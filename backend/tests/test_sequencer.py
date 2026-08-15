"""Enrollment lifecycle: enroll, advance, and every way a sequence stops."""

from datetime import datetime, timedelta, timezone

import pytest

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
    SequenceStep,
    Suppression,
    SuppressionReason,
)
from app.services.automation_settings import get_settings_row
from app.services.sequencer import (
    SequencerError,
    advance,
    enroll,
    on_bounce,
    on_reply,
    on_unsubscribe,
    stop,
)


def make_prospect(db, email="ana@example.com"):
    p = Prospect(email=email, first_name="Ana", last_name="Ruiz")
    db.add(p)
    db.flush()
    return p


def make_sequence(db, steps=2, name="Default outreach"):
    seq = Sequence(
        name=name,
        steps=[SequenceStep(position=i + 1, wait_days=3) for i in range(steps)],
    )
    db.add(seq)
    db.flush()
    return seq


def open_window_settings(db):
    """A 24/7 window so scheduling assertions don't depend on the wall clock."""
    row = get_settings_row(db)
    row.send_days = [1, 2, 3, 4, 5, 6, 7]
    row.send_window_start = datetime.min.time()
    row.send_window_end = datetime.max.time().replace(microsecond=0)
    db.flush()
    return row


def mark_sent(db, message, when=None):
    message.state = MessageState.sent
    message.sent_at = when or datetime.now(timezone.utc)
    db.flush()


def pending_messages(enrollment):
    return [
        m
        for m in enrollment.messages
        if m.state in (MessageState.drafting, MessageState.scheduled, MessageState.needs_approval)
    ]


def test_enroll_creates_first_message_scheduled_now(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)

    before = datetime.now(timezone.utc)
    enrollment = enroll(db, prospect, sequence, mode="send_now")

    assert enrollment.state == EnrollmentState.active
    messages = enrollment.messages
    assert len(messages) == 1
    first = messages[0]
    assert first.kind == MessageKind.opener
    assert first.state == MessageState.drafting
    assert first.to_address == prospect.email
    assert before <= first.scheduled_for <= datetime.now(timezone.utc)
    # Enrolling a manual prospect hands it off implicitly.
    assert prospect.pipeline_mode == "automated"

    types = {e.type for e in db.query(ProspectEvent).filter_by(prospect_id=prospect.id)}
    assert ProspectEventType.enrolled in types
    assert ProspectEventType.message_scheduled in types
    assert ProspectEventType.handed_off in types


def test_send_at_mode_uses_the_given_instant(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    when = datetime.now(timezone.utc) + timedelta(days=2)

    enrollment = enroll(db, prospect, sequence, mode="send_at", send_at=when)

    assert enrollment.messages[0].scheduled_for == when


def test_double_enroll_is_rejected(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    enroll(db, prospect, sequence, mode="send_now")

    with pytest.raises(SequencerError, match="Already enrolled"):
        enroll(db, prospect, sequence, mode="send_now")

    # The refusal must leave the session usable (bulk enroll continues).
    other = make_prospect(db, email="second@example.com")
    assert enroll(db, other, sequence, mode="send_now").state == EnrollmentState.active


def test_suppressed_email_cannot_enroll(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    db.add(Suppression(email=prospect.email, reason=SuppressionReason.unsubscribed))
    db.flush()

    with pytest.raises(SequencerError, match="suppressed"):
        enroll(db, prospect, sequence, mode="send_now")


def test_empty_sequence_cannot_be_enrolled_into(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db, steps=0)

    with pytest.raises(SequencerError, match="no active steps"):
        enroll(db, prospect, sequence, mode="send_now")


def test_advance_schedules_the_next_step_after_the_wait(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db, steps=2)
    enrollment = enroll(db, prospect, sequence, mode="send_now")

    first = enrollment.messages[0]
    sent_at = datetime.now(timezone.utc)
    mark_sent(db, first, sent_at)

    follow_up = advance(db, enrollment)

    assert follow_up is not None
    assert follow_up.kind == MessageKind.follow_up
    assert follow_up.state == MessageState.drafting
    assert enrollment.current_position == 1
    # wait_days=3: the follow-up lands about three days out, never earlier
    # than the send it follows.
    assert follow_up.scheduled_for >= sent_at + timedelta(days=2)
    assert follow_up.scheduled_for <= sent_at + timedelta(days=4, hours=1)


def test_advance_completes_after_the_last_step(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db, steps=1)
    enrollment = enroll(db, prospect, sequence, mode="send_now")
    mark_sent(db, enrollment.messages[0])

    result = advance(db, enrollment)

    assert result is None
    assert enrollment.state == EnrollmentState.completed
    assert enrollment.end_reason == "All steps sent"
    assert enrollment.ended_at is not None


def test_stop_cancels_everything_pending(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    enrollment = enroll(db, prospect, sequence, mode="send_now")
    assert pending_messages(enrollment)

    stop(db, enrollment, "Changed my mind")

    assert enrollment.state == EnrollmentState.stopped
    assert not pending_messages(enrollment)
    assert enrollment.end_reason == "Changed my mind"


def test_reply_ends_the_sequence_and_flips_the_prospect(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    enrollment = enroll(db, prospect, sequence, mode="send_now")
    mark_sent(db, enrollment.messages[0])
    advance(db, enrollment)  # queue step 2 so there is something to cancel

    inbound = Message(
        prospect_id=prospect.id,
        enrollment_id=enrollment.id,
        direction=MessageDirection.inbound,
        kind=MessageKind.incoming,
        state=MessageState.received,
        body="Sounds interesting, tell me more.",
    )
    db.add(inbound)
    db.flush()

    on_reply(db, enrollment, inbound)

    assert enrollment.state == EnrollmentState.replied
    assert not pending_messages(enrollment)
    assert prospect.status == ProspectStatus.replied


def test_bounce_suppresses_and_ends_the_enrollment(db):
    open_window_settings(db)
    prospect = make_prospect(db)
    sequence = make_sequence(db)
    enrollment = enroll(db, prospect, sequence, mode="send_now")

    on_bounce(db, enrollment, detail="550 no such user")

    assert enrollment.state == EnrollmentState.bounced
    assert prospect.status == ProspectStatus.bounced
    assert not pending_messages(enrollment)
    suppression = db.query(Suppression).filter_by(email=prospect.email).one()
    assert suppression.reason == SuppressionReason.hard_bounce


def test_unsubscribe_cancels_across_all_enrollments(db):
    """An unsubscribe is per-person, not per-sequence: every queued message to
    that address must die, whichever sequence queued it."""
    open_window_settings(db)
    prospect = make_prospect(db)
    seq_a = make_sequence(db, name="Sequence A")
    seq_b = make_sequence(db, name="Sequence B")
    enr_a = enroll(db, prospect, seq_a, mode="send_now")
    enr_b = enroll(db, prospect, seq_b, mode="send_now")

    on_unsubscribe(db, prospect)

    assert enr_a.state == EnrollmentState.stopped
    assert enr_b.state == EnrollmentState.stopped
    assert not pending_messages(enr_a)
    assert not pending_messages(enr_b)
    suppression = db.query(Suppression).filter_by(email=prospect.email).one()
    assert suppression.reason == SuppressionReason.unsubscribed
