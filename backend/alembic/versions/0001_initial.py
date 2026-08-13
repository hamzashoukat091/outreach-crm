"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-08-13
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None

# The enum types are created once up front, then referenced with
# create_type=False so create_table() doesn't try to emit CREATE TYPE again.
lead_status = postgresql.ENUM(
    "new",
    "contacted",
    "replied",
    "qualified",
    "won",
    "lost",
    "unsubscribed",
    name="lead_status",
    create_type=False,
)
enrollment_status = postgresql.ENUM(
    "active", "paused", "completed", "stopped", name="enrollment_status", create_type=False
)
send_status = postgresql.ENUM(
    "scheduled", "sent", "failed", "canceled", name="send_status", create_type=False
)
activity_type = postgresql.ENUM(
    "created",
    "status_changed",
    "note",
    "email_sent",
    "email_failed",
    "enrolled",
    "unenrolled",
    "replied",
    name="activity_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in (lead_status, enrollment_status, send_status, activity_type):
        enum_type.create(bind, checkfirst=True)

    op.create_table(
        "leads",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("first_name", sa.String(120)),
        sa.Column("last_name", sa.String(120)),
        sa.Column("company", sa.String(200)),
        sa.Column("title", sa.String(200)),
        sa.Column("phone", sa.String(50)),
        sa.Column("website", sa.String(300)),
        sa.Column("source", sa.String(120)),
        sa.Column("status", lead_status, nullable=False, server_default="new"),
        sa.Column(
            "tags", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")
        ),
        sa.Column(
            "custom_fields",
            postgresql.JSONB,
            nullable=False,
            server_default=sa.text("'{}'::jsonb"),
        ),
        sa.Column("notes", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_leads_email", "leads", ["email"])
    op.create_index("ix_leads_company", "leads", ["company"])
    op.create_index("ix_leads_status", "leads", ["status"])

    op.create_table(
        "sequences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "sequence_steps",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "sequence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequences.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("step_order", sa.Integer, nullable=False),
        sa.Column("delay_days", sa.Integer, nullable=False, server_default="0"),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("sequence_id", "step_order", name="uq_step_order"),
    )
    op.create_index("ix_sequence_steps_sequence_id", "sequence_steps", ["sequence_id"])

    op.create_table(
        "enrollments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "lead_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("leads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sequence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequences.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("status", enrollment_status, nullable=False, server_default="active"),
        sa.Column("current_step", sa.Integer, nullable=False, server_default="0"),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("completed_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("lead_id", "sequence_id", name="uq_lead_sequence"),
    )
    op.create_index("ix_enrollments_lead_id", "enrollments", ["lead_id"])
    op.create_index("ix_enrollments_sequence_id", "enrollments", ["sequence_id"])
    op.create_index("ix_enrollment_status", "enrollments", ["status"])

    op.create_table(
        "scheduled_sends",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "enrollment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("enrollments.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "step_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequence_steps.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scheduled_for", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", send_status, nullable=False, server_default="scheduled"),
        sa.Column("rendered_subject", sa.String(500)),
        sa.Column("rendered_body", sa.Text),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("error", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("enrollment_id", "step_id", name="uq_enrollment_step"),
    )
    op.create_index("ix_scheduled_sends_enrollment_id", "scheduled_sends", ["enrollment_id"])
    op.create_index("ix_send_due", "scheduled_sends", ["status", "scheduled_for"])

    op.create_table(
        "activities",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "lead_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("leads.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", activity_type, nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column(
            "detail", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")
        ),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_activities_lead_id", "activities", ["lead_id"])
    op.create_index("ix_activities_created_at", "activities", ["created_at"])


def downgrade() -> None:
    op.drop_table("activities")
    op.drop_table("scheduled_sends")
    op.drop_table("enrollments")
    op.drop_table("sequence_steps")
    op.drop_table("sequences")
    op.drop_table("leads")

    bind = op.get_bind()
    activity_type.drop(bind, checkfirst=True)
    send_status.drop(bind, checkfirst=True)
    enrollment_status.drop(bind, checkfirst=True)
    lead_status.drop(bind, checkfirst=True)
