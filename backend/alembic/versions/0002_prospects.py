"""prospects, strategies, email drafts

Revision ID: 0002
Revises: 0001
Create Date: 2026-08-14
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

prospect_status = postgresql.ENUM(
    "new",
    "drafted",
    "approved",
    "replied",
    "bounced",
    "not_interested",
    "won",
    "archived",
    name="prospect_status",
    create_type=False,
)
draft_status = postgresql.ENUM(
    "draft", "approved", "discarded", "failed", name="draft_status", create_type=False
)
prospect_event_type = postgresql.ENUM(
    "imported",
    "updated",
    "generated",
    "approved",
    "replied",
    "bounced",
    "status_changed",
    "note",
    name="prospect_event_type",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    for enum_type in (prospect_status, draft_status, prospect_event_type):
        enum_type.create(bind, checkfirst=True)

    op.create_table(
        "prospects",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("prospect_ref", sa.String(128), unique=True),
        sa.Column("business_ref", sa.String(128)),
        sa.Column("email", sa.String(320), nullable=False, unique=True),
        sa.Column("email_status", sa.String(40)),
        sa.Column("first_name", sa.String(120)),
        sa.Column("last_name", sa.String(120)),
        sa.Column("job_title", sa.String(300)),
        sa.Column("job_department", sa.String(160)),
        sa.Column("seniority", sa.String(80)),
        sa.Column("linkedin", sa.String(400)),
        sa.Column("prospect_city", sa.String(160)),
        sa.Column("prospect_region", sa.String(160)),
        sa.Column("prospect_country", sa.String(160)),
        sa.Column("skills", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("interests", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("experience", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("other_emails", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("company_name", sa.String(300)),
        sa.Column("company_domain", sa.String(300)),
        sa.Column("company_website", sa.String(400)),
        sa.Column("company_description", sa.Text),
        sa.Column("company_city", sa.String(160)),
        sa.Column("company_region", sa.String(160)),
        sa.Column("company_country", sa.String(160)),
        sa.Column("employee_range", sa.String(60)),
        sa.Column("revenue_range", sa.String(60)),
        sa.Column("industry", sa.String(300)),
        sa.Column("naics", sa.String(40)),
        sa.Column("sic_code", sa.String(40)),
        sa.Column("company_logo", sa.String(600)),
        sa.Column("intent_topics", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("status", prospect_status, nullable=False, server_default="new"),
        sa.Column("is_complete", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("missing_fields", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("company_inferred", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("tags", postgresql.JSONB, nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("notes", sa.Text),
        sa.Column("extra", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("source_row", sa.Integer),
        sa.Column("imported_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_prospects_email", "prospects", ["email"])
    op.create_index("ix_prospects_prospect_ref", "prospects", ["prospect_ref"])
    op.create_index("ix_prospects_business_ref", "prospects", ["business_ref"])
    op.create_index("ix_prospects_company_domain", "prospects", ["company_domain"])
    op.create_index("ix_prospects_seniority", "prospects", ["seniority"])
    op.create_index("ix_prospect_company", "prospects", ["company_name"])
    op.create_index("ix_prospect_status", "prospects", ["status"])
    op.create_index("ix_prospect_complete", "prospects", ["is_complete"])

    op.create_table(
        "strategies",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(200), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("system_prompt", sa.Text, nullable=False),
        sa.Column("instructions", sa.Text, nullable=False),
        sa.Column("tone", sa.String(120)),
        sa.Column("max_words", sa.Integer, nullable=False, server_default="150"),
        sa.Column("subject_hint", sa.String(400)),
        sa.Column("is_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    op.create_table(
        "email_drafts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "prospect_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prospects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "strategy_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("strategies.id", ondelete="SET NULL"),
        ),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("status", draft_status, nullable=False, server_default="draft"),
        sa.Column("model", sa.String(120)),
        sa.Column("strategy_name", sa.String(200)),
        sa.Column("context_quality", sa.String(40)),
        sa.Column("context_used", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("input_tokens", sa.Integer),
        sa.Column("output_tokens", sa.Integer),
        sa.Column("error", sa.Text),
        sa.Column("approved_at", sa.DateTime(timezone=True)),
        sa.Column("edited", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_email_drafts_prospect_id", "email_drafts", ["prospect_id"])
    op.create_index("ix_email_drafts_strategy_id", "email_drafts", ["strategy_id"])
    op.create_index("ix_email_drafts_created_at", "email_drafts", ["created_at"])
    op.create_index("ix_draft_status", "email_drafts", ["status"])

    op.create_table(
        "prospect_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "prospect_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("prospects.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("type", prospect_event_type, nullable=False),
        sa.Column("summary", sa.String(500), nullable=False),
        sa.Column("detail", postgresql.JSONB, nullable=False, server_default=sa.text("'{}'::jsonb")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_prospect_events_prospect_id", "prospect_events", ["prospect_id"])
    op.create_index("ix_prospect_events_created_at", "prospect_events", ["created_at"])


def downgrade() -> None:
    op.drop_table("prospect_events")
    op.drop_table("email_drafts")
    op.drop_table("strategies")
    op.drop_table("prospects")

    bind = op.get_bind()
    prospect_event_type.drop(bind, checkfirst=True)
    draft_status.drop(bind, checkfirst=True)
    prospect_status.drop(bind, checkfirst=True)
