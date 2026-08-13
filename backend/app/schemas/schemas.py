import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import ActivityType, EnrollmentStatus, LeadStatus, SendStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Leads ----------


class LeadBase(BaseModel):
    email: EmailStr
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    title: str | None = None
    phone: str | None = None
    website: str | None = None
    source: str | None = None
    status: LeadStatus = LeadStatus.new
    tags: list[str] = Field(default_factory=list)
    custom_fields: dict[str, Any] = Field(default_factory=dict)
    notes: str | None = None


class LeadCreate(LeadBase):
    pass


class LeadUpdate(BaseModel):
    email: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None
    company: str | None = None
    title: str | None = None
    phone: str | None = None
    website: str | None = None
    source: str | None = None
    status: LeadStatus | None = None
    tags: list[str] | None = None
    custom_fields: dict[str, Any] | None = None
    notes: str | None = None


class LeadOut(ORMModel, LeadBase):
    id: uuid.UUID
    full_name: str
    created_at: datetime
    updated_at: datetime


class LeadList(BaseModel):
    items: list[LeadOut]
    total: int
    page: int
    page_size: int


# ---------- Sequence steps ----------


class SequenceStepBase(BaseModel):
    step_order: int = Field(ge=1)
    delay_days: int = Field(default=0, ge=0, le=365)
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1)


class SequenceStepCreate(SequenceStepBase):
    pass


class SequenceStepOut(ORMModel, SequenceStepBase):
    id: uuid.UUID


# ---------- Sequences ----------


class SequenceBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    is_active: bool = True


class SequenceCreate(SequenceBase):
    steps: list[SequenceStepCreate] = Field(default_factory=list)


class SequenceUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    is_active: bool | None = None
    steps: list[SequenceStepCreate] | None = None


class SequenceOut(ORMModel, SequenceBase):
    id: uuid.UUID
    created_at: datetime
    steps: list[SequenceStepOut] = Field(default_factory=list)
    active_enrollments: int = 0


# ---------- Enrollments ----------


class EnrollRequest(BaseModel):
    sequence_id: uuid.UUID
    lead_ids: list[uuid.UUID] = Field(min_length=1)


class ScheduledSendOut(ORMModel):
    id: uuid.UUID
    step_id: uuid.UUID
    step_order: int | None = None
    scheduled_for: datetime
    status: SendStatus
    rendered_subject: str | None = None
    sent_at: datetime | None = None
    error: str | None = None


class EnrollmentOut(ORMModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    sequence_id: uuid.UUID
    status: EnrollmentStatus
    current_step: int
    enrolled_at: datetime
    sequence_name: str | None = None
    lead_email: str | None = None
    sends: list[ScheduledSendOut] = Field(default_factory=list)


class EnrollResult(BaseModel):
    enrolled: int
    skipped: int
    reasons: dict[str, str] = Field(default_factory=dict)


# ---------- Activities ----------


class ActivityCreate(BaseModel):
    type: ActivityType = ActivityType.note
    summary: str = Field(min_length=1, max_length=500)
    detail: dict[str, Any] = Field(default_factory=dict)


class ActivityOut(ORMModel):
    id: uuid.UUID
    lead_id: uuid.UUID
    type: ActivityType
    summary: str
    detail: dict[str, Any]
    created_at: datetime


# ---------- Import ----------


class ImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    errors: list[str] = Field(default_factory=list)


# ---------- Dashboard ----------


class PipelineBucket(BaseModel):
    status: LeadStatus
    count: int


class UpcomingSend(BaseModel):
    id: uuid.UUID
    lead_email: str
    lead_name: str
    sequence_name: str
    subject: str
    scheduled_for: datetime


class DashboardStats(BaseModel):
    total_leads: int
    pipeline: list[PipelineBucket]
    active_enrollments: int
    sends_last_7_days: int
    sends_scheduled: int
    reply_rate: float
    upcoming: list[UpcomingSend]


# ---------- Template preview ----------


class PreviewRequest(BaseModel):
    subject: str
    body: str
    lead_id: uuid.UUID | None = None


class PreviewResponse(BaseModel):
    subject: str
    body: str
    missing_fields: list[str] = Field(default_factory=list)
