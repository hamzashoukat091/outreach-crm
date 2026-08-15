"""The / dashboard, rebuilt on prospects + automation messages.

The response keeps the original field names (total_leads, upcoming, ...) so
the existing frontend page renders unchanged; only the data source moved when
the old leads layer was removed.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import (
    EnrollmentState,
    Message,
    MessageDirection,
    MessageState,
    Prospect,
    ProspectStatus,
    Sequence,
    SequenceEnrollment,
)
from app.schemas.schemas import DashboardStats, PipelineBucket, UpcomingSend

router = APIRouter(prefix="/api/dashboard", tags=["dashboard"])

# Statuses that count as a positive response for the reply-rate metric.
REPLY_STATUSES = (ProspectStatus.replied, ProspectStatus.won)


@router.get("", response_model=DashboardStats)
def get_stats(db: Session = Depends(get_db)):
    active = Prospect.is_archived.is_(False)

    total = db.scalar(select(func.count(Prospect.id)).where(active)) or 0

    counts = dict(
        db.execute(
            select(Prospect.status, func.count(Prospect.id)).where(active).group_by(Prospect.status)
        ).all()
    )
    pipeline = [
        PipelineBucket(status=s.value, count=counts.get(s, 0)) for s in ProspectStatus
    ]

    active_enrollments = (
        db.scalar(
            select(func.count(SequenceEnrollment.id)).where(
                SequenceEnrollment.state == EnrollmentState.active
            )
        )
        or 0
    )

    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    sends_last_7_days = (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.direction == MessageDirection.outbound,
                Message.state == MessageState.sent,
                Message.sent_at >= week_ago,
            )
        )
        or 0
    )

    sends_scheduled = (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.direction == MessageDirection.outbound,
                Message.state.in_((MessageState.scheduled, MessageState.drafting)),
            )
        )
        or 0
    )

    # Reply rate against prospects actually contacted (anything past 'new'/'drafted').
    contacted = (
        db.scalar(
            select(func.count(Prospect.id)).where(
                active, Prospect.status.notin_((ProspectStatus.new, ProspectStatus.drafted))
            )
        )
        or 0
    )
    replied = sum(counts.get(s, 0) for s in REPLY_STATUSES)
    reply_rate = round((replied / contacted) * 100, 1) if contacted else 0.0

    upcoming_rows = db.execute(
        select(Message, Prospect, Sequence)
        .join(Prospect, Message.prospect_id == Prospect.id)
        .join(SequenceEnrollment, Message.enrollment_id == SequenceEnrollment.id)
        .join(Sequence, SequenceEnrollment.sequence_id == Sequence.id)
        .where(
            Message.direction == MessageDirection.outbound,
            Message.state.in_((MessageState.scheduled, MessageState.drafting)),
            SequenceEnrollment.state == EnrollmentState.active,
        )
        .order_by(Message.scheduled_for)
        .limit(10)
    ).all()

    upcoming = [
        UpcomingSend(
            id=message.id,
            lead_email=prospect.email,
            lead_name=prospect.full_name,
            sequence_name=sequence.name,
            # Drafting messages have no subject yet -- the text is written
            # closer to send time.
            subject=message.subject or "(drafting…)",
            scheduled_for=message.scheduled_for,
        )
        for message, prospect, sequence in upcoming_rows
        if message.scheduled_for
    ]

    return DashboardStats(
        total_leads=total,
        pipeline=pipeline,
        active_enrollments=active_enrollments,
        sends_last_7_days=sends_last_7_days,
        sends_scheduled=sends_scheduled,
        reply_rate=reply_rate,
        upcoming=upcoming,
    )
