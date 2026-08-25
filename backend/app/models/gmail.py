"""The stored mailbox.

GmailAccount holds the connection and the sync cursor; EmailMessage is one
row per email. Kept in their own module rather than in automation.py because
they model a mailbox, not the outreach pipeline -- most rows here have nothing
to do with a prospect.

The relationship to the pipeline runs the other way: Message.email_message_id
points here. See migration 0010 for why the two are not merged.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


class GmailAccount(Base):
    """The connected mailbox. One row, guarded by a unique index.

    The credentials themselves live in the environment, not here -- this row
    holds only what has to be mutable and durable: the cursor, and whether
    the last sync worked.
    """

    __tablename__ = "gmail_accounts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email_address: Mapped[str] = mapped_column(String(320), nullable=False, unique=True, index=True)

    # Gmail's historyId. None means never synced, which triggers a full sync.
    # BigInteger because it is a uint64 upstream.
    history_id: Mapped[int | None] = mapped_column(BigInteger)

    sync_enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # A mailbox that stopped syncing looks exactly like a quiet one. This is
    # what makes the difference visible.
    last_error: Mapped[str | None] = mapped_column(Text)
    last_error_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Climbs on its own only when the cursor keeps expiring, i.e. the worker
    # is down for longer than Gmail's history retention.
    full_sync_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )

    messages: Mapped[list["EmailMessage"]] = relationship(
        back_populates="account", cascade="all, delete-orphan"
    )


class EmailMessage(Base):
    """One email, stored whole.

    Deliberately a faithful copy of what Gmail holds rather than a projection
    onto what the CRM currently needs: re-fetching a mailbox to add a column
    is slow and rate-limited, and the history cursor may no longer reach far
    enough back to do it at all.
    """

    __tablename__ = "email_messages"
    __table_args__ = (
        # Gmail ids are unique per mailbox, not globally.
        Index("ix_email_messages_gmail_id", "account_id", "gmail_id", unique=True),
        Index("ix_email_messages_thread", "gmail_thread_id"),
        Index("ix_email_messages_from", "from_address"),
        Index("ix_email_messages_rfc_id", "rfc_message_id"),
        Index("ix_email_messages_internal_date", text("internal_date DESC")),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    account_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("gmail_accounts.id", ondelete="CASCADE"), nullable=False
    )

    gmail_id: Mapped[str] = mapped_column(String(64), nullable=False)
    gmail_thread_id: Mapped[str] = mapped_column(String(64), nullable=False)

    rfc_message_id: Mapped[str | None] = mapped_column(String(400))
    in_reply_to: Mapped[str | None] = mapped_column(String(400))
    references: Mapped[str | None] = mapped_column(Text)

    from_address: Mapped[str | None] = mapped_column(String(320))
    from_name: Mapped[str | None] = mapped_column(String(300))
    to_addresses: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    cc_addresses: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    reply_to: Mapped[str | None] = mapped_column(String(320))

    subject: Mapped[str | None] = mapped_column(Text)
    snippet: Mapped[str | None] = mapped_column(Text)
    body_text: Mapped[str | None] = mapped_column(Text)
    # Sanitised at render time, not here -- see migration 0010.
    body_html: Mapped[str | None] = mapped_column(Text)

    # Metadata only. The bytes stay in Gmail.
    attachments: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)
    label_ids: Mapped[list] = mapped_column(JSONB, default=list, nullable=False)

    is_unread: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_sent: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_draft: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Null for the majority of mail. Set when the sender matches a prospect.
    prospect_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("prospects.id", ondelete="SET NULL"), index=True
    )

    # Gmail's internalDate: when Google received it. The Date: header is
    # sender-supplied and routinely wrong.
    internal_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    synced_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    account: Mapped[GmailAccount] = relationship(back_populates="messages")
    prospect: Mapped["object | None"] = relationship("Prospect")
