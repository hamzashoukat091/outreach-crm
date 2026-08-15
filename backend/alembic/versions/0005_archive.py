"""archive prospects without losing their outcome

Revision ID: 0005
Revises: 0004
Create Date: 2026-08-14
"""
import sqlalchemy as sa
from alembic import op

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prospects",
        sa.Column("is_archived", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.add_column("prospects", sa.Column("archived_at", sa.DateTime(timezone=True)))
    op.add_column("prospects", sa.Column("archive_reason", sa.String(300)))
    op.create_index("ix_prospects_is_archived", "prospects", ["is_archived"])

    # Two new timeline event types.
    op.execute("ALTER TYPE prospect_event_type ADD VALUE IF NOT EXISTS 'archived'")
    op.execute("ALTER TYPE prospect_event_type ADD VALUE IF NOT EXISTS 'unarchived'")

    # Anyone previously shelved via status='archived' becomes a real archive.
    # Their status resets to 'new' because that status carried no outcome.
    op.execute(
        """
        UPDATE prospects
           SET is_archived = true,
               archived_at = now(),
               archive_reason = 'migrated from archived status',
               status = 'new'
         WHERE status = 'archived'
        """
    )


def downgrade() -> None:
    op.execute("UPDATE prospects SET status = 'archived' WHERE is_archived")
    op.drop_index("ix_prospects_is_archived", table_name="prospects")
    op.drop_column("prospects", "archive_reason")
    op.drop_column("prospects", "archived_at")
    op.drop_column("prospects", "is_archived")
