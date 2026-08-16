import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class ProspectStatus(str, enum.Enum):
    new = "new"
    drafted = "drafted"       # an email has been generated but not approved
    approved = "approved"     # approved + copied = sent manually
    replied = "replied"
    bounced = "bounced"
    not_interested = "not_interested"
    won = "won"
    archived = "archived"


class DraftStatus(str, enum.Enum):
    draft = "draft"
    approved = "approved"     # approving means "I copied this and sent it"
    discarded = "discarded"
    failed = "failed"


class ProspectEventType(str, enum.Enum):
    imported = "imported"
    updated = "updated"
    generated = "generated"
    approved = "approved"
    replied = "replied"
    bounced = "bounced"
    status_changed = "status_changed"
    note = "note"
    archived = "archived"
    unarchived = "unarchived"
    # --- automation ---
    handed_off = "handed_off"          # manual -> automated
    returned_to_manual = "returned_to_manual"
    enrolled = "enrolled"
    unenrolled = "unenrolled"
    message_scheduled = "message_scheduled"
    message_sent = "message_sent"
    message_failed = "message_failed"
    reply_received = "reply_received"
    reply_sent = "reply_sent"
    escalated = "escalated"
    suppressed = "suppressed"


class Prospect(Base):
    """A row from the enrichment export.

    Kept separate from Lead: this table mirrors the vendor's column set and its
    sparsity, rather than forcing that shape onto the sequencing model.
    """

    __tablename__ = "prospects"
    __table_args__ = (
        Index("ix_prospect_company", "company_name"),
        Index("ix_prospect_status", "status"),
        Index("ix_prospect_complete", "is_complete"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    # --- Identity / dedupe ---
    # The vendor's ids are the natural key; email is the fallback for hand-made rows.
    prospect_ref: Mapped[str | None] = mapped_column(String(128), unique=True, index=True)
    business_ref: Mapped[str | None] = mapped_column(String(128), index=True)

    # --- Prospect ---
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    email_status: Mapped[str | None] = mapped_column(String(40))
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    job_title: Mapped[str | None] = mapped_column(String(300))
    job_department: Mapped[str | None] = mapped_column(String(160))
    seniority: Mapped[str | None] = mapped_column(String(80), index=True)
    linkedin: Mapped[str | None] = mapped_column(String(400))
    prospect_city: Mapped[str | None] = mapped_column(String(160))
    prospect_region: Mapped[str | None] = mapped_column(String(160))
    prospect_country: Mapped[str | None] = mapped_column(String(160))
    skills: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    interests: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    experience: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    other_emails: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # --- Company (frequently absent in the export) ---
    company_name: Mapped[str | None] = mapped_column(String(300))
    company_domain: Mapped[str | None] = mapped_column(String(300), index=True)
    company_website: Mapped[str | None] = mapped_column(String(400))
    company_description: Mapped[str | None] = mapped_column(Text)
    company_city: Mapped[str | None] = mapped_column(String(160))
    company_region: Mapped[str | None] = mapped_column(String(160))
    company_country: Mapped[str | None] = mapped_column(String(160))
    employee_range: Mapped[str | None] = mapped_column(String(60))
    revenue_range: Mapped[str | None] = mapped_column(String(60))
    industry: Mapped[str | None] = mapped_column(String(300))
    naics: Mapped[str | None] = mapped_column(String(40))
    sic_code: Mapped[str | None] = mapped_column(String(40))
    company_logo: Mapped[str | None] = mapped_column(String(600))
    # [{topic, score}] — the strongest buying signal in this dataset.
    intent_topics: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    # --- Workflow ---
    status: Mapped[ProspectStatus] = mapped_column(
        Enum(ProspectStatus, name="prospect_status"),
        default=ProspectStatus.new,
        nullable=False,
    )
    # Which side of the app owns this prospect: 'manual' (Outreach section,
    # drafts copied by hand) or 'automated' (Sequences section, system sends).
    # A plain string rather than the PipelineMode enum so flipping it never
    # requires an ALTER TYPE.
    pipeline_mode: Mapped[str] = mapped_column(
        String(20), default="manual", nullable=False, index=True
    )
    # Which sourcing run this prospect came from -- the vertical you searched
    # for, set once at import. A column rather than a tag because it is exactly
    # one value per prospect and the whole point is grouping by it: reply rate
    # per category is how you learn which vertical is worth more credits.
    category: Mapped[str | None] = mapped_column(String(60), index=True)

    # False when the export gave us an email but no company context. Surfaced in
    # the UI so a thin generation is never mistaken for a well-grounded one.
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    missing_fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    company_inferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Archiving is deliberately a flag, not a status: setting status='archived'
    # would erase whether they replied or bounced. A shelved prospect keeps its
    # real outcome and can be restored to exactly where it was.
    is_archived: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, index=True
    )
    archived_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    archive_reason: Mapped[str | None] = mapped_column(String(300))

    tags: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    # Anything in the CSV we don't have a column for, so no data is discarded.
    extra: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    source_row: Mapped[int | None] = mapped_column(Integer)
    imported_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    drafts: Mapped[list["EmailDraft"]] = relationship(
        back_populates="prospect",
        cascade="all, delete-orphan",
        order_by="EmailDraft.created_at.desc()",
    )
    events: Mapped[list["ProspectEvent"]] = relationship(
        back_populates="prospect",
        cascade="all, delete-orphan",
        order_by="ProspectEvent.created_at.desc()",
    )

    @property
    def full_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) or self.email.split("@")[0]

    @property
    def display_company(self) -> str:
        return self.company_name or self.company_domain or "—"

    @property
    def top_intent(self) -> str | None:
        if not self.intent_topics:
            return None
        best = max(self.intent_topics, key=lambda t: t.get("score", 0))
        return best.get("topic")


class SenderProfile(Base):
    """Who is sending, and what they offer.

    Single row. Without this the prompt describes the prospect but never the
    sender, so the model invents a vague "we help teams" pitch. Naming the
    actual offer is what lets it write a specific one.
    """

    __tablename__ = "sender_profile"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    name: Mapped[str | None] = mapped_column(String(200))
    headline: Mapped[str | None] = mapped_column(String(300))
    # The core of it: skills, services, and the problems they solve.
    offer: Mapped[str | None] = mapped_column(Text)
    # Concrete proof -- past work, results, stack. Never invented by the model.
    proof: Mapped[str | None] = mapped_column(Text)
    # What a reply should lead to (call, reply, portfolio link).
    call_to_action: Mapped[str | None] = mapped_column(String(400))
    signature: Mapped[str | None] = mapped_column(String(200))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    @property
    def is_configured(self) -> bool:
        return bool((self.offer or "").strip())


class Strategy(Base):
    """A saved, editable generation prompt.

    kind='opener' strategies write cold first-touches and follow-ups; the user
    picks one per sequence step. kind='reply' strategies answer inbound mail;
    the classifier picks one by matching the reply's situation, taking the
    highest-priority active strategy when several claim the same situation.
    """

    __tablename__ = "strategies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

    kind: Mapped[str] = mapped_column(
        String(20), default="opener", nullable=False, index=True
    )
    # Reply strategies only: which classified situation this handles.
    reply_situation: Mapped[str | None] = mapped_column(String(40), index=True)
    # Routing order when several reply strategies handle the same situation.
    priority: Mapped[int] = mapped_column(Integer, default=100, nullable=False)

    # The editable prompt surface.
    system_prompt: Mapped[str] = mapped_column(Text, nullable=False)
    instructions: Mapped[str] = mapped_column(Text, nullable=False)
    tone: Mapped[str | None] = mapped_column(String(120))
    max_words: Mapped[int] = mapped_column(Integer, default=150, nullable=False)
    subject_hint: Mapped[str | None] = mapped_column(String(400))

    is_default: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    drafts: Mapped[list["EmailDraft"]] = relationship(back_populates="strategy")


class EmailDraft(Base):
    """One generated email. Approving it means the user copied and sent it."""

    __tablename__ = "email_drafts"
    __table_args__ = (Index("ix_draft_status", "status"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    strategy_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("strategies.id", ondelete="SET NULL"), index=True
    )

    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    status: Mapped[DraftStatus] = mapped_column(
        Enum(DraftStatus, name="draft_status"), default=DraftStatus.draft, nullable=False
    )

    # Provenance: which model, which prompt, how much context it actually had.
    model: Mapped[str | None] = mapped_column(String(120))
    strategy_name: Mapped[str | None] = mapped_column(String(200))
    context_quality: Mapped[str | None] = mapped_column(String(40))  # rich | thin
    context_used: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)

    # The exact strings sent to the API for THIS draft, stored verbatim.
    # A strategy can be edited later, so re-deriving the prompt from it would
    # show what the prompt is now, not what produced this email.
    system_prompt: Mapped[str | None] = mapped_column(Text)
    user_prompt: Mapped[str | None] = mapped_column(Text)
    raw_response: Mapped[str | None] = mapped_column(Text)
    input_tokens: Mapped[int | None] = mapped_column(Integer)
    output_tokens: Mapped[int | None] = mapped_column(Integer)
    error: Mapped[str | None] = mapped_column(Text)

    # Set when the user approves (= copied and sent by hand).
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    edited: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    prospect: Mapped[Prospect] = relationship(back_populates="drafts")
    strategy: Mapped[Strategy | None] = relationship(back_populates="drafts")


class ProspectEvent(Base):
    """Append-only timeline for a prospect."""

    __tablename__ = "prospect_events"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    prospect_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("prospects.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[ProspectEventType] = mapped_column(
        Enum(ProspectEventType, name="prospect_event_type"), nullable=False
    )
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    prospect: Mapped[Prospect] = relationship(back_populates="events")
