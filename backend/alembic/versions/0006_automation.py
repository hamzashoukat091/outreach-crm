"""sequences automation layer; drop the old MVP leads schema

Revision ID: 0006
Revises: 0005
Create Date: 2026-08-16

The old `leads` layer and the new automation layer both used tables named
"sequences" and "sequence_steps", so the drops MUST run before the creates.
The old tables carried demo data only; the 48 real prospects live in
`prospects` and are untouched.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

# Referenced with create_type=False inside create_table so the CREATE TYPE
# emitted up front is not attempted a second time (DuplicateObject otherwise).
enrollment_state = postgresql.ENUM(
    "active", "paused", "replied", "stopped", "bounced", "completed",
    name="enrollment_state", create_type=False,
)
message_direction = postgresql.ENUM(
    "outbound", "inbound", name="message_direction", create_type=False
)
message_kind = postgresql.ENUM(
    "opener", "follow_up", "reply", "incoming", name="message_kind", create_type=False
)
message_state = postgresql.ENUM(
    "drafting", "scheduled", "needs_approval", "sending", "sent", "failed",
    "cancelled", "received",
    name="message_state", create_type=False,
)
reply_situation = postgresql.ENUM(
    "interested", "question", "objection", "not_now", "referral",
    "not_interested", "unsubscribe", "auto_reply", "unclear",
    name="reply_situation", create_type=False,
)
suppression_reason = postgresql.ENUM(
    "unsubscribed", "hard_bounce", "complained", "manual",
    name="suppression_reason", create_type=False,
)

NEW_ENUMS = (
    enrollment_state,
    message_direction,
    message_kind,
    message_state,
    reply_situation,
    suppression_reason,
)

# The MVP layer this migration retires, in FK dependency order.
OLD_TABLES = ("activities", "scheduled_sends", "enrollments", "sequence_steps", "sequences", "leads")
OLD_ENUMS = ("activity_type", "send_status", "enrollment_status", "lead_status")


def upgrade() -> None:
    bind = op.get_bind()

    # --- 1. Drop the old MVP layer first: it owns the names "sequences" and
    # "sequence_steps" that the automation tables are about to reclaim. ---
    for table in OLD_TABLES:
        op.execute(f'DROP TABLE IF EXISTS "{table}" CASCADE')
    for enum_name in OLD_ENUMS:
        op.execute(f'DROP TYPE IF EXISTS "{enum_name}"')

    # --- 2. New enum types. ---
    for enum_type in NEW_ENUMS:
        enum_type.create(bind, checkfirst=True)

    # --- 3. Prospects gain a pipeline mode; strategies gain reply routing. ---
    op.add_column(
        "prospects",
        sa.Column("pipeline_mode", sa.String(20), nullable=False, server_default="manual"),
    )
    op.create_index("ix_prospects_pipeline_mode", "prospects", ["pipeline_mode"])

    op.add_column(
        "strategies",
        sa.Column("kind", sa.String(20), nullable=False, server_default="opener"),
    )
    op.add_column("strategies", sa.Column("reply_situation", sa.String(40)))
    op.add_column(
        "strategies",
        sa.Column("priority", sa.Integer, nullable=False, server_default="100"),
    )
    op.create_index("ix_strategies_kind", "strategies", ["kind"])
    op.create_index("ix_strategies_reply_situation", "strategies", ["reply_situation"])

    # --- 4. Automation tables. ---
    op.create_table(
        "sequences",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
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
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("wait_days", sa.Integer, nullable=False, server_default="3"),
        sa.Column("send_at_time", sa.Time),
        sa.Column(
            "strategy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategies.id", ondelete="SET NULL"),
        ),
        sa.Column("step_instructions", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("sequence_id", "position", name="uq_step_position"),
    )
    op.create_index("ix_sequence_steps_sequence_id", "sequence_steps", ["sequence_id"])
    op.create_index("ix_sequence_steps_strategy_id", "sequence_steps", ["strategy_id"])

    op.create_table(
        "sequence_enrollments",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "prospect_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prospects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "sequence_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequences.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("state", enrollment_state, nullable=False, server_default="active"),
        sa.Column("current_position", sa.Integer, nullable=False, server_default="0"),
        sa.Column("thread_root_message_id", sa.String(400)),
        sa.Column("thread_subject", sa.String(500)),
        sa.Column("enrolled_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("ended_at", sa.DateTime(timezone=True)),
        sa.Column("end_reason", sa.String(300)),
        sa.Column("last_activity_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_enrollment_state", "sequence_enrollments", ["state"])
    op.create_index("ix_enrollment_prospect", "sequence_enrollments", ["prospect_id"])
    op.create_index("ix_sequence_enrollments_sequence_id", "sequence_enrollments", ["sequence_id"])
    op.create_index(
        "ix_sequence_enrollments_thread_root_message_id",
        "sequence_enrollments",
        ["thread_root_message_id"],
    )
    # A prospect must not run the same sequence twice at once; DB-enforced so
    # racing enroll calls cannot slip through.
    op.create_index(
        "uq_open_enrollment",
        "sequence_enrollments",
        ["prospect_id", "sequence_id"],
        unique=True,
        postgresql_where=sa.text("state IN ('active', 'paused')"),
    )

    op.create_table(
        "messages",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "prospect_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prospects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "enrollment_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequence_enrollments.id", ondelete="CASCADE"),
        ),
        sa.Column(
            "step_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sequence_steps.id", ondelete="SET NULL"),
        ),
        sa.Column(
            "strategy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategies.id", ondelete="SET NULL"),
        ),
        sa.Column("direction", message_direction, nullable=False),
        sa.Column("kind", message_kind, nullable=False),
        sa.Column("state", message_state, nullable=False),
        sa.Column("subject", sa.String(500)),
        sa.Column("body", sa.Text),
        sa.Column("from_address", sa.String(320)),
        sa.Column("to_address", sa.String(320)),
        sa.Column("rfc_message_id", sa.String(400)),
        sa.Column("in_reply_to", sa.String(400)),
        sa.Column("references", sa.Text),
        sa.Column("dedupe_key", sa.String(400)),
        sa.Column("scheduled_for", sa.DateTime(timezone=True)),
        sa.Column("sent_at", sa.DateTime(timezone=True)),
        sa.Column("received_at", sa.DateTime(timezone=True)),
        sa.Column("attempts", sa.Integer, nullable=False, server_default="0"),
        sa.Column("error", sa.Text),
        sa.Column("simulated", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("situation", reply_situation),
        sa.Column("classification_confidence", sa.Integer),
        sa.Column("classification_reason", sa.Text),
        sa.Column("escalated", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("escalation_reason", sa.String(400)),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("edited", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("model", sa.String(120)),
        sa.Column("strategy_name", sa.String(200)),
        sa.Column("context_quality", sa.String(40)),
        sa.Column("context_used", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("system_prompt", sa.Text),
        sa.Column("user_prompt", sa.Text),
        sa.Column("raw_response", sa.Text),
        sa.Column("input_tokens", sa.Integer),
        sa.Column("output_tokens", sa.Integer),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.UniqueConstraint("dedupe_key", name="uq_message_dedupe"),
    )
    op.create_index("ix_message_state_due", "messages", ["state", "scheduled_for"])
    op.create_index("ix_message_prospect", "messages", ["prospect_id"])
    op.create_index("ix_messages_enrollment_id", "messages", ["enrollment_id"])
    op.create_index("ix_messages_rfc_message_id", "messages", ["rfc_message_id"])
    op.create_index("ix_messages_in_reply_to", "messages", ["in_reply_to"])
    op.create_index("ix_messages_created_at", "messages", ["created_at"])

    op.create_table(
        "suppressions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("reason", suppression_reason, nullable=False),
        sa.Column("detail", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index("ix_suppressions_email", "suppressions", ["email"])

    op.create_table(
        "sender_facts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("rates", sa.Text),
        sa.Column("availability", sa.Text),
        sa.Column("tech_stack", sa.Text),
        sa.Column("process", sa.Text),
        sa.Column("booking_link", sa.String(400)),
        sa.Column("portfolio_link", sa.String(400)),
        sa.Column("do_not_answer", sa.Text),
        sa.Column("extra_facts", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    op.create_table(
        "automation_settings",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("dry_run", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("sending_paused", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("send_window_start", sa.Time, nullable=False, server_default="09:00:00"),
        sa.Column("send_window_end", sa.Time, nullable=False, server_default="17:00:00"),
        sa.Column("send_days", postgresql.JSONB, nullable=False, server_default=sa.text("'[1,2,3,4,5]'::jsonb")),
        sa.Column("timezone", sa.String(80), nullable=False, server_default="UTC"),
        sa.Column("hourly_send_limit", sa.Integer, nullable=False, server_default="20"),
        sa.Column("daily_send_limit", sa.Integer, nullable=False, server_default="100"),
        sa.Column("default_delay_days", sa.Integer, nullable=False, server_default="1"),
        sa.Column("default_send_time", sa.Time, nullable=False, server_default="09:00:00"),
        sa.Column("auto_reply_enabled", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("min_confidence_to_send", sa.Integer, nullable=False, server_default="75"),
        sa.Column("always_review_first_reply", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("escalate_situations", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("smtp_host", sa.String(300)),
        sa.Column("smtp_port", sa.Integer),
        sa.Column("smtp_username", sa.String(300)),
        sa.Column("smtp_password", sa.String(500)),
        sa.Column("smtp_use_tls", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("from_address", sa.String(320)),
        sa.Column("from_name", sa.String(200)),
        sa.Column("reply_to", sa.String(320)),
        sa.Column("imap_host", sa.String(300)),
        sa.Column("imap_port", sa.Integer),
        sa.Column("imap_username", sa.String(300)),
        sa.Column("imap_password", sa.String(500)),
        sa.Column("imap_use_ssl", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("imap_folder", sa.String(200), nullable=False, server_default="INBOX"),
        sa.Column("imap_poll_seconds", sa.Integer, nullable=False, server_default="60"),
        sa.Column("worker_heartbeat_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )

    # --- 5. Seed the single-row tables so "get settings" never 404s. Every
    # non-null column has a server default, so id alone is enough. ---
    op.execute("INSERT INTO automation_settings (id) VALUES (gen_random_uuid())")
    op.execute("INSERT INTO sender_facts (id) VALUES (gen_random_uuid())")


def downgrade() -> None:
    bind = op.get_bind()

    op.drop_table("automation_settings")
    op.drop_table("sender_facts")
    op.drop_table("suppressions")
    op.drop_table("messages")
    op.drop_table("sequence_enrollments")
    op.drop_table("sequence_steps")
    op.drop_table("sequences")

    for enum_type in NEW_ENUMS:
        enum_type.drop(bind, checkfirst=True)

    op.drop_index("ix_strategies_reply_situation", table_name="strategies")
    op.drop_index("ix_strategies_kind", table_name="strategies")
    op.drop_column("strategies", "priority")
    op.drop_column("strategies", "reply_situation")
    op.drop_column("strategies", "kind")

    op.drop_index("ix_prospects_pipeline_mode", table_name="prospects")
    op.drop_column("prospects", "pipeline_mode")

    # The old MVP tables held demo data only and are not recreated; restoring
    # them means checking out the pre-0006 tree and re-running 0001.
