from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import (
    Enrollment,
    EnrollmentStatus,
    Lead,
    LeadStatus,
    ScheduledSend,
    SendStatus,
    Sequence,
    SequenceStep,
)
from app.schemas import DashboardStats, PipelineBucket, UpcomingSend

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Statuses that count as a positive response for the reply-rate metric.
REPLY_STATUSES = (LeadStatus.replied, LeadStatus.qualified, LeadStatus.won)


@router.get("", response_model=DashboardStats)
def get_stats(db: Session = Depends(get_db)):
    total_leads = db.scalar(select(func.count(Lead.id))) or 0

    counts = dict(
        db.execute(select(Lead.status, func.count(Lead.id)).group_by(Lead.status)).all()
    )
    pipeline = [
        PipelineBucket(status=s, count=counts.get(s, 0))
        for s in LeadStatus
    ]

    active_enrollments = (
        db.scalar(
            select(func.count(Enrollment.id)).where(
                Enrollment.status == EnrollmentStatus.active
            )
        )
        or 0
    )

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    sends_last_7_days = (
        db.scalar(
            select(func.count(ScheduledSend.id)).where(
                ScheduledSend.status == SendStatus.sent, ScheduledSend.sent_at >= week_ago
            )
        )
        or 0
    )

    sends_scheduled = (
        db.scalar(
            select(func.count(ScheduledSend.id)).where(
                ScheduledSend.status == SendStatus.scheduled
            )
        )
        or 0
    )

    # Reply rate is measured against leads actually contacted, not the whole list.
    contacted = (
        db.scalar(
            select(func.count(Lead.id)).where(Lead.status != LeadStatus.new)
        )
        or 0
    )
    replied = sum(counts.get(s, 0) for s in REPLY_STATUSES)
    reply_rate = round((replied / contacted) * 100, 1) if contacted else 0.0

    upcoming_rows = db.execute(
        select(ScheduledSend, Lead, Sequence, SequenceStep)
        .join(Enrollment, ScheduledSend.enrollment_id == Enrollment.id)
        .join(Lead, Enrollment.lead_id == Lead.id)
        .join(Sequence, Enrollment.sequence_id == Sequence.id)
        .join(SequenceStep, ScheduledSend.step_id == SequenceStep.id)
        .where(
            ScheduledSend.status == SendStatus.scheduled,
            Enrollment.status == EnrollmentStatus.active,
        )
        .order_by(ScheduledSend.scheduled_for)
        .limit(10)
    ).all()

    upcoming = [
        UpcomingSend(
            id=send.id,
            lead_email=lead.email,
            lead_name=lead.full_name,
            sequence_name=sequence.name,
            subject=step.subject,
            scheduled_for=send.scheduled_for,
        )
        for send, lead, sequence, step in upcoming_rows
    ]

    return DashboardStats(
        total_leads=total_leads,
        pipeline=pipeline,
        active_enrollments=active_enrollments,
        sends_last_7_days=sends_last_7_days,
        sends_scheduled=sends_scheduled,
        reply_rate=reply_rate,
        upcoming=upcoming,
    )
