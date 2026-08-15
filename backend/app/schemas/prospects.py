import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, EmailStr, Field

from app.models import DraftStatus, ProspectEventType, ProspectStatus


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Prospects ----------


class ProspectBase(BaseModel):
    email: EmailStr
    first_name: str | None = None
    last_name: str | None = None
    job_title: str | None = None
    job_department: str | None = None
    seniority: str | None = None
    linkedin: str | None = None
    prospect_city: str | None = None
    prospect_region: str | None = None
    prospect_country: str | None = None
    company_name: str | None = None
    company_domain: str | None = None
    company_website: str | None = None
    company_description: str | None = None
    company_city: str | None = None
    company_region: str | None = None
    company_country: str | None = None
    employee_range: str | None = None
    revenue_range: str | None = None
    industry: str | None = None
    tags: list[str] = Field(default_factory=list)
    notes: str | None = None


class ProspectCreate(ProspectBase):
    status: ProspectStatus = ProspectStatus.new


class ProspectUpdate(BaseModel):
    """Every field optional -- this is the manual gap-filling surface."""

    email: EmailStr | None = None
    first_name: str | None = None
    last_name: str | None = None
    job_title: str | None = None
    job_department: str | None = None
    seniority: str | None = None
    linkedin: str | None = None
    prospect_city: str | None = None
    prospect_region: str | None = None
    prospect_country: str | None = None
    company_name: str | None = None
    company_domain: str | None = None
    company_website: str | None = None
    company_description: str | None = None
    company_city: str | None = None
    company_region: str | None = None
    company_country: str | None = None
    employee_range: str | None = None
    revenue_range: str | None = None
    industry: str | None = None
    status: ProspectStatus | None = None
    tags: list[str] | None = None
    notes: str | None = None


class ArchiveRequest(BaseModel):
    reason: str | None = Field(default=None, max_length=300)


class BulkArchiveRequest(BaseModel):
    prospect_ids: list[uuid.UUID] = Field(min_length=1)
    archived: bool = True
    reason: str | None = Field(default=None, max_length=300)


class ProspectOut(ORMModel, ProspectBase):
    id: uuid.UUID
    full_name: str
    display_company: str
    status: ProspectStatus
    is_complete: bool
    missing_fields: list[str]
    company_inferred: bool
    is_archived: bool = False
    archived_at: datetime | None = None
    archive_reason: str | None = None
    email_status: str | None = None
    naics: str | None = None
    intent_topics: list[Any] = Field(default_factory=list)
    skills: list[Any] = Field(default_factory=list)
    interests: list[Any] = Field(default_factory=list)
    experience: list[Any] = Field(default_factory=list)
    other_emails: list[Any] = Field(default_factory=list)
    top_intent: str | None = None
    draft_count: int = 0
    last_draft_status: DraftStatus | None = None
    created_at: datetime
    updated_at: datetime


class ProspectList(BaseModel):
    items: list[ProspectOut]
    total: int
    page: int
    page_size: int


class ProspectImportResult(BaseModel):
    created: int
    updated: int
    skipped: int
    incomplete: int
    errors: list[str] = Field(default_factory=list)


# ---------- Strategies ----------


class StrategyBase(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    description: str | None = None
    system_prompt: str = Field(min_length=1)
    instructions: str = Field(min_length=1)
    tone: str | None = None
    max_words: int = Field(default=150, ge=30, le=600)
    subject_hint: str | None = None
    is_default: bool = False
    is_active: bool = True


class StrategyCreate(StrategyBase):
    pass


class StrategyUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    system_prompt: str | None = None
    instructions: str | None = None
    tone: str | None = None
    max_words: int | None = Field(default=None, ge=30, le=600)
    subject_hint: str | None = None
    is_default: bool | None = None
    is_active: bool | None = None


class StrategyOut(ORMModel, StrategyBase):
    id: uuid.UUID
    created_at: datetime
    usage_count: int = 0


# ---------- Sender profile ----------


class SenderProfileUpdate(BaseModel):
    name: str | None = None
    headline: str | None = None
    offer: str | None = None
    proof: str | None = None
    call_to_action: str | None = None
    signature: str | None = None


class SenderProfileOut(ORMModel):
    id: uuid.UUID
    name: str | None = None
    headline: str | None = None
    offer: str | None = None
    proof: str | None = None
    call_to_action: str | None = None
    signature: str | None = None
    is_configured: bool = False


# ---------- Drafts ----------


class GenerateRequest(BaseModel):
    strategy_id: uuid.UUID | None = None


class BulkGenerateRequest(BaseModel):
    prospect_ids: list[uuid.UUID] = Field(min_length=1, max_length=25)
    strategy_id: uuid.UUID | None = None


class DraftUpdate(BaseModel):
    subject: str | None = Field(default=None, max_length=500)
    body: str | None = None


class DraftOut(ORMModel):
    id: uuid.UUID
    prospect_id: uuid.UUID
    strategy_id: uuid.UUID | None = None
    strategy_name: str | None = None
    subject: str
    body: str
    status: DraftStatus
    model: str | None = None
    context_quality: str | None = None
    context_used: dict[str, Any] = Field(default_factory=dict)
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None
    edited: bool
    approved_at: datetime | None = None
    created_at: datetime
    prospect_email: str | None = None
    prospect_name: str | None = None


class BulkGenerateResult(BaseModel):
    generated: int
    failed: int
    drafts: list[DraftOut] = Field(default_factory=list)
    errors: dict[str, str] = Field(default_factory=dict)


# ---------- Events ----------


class ProspectEventCreate(BaseModel):
    type: ProspectEventType = ProspectEventType.note
    summary: str = Field(min_length=1, max_length=500)
    detail: dict[str, Any] = Field(default_factory=dict)


class ProspectEventOut(ORMModel):
    id: uuid.UUID
    prospect_id: uuid.UUID
    type: ProspectEventType
    summary: str
    detail: dict[str, Any]
    created_at: datetime


# ---------- Analytics ----------


class StatusCount(BaseModel):
    status: str
    count: int


class NamedCount(BaseModel):
    label: str
    count: int


class DayCount(BaseModel):
    day: str
    generated: int
    approved: int


class StrategyPerformance(BaseModel):
    strategy_id: uuid.UUID | None = None
    name: str
    generated: int
    approved: int
    approval_rate: float
    replied: int
    reply_rate: float
    avg_output_tokens: float | None = None


class ProspectAnalytics(BaseModel):
    total_prospects: int
    complete: int
    incomplete: int
    data_completeness: float

    by_status: list[StatusCount]
    by_seniority: list[NamedCount]
    by_industry: list[NamedCount]
    by_employee_range: list[NamedCount]
    top_intent_topics: list[NamedCount]

    total_drafts: int
    approved_drafts: int
    approval_rate: float
    replied_count: int
    reply_rate: float

    thin_context_drafts: int
    rich_context_drafts: int
    thin_approval_rate: float
    rich_approval_rate: float

    activity: list[DayCount]
    strategy_performance: list[StrategyPerformance]

    total_input_tokens: int
    total_output_tokens: int
