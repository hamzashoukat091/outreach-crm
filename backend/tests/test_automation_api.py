"""API surface: sequences, steps, enrollment results, and the approval queue.

Router functions are called directly with the test session, the same way
test_handoff exercises the prospects router."""

import uuid
from datetime import datetime, timezone

import pytest
from fastapi import HTTPException

from app.api.automation_messages import approve_message, reject_message
from app.api.automation_sequences import (
    add_step,
    create_sequence,
    enroll_prospects,
    get_sequence,
    pause_enrollment,
    reorder_steps,
    resume_enrollment,
    stop_enrollment,
)
from app.models import (
    EnrollmentState,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    Prospect,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
    Suppression,
    SuppressionReason,
)
from app.schemas.automation import (
    EnrollRequest,
    MessageApproveRequest,
    SequenceCreate,
    StepCreate,
    StepReorderRequest,
)
from app.services.automation_settings import get_settings_row


def make_prospect(db, email="eve@example.com"):
    p = Prospect(email=email, first_name="Eve")
    db.add(p)
    db.flush()
    return p


def make_sequence_with_steps(db, n=2):
    out = create_sequence(SequenceCreate(name="API seq"), db)
    sequence = db.get(Sequence, out.id)
    for _ in range(n):
        add_step(sequence.id, StepCreate(wait_days=2), db)
    db.refresh(sequence)
    return sequence


def test_create_sequence_and_append_steps(db):
    sequence = make_sequence_with_steps(db, n=3)

    positions = sorted(s.position for s in sequence.steps)
    assert positions == [1, 2, 3]


def test_reorder_steps(db):
    sequence = make_sequence_with_steps(db, n=3)
    ordered = sorted(sequence.steps, key=lambda s: s.position)
    new_order = [ordered[2].id, ordered[0].id, ordered[1].id]

    result = reorder_steps(sequence.id, StepReorderRequest(ids=new_order), db)

    assert [s.id for s in result] == new_order
    assert [s.position for s in result] == [1, 2, 3]


def test_reorder_rejects_wrong_id_set(db):
    sequence = make_sequence_with_steps(db, n=2)

    with pytest.raises(HTTPException) as excinfo:
        reorder_steps(
            sequence.id, StepReorderRequest(ids=[uuid.uuid4(), uuid.uuid4()]), db
        )
    assert excinfo.value.status_code == 400


def test_enroll_reports_per_prospect_outcomes(db):
    """One suppressed, one unknown, one fine -- the batch never aborts."""
    get_settings_row(db)
    sequence = make_sequence_with_steps(db)
    good = make_prospect(db, "good@example.com")
    suppressed = make_prospect(db, "gone@example.com")
    db.add(Suppression(email=suppressed.email, reason=SuppressionReason.unsubscribed))
    db.flush()

    result = enroll_prospects(
        sequence.id,
        EnrollRequest(
            prospect_ids=[good.id, suppressed.id, uuid.uuid4()], mode="send_now"
        ),
        db,
    )

    assert result.enrolled == 1
    assert result.skipped == 2
    by_status = {r.prospect_id: r for r in result.results}
    assert by_status[good.id].status == "enrolled"
    assert "suppressed" in by_status[suppressed.id].reason


def test_pause_resume_stop_lifecycle(db):
    get_settings_row(db)
    sequence = make_sequence_with_steps(db)
    prospect = make_prospect(db)
    enroll_prospects(
        sequence.id, EnrollRequest(prospect_ids=[prospect.id], mode="send_now"), db
    )
    enrollment = db.query(SequenceEnrollment).one()

    assert pause_enrollment(enrollment.id, db).state == EnrollmentState.paused
    assert resume_enrollment(enrollment.id, db).state == EnrollmentState.active
    assert stop_enrollment(enrollment.id, db=db).state == EnrollmentState.stopped

    with pytest.raises(HTTPException):
        resume_enrollment(enrollment.id, db)  # ended is final


def make_held_reply(db, prospect, body="Drafted answer."):
    message = Message(
        prospect_id=prospect.id,
        direction=MessageDirection.outbound,
        kind=MessageKind.reply,
        state=MessageState.needs_approval,
        subject="Re: hello",
        body=body,
        to_address=prospect.email,
        escalated=True,
        escalation_reason="test hold",
    )
    db.add(message)
    db.flush()
    return message


def test_approve_releases_and_flags_edits(db):
    prospect = make_prospect(db)
    message = make_held_reply(db, prospect)

    out = approve_message(
        message.id, MessageApproveRequest(body="Edited answer."), db
    )

    assert out.state == MessageState.scheduled
    assert out.edited is True
    assert out.approved_at is not None
    assert message.scheduled_for <= datetime.now(timezone.utc)


def test_approve_without_body_is_refused(db):
    """A strategy-less escalation has no draft; approving nothing would send
    nothing."""
    prospect = make_prospect(db)
    message = make_held_reply(db, prospect, body=None)

    with pytest.raises(HTTPException) as excinfo:
        approve_message(message.id, None, db)
    assert excinfo.value.status_code == 400


def test_reject_cancels(db):
    prospect = make_prospect(db)
    message = make_held_reply(db, prospect)

    out = reject_message(message.id, db)

    assert out.state == MessageState.cancelled


def test_sequence_counts_separate_open_from_finished(db):
    """'Enrolled' must mean right now, or the card contradicts itself."""
    sequence = Sequence(name="Counted", steps=[SequenceStep(position=1)])
    db.add(sequence)
    db.flush()

    states = [
        EnrollmentState.active,
        EnrollmentState.paused,
        EnrollmentState.stopped,
        EnrollmentState.completed,
        EnrollmentState.replied,
    ]
    for i, state in enumerate(states):
        prospect = Prospect(email=f"count{i}@example.com")
        db.add(prospect)
        db.flush()
        db.add(
            SequenceEnrollment(
                prospect_id=prospect.id, sequence_id=sequence.id, state=state
            )
        )
    db.flush()

    out = get_sequence(sequence.id, db=db)

    assert out.active_enrollments == 1
    assert out.paused_enrollments == 1
    assert out.open_enrollments == 2
    assert out.finished_enrollments == 3  # stopped + completed + replied
    assert out.total_enrollments == 5


def test_sequence_with_only_stopped_runs_reads_as_empty(db):
    """The exact case that looked broken: nothing open, history intact."""
    sequence = Sequence(name="All stopped", steps=[SequenceStep(position=1)])
    db.add(sequence)
    db.flush()
    for i in range(2):
        prospect = Prospect(email=f"stopped{i}@example.com")
        db.add(prospect)
        db.flush()
        db.add(
            SequenceEnrollment(
                prospect_id=prospect.id,
                sequence_id=sequence.id,
                state=EnrollmentState.stopped,
            )
        )
    db.flush()

    out = get_sequence(sequence.id, db=db)

    assert out.open_enrollments == 0
    assert out.finished_enrollments == 2
    assert out.total_enrollments == 2
