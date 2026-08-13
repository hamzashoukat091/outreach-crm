from datetime import datetime, timedelta, timezone

import pytest

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
from app.services.engine import enroll_lead, halt_lead_enrollments, process_due_sends


@pytest.fixture
def sequence(db):
    seq = Sequence(name="Test 3-touch")
    for order, delay in ((1, 0), (2, 3), (3, 7)):
        seq.steps.append(
            SequenceStep(
                step_order=order,
                delay_days=delay,
                subject=f"Step {order} for {{{{company}}}}",
                body=f"Hi {{{{first_name}}}}, this is step {order}.",
            )
        )
    db.add(seq)
    db.flush()
    return seq


def make_lead(db, email="dana@northwind.com", status=LeadStatus.new):
    lead = Lead(
        email=email,
        first_name="Dana",
        last_name="Whitfield",
        company="Northwind",
        status=status,
    )
    db.add(lead)
    db.flush()
    return lead


def test_enroll_materializes_a_send_per_step(db, sequence):
    lead = make_lead(db)
    enrollment, reason = enroll_lead(db, lead, sequence)
    db.flush()

    assert reason is None
    assert enrollment is not None
    sends = db.query(ScheduledSend).filter_by(enrollment_id=enrollment.id).all()
    assert len(sends) == 3

    # Offsets come from each step's delay_days.
    by_step = {s.step.step_order: s for s in sends}
    gap = by_step[2].scheduled_for - by_step[1].scheduled_for
    assert gap.days == 3


def test_enroll_is_idempotent_per_sequence(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    _enrollment, reason = enroll_lead(db, lead, sequence)
    assert reason == "already enrolled in this sequence"


def test_enroll_refuses_terminal_status(db, sequence):
    lead = make_lead(db, status=LeadStatus.unsubscribed)
    enrollment, reason = enroll_lead(db, lead, sequence)

    assert enrollment is None
    assert "unsubscribed" in reason


def test_only_due_sends_go_out(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    tally = process_due_sends(db)

    # Step 1 has delay 0; steps 2 and 3 are still in the future.
    assert tally["sent"] == 1
    remaining = (
        db.query(ScheduledSend).filter_by(status=SendStatus.scheduled).count()
    )
    assert remaining == 2


def test_first_send_moves_lead_to_contacted(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    process_due_sends(db)
    db.refresh(lead)

    assert lead.status == LeadStatus.contacted


def test_merge_fields_are_rendered_at_send_time(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    process_due_sends(db)

    sent = db.query(ScheduledSend).filter_by(status=SendStatus.sent).one()
    assert sent.rendered_subject == "Step 1 for Northwind"
    assert "Hi Dana" in sent.rendered_body


def test_reply_cancels_queued_sends(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    lead.status = LeadStatus.replied
    halt_lead_enrollments(db, lead, "lead replied")
    db.flush()

    enrollment = db.query(Enrollment).one()
    assert enrollment.status == EnrollmentStatus.stopped
    assert (
        db.query(ScheduledSend).filter_by(status=SendStatus.canceled).count() == 3
    )


def test_due_send_is_skipped_if_lead_replied_after_scheduling(db, sequence):
    lead = make_lead(db)
    enroll_lead(db, lead, sequence)
    db.flush()

    # The row is already due, but the lead answered in the meantime.
    lead.status = LeadStatus.replied
    db.flush()

    tally = process_due_sends(db)

    assert tally["sent"] == 0
    assert tally["skipped"] == 1
    assert db.query(Enrollment).one().status == EnrollmentStatus.stopped


def test_enrollment_completes_after_last_step(db):
    single = Sequence(name="One-touch")
    single.steps.append(
        SequenceStep(step_order=1, delay_days=0, subject="Hello", body="Hi {{first_name}}")
    )
    db.add(single)
    db.flush()

    lead = make_lead(db)
    enroll_lead(db, lead, single)
    db.flush()

    process_due_sends(db)

    enrollment = db.query(Enrollment).one()
    assert enrollment.status == EnrollmentStatus.completed
    assert enrollment.completed_at is not None


def test_daily_cap_stops_sending(db, sequence, monkeypatch):
    from app.services import engine as engine_module

    monkeypatch.setattr(engine_module.settings, "daily_send_cap", 2)

    for i in range(5):
        lead = make_lead(db, email=f"lead{i}@example.com")
        enroll_lead(db, lead, sequence)
    db.flush()

    tally = process_due_sends(db)
    assert tally["sent"] == 2

    # Budget is now exhausted for the day.
    second = process_due_sends(db)
    assert second["sent"] == 0
    assert second["cap_reached"] == 1


def test_paused_enrollment_does_not_send(db, sequence):
    lead = make_lead(db)
    enrollment, _ = enroll_lead(db, lead, sequence)
    db.flush()

    enrollment.status = EnrollmentStatus.paused
    db.flush()

    tally = process_due_sends(db)
    assert tally["sent"] == 0
