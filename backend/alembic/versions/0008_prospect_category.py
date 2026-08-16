"""Add prospects.category -- which sourcing run a prospect came from.

Each Vibe export is one vertical (dental, SaaS, law firms...), and once the
rows land in the CRM there is nothing recording which search produced them.
Nullable, so every existing row keeps working untouched; indexed because the
column exists to be filtered and grouped by.

Revision ID: 0008
Revises: 0007
"""

import sqlalchemy as sa
from alembic import op

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("prospects", sa.Column("category", sa.String(60), nullable=True))
    op.create_index("ix_prospects_category", "prospects", ["category"])


def downgrade() -> None:
    op.drop_index("ix_prospects_category", table_name="prospects")
    op.drop_column("prospects", "category")
