"""Enrollment + send scheduling.

Design note: enrolling a lead materializes one ScheduledSend row per step up
front. That makes the whole plan visible and cancellable in the UI before
anything goes out, and it gives the worker a trivial "claim what's due" query
instead of recomputing offsets on every tick.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.config import settings
from app.models import (
    Activity,
    ActivityType,
    Enrollment,
    EnrollmentStatus,
    Lead,
    LeadStatus,
    ScheduledSend,
    SendStatus,
    Sequence,
)
from app.services.mailer import MailerError, get_mailer
from app.services.templating import render_for_lead

logger = logging.getLogger("outreach.engine")

# Statuses that mean "stop talking to this person".
HALT_STATUSES = {LeadStatus.replied, LeadStatus.won, LeadStatus.lost, LeadStatus.unsubscribed}


def log_activity(
    db: Session,
    lead_id: uuid.UUID,
    type_: ActivityType,
    summary: str,
    detail: dict | None = None,
) -> Activity:
    activity = Activity(lead_id=lead_id, type=type_, summary=summary, detail=detail or {})
    db.add(activity)
    return activity


def enroll_lead(db: Session, lead: Lead, sequence: Sequence) -> tuple[Enrollment | None, str | None]:
    """Enroll one lead, materializing its send plan. Returns (enrollment, skip_reason)."""
    if lead.status in HALT_STATUSES:
        return None, f"lead status is '{lead.status.value}'"
    if not sequence.steps:
        return None, "sequence has no steps"

    existing = db.scalar(
        select(Enrollment).where(
            Enrollment.lead_id == lead.id, Enrollment.sequence_id == sequence.id
        )
    )
    if existing:
        return None, "already enrolled in this sequence"

    now = datetime.now(timezone.utc)
    enrollment = Enrollment(
        lead_id=lead.id,
        sequence_id=sequence.id,
        status=EnrollmentStatus.active,
        enrolled_at=now,
    )
    db.add(enrollment)
    db.flush()  # need enrollment.id for the send rows

    for step in sorted(sequence.steps, key=lambda s: s.step_order):
        db.add(
            ScheduledSend(
                enrollment_id=enrollment.id,
                step_id=step.id,
                scheduled_for=now + timedelta(days=step.delay_days),
                status=SendStatus.scheduled,
            )
        )

    log_activity(
        db,
        lead.id,
        ActivityType.enrolled,
        f"Enrolled in '{sequence.name}'",
        {"sequence_id": str(sequence.id), "steps": len(sequence.steps)},
    )
    return enrollment, None


def stop_enrollment(db: Session, enrollment: Enrollment, reason: str) -> None:
    """Halt an enrollment and cancel anything it still had queued."""
    enrollment.status = EnrollmentStatus.stopped
    for send in enrollment.sends:
        if send.status == SendStatus.scheduled:
            send.status = SendStatus.canceled

    log_activity(
        db,
        enrollment.lead_id,
        ActivityType.unenrolled,
        f"Removed from sequence: {reason}",
        {"enrollment_id": str(enrollment.id)},
    )


def halt_lead_enrollments(db: Session, lead: Lead, reason: str) -> int:
    """Stop every active enrollment for a lead -- used when they reply or opt out."""
    enrollments = db.scalars(
        select(Enrollment)
        .options(selectinload(Enrollment.sends))
        .where(Enrollment.lead_id == lead.id, Enrollment.status == EnrollmentStatus.active)
    ).all()
    for enrollment in enrollments:
        stop_enrollment(db, enrollment, reason)
    return len(enrollments)


def _sent_today(db: Session) -> int:
    start_of_day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return (
        db.scalar(
            select(func.count(ScheduledSend.id)).where(
                ScheduledSend.status == SendStatus.sent,
                ScheduledSend.sent_at >= start_of_day,
            )
        )
        or 0
    )


def process_due_sends(db: Session, limit: int | None = None) -> dict[str, int]:
    """Send everything that's due, respecting the daily cap. Returns a tally."""
    budget = max(0, settings.daily_send_cap - _sent_today(db))
    if budget == 0:
        logger.info("daily send cap of %s reached; skipping tick", settings.daily_send_cap)
        return {"sent": 0, "failed": 0, "skipped": 0, "cap_reached": 1}

    batch = min(limit or settings.send_batch_size, budget)
    now = datetime.now(timezone.utc)

    # SKIP LOCKED lets multiple workers run without handing the same row to two
    # of them -- the row is claimed for the life of this transaction.
    due = db.scalars(
        select(ScheduledSend)
        .join(Enrollment)
        .options(
            selectinload(ScheduledSend.step),
            selectinload(ScheduledSend.enrollment).selectinload(Enrollment.lead),
            selectinload(ScheduledSend.enrollment).selectinload(Enrollment.sequence),
        )
        .where(
            ScheduledSend.status == SendStatus.scheduled,
            ScheduledSend.scheduled_for <= now,
            Enrollment.status == EnrollmentStatus.active,
        )
        .order_by(ScheduledSend.scheduled_for)
        .limit(batch)
        .with_for_update(of=ScheduledSend, skip_locked=True)
    ).all()

    mailer = get_mailer()
    tally = {"sent": 0, "failed": 0, "skipped": 0, "cap_reached": 0}

    for send in due:
        enrollment = send.enrollment
        lead = enrollment.lead

        # The lead may have replied or opted out after this row was created.
        if lead.status in HALT_STATUSES:
            send.status = SendStatus.canceled
            stop_enrollment(db, enrollment, f"lead status is '{lead.status.value}'")
            tally["skipped"] += 1
            continue

        subject, body, _missing = render_for_lead(send.step.subject, send.step.body, lead)
        send.rendered_subject = subject
        send.rendered_body = body

        try:
            mailer.send(lead.email, subject, body)
        except MailerError as exc:
            send.status = SendStatus.failed
            send.error = str(exc)
            log_activity(
                db,
                lead.id,
                ActivityType.email_failed,
                f"Send failed: {subject}",
                {"error": str(exc), "step": send.step.step_order},
            )
            tally["failed"] += 1
            continue

        send.status = SendStatus.sent
        send.sent_at = datetime.now(timezone.utc)
        send.error = None
        enrollment.current_step = send.step.step_order

        # First touch moves a brand-new lead into the contacted column.
        if lead.status == LeadStatus.new:
            lead.status = LeadStatus.contacted

        log_activity(
            db,
            lead.id,
            ActivityType.email_sent,
            subject,
            {
                "step": send.step.step_order,
                "sequence": enrollment.sequence.name,
                "body": body,
            },
        )
        tally["sent"] += 1

        # Last step delivered -> the enrollment is done.
        remaining = [
            s for s in enrollment.sends if s.status == SendStatus.scheduled and s.id != send.id
        ]
        if not remaining:
            enrollment.status = EnrollmentStatus.completed
            enrollment.completed_at = datetime.now(timezone.utc)

    db.commit()
    if any(tally.values()):
        logger.info("tick complete: %s", tally)
    return tally
