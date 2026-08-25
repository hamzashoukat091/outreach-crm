"""Gmail sync: a stored mailbox, and the link from mail to the CRM pipeline.

Replaces polling IMAP-at-read-time with a real archive. Two tables, kept
deliberately separate:

  gmail_accounts  -- the connection and, critically, the sync cursor
  email_messages  -- one row per email in the mailbox, body and all

`messages` is NOT replaced. It remains the CRM pipeline: what we drafted, what
we scheduled, what the classifier decided. An inbound prospect reply now
exists in both -- as the raw email in email_messages, and as the pipeline
event in messages -- joined by messages.email_message_id rather than copied.
Merging them was the alternative and it fails in both directions: the pipeline
has rows that are not email (drafts that never sent), and the mailbox has mail
that is not pipeline (everything from non-prospects).

The gmail_thread_id column on messages is denormalised on purpose. Reply
matching runs per inbound message and threading by Google's own thread id is
the authoritative path; making it a join through email_messages would put a
second table in the hot path of every reply.

Revision ID: 0010
Revises: 0009
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---- The connection -------------------------------------------------
    #
    # One row, enforced below. Not env-only because history_id is mutable
    # state that has to survive a redeploy: losing it silently re-syncs the
    # whole window and re-runs the classifier over old mail.
    op.create_table(
        "gmail_accounts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("email_address", sa.String(320), nullable=False),
        # The cursor. Null means "never synced" and triggers a full sync.
        # BigInteger: Gmail's historyId is a uint64 and outgrows int4 on
        # long-lived mailboxes.
        sa.Column("history_id", sa.BigInteger()),
        sa.Column("sync_enabled", sa.Boolean(), server_default=sa.true(), nullable=False),
        sa.Column("last_synced_at", sa.DateTime(timezone=True)),
        # Surfaced in the UI. A mailbox that stopped syncing looks identical
        # to a quiet one, so the failure has to be visible somewhere.
        sa.Column("last_error", sa.Text()),
        sa.Column("last_error_at", sa.DateTime(timezone=True)),
        # Counts full syncs. A number that climbs on its own means the cursor
        # keeps expiring -- the worker is down longer than Gmail's history
        # retention, which is roughly a week.
        sa.Column("full_sync_count", sa.Integer(), server_default="0", nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index(
        "ix_gmail_accounts_email", "gmail_accounts", ["email_address"], unique=True
    )
    # Single-row guard. The sync service assumes one mailbox; a second row
    # would give two cursors racing over the same email_messages table.
    op.create_index(
        "ix_gmail_accounts_singleton",
        "gmail_accounts",
        [sa.text("(true)")],
        unique=True,
    )

    # ---- The mailbox ----------------------------------------------------
    op.create_table(
        "email_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "account_id",
            UUID(as_uuid=True),
            sa.ForeignKey("gmail_accounts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        # Gmail's own ids. gmail_id is the dedupe key -- assigned by Google,
        # immutable, and present on every message, which RFC Message-Id is
        # not (broken senders omit it and the old code had to synthesise one).
        sa.Column("gmail_id", sa.String(64), nullable=False),
        sa.Column("gmail_thread_id", sa.String(64), nullable=False),
        # RFC headers, kept so the existing header-based reply matching still
        # works for anything that arrives outside Gmail sync.
        sa.Column("rfc_message_id", sa.String(400)),
        sa.Column("in_reply_to", sa.String(400)),
        sa.Column("references", sa.Text()),
        sa.Column("from_address", sa.String(320)),
        sa.Column("from_name", sa.String(300)),
        # Lists, not scalars: a real email has many recipients and flattening
        # them to one column loses who else was on the thread.
        sa.Column("to_addresses", JSONB(), server_default="[]", nullable=False),
        sa.Column("cc_addresses", JSONB(), server_default="[]", nullable=False),
        sa.Column("reply_to", sa.String(320)),
        sa.Column("subject", sa.Text()),
        sa.Column("snippet", sa.Text()),
        sa.Column("body_text", sa.Text()),
        # The inbox renders this. Stored raw and sanitised at render time
        # rather than on the way in: sanitising once here would mean a fix to
        # the sanitiser could never be applied to mail already stored.
        sa.Column("body_html", sa.Text()),
        # Metadata only -- filename, mime type, size. Not the bytes: a 25MB
        # attachment per row bloats Postgres fast and Gmail already holds it.
        sa.Column("attachments", JSONB(), server_default="[]", nullable=False),
        sa.Column("label_ids", JSONB(), server_default="[]", nullable=False),
        sa.Column("is_unread", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_sent", sa.Boolean(), server_default=sa.false(), nullable=False),
        sa.Column("is_draft", sa.Boolean(), server_default=sa.false(), nullable=False),
        # Nullable: most mail is not from a prospect. Set at sync time when
        # the sender matches, which is what the inbox's "Prospects" filter
        # reads. SET NULL rather than CASCADE -- deleting a prospect should
        # not silently delete the mail they sent.
        sa.Column(
            "prospect_id",
            UUID(as_uuid=True),
            sa.ForeignKey("prospects.id", ondelete="SET NULL"),
            index=True,
        ),
        # Gmail's internalDate, not the Date: header. The header is written
        # by the sender and is routinely wrong or forged; internalDate is
        # when Google received it.
        sa.Column("internal_date", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "synced_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    # The dedupe guarantee. Unique on (account, gmail_id) rather than
    # gmail_id alone: ids are only unique within a mailbox.
    op.create_index(
        "ix_email_messages_gmail_id",
        "email_messages",
        ["account_id", "gmail_id"],
        unique=True,
    )
    op.create_index(
        "ix_email_messages_thread", "email_messages", ["gmail_thread_id"]
    )
    op.create_index("ix_email_messages_from", "email_messages", ["from_address"])
    op.create_index("ix_email_messages_rfc_id", "email_messages", ["rfc_message_id"])
    # The inbox list query: newest first, optionally filtered to prospects.
    op.create_index(
        "ix_email_messages_internal_date",
        "email_messages",
        [sa.text("internal_date DESC")],
    )

    # ---- The link -------------------------------------------------------
    op.add_column(
        "messages",
        sa.Column(
            "email_message_id",
            UUID(as_uuid=True),
            sa.ForeignKey("email_messages.id", ondelete="SET NULL"),
        ),
    )
    op.add_column("messages", sa.Column("gmail_thread_id", sa.String(64)))
    op.create_index(
        "ix_messages_email_message_id", "messages", ["email_message_id"]
    )
    op.create_index("ix_messages_gmail_thread", "messages", ["gmail_thread_id"])


def downgrade() -> None:
    op.drop_index("ix_messages_gmail_thread", table_name="messages")
    op.drop_index("ix_messages_email_message_id", table_name="messages")
    op.drop_column("messages", "gmail_thread_id")
    op.drop_column("messages", "email_message_id")
    op.drop_table("email_messages")
    op.drop_table("gmail_accounts")
