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
    # False when the export gave us an email but no company context. Surfaced in
    # the UI so a thin generation is never mistaken for a well-grounded one.
    is_complete: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    missing_fields: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    company_inferred: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

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


class Strategy(Base):
    """A saved, editable generation prompt."""

    __tablename__ = "strategies"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text)

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
