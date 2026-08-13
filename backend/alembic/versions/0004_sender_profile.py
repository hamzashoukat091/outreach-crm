"""sender profile: who is writing and what they offer

Revision ID: 0004
Revises: 0003
Create Date: 2026-08-14
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "sender_profile",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200)),
        sa.Column("headline", sa.String(300)),
        sa.Column("offer", sa.Text),
        sa.Column("proof", sa.Text),
        sa.Column("call_to_action", sa.String(400)),
        sa.Column("signature", sa.String(200)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("sender_profile")
