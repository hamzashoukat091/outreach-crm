"""Add the automation event types to prospect_event_type.

0006 added these values to the Python enum but never ALTERed the existing
Postgres type -- the gap slipped through because tests rebuild the schema from
metadata (fresh enum, all values present) while the live database keeps the
enum 0002 created. First real enrollment failed on 'handed_off'.

Revision ID: 0007
Revises: 0006
"""

from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None

NEW_VALUES = (
    "handed_off",
    "returned_to_manual",
    "enrolled",
    "unenrolled",
    "message_scheduled",
    "message_sent",
    "message_failed",
    "reply_received",
    "reply_sent",
    "escalated",
    "suppressed",
)


def upgrade() -> None:
    for value in NEW_VALUES:
        # IF NOT EXISTS makes this safe to re-run against a database where the
        # value was added by hand. Values added in a transaction simply cannot
        # be used until it commits, which is fine here.
        op.execute(f"ALTER TYPE prospect_event_type ADD VALUE IF NOT EXISTS '{value}'")


def downgrade() -> None:
    # Postgres cannot remove enum values; rows using them would be orphaned
    # anyway. Deliberate no-op.
    pass
