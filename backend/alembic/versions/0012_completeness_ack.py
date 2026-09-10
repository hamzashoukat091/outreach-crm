"""Let a prospect's missing company info be accepted deliberately.

is_complete answers "did the import give us company context", which is a fact
about the data. It is the wrong place to record "I looked at this one and it
is fine as it is" -- overwriting it to silence a warning would destroy the
only record of what the export actually contained, and the next import would
compute it back to False anyway.

So this is a separate flag. The warning, the amber badge, the banner count and
the completeness filter all read `is_complete OR completeness_ack`, while
is_complete keeps meaning exactly what it meant.

Nullable timestamp rather than a boolean: when you accepted it is worth having
when a batch of thin prospects turns out to send badly, and NULL is an
unambiguous "not acknowledged".

Revision ID: 0012
Revises: 0011
"""

import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "prospects",
        sa.Column("completeness_ack_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Partial: the acknowledged rows are the minority and the only ones any
    # query filters on.
    op.create_index(
        "ix_prospects_completeness_ack",
        "prospects",
        ["completeness_ack_at"],
        postgresql_where=sa.text("completeness_ack_at IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("ix_prospects_completeness_ack", table_name="prospects")
    op.drop_column("prospects", "completeness_ack_at")
