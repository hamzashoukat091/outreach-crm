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
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def _uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)


class LeadStatus(str, enum.Enum):
    new = "new"
    contacted = "contacted"
    replied = "replied"
    qualified = "qualified"
    won = "won"
    lost = "lost"
    unsubscribed = "unsubscribed"


class EnrollmentStatus(str, enum.Enum):
    active = "active"
    paused = "paused"
    completed = "completed"
    stopped = "stopped"


class SendStatus(str, enum.Enum):
    scheduled = "scheduled"
    sent = "sent"
    failed = "failed"
    canceled = "canceled"


class ActivityType(str, enum.Enum):
    created = "created"
    status_changed = "status_changed"
    note = "note"
    email_sent = "email_sent"
    email_failed = "email_failed"
    enrolled = "enrolled"
    unenrolled = "unenrolled"
    replied = "replied"


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Lead(Base, TimestampMixin):
    __tablename__ = "leads"

    id: Mapped[uuid.UUID] = _uuid_pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    company: Mapped[str | None] = mapped_column(String(200), index=True)
    title: Mapped[str | None] = mapped_column(String(200))
    phone: Mapped[str | None] = mapped_column(String(50))
    website: Mapped[str | None] = mapped_column(String(300))
    source: Mapped[str | None] = mapped_column(String(120))
    status: Mapped[LeadStatus] = mapped_column(
        Enum(LeadStatus, name="lead_status"), default=LeadStatus.new, nullable=False, index=True
    )
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list, nullable=False)
    # Arbitrary merge fields available to templates as {{custom.key}}.
    custom_fields: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)

    enrollments: Mapped[list["Enrollment"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan"
    )
    activities: Mapped[list["Activity"]] = relationship(
        back_populates="lead", cascade="all, delete-orphan", order_by="Activity.created_at.desc()"
    )

    @property
    def full_name(self) -> str:
        parts = [p for p in (self.first_name, self.last_name) if p]
        return " ".join(parts) or self.email.split("@")[0]


class Sequence(Base, TimestampMixin):
    __tablename__ = "sequences"

    id: Mapped[uuid.UUID] = _uuid_pk()
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    steps: Mapped[list["SequenceStep"]] = relationship(
        back_populates="sequence",
        cascade="all, delete-orphan",
        order_by="SequenceStep.step_order",
    )
    enrollments: Mapped[list["Enrollment"]] = relationship(
        back_populates="sequence", cascade="all, delete-orphan"
    )


class SequenceStep(Base, TimestampMixin):
    __tablename__ = "sequence_steps"
    __table_args__ = (UniqueConstraint("sequence_id", "step_order", name="uq_step_order"),)

    id: Mapped[uuid.UUID] = _uuid_pk()
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_order: Mapped[int] = mapped_column(Integer, nullable=False)
    # Days to wait after enrollment before this step is due.
    delay_days: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    subject: Mapped[str] = mapped_column(String(500), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)

    sequence: Mapped[Sequence] = relationship(back_populates="steps")


class Enrollment(Base, TimestampMixin):
    __tablename__ = "enrollments"
    __table_args__ = (
        UniqueConstraint("lead_id", "sequence_id", name="uq_lead_sequence"),
        Index("ix_enrollment_status", "status"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    lead_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    sequence_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequences.id", ondelete="CASCADE"), nullable=False, index=True
    )
    status: Mapped[EnrollmentStatus] = mapped_column(
        Enum(EnrollmentStatus, name="enrollment_status"),
        default=EnrollmentStatus.active,
        nullable=False,
    )
    current_step: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    enrolled_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    lead: Mapped[Lead] = relationship(back_populates="enrollments")
    sequence: Mapped[Sequence] = relationship(back_populates="enrollments")
    # Ordered by when each send is due, so the UI can render steps in sequence.
    sends: Mapped[list["ScheduledSend"]] = relationship(
        back_populates="enrollment",
        cascade="all, delete-orphan",
        order_by="ScheduledSend.scheduled_for",
    )


class ScheduledSend(Base, TimestampMixin):
    __tablename__ = "scheduled_sends"
    __table_args__ = (
        UniqueConstraint("enrollment_id", "step_id", name="uq_enrollment_step"),
        Index("ix_send_due", "status", "scheduled_for"),
    )

    id: Mapped[uuid.UUID] = _uuid_pk()
    enrollment_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("enrollments.id", ondelete="CASCADE"), nullable=False, index=True
    )
    step_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("sequence_steps.id", ondelete="CASCADE"), nullable=False
    )
    scheduled_for: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[SendStatus] = mapped_column(
        Enum(SendStatus, name="send_status"), default=SendStatus.scheduled, nullable=False
    )
    # Rendered at send time so the timeline shows exactly what went out.
    rendered_subject: Mapped[str | None] = mapped_column(String(500))
    rendered_body: Mapped[str | None] = mapped_column(Text)
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    error: Mapped[str | None] = mapped_column(Text)

    enrollment: Mapped[Enrollment] = relationship(back_populates="sends")
    step: Mapped[SequenceStep] = relationship(lazy="joined")

    @property
    def step_order(self) -> int | None:
        return self.step.step_order if self.step else None


class Activity(Base):
    __tablename__ = "activities"

    id: Mapped[uuid.UUID] = _uuid_pk()
    lead_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("leads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    type: Mapped[ActivityType] = mapped_column(
        Enum(ActivityType, name="activity_type"), nullable=False
    )
    summary: Mapped[str] = mapped_column(String(500), nullable=False)
    detail: Mapped[dict] = mapped_column(JSONB, default=dict, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    lead: Mapped[Lead] = relationship(back_populates="activities")
