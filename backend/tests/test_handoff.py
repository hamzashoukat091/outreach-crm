"""Pipeline handoff: who owns the prospect, and when the door back is locked."""

import pytest
from fastapi import HTTPException

from app.api.prospects import bulk_handoff, handoff_prospect, return_prospect_to_manual
from app.models import (
    EnrollmentState,
    Prospect,
    ProspectEvent,
    ProspectEventType,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
)
from app.schemas.automation import BulkHandoffRequest


def make_prospect(db, email="dan@example.com"):
    p = Prospect(email=email, first_name="Dan")
    db.add(p)
    db.flush()
    return p


def make_enrollment(db, prospect, state=EnrollmentState.active):
    sequence = Sequence(name="Seq", steps=[SequenceStep(position=1)])
    db.add(sequence)
    db.flush()
    enrollment = SequenceEnrollment(
        prospect_id=prospect.id, sequence_id=sequence.id, state=state
    )
    db.add(enrollment)
    db.flush()
    return enrollment


def event_types(db, prospect):
    return [
        e.type
        for e in db.query(ProspectEvent).filter(ProspectEvent.prospect_id == prospect.id)
    ]


def test_prospects_start_manual(db):
    assert make_prospect(db).pipeline_mode == "manual"


def test_handoff_flips_mode_and_logs(db):
    prospect = make_prospect(db)

    out = handoff_prospect(prospect.id, db)

    assert out.pipeline_mode == "automated"
    assert prospect.pipeline_mode == "automated"
    assert ProspectEventType.handed_off in event_types(db, prospect)


def test_handoff_twice_logs_once(db):
    prospect = make_prospect(db)
    handoff_prospect(prospect.id, db)
    handoff_prospect(prospect.id, db)

    events = [t for t in event_types(db, prospect) if t == ProspectEventType.handed_off]
    assert len(events) == 1


def test_return_to_manual_flips_back_and_logs(db):
    prospect = make_prospect(db)
    handoff_prospect(prospect.id, db)

    out = return_prospect_to_manual(prospect.id, db)

    assert out.pipeline_mode == "manual"
    assert ProspectEventType.returned_to_manual in event_types(db, prospect)


def test_return_is_blocked_while_an_enrollment_is_open(db):
    """Returning mid-sequence would leave automation firing at a prospect the
    user believes they now handle by hand."""
    prospect = make_prospect(db)
    handoff_prospect(prospect.id, db)
    make_enrollment(db, prospect)

    with pytest.raises(HTTPException) as excinfo:
        return_prospect_to_manual(prospect.id, db)

    assert excinfo.value.status_code == 409
    assert "open enrollment" in excinfo.value.detail
    assert prospect.pipeline_mode == "automated"


def test_paused_enrollment_also_blocks_return(db):
    prospect = make_prospect(db)
    handoff_prospect(prospect.id, db)
    make_enrollment(db, prospect, state=EnrollmentState.paused)

    with pytest.raises(HTTPException):
        return_prospect_to_manual(prospect.id, db)


def test_return_allowed_after_enrollment_ends(db):
    prospect = make_prospect(db)
    handoff_prospect(prospect.id, db)
    enrollment = make_enrollment(db, prospect)
    enrollment.state = EnrollmentState.completed
    db.flush()

    out = return_prospect_to_manual(prospect.id, db)

    assert out.pipeline_mode == "manual"


def test_bulk_handoff_counts_only_changes(db):
    a = make_prospect(db, "a@example.com")
    b = make_prospect(db, "b@example.com")
    handoff_prospect(a.id, db)  # already automated

    result = bulk_handoff(BulkHandoffRequest(ids=[a.id, b.id]), db)

    assert result == {"updated": 1, "total": 2}
    assert b.pipeline_mode == "automated"
