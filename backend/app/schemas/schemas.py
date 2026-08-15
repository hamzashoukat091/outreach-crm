"""Dashboard response shapes.

The rest of the old MVP schema surface (leads, template sequences, scheduled
sends) went with the leads layer. The dashboard keeps its original field names
so the existing frontend page continues to render, but the numbers now come
from prospects and automation messages.
"""

import uuid
from datetime import datetime

from pydantic import BaseModel, Field


class PipelineBucket(BaseModel):
    status: str
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
    pipeline: list[PipelineBucket] = Field(default_factory=list)
    active_enrollments: int
    sends_last_7_days: int
    sends_scheduled: int
    reply_rate: float
    upcoming: list[UpcomingSend] = Field(default_factory=list)
