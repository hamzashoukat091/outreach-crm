"""Walking prospects through sequences.

The lifecycle: enroll() creates the enrollment and its first message row in
state 'drafting'; the worker calls draft_message() to write it and move it to
'scheduled'; after the send, advance() creates the next step's message or
completes the enrollment. The stop rules (reply, bounce, unsubscribe, manual
stop) all funnel through _cancel_pending so nothing half-written can leak out
after a conversation has ended.
"""

import logging
import uuid
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import (
    EnrollmentState,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    Prospect,
    ProspectEvent,
    ProspectEventType,
    ProspectStatus,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
    Strategy,
    Suppression,
    SuppressionReason,
)
from app.services.automation_settings import (
    get_settings_row,
    is_suppressed,
    next_window_open,
    resolve_send_time,
)
from app.services.generator import (
    GUARDRAILS,
    GenerationError,
    _parse_response,
    build_context,
    build_sender_block,
    call_claude,
)
from app.services.thread import build_thread_context

logger = logging.getLogger("outreach.sequencer")

# States a message can still be pulled back from.
PENDING_STATES = (MessageState.drafting, MessageState.scheduled, MessageState.needs_approval)
# Kinds that belong to the sequence engine (vs. conversation replies).
SEQUENCE_KINDS = (MessageKind.opener, MessageKind.follow_up)


class SequencerError(Exception):
    """A refusal with a message safe to show the user."""


def log_event(
    db: Session,
    prospect_id: uuid.UUID,
    type_: ProspectEventType,
    summary: str,
    detail: dict | None = None,
) -> None:
    db.add(
        ProspectEvent(
            prospect_id=prospect_id, type=type_, summary=summary, detail=detail or {}
        )
    )


def _active_steps(sequence: Sequence) -> list[SequenceStep]:
    return sorted((s for s in sequence.steps if s.is_active), key=lambda s: s.position)


# ---------- Enrollment ----------


def enroll(
    db: Session,
    prospect: Prospect,
    sequence: Sequence,
    mode: str,
    send_at: datetime | None = None,
) -> SequenceEnrollment:
    """Put a prospect into a sequence and queue its first message.

    Raises SequencerError for every refusal (suppressed address, empty
    sequence, already enrolled) so bulk callers can report per-prospect
    outcomes instead of aborting the batch.
    """
    if is_suppressed(db, prospect.email):
        raise SequencerError("Address is suppressed (unsubscribed or bounced)")

    steps = _active_steps(sequence)
    if not steps:
        raise SequencerError("Sequence has no active steps")

    settings_row = get_settings_row(db)
    first_step = steps[0]
    scheduled_for = resolve_send_time(settings_row, mode, send_at, first_step.send_at_time)

    enrollment = SequenceEnrollment(
        prospect_id=prospect.id,
        sequence_id=sequence.id,
        state=EnrollmentState.active,
        current_position=0,
    )
    try:
        # Savepoint so the partial unique index violation (already actively
        # enrolled) leaves the session usable for the rest of a bulk call.
        with db.begin_nested():
            db.add(enrollment)
            db.flush()
    except IntegrityError as exc:
        raise SequencerError("Already enrolled in this sequence") from exc

    message = Message(
        prospect_id=prospect.id,
        # Assigned via the relationship so an already-loaded enrollment.messages
        # collection sees the new row without a round-trip.
        enrollment=enrollment,
        step_id=first_step.id,
        strategy_id=first_step.strategy_id,
        direction=MessageDirection.outbound,
        kind=MessageKind.opener,
        state=MessageState.drafting,
        to_address=prospect.email,
        scheduled_for=scheduled_for,
    )
    db.add(message)

    if prospect.pipeline_mode != "automated":
        prospect.pipeline_mode = "automated"
        log_event(db, prospect.id, ProspectEventType.handed_off, "Handed off to automation")

    enrollment.last_activity_at = datetime.now(timezone.utc)
    log_event(
        db,
        prospect.id,
        ProspectEventType.enrolled,
        f"Enrolled in '{sequence.name}'",
        {"sequence_id": str(sequence.id), "mode": mode},
    )
    log_event(
        db,
        prospect.id,
        ProspectEventType.message_scheduled,
        f"Step 1 queued for {scheduled_for:%Y-%m-%d %H:%M} UTC",
        {"enrollment_id": str(enrollment.id), "step_position": first_step.position},
    )
    db.flush()

    # 'draft_now_send_later' promises the copy exists before it goes, and the
    # UI sells it as "you can read it before it goes". The worker only drafts
    # inside its 24h horizon, so a send further out than that would have left
    # nothing to read for hours. Write it here instead.
    #
    # Failure is not fatal: the row stays in 'drafting' and the worker retries
    # when the horizon opens, which is exactly the pre-existing behaviour.
    if mode != "send_at":
        try:
            with db.begin_nested():
                draft_message(db, message)
        except Exception:
            # Savepoint-scoped, so the enrollment itself survives. The message
            # stays in 'drafting' and the worker picks it up on its horizon --
            # a Claude outage must never block enrolling.
            logger.warning(
                "immediate draft failed for message %s; worker will retry",
                message.id,
                exc_info=True,
            )

    return enrollment


# ---------- Drafting ----------


def _resolve_step_strategy(db: Session, step: SequenceStep | None) -> Strategy:
    if step and step.strategy_id:
        strategy = db.get(Strategy, step.strategy_id)
        if strategy:
            return strategy
    # The step's strategy was deleted (or never set): fall back to the default
    # active opener rather than stalling the enrollment.
    strategy = db.scalar(
        select(Strategy).where(
            Strategy.kind == "opener",
            Strategy.is_active.is_(True),
            Strategy.is_default.is_(True),
        )
    ) or db.scalar(
        select(Strategy)
        .where(Strategy.kind == "opener", Strategy.is_active.is_(True))
        .order_by(Strategy.created_at)
    )
    if not strategy:
        raise SequencerError("No active opener strategy exists to draft with")
    return strategy


def draft_message(db: Session, message: Message) -> Message:
    """Write the subject/body for a queued sequence message via Claude.

    Openers set the enrollment's thread subject; follow-ups reuse it as
    "Re: <subject>" and are shown the thread so far, with explicit orders not
    to re-introduce the sender or re-run the same angle.
    """
    from app.api.sender import get_or_create_profile  # local import: avoids app.api at module load

    enrollment = message.enrollment
    prospect = message.prospect
    step = db.get(SequenceStep, message.step_id) if message.step_id else None
    strategy = _resolve_step_strategy(db, step)

    context, quality, used = build_context(prospect)
    sender = get_or_create_profile(db)

    is_follow_up = message.kind == MessageKind.follow_up and enrollment is not None

    parts: list[str] = []
    if is_follow_up:
        parts.append(
            "Write the next follow-up email in an ongoing cold outreach thread. "
            "The prospect has NOT replied to anything below."
        )
    else:
        parts.append("Write one cold outreach email to the prospect described below.")

    parts += ["", build_sender_block(sender), ""]

    if is_follow_up:
        parts += [
            "THE THREAD SO FAR:",
            build_thread_context(list(enrollment.messages)),
            "",
            "FOLLOW-UP RULES:",
            "- Do NOT re-introduce yourself; they have already been told who you are.",
            "- Do NOT repeat the angle, offer framing, or phrasing of any earlier "
            "email above. Bring one genuinely new reason to reply.",
            "- Reference the thread lightly at most ('circling back' energy is fine "
            "once, apologising for following up is not).",
            "- Shorter than the first email. A follow-up that is longer than the "
            "opener reads as pressure.",
            "",
        ]

    parts += ["YOUR STRATEGY AND INSTRUCTIONS:", strategy.instructions.strip()]

    if step and step.step_instructions:
        parts += ["", "THIS STEP SPECIFICALLY:", step.step_instructions.strip()]

    if strategy.tone:
        parts.append(f"\nTone: {strategy.tone}")

    instructions_cover_subject = "SUBJECT LINE" in strategy.instructions.upper()
    if is_follow_up and enrollment.thread_subject:
        parts.append(
            "\nThe subject line is fixed by the thread; still emit the SUBJECT: "
            "line but its content will be replaced with the thread subject."
        )
    elif strategy.subject_hint and not instructions_cover_subject:
        parts.append(f"Subject line guidance: {strategy.subject_hint}")

    parts.append(f"Hard length limit: {strategy.max_words} words for the body.")
    if sender and sender.signature:
        parts.append(f"Sign off as: {sender.signature}")

    parts += ["", "PROSPECT CONTEXT", context, "", GUARDRAILS]
    user_message = "\n".join(parts)
    system = strategy.system_prompt.strip()

    result = call_claude(system, user_message, max_tokens=max(1200, strategy.max_words * 8))
    if result["stop_reason"] == "max_tokens":
        raise GenerationError(
            "The model ran out of room before finishing. Lower the strategy's "
            "word limit and try again."
        )

    subject, body = _parse_response(result["text"])

    if is_follow_up and enrollment.thread_subject:
        subject = f"Re: {enrollment.thread_subject}"[:500]
    elif enrollment is not None and not enrollment.thread_subject:
        # The opener names the thread; everything after rides on it.
        enrollment.thread_subject = subject

    message.subject = subject
    message.body = body
    message.state = MessageState.scheduled
    message.strategy_id = strategy.id
    message.strategy_name = strategy.name
    message.model = result["model"]
    message.context_quality = quality
    message.context_used = used
    message.system_prompt = system
    message.user_prompt = user_message
    message.raw_response = result["text"]
    message.input_tokens = result["input_tokens"]
    message.output_tokens = result["output_tokens"]
    db.flush()
    return message


# ---------- Advancing ----------


def advance(db: Session, enrollment: SequenceEnrollment) -> Message | None:
    """After a send: queue the next step, or complete the enrollment."""
    if enrollment.state != EnrollmentState.active:
        return None

    sent = [
        m
        for m in enrollment.messages
        if m.kind in SEQUENCE_KINDS and m.state == MessageState.sent
    ]
    if not sent:
        return None
    last = max(sent, key=lambda m: m.sent_at or m.created_at)

    last_step = db.get(SequenceStep, last.step_id) if last.step_id else None
    if last_step:
        enrollment.current_position = last_step.position

    steps = _active_steps(enrollment.sequence)
    remaining = [s for s in steps if s.position > enrollment.current_position]
    if not remaining:
        enrollment.state = EnrollmentState.completed
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "All steps sent"
        db.flush()
        return None

    next_step = remaining[0]
    settings_row = get_settings_row(db)

    # wait_days after the previous send, at the step's own time of day (or the
    # account default), in the operator's timezone, clamped into the window.
    from app.services.automation_settings import _tz  # shared tz parsing

    tz = _tz(settings_row)
    base = (last.sent_at or datetime.now(timezone.utc)).astimezone(tz)
    at = next_step.send_at_time or settings_row.default_send_time
    local_day = (base + timedelta(days=next_step.wait_days)).date()
    scheduled_for = datetime.combine(local_day, at, tzinfo=tz).astimezone(timezone.utc)
    scheduled_for = max(scheduled_for, datetime.now(timezone.utc))
    scheduled_for = next_window_open(settings_row, scheduled_for)

    message = Message(
        prospect_id=enrollment.prospect_id,
        enrollment=enrollment,
        step_id=next_step.id,
        strategy_id=next_step.strategy_id,
        direction=MessageDirection.outbound,
        kind=MessageKind.follow_up,
        state=MessageState.drafting,
        to_address=enrollment.prospect.email,
        scheduled_for=scheduled_for,
    )
    db.add(message)
    log_event(
        db,
        enrollment.prospect_id,
        ProspectEventType.message_scheduled,
        f"Step {next_step.position} queued for {scheduled_for:%Y-%m-%d %H:%M} UTC",
        {"enrollment_id": str(enrollment.id), "step_position": next_step.position},
    )
    db.flush()
    return message


# ---------- Stop rules ----------


def _cancel_pending(
    db: Session,
    enrollment: SequenceEnrollment,
    kinds: tuple[MessageKind, ...] = SEQUENCE_KINDS,
) -> int:
    cancelled = 0
    for message in enrollment.messages:
        if (
            message.direction == MessageDirection.outbound
            and message.kind in kinds
            and message.state in PENDING_STATES
        ):
            message.state = MessageState.cancelled
            cancelled += 1
    return cancelled


def stop(
    db: Session,
    enrollment: SequenceEnrollment,
    reason: str,
    state: EnrollmentState = EnrollmentState.stopped,
) -> None:
    """End an enrollment and pull back everything not yet sent."""
    if not enrollment.is_open:
        return
    # Manual stops cancel reply drafts too: 'stop' means stop talking.
    kinds = SEQUENCE_KINDS + ((MessageKind.reply,) if state == EnrollmentState.stopped else ())
    _cancel_pending(db, enrollment, kinds)
    enrollment.state = state
    enrollment.ended_at = datetime.now(timezone.utc)
    enrollment.end_reason = reason
    log_event(
        db,
        enrollment.prospect_id,
        ProspectEventType.unenrolled,
        f"Sequence ended: {reason}",
        {"enrollment_id": str(enrollment.id), "state": state.value},
    )
    db.flush()


def on_reply(db: Session, enrollment: SequenceEnrollment, inbound_msg: Message) -> None:
    """They answered: the sequence's job is done, reply mode takes over."""
    _cancel_pending(db, enrollment)  # sequence steps only; reply drafts survive
    if enrollment.is_open:
        enrollment.state = EnrollmentState.replied
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "Prospect replied"
    enrollment.last_activity_at = datetime.now(timezone.utc)

    prospect = enrollment.prospect
    if prospect.status not in (ProspectStatus.won, ProspectStatus.not_interested):
        prospect.status = ProspectStatus.replied
    db.flush()


def on_bounce(db: Session, enrollment: SequenceEnrollment, detail: str | None = None) -> None:
    """Hard bounce: stop the enrollment and never mail the address again."""
    _cancel_pending(db, enrollment, SEQUENCE_KINDS + (MessageKind.reply,))
    if enrollment.is_open:
        enrollment.state = EnrollmentState.bounced
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "Delivery bounced"

    prospect = enrollment.prospect
    prospect.status = ProspectStatus.bounced
    _suppress(db, prospect.email, SuppressionReason.hard_bounce, detail)
    log_event(
        db,
        prospect.id,
        ProspectEventType.bounced,
        "Delivery bounced; address suppressed",
        {"detail": detail or ""},
    )
    log_event(db, prospect.id, ProspectEventType.suppressed, "Suppressed: hard bounce")
    db.flush()


def on_unsubscribe(db: Session, prospect: Prospect, detail: str | None = None) -> None:
    """They asked out. Suppress the address and cancel everything queued for
    it -- across ALL enrollments, since an unsubscribe is not per-sequence."""
    email = prospect.email.lower().strip()
    _suppress(db, email, SuppressionReason.unsubscribed, detail)

    pending = db.scalars(
        select(Message).where(
            Message.to_address == email,
            Message.direction == MessageDirection.outbound,
            Message.state.in_(PENDING_STATES),
        )
    ).all()
    for message in pending:
        message.state = MessageState.cancelled

    enrollments = db.scalars(
        select(SequenceEnrollment).where(
            SequenceEnrollment.prospect_id == prospect.id,
            SequenceEnrollment.state.in_((EnrollmentState.active, EnrollmentState.paused)),
        )
    ).all()
    for enrollment in enrollments:
        enrollment.state = EnrollmentState.stopped
        enrollment.ended_at = datetime.now(timezone.utc)
        enrollment.end_reason = "Unsubscribed"

    prospect.status = ProspectStatus.not_interested
    log_event(db, prospect.id, ProspectEventType.suppressed, "Unsubscribed; address suppressed")
    db.flush()


def _suppress(
    db: Session, email: str, reason: SuppressionReason, detail: str | None = None
) -> None:
    email = email.lower().strip()
    if not db.scalar(select(Suppression).where(Suppression.email == email)):
        db.add(Suppression(email=email, reason=reason, detail=detail))
