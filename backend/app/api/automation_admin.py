"""Operator surface: settings, sender facts, analytics, status."""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings as env_settings
from app.core.db import get_db
from app.models import (
    DEFAULT_SETTINGS,
    SETTINGS_SECTIONS,
    AutomationSettings,
    EnrollmentState,
    Message,
    MessageDirection,
    MessageState,
    Sequence,
    SequenceEnrollment,
)
from app.schemas.automation import (
    AutomationAnalytics,
    AutomationSettingsOut,
    AutomationSettingsUpdate,
    AutomationStatus,
    SenderFactsOut,
    SenderFactsUpdate,
    SequenceAnalyticsRow,
    SettingsResetRequest,
    StepDropoff,
)
from app.services.automation_settings import (
    get_settings_row,
    sends_in_last_day,
    sends_in_last_hour,
    within_send_window,
)
from app.services.replier import get_or_create_facts

router = APIRouter(prefix="/api/automation", tags=["automation"])

PASSWORD_FIELDS = ("smtp_password",)


def _settings_out(row: AutomationSettings) -> AutomationSettingsOut:
    out = AutomationSettingsOut.model_validate(row)
    out.has_smtp_password = bool(row.smtp_password)
    return out


@router.get("/settings", response_model=AutomationSettingsOut)
def get_settings(db: Session = Depends(get_db)):
    return _settings_out(get_settings_row(db))


@router.put("/settings", response_model=AutomationSettingsOut)
def update_settings(payload: AutomationSettingsUpdate, db: Session = Depends(get_db)):
    row = get_settings_row(db)
    updates = payload.model_dump(exclude_unset=True)

    if "send_days" in updates and updates["send_days"] is not None:
        days = sorted(set(updates["send_days"]))
        if any(d < 1 or d > 7 for d in days):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "send_days must be ISO 1-7")
        updates["send_days"] = days

    for key, value in updates.items():
        if key in PASSWORD_FIELDS:
            # Write-only: absent = keep (handled by exclude_unset), "" = clear.
            setattr(row, key, value or None)
        else:
            setattr(row, key, value)

    db.commit()
    db.refresh(row)
    return _settings_out(row)


@router.post("/settings/reset", response_model=AutomationSettingsOut)
def reset_settings_section(payload: SettingsResetRequest, db: Session = Depends(get_db)):
    fields = SETTINGS_SECTIONS.get(payload.section)
    if not fields:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            f"Unknown section '{payload.section}'. One of: {', '.join(SETTINGS_SECTIONS)}",
        )
    row = get_settings_row(db)
    for field in fields:
        default = DEFAULT_SETTINGS[field]
        # JSONB lists must not be shared between the defaults dict and the row.
        setattr(row, field, list(default) if isinstance(default, list) else default)
    db.commit()
    db.refresh(row)
    return _settings_out(row)


# ---------- Sender facts ----------


@router.get("/sender-facts", response_model=SenderFactsOut)
def get_sender_facts(db: Session = Depends(get_db)):
    return get_or_create_facts(db)


@router.put("/sender-facts", response_model=SenderFactsOut)
def update_sender_facts(payload: SenderFactsUpdate, db: Session = Depends(get_db)):
    facts = get_or_create_facts(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(facts, key, value)
    db.commit()
    db.refresh(facts)
    return facts


# ---------- Analytics ----------


@router.get("/analytics", response_model=AutomationAnalytics)
def automation_analytics(db: Session = Depends(get_db)):
    open_states = (EnrollmentState.active, EnrollmentState.paused)

    active = (
        db.scalar(
            select(func.count(SequenceEnrollment.id)).where(
                SequenceEnrollment.state.in_(open_states)
            )
        )
        or 0
    )
    total_sent = (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.direction == MessageDirection.outbound,
                Message.state == MessageState.sent,
            )
        )
        or 0
    )
    replies_received = (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.direction == MessageDirection.inbound,
                Message.situation.isnot(None),  # classified = a real reply, not a bounce
            )
        )
        or 0
    )
    pending_approvals = (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.state == MessageState.needs_approval
            )
        )
        or 0
    )

    # Reply rate over enrollments that were actually mailed at least once.
    contacted = (
        db.scalar(
            select(func.count(func.distinct(Message.enrollment_id))).where(
                Message.direction == MessageDirection.outbound,
                Message.state == MessageState.sent,
                Message.enrollment_id.isnot(None),
            )
        )
        or 0
    )
    replied = (
        db.scalar(
            select(func.count(SequenceEnrollment.id)).where(
                SequenceEnrollment.state == EnrollmentState.replied
            )
        )
        or 0
    )

    settings_row = get_settings_row(db)

    sequences = db.scalars(
        select(Sequence).options(selectinload(Sequence.steps)).order_by(Sequence.created_at)
    ).unique().all()

    rows: list[SequenceAnalyticsRow] = []
    for sequence in sequences:
        rows.append(_sequence_row(db, sequence))

    return AutomationAnalytics(
        active_enrollments=active,
        total_sent=total_sent,
        replies_received=replies_received,
        reply_rate=round((replied / contacted) * 100, 1) if contacted else 0.0,
        pending_approvals=pending_approvals,
        sends_today=sends_in_last_day(db),
        daily_send_limit=settings_row.daily_send_limit,
        sequences=rows,
    )


def _sequence_row(db: Session, sequence: Sequence) -> SequenceAnalyticsRow:
    counts = dict(
        db.execute(
            select(SequenceEnrollment.state, func.count(SequenceEnrollment.id))
            .where(SequenceEnrollment.sequence_id == sequence.id)
            .group_by(SequenceEnrollment.state)
        ).all()
    )
    enrolled = sum(counts.values())
    replied = counts.get(EnrollmentState.replied, 0)

    # Step drop-off: sends per position, plus replies credited to the last
    # step that had been sent when the reply arrived -- that step earned it.
    positions = {s.id: s.position for s in sequence.steps}
    sent_per_position: dict[int, int] = {}
    replies_after: dict[int, int] = {}

    enrollments = db.scalars(
        select(SequenceEnrollment)
        .options(selectinload(SequenceEnrollment.messages))
        .where(SequenceEnrollment.sequence_id == sequence.id)
    ).unique().all()

    for enrollment in enrollments:
        sent = [
            m
            for m in enrollment.messages
            if m.direction == MessageDirection.outbound
            and m.state == MessageState.sent
            and m.step_id in positions
        ]
        for message in sent:
            pos = positions[message.step_id]
            sent_per_position[pos] = sent_per_position.get(pos, 0) + 1

        first_reply = min(
            (
                m
                for m in enrollment.messages
                if m.direction == MessageDirection.inbound and m.situation is not None
            ),
            key=lambda m: m.received_at or m.created_at,
            default=None,
        )
        if first_reply and sent:
            reply_at = first_reply.received_at or first_reply.created_at
            before = [
                positions[m.step_id]
                for m in sent
                if (m.sent_at or m.created_at) <= reply_at
            ]
            if before:
                credited = max(before)
                replies_after[credited] = replies_after.get(credited, 0) + 1

    steps = [
        StepDropoff(
            position=pos,
            sent=sent_per_position.get(pos, 0),
            replies_after=replies_after.get(pos, 0),
        )
        for pos in sorted({s.position for s in sequence.steps})
    ]

    return SequenceAnalyticsRow(
        sequence_id=sequence.id,
        name=sequence.name,
        enrolled=enrolled,
        active=counts.get(EnrollmentState.active, 0) + counts.get(EnrollmentState.paused, 0),
        completed=counts.get(EnrollmentState.completed, 0),
        replied=replied,
        reply_rate=round((replied / enrolled) * 100, 1) if enrolled else 0.0,
        steps=steps,
    )


# ---------- Status ----------


@router.get("/status", response_model=AutomationStatus)
def automation_status(db: Session = Depends(get_db)):
    row = get_settings_row(db)
    now = datetime.now(timezone.utc)

    next_scheduled = db.scalar(
        select(func.min(Message.scheduled_for)).where(
            Message.state.in_((MessageState.scheduled, MessageState.drafting)),
            Message.direction == MessageDirection.outbound,
        )
    )

    heartbeat = row.worker_heartbeat_at
    # Missing two full ticks (plus slack) means the worker is down or wedged.
    alive_horizon = timedelta(seconds=max(60, env_settings.worker_interval_seconds * 4))
    worker_alive = bool(heartbeat and (now - heartbeat) < alive_horizon)

    return AutomationStatus(
        dry_run=row.dry_run,
        sending_paused=row.sending_paused,
        window_open=within_send_window(row, now),
        sends_this_hour=sends_in_last_hour(db, now),
        hourly_send_limit=row.hourly_send_limit,
        sends_today=sends_in_last_day(db, now),
        daily_send_limit=row.daily_send_limit,
        next_scheduled_at=next_scheduled,
        worker_heartbeat_at=heartbeat,
        worker_alive=worker_alive,
    )
