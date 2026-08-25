"""The automated side of the app.

Everything here operates on `prospects`. The original MVP had its own `leads`
table with a parallel sequencing model; that split meant the 48 imported
prospects were unreachable from automation, so it was removed in favour of one
record with a mode flag.

The manual side (EmailDraft) and this side (Message) stay separate on purpose.
A draft is something the user copies out by hand; a message is something the
system actually put on the wire, and it carries delivery state, RFC headers and
threading that a draft has no use for.
"""

import enum
import uuid
from datetime import datetime, time

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    Time,
    UniqueConstraint,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class PipelineMode(str, enum.Enum):
    """Who sends this prospect's email."""

    manual = "manual"        # Outreach section: user copies and sends
    automated = "automated"  # Sequences section: the system sends


class EnrollmentState(str, enum.Enum):
    active = "active"
    paused = "paused"
    replied = "replied"        # they answered; steps cancelled, reply mode on
    stopped = "stopped"        # unsubscribed or manually stopped
    bounced = "bounced"
    completed = "completed"    # every step sent, no reply


class MessageDirection(str, enum.Enum):
    outbound = "outbound"
    inbound = "inbound"


class MessageKind(str, enum.Enum):
    opener = "opener"          # step 1 of a sequence
    follow_up = "follow_up"    # steps 2+
    reply = "reply"            # our answer to something they sent
    incoming = "incoming"      # what they sent us


class MessageState(str, enum.Enum):
    drafting = "drafting"          # generation in flight
    scheduled = "scheduled"        # written, waiting for its send time
    needs_approval = "needs_approval"  # held: risky or low confidence
    sending = "sending"            # claimed by a worker
    sent = "sent"
    failed = "failed"
    cancelled = "cancelled"        # they replied/stopped before it went out
    received = "received"          # inbound only


class StrategyKind(str, enum.Enum):
    opener = "opener"  # cold first-touch and follow-ups
    reply = "reply"    # answering something they wrote


class ReplySituation(str, enum.Enum):
    """What an incoming reply is doing.

    The classifier picks one of these, then the highest-priority active reply
    strategy for that situation writes the response. Keeping the situation
    separate from the strategy means you can rewrite how "interested" is
    handled without touching how replies are recognised.
    """

    interested = "interested"
    question = "question"            # pricing, scope, tech, availability
    objection = "objection"
    not_now = "not_now"              # circle back later
    referral = "referral"            # go talk to someone else
    not_interested = "not_interested"
    unsubscribe = "unsubscribe"
    auto_reply = "auto_reply"        # OOO, autoresponder -- never answer these
    unclear = "unclear"              # always escalated


class SuppressionReason(str, enum.Enum):
    unsubscribed = "unsubscribed"
    hard_bounce = "hard_bounce"
    complained = "complained"
    manual = "manual"


# Situations that must never be auto-sent regardless of model confidence.
# Money and legal talk gets a human; hostile replies get a human; an
# autoresponder gets nothing at all.
ALWAYS_ESCALATE = {
    ReplySituation.question,
    ReplySituation.objection,
    ReplySituation.unclear,
}


class Sequence(Base):
    """An ordered set of steps a prospect walks through."""

    __tablename__ = "sequences"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    steps: Mapped[list["SequenceStep"]] = relationship(
        back_populates="sequence",
        cascade="all, delete-orphan",
        order_by="SequenceStep.position",
    )
    enrollments: Mapped[list["SequenceEnrollment"]] = relationship(
        back_populates="sequence", cascade="all, delete-orphan"
    )


class SequenceStep(Base):
    """One scheduled touch: wait N days, then write with this strategy.

    There is no body here. Every step is written by Claude at send time using
    the strategy plus the thread so far -- a stored template would go stale
    against a conversation it cannot see.
    """

    __tablename__ = "sequence_steps"
    __table_args__ = (UniqueConstraint("sequence_id", "position", name="uq_step_position"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True
    )
    position: Mapped[int] = mapped_column(Integer, nullable=False)

    # Days after the previous step (or after enrolling, for position 1).
    wait_days: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    # Time of day to send. None means "use the account default".
    send_at_time: Mapped[time | None] = mapped_column(Time)

    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL"), index=True
    )
    # Free-text nudge for this specific step, on top of the strategy.
    step_instructions: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    sequence: Mapped[Sequence] = relationship(back_populates="steps")
    strategy: Mapped["object | None"] = relationship("Strategy")


class SequenceEnrollment(Base):
    """One prospect walking through one sequence."""

    __tablename__ = "sequence_enrollments"
    __table_args__ = (
        Index("ix_enrollment_state", "state"),
        Index("ix_enrollment_prospect", "prospect_id"),
        # A prospect may be re-enrolled after a sequence ends, but must not run
        # through the same one twice at once -- that would send every step
        # twice. Enforced in the database rather than in the API so a bulk
        # enroll and a single enroll racing each other still cannot do it.
        Index(
            "uq_open_enrollment",
            "prospect_id",
            "sequence_id",
            unique=True,
            postgresql_where=text("state IN ('active', 'paused')"),
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), nullable=False
    )
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True
    )

    state: Mapped[EnrollmentState] = mapped_column(
        Enum(EnrollmentState, name="enrollment_state"),
        default=EnrollmentState.active,
        nullable=False,
    )
    current_position: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    # RFC threading. Every message in this enrollment shares a thread so their
    # mail client groups it and our IMAP poller can match replies by header.
    thread_root_message_id: Mapped[str | None] = mapped_column(String(400), index=True)
    thread_subject: Mapped[str | None] = mapped_column(String(500))

    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    end_reason: Mapped[str | None] = mapped_column(String(300))
    last_activity_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    sequence: Mapped[Sequence] = relationship(back_populates="enrollments")
    prospect: Mapped["object"] = relationship("Prospect")
    messages: Mapped[list["Message"]] = relationship(
        back_populates="enrollment",
        cascade="all, delete-orphan",
        order_by="Message.created_at",
    )

    @property
    def is_open(self) -> bool:
        return self.state in (EnrollmentState.active, EnrollmentState.paused)


class Message(Base):
    """One email, in either direction.

    Outbound rows carry the full generation provenance -- the same fields
    EmailDraft stores -- so an automated send is as auditable as a manual one.
    """

    __tablename__ = "messages"
    __table_args__ = (
        Index("ix_message_state_due", "state", "scheduled_for"),
        Index("ix_message_prospect", "prospect_id"),
        # Guards against the same inbound email being ingested twice if the
        # IMAP poller restarts mid-batch.
        UniqueConstraint("dedupe_key", name="uq_message_dedupe"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), nullable=False
    )
    enrollment_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sequence_enrollments.id", ondelete="CASCADE"), index=True
    )
    step_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("sequence_steps.id", ondelete="SET NULL")
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL")
    )

    direction: Mapped[MessageDirection] = mapped_column(
        Enum(MessageDirection, name="message_direction"), nullable=False
    )
    kind: Mapped[MessageKind] = mapped_column(
        Enum(MessageKind, name="message_kind"), nullable=False
    )
    state: Mapped[MessageState] = mapped_column(
        Enum(MessageState, name="message_state"), nullable=False
    )

    subject: Mapped[str | None] = mapped_column(String(500))
    body: Mapped[str | None] = mapped_column(Text)

    from_address: Mapped[str | None] = mapped_column(String(320))
    to_address: Mapped[str | None] = mapped_column(String(320))

    # RFC 5322 headers, kept so replies thread correctly in their client and so
    # inbound mail can be matched back to the conversation that caused it.
    rfc_message_id: Mapped[str | None] = mapped_column(String(400), index=True)
    in_reply_to: Mapped[str | None] = mapped_column(String(400), index=True)
    references: Mapped[str | None] = mapped_column(Text)
    dedupe_key: Mapped[str | None] = mapped_column(String(400))

    # Gmail linkage. email_message_id points at the stored email this pipeline
    # row came from (inbound only); gmail_thread_id is denormalised so reply
    # matching can thread by Google's own id without a join -- see 0010.
    email_message_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("email_messages.id", ondelete="SET NULL"), index=True
    )
    gmail_thread_id: Mapped[str | None] = mapped_column(String(64), index=True)

    scheduled_for: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(Text)
    # True when this was written but deliberately not delivered (dry run).
    simulated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- Reply handling (inbound rows and the replies they produce) ---
    situation: Mapped[ReplySituation | None] = mapped_column(
        Enum(ReplySituation, name="reply_situation")
    )
    classification_confidence: Mapped[int | None] = mapped_column(Integer)  # 0-100
    classification_reason: Mapped[str | None] = mapped_column(Text)
    escalated: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    escalation_reason: Mapped[str | None] = mapped_column(String(400))
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # --- Generation provenance (mirrors EmailDraft) ---
    model: Mapped[str | None] = mapped_column(String(120))
    strategy_name: Mapped[str | None] = mapped_column(String(200))
    context_quality: Mapped[str | None] = mapped_column(String(40))
    context_used: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    system_prompt: Mapped[str | None] = mapped_column(Text)
    user_prompt: Mapped[str | None] = mapped_column(Text)
    raw_response: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    enrollment: Mapped[SequenceEnrollment | None] = relationship(back_populates="messages")
    prospect: Mapped["object"] = relationship("Prospect")


class Suppression(Base):
    """Never contact this address again.

    Deliberately keyed on the email rather than the prospect id: re-importing
    the CSV creates or updates prospect rows, and an unsubscribe must survive
    that. Checked immediately before every send.
    """

    __tablename__ = "suppressions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    reason: Mapped[SuppressionReason] = mapped_column(
        Enum(SuppressionReason, name="suppression_reason"), nullable=False
    )
    detail: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )


class SenderFacts(Base):
    """The only source Claude may draw on when answering a question.

    Separate from SenderProfile: that one sells (offer, proof, CTA), this one
    answers (rates, availability, stack, hard limits). Anything a reply asks
    that is not covered here gets escalated instead of guessed at.
    """

    __tablename__ = "sender_facts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    rates: Mapped[str | None] = mapped_column(Text)
    availability: Mapped[str | None] = mapped_column(Text)
    tech_stack: Mapped[str | None] = mapped_column(Text)
    process: Mapped[str | None] = mapped_column(Text)
    booking_link: Mapped[str | None] = mapped_column(String(400))
    portfolio_link: Mapped[str | None] = mapped_column(String(400))
    # Explicit refusals: topics Claude must escalate rather than answer.
    do_not_answer: Mapped[str | None] = mapped_column(Text)
    extra_facts: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    @property
    def is_configured(self) -> bool:
        return any(
            (v or "").strip()
            for v in (self.rates, self.availability, self.tech_stack, self.extra_facts)
        )


# Shipped defaults, in one place so the model, the API and the "reset" button in
# the control panel cannot drift apart. Transport fields are excluded on
# purpose: resetting a section should never silently wipe mail credentials.
DEFAULT_SETTINGS: dict = {
    "dry_run": True,
    "sending_paused": False,
    "send_window_start": time(9, 0),
    "send_window_end": time(17, 0),
    "send_days": [1, 2, 3, 4, 5],
    "timezone": "UTC",
    "hourly_send_limit": 20,
    "daily_send_limit": 100,
    "default_delay_days": 1,
    "default_send_time": time(9, 0),
    "auto_reply_enabled": True,
    "min_confidence_to_send": 75,
    "always_review_first_reply": True,
    "escalate_situations": [],
}

# Which fields the control panel groups together, so one section can be reset
# without touching the others.
SETTINGS_SECTIONS: dict[str, tuple[str, ...]] = {
    "safety": ("dry_run", "sending_paused"),
    "schedule": (
        "send_window_start",
        "send_window_end",
        "send_days",
        "timezone",
        "default_delay_days",
        "default_send_time",
    ),
    "limits": ("hourly_send_limit", "daily_send_limit"),
    "replies": (
        "auto_reply_enabled",
        "min_confidence_to_send",
        "always_review_first_reply",
        "escalate_situations",
    ),
}


class AutomationSettings(Base):
    """Operator controls. Single row.

    Every guardrail lives here rather than in code so the schedule can be
    changed without a deploy -- set the window to 00:00-23:59 across all seven
    days and sends become genuinely immediate.
    """

    __tablename__ = "automation_settings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # Nothing leaves the building while this is on. Default on: a fresh install
    # must not be one SMTP config away from mailing real people.
    dry_run: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Panic button, independent of dry_run so it can be flipped without
    # disturbing the configured mode.
    sending_paused: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    send_window_start: Mapped[time] = mapped_column(Time, default=time(9, 0), nullable=False)
    send_window_end: Mapped[time] = mapped_column(Time, default=time(17, 0), nullable=False)
    # ISO weekday numbers, 1=Mon .. 7=Sun.
    send_days: Mapped[list] = mapped_column(JSONB, default=lambda: [1, 2, 3, 4, 5], nullable=False)
    timezone: Mapped[str] = mapped_column(String(80), default="UTC", nullable=False)

    hourly_send_limit: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    daily_send_limit: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # Default enrollment timing.
    default_delay_days: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    default_send_time: Mapped[time] = mapped_column(Time, default=time(9, 0), nullable=False)

    # Reply automation.
    auto_reply_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    min_confidence_to_send: Mapped[int] = mapped_column(Integer, default=75, nullable=False)
    # Hold the first reply from any given person even when confident, so the
    # user sees how it behaves before it runs unattended.
    always_review_first_reply: Mapped[bool] = mapped_column(
        Boolean, default=True, nullable=False
    )
    # Situations that are always held for approval, on top of ALWAYS_ESCALATE.
    escalate_situations: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # --- Outbound mail transport ---
    # Editable here so the user can point at their own mailbox without a
    # redeploy. Empty host falls back to the env-configured Mailpit.
    smtp_host: Mapped[str | None] = mapped_column(String(300))
    smtp_port: Mapped[int | None] = mapped_column(Integer)
    smtp_username: Mapped[str | None] = mapped_column(String(300))
    smtp_password: Mapped[str | None] = mapped_column(String(500))
    smtp_use_tls: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    from_address: Mapped[str | None] = mapped_column(String(320))
    from_name: Mapped[str | None] = mapped_column(String(200))
    reply_to: Mapped[str | None] = mapped_column(String(320))

    # --- Inbound mail (reply detection) ---

    # Stamped by the worker each tick. Kept on this row (rather than a separate
    # table) because the worker already reads it every loop; the status endpoint
    # treats a stale stamp as "worker down".
    worker_heartbeat_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )
