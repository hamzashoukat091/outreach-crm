"""Drop the IMAP settings columns.

Inbound mail now arrives through the Gmail API (0010). IMAP was the original
path and is gone: it authenticated with the account password stored in this
table, found new mail by the UNSEEN flag -- which anything touching the
mailbox can flip -- and reconstructed threads by parsing References headers.

Leaving the columns in place would have been cheaper, but a settings form
that saves values nothing reads is worse than no form: it looks configurable
and silently does nothing.

The downgrade restores the columns but not their contents. That is the honest
behaviour -- imap_password held a real credential and re-creating an empty
column is not a rollback of the data, only of the shape.

Revision ID: 0011
Revises: 0010
"""

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

COLUMNS = (
    "imap_host",
    "imap_port",
    "imap_username",
    "imap_password",
    "imap_use_ssl",
    "imap_folder",
    "imap_poll_seconds",
)


def upgrade() -> None:
    for column in COLUMNS:
        op.drop_column("automation_settings", column)


def downgrade() -> None:
    op.add_column("automation_settings", sa.Column("imap_host", sa.String(300)))
    op.add_column("automation_settings", sa.Column("imap_port", sa.Integer()))
    op.add_column("automation_settings", sa.Column("imap_username", sa.String(300)))
    op.add_column("automation_settings", sa.Column("imap_password", sa.String(500)))
    op.add_column(
        "automation_settings",
        sa.Column("imap_use_ssl", sa.Boolean(), server_default=sa.true(), nullable=False),
    )
    op.add_column(
        "automation_settings",
        sa.Column(
            "imap_folder", sa.String(200), server_default="INBOX", nullable=False
        ),
    )
    op.add_column(
        "automation_settings",
        sa.Column(
            "imap_poll_seconds", sa.Integer(), server_default="60", nullable=False
        ),
    )
