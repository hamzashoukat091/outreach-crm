"""Reply handling: stop rules, escalation gates, and the facts fence.

No real API calls -- classify_reply and call_claude are monkeypatched in the
replier's namespace, mirroring test_generator's approach of testing the logic
around the model rather than the model."""

from datetime import datetime, time, timezone

import pytest

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
    Strategy,
    Suppression,
)
from app.services.automation_settings import get_settings_row
from app.services.replier import handle_inbound


def classification(situation, confidence=95, summary="They replied."):
    return {
        "situation": situation,
        "confidence": confidence,
        "reason": "test",
        "summary": summary,
    }


def patch_classifier(monkeypatch, situation, confidence=95):
    monkeypatch.setattr(
        "app.services.replier.classify_reply",
        lambda inbound, thread, prospect: classification(situation, confidence),
    )


def patch_drafter(monkeypatch, text="SUBJECT: re\nBODY:\nHappy to walk you through it."):
    monkeypatch.setattr(
        "app.services.replier.call_claude",
        lambda system, user, max_tokens=1200: {
            "text": text,
            "input_tokens": 10,
            "output_tokens": 20,
            "stop_reason": "end_turn",
            "model": "test-model",
        },
    )


def make_thread(db, email="cara@example.com"):
    prospect = Prospect(email=email, first_name="Cara")
    sequence = Sequence(name="Seq", steps=[SequenceStep(position=1), SequenceStep(position=2)])
    db.add_all([prospect, sequence])
    db.flush()

    enrollment = SequenceEnrollment(
        prospect_id=prospect.id,
        sequence_id=sequence.id,
        state=EnrollmentState.active,
        thread_subject="quick note",
    )
    db.add(enrollment)
    db.flush()

    sent = Message(
        prospect_id=prospect.id,
        enrollment=enrollment,
        direction=MessageDirection.outbound,
        kind=MessageKind.opener,
        state=MessageState.sent,
        subject="quick note",
        body="Hello there.",
        to_address=email,
        rfc_message_id="<sent-1@ours.dev>",
        sent_at=datetime.now(timezone.utc),
    )
    # A queued follow-up, to observe what the stop rules do to it.
    queued = Message(
        prospect_id=prospect.id,
        enrollment=enrollment,
        direction=MessageDirection.outbound,
        kind=MessageKind.follow_up,
        state=MessageState.scheduled,
        subject="Re: quick note",
        body="Following up.",
        to_address=email,
        scheduled_for=datetime.now(timezone.utc),
    )
    inbound = Message(
        prospect_id=prospect.id,
        enrollment=enrollment,
        direction=MessageDirection.inbound,
        kind=MessageKind.incoming,
        state=MessageState.received,
        subject="Re: quick note",
        body="Tell me more.",
        from_address=email,
        received_at=datetime.now(timezone.utc),
    )
    db.add_all([sent, queued, inbound])
    db.flush()
    return prospect, enrollment, queued, inbound


def make_reply_strategy(db, situation, name=None):
    strategy = Strategy(
        name=name or f"Reply: {situation}",
        kind="reply",
        reply_situation=situation,
        priority=100,
        system_prompt="You reply.",
        instructions="Answer them.",
        max_words=90,
    )
    db.add(strategy)
    db.flush()
    return strategy


def add_prior_sent_reply(db, prospect):
    """History that satisfies the always-review-first-reply gate."""
    db.add(
        Message(
            prospect_id=prospect.id,
            direction=MessageDirection.outbound,
            kind=MessageKind.reply,
            state=MessageState.sent,
            subject="Re: earlier",
            body="Earlier answer.",
            sent_at=datetime.now(timezone.utc),
        )
    )
    db.flush()


def test_unsubscribe_suppresses_and_stops(db, monkeypatch):
    patch_classifier(monkeypatch, "unsubscribe")
    prospect, enrollment, queued, inbound = make_thread(db)
    settings = get_settings_row(db)

    result = handle_inbound(db, inbound, settings)

    assert result is None  # never answer an unsubscribe
    assert enrollment.state == EnrollmentState.stopped
    assert queued.state == MessageState.cancelled
    assert db.query(Suppression).filter_by(email=prospect.email).count() == 1


def test_auto_reply_does_not_cancel_the_sequence(db, monkeypatch):
    """An out-of-office is not a person answering: the follow-ups keep their
    schedule and nothing is written back to the robot."""
    patch_classifier(monkeypatch, "auto_reply")
    _prospect, enrollment, queued, inbound = make_thread(db)
    settings = get_settings_row(db)

    result = handle_inbound(db, inbound, settings)

    assert result is None
    assert enrollment.state == EnrollmentState.active
    assert queued.state == MessageState.scheduled
    assert inbound.situation is not None  # classification is still recorded


def test_question_always_escalates(db, monkeypatch):
    """ALWAYS_ESCALATE beats any confidence and any history."""
    patch_classifier(monkeypatch, "question", confidence=99)
    patch_drafter(monkeypatch)
    prospect, _enrollment, _queued, inbound = make_thread(db)
    make_reply_strategy(db, "question")
    add_prior_sent_reply(db, prospect)
    settings = get_settings_row(db)
    settings.always_review_first_reply = False

    result = handle_inbound(db, inbound, settings)

    assert result is not None
    assert result.state == MessageState.needs_approval
    assert "always requires review" in result.escalation_reason


def test_low_confidence_escalates(db, monkeypatch):
    patch_classifier(monkeypatch, "interested", confidence=40)
    patch_drafter(monkeypatch)
    prospect, _enrollment, _queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    add_prior_sent_reply(db, prospect)
    settings = get_settings_row(db)
    settings.always_review_first_reply = False

    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.needs_approval
    assert "below threshold" in result.escalation_reason


def test_first_reply_is_always_reviewed(db, monkeypatch):
    patch_classifier(monkeypatch, "interested", confidence=95)
    patch_drafter(monkeypatch)
    _prospect, _enrollment, _queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    settings = get_settings_row(db)
    assert settings.always_review_first_reply is True  # shipped default

    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.needs_approval
    assert "First reply" in result.escalation_reason


def test_confident_interested_with_history_auto_schedules(db, monkeypatch):
    patch_classifier(monkeypatch, "interested", confidence=95)
    patch_drafter(monkeypatch)
    prospect, enrollment, queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    add_prior_sent_reply(db, prospect)
    settings = get_settings_row(db)

    before = datetime.now(timezone.utc)
    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.scheduled
    assert before <= result.scheduled_for <= datetime.now(timezone.utc)
    assert result.kind == MessageKind.reply
    assert result.subject == "Re: quick note"
    assert "Happy to walk you through it." in result.body
    # A real reply also ends the sequence.
    assert enrollment.state == EnrollmentState.replied
    assert queued.state == MessageState.cancelled


def test_reply_scheduling_ignores_the_send_window(db, monkeypatch):
    """Sequences wait for office hours; answering a human does not."""
    patch_classifier(monkeypatch, "interested", confidence=95)
    patch_drafter(monkeypatch)
    prospect, _enrollment, _queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    add_prior_sent_reply(db, prospect)
    settings = get_settings_row(db)
    # A window that is almost never open.
    settings.send_window_start = time(3, 0)
    settings.send_window_end = time(3, 1)

    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.scheduled
    assert result.scheduled_for <= datetime.now(timezone.utc)


def test_model_escalate_output_holds_for_approval(db, monkeypatch):
    """The model refusing for lack of facts is a feature, not an error."""
    patch_classifier(monkeypatch, "interested", confidence=95)
    patch_drafter(monkeypatch, text="ESCALATE: they asked for rates and none are listed")
    prospect, _enrollment, _queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    add_prior_sent_reply(db, prospect)
    settings = get_settings_row(db)
    settings.always_review_first_reply = False

    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.needs_approval
    assert "Model escalated" in result.escalation_reason
    assert "rates" in result.escalation_reason


def test_missing_reply_strategy_escalates(db, monkeypatch):
    patch_classifier(monkeypatch, "interested", confidence=95)
    _prospect, _enrollment, _queued, inbound = make_thread(db)
    settings = get_settings_row(db)  # no strategies seeded in this test

    result = handle_inbound(db, inbound, settings)

    assert result.state == MessageState.needs_approval
    assert "No active reply strategy" in result.escalation_reason


def test_auto_reply_disabled_still_applies_stop_rules(db, monkeypatch):
    patch_classifier(monkeypatch, "interested", confidence=95)
    _prospect, enrollment, queued, inbound = make_thread(db)
    make_reply_strategy(db, "interested")
    settings = get_settings_row(db)
    settings.auto_reply_enabled = False

    result = handle_inbound(db, inbound, settings)

    assert result is None  # no draft when auto-reply is off
    assert enrollment.state == EnrollmentState.replied
    assert queued.state == MessageState.cancelled


# ---------- redraft_reply (the fill-facts-then-regenerate loop) ----------


def test_redraft_updates_held_reply_in_place(db, monkeypatch):
    """Escalated-for-missing-facts, facts filled, redraft -> grounded body,
    still held. The hold is never bypassed by regenerating."""
    from app.models import SenderFacts
    from app.services.replier import redraft_reply

    patch_classifier(monkeypatch, "question", confidence=95)
    patch_drafter(monkeypatch, text="ESCALATE: they asked for rates and none are listed")
    make_reply_strategy(db, "question")
    prospect, enrollment, _queued, inbound = make_thread(db)
    settings_row = get_settings_row(db)

    held = handle_inbound(db, inbound, settings_row)
    assert held.state == MessageState.needs_approval
    assert held.body is None
    assert "ESCALATE" in (held.escalation_reason or "").upper() or held.escalated

    # The user fills in facts; the model can now answer.
    db.add(SenderFacts(rates="$40/hr"))
    patch_drafter(monkeypatch, text="SUBJECT: re\nBODY:\nMy rate is $40/hr.")

    redrafted = redraft_reply(db, held)

    assert redrafted.id == held.id  # in place, not a new row
    assert redrafted.state == MessageState.needs_approval  # hold survives
    assert "$40/hr" in redrafted.body
    assert redrafted.user_prompt  # provenance refreshed


def test_redraft_can_escalate_again(db, monkeypatch):
    from app.services.replier import redraft_reply

    patch_classifier(monkeypatch, "question", confidence=95)
    patch_drafter(monkeypatch, text="ESCALATE: no availability listed")
    make_reply_strategy(db, "question")
    prospect, enrollment, _queued, inbound = make_thread(db)

    held = handle_inbound(db, inbound, get_settings_row(db))
    redrafted = redraft_reply(db, held)

    assert redrafted.state == MessageState.needs_approval
    assert redrafted.body is None
    assert "availability" in redrafted.escalation_reason
