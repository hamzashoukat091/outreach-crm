"""Pydantic surface for the Sequences automation layer."""

import uuid
from datetime import datetime, time
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from app.models import (
    EnrollmentState,
    MessageDirection,
    MessageKind,
    MessageState,
    ReplySituation,
)


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Sequences & steps ----------


class StepBase(BaseModel):
    wait_days: int = Field(default=3, ge=0, le=365)
    send_at_time: time | None = None
    strategy_id: uuid.UUID | None = None
    step_instructions: str | None = None
    is_active: bool = True


class StepCreate(StepBase):
    # Position is optional on create: omitted means "append at the end".
    position: int | None = Field(default=None, ge=1)


class StepUpdate(BaseModel):
    wait_days: int | None = Field(default=None, ge=0, le=365)
    send_at_time: time | None = None
    strategy_id: uuid.UUID | None = None
    step_instructions: str | None = None
    is_active: bool | None = None


class StepOut(ORMModel, StepBase):
    id: uuid.UUID
    sequence_id: uuid.UUID
    position: int
    strategy_name: str | None = None
    created_at: datetime


class StepReorderRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1)


class SequenceBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_active: bool = True


class SequenceCreate(SequenceBase):
    pass


class TemplateStepOut(BaseModel):
    position: int
    strategy_name: str
    wait_days: int
    step_instructions: str | None = None


class TemplateOut(BaseModel):
    """A ready-made shape, resolved for display before anything is created."""

    key: str
    name: str
    summary: str
    best_for: str
    total_days: int
    steps: list[TemplateStepOut] = Field(default_factory=list)
    # Angles this template expects that the database does not have yet.
    missing_strategies: list[str] = Field(default_factory=list)


class TemplateApplyRequest(BaseModel):
    name: str | None = Field(default=None, max_length=200)


class SequenceUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=200)
    description: str | None = None
    is_active: bool | None = None


class SequenceOut(ORMModel, SequenceBase):
    id: uuid.UUID
    created_at: datetime
    updated_at: datetime
    steps: list[StepOut] = Field(default_factory=list)
    step_count: int = 0
    # 'open' is what the UI calls "enrolled" -- someone the sequence is still
    # working on. 'total' is lifetime and only appears where history is meant.
    active_enrollments: int = 0
    paused_enrollments: int = 0
    open_enrollments: int = 0
    replied_enrollments: int = 0
    finished_enrollments: int = 0
    total_enrollments: int = 0


# ---------- Enrollment ----------


class EnrollRequest(BaseModel):
    prospect_ids: list[uuid.UUID] = Field(min_length=1)
    mode: Literal["send_now", "draft_now_send_later", "send_at"] = "draft_now_send_later"
    send_at: datetime | None = None


class EnrollResultItem(BaseModel):
    prospect_id: uuid.UUID
    email: str | None = None
    status: Literal["enrolled", "skipped"]
    reason: str | None = None
    enrollment_id: uuid.UUID | None = None


class EnrollResult(BaseModel):
    enrolled: int
    skipped: int
    results: list[EnrollResultItem] = Field(default_factory=list)


class EnrollmentOut(ORMModel):
    id: uuid.UUID
    prospect_id: uuid.UUID
    sequence_id: uuid.UUID
    state: EnrollmentState
    current_position: int
    thread_subject: str | None = None
    enrolled_at: datetime
    ended_at: datetime | None = None
    end_reason: str | None = None
    last_activity_at: datetime | None = None
    # Joined for the list view.
    prospect_name: str | None = None
    prospect_email: str | None = None
    sequence_name: str | None = None
    total_steps: int = 0
    next_message_at: datetime | None = None


class MessageOut(ORMModel):
    id: uuid.UUID
    prospect_id: uuid.UUID
    enrollment_id: uuid.UUID | None = None
    step_id: uuid.UUID | None = None
    direction: MessageDirection
    kind: MessageKind
    state: MessageState
    subject: str | None = None
    body: str | None = None
    from_address: str | None = None
    to_address: str | None = None
    scheduled_for: datetime | None = None
    sent_at: datetime | None = None
    received_at: datetime | None = None
    attempts: int = 0
    error: str | None = None
    simulated: bool = False
    situation: ReplySituation | None = None
    classification_confidence: int | None = None
    classification_reason: str | None = None
    escalated: bool = False
    escalation_reason: str | None = None
    approved_at: datetime | None = None
    edited: bool = False
    model: str | None = None
    strategy_name: str | None = None
    context_quality: str | None = None
    created_at: datetime
    # Joined for list views.
    prospect_name: str | None = None
    prospect_email: str | None = None


class MessageDetail(MessageOut):
    """Single-message view, with the exact strings sent to the model.

    Provenance stays off the list responses -- prompts are kilobytes each --
    but the detail endpoint must expose them: seeing the real prompt behind
    any generated email is a core feature of this app, and automated sends
    are the emails with the least human review, not the most.
    """

    system_prompt: str | None = None
    user_prompt: str | None = None
    raw_response: str | None = None
    context_used: dict | None = None
    input_tokens: int | None = None
    output_tokens: int | None = None


class EnrollmentDetail(EnrollmentOut):
    messages: list[MessageOut] = Field(default_factory=list)


class MessageList(BaseModel):
    items: list[MessageOut]
    total: int
    page: int
    page_size: int


class MessageApproveRequest(BaseModel):
    subject: str | None = Field(default=None, max_length=500)
    body: str | None = None


class SimulateReplyRequest(BaseModel):
    """A reply typed by the operator, standing in for the prospect."""

    prospect_id: uuid.UUID
    body: str = Field(min_length=1, max_length=8000)


# ---------- Inbox / approvals ----------


class InboxItem(BaseModel):
    enrollment_id: uuid.UUID
    prospect_id: uuid.UUID
    prospect_name: str | None = None
    prospect_email: str | None = None
    sequence_name: str | None = None
    state: EnrollmentState
    situation: ReplySituation | None = None
    pending_approval: bool = False
    latest_inbound: MessageOut | None = None
    latest_outbound: MessageOut | None = None
    last_activity_at: datetime | None = None


class ApprovalOut(BaseModel):
    message: MessageOut
    trigger: MessageOut | None = None  # the inbound email this reply answers


# ---------- Settings ----------


class AutomationSettingsOut(ORMModel):
    id: uuid.UUID
    dry_run: bool
    sending_paused: bool
    send_window_start: time
    send_window_end: time
    send_days: list[int]
    timezone: str
    hourly_send_limit: int
    daily_send_limit: int
    default_delay_days: int
    default_send_time: time
    auto_reply_enabled: bool
    min_confidence_to_send: int
    always_review_first_reply: bool
    escalate_situations: list[str]
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_use_tls: bool = True
    from_address: str | None = None
    from_name: str | None = None
    reply_to: str | None = None
    # Passwords never leave the API; only whether one is stored.
    has_smtp_password: bool = False
    updated_at: datetime


class AutomationSettingsUpdate(BaseModel):
    """Partial update. For the two password fields: absent = keep the stored
    value, empty string = clear it, anything else = replace it."""

    dry_run: bool | None = None
    sending_paused: bool | None = None
    send_window_start: time | None = None
    send_window_end: time | None = None
    send_days: list[int] | None = None
    timezone: str | None = None
    hourly_send_limit: int | None = Field(default=None, ge=1, le=1000)
    daily_send_limit: int | None = Field(default=None, ge=1, le=10000)
    default_delay_days: int | None = Field(default=None, ge=0, le=60)
    default_send_time: time | None = None
    auto_reply_enabled: bool | None = None
    min_confidence_to_send: int | None = Field(default=None, ge=0, le=100)
    always_review_first_reply: bool | None = None
    escalate_situations: list[str] | None = None
    smtp_host: str | None = None
    smtp_port: int | None = None
    smtp_username: str | None = None
    smtp_password: str | None = None
    smtp_use_tls: bool | None = None
    from_address: str | None = None
    from_name: str | None = None
    reply_to: str | None = None


class SettingsResetRequest(BaseModel):
    section: str


# ---------- Sender facts ----------


class SenderFactsUpdate(BaseModel):
    rates: str | None = None
    availability: str | None = None
    tech_stack: str | None = None
    process: str | None = None
    booking_link: str | None = None
    portfolio_link: str | None = None
    do_not_answer: str | None = None
    extra_facts: str | None = None


class SenderFactsOut(ORMModel):
    id: uuid.UUID
    rates: str | None = None
    availability: str | None = None
    tech_stack: str | None = None
    process: str | None = None
    booking_link: str | None = None
    portfolio_link: str | None = None
    do_not_answer: str | None = None
    extra_facts: str | None = None
    is_configured: bool = False
    updated_at: datetime


# ---------- Analytics / status ----------


class StepDropoff(BaseModel):
    position: int
    sent: int
    replies_after: int


class SequenceAnalyticsRow(BaseModel):
    sequence_id: uuid.UUID
    name: str
    enrolled: int
    active: int
    completed: int
    replied: int
    reply_rate: float
    steps: list[StepDropoff] = Field(default_factory=list)


class AutomationAnalytics(BaseModel):
    active_enrollments: int
    total_sent: int
    replies_received: int
    reply_rate: float
    pending_approvals: int
    sends_today: int
    daily_send_limit: int
    sequences: list[SequenceAnalyticsRow] = Field(default_factory=list)


class AutomationStatus(BaseModel):
    dry_run: bool
    sending_paused: bool
    window_open: bool
    sends_this_hour: int
    hourly_send_limit: int
    sends_today: int
    daily_send_limit: int
    next_scheduled_at: datetime | None = None
    worker_heartbeat_at: datetime | None = None
    worker_alive: bool = False


# ---------- Handoff ----------


class BulkHandoffRequest(BaseModel):
    ids: list[uuid.UUID] = Field(min_length=1)
