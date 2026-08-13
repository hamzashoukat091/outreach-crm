"""store the exact prompt and raw response on each draft

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-14
"""
import sqlalchemy as sa
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable: drafts generated before this migration have no record of the
    # prompt that produced them, and the UI says so rather than inventing one.
    op.add_column("email_drafts", sa.Column("system_prompt", sa.Text(), nullable=True))
    op.add_column("email_drafts", sa.Column("user_prompt", sa.Text(), nullable=True))
    op.add_column("email_drafts", sa.Column("raw_response", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("email_drafts", "raw_response")
    op.drop_column("email_drafts", "user_prompt")
    op.drop_column("email_drafts", "system_prompt")
