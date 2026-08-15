"""Ingestion: matching mail to conversations, deduping, and bounce handling."""

from datetime import datetime, timezone

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
from app.services.inbox import InboundEmail, ingest


def make_thread(db, email="ben@example.com", rfc_id="<sent-1@ours.dev>"):
    """A prospect with an active enrollment and one sent opener."""
    prospect = Prospect(email=email, first_name="Ben")
    sequence = Sequence(name="Seq", steps=[SequenceStep(position=1)])
    db.add_all([prospect, sequence])
    db.flush()

    enrollment = SequenceEnrollment(
        prospect_id=prospect.id, sequence_id=sequence.id, state=EnrollmentState.active
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
        body="Hello.",
        to_address=email,
        rfc_message_id=rfc_id,
        sent_at=datetime.now(timezone.utc),
    )
    db.add(sent)
    db.flush()
    return prospect, enrollment, sent


def make_inbound(**overrides):
    base = dict(
        message_id="<reply-1@their.example.com>",
        in_reply_to=None,
        references=None,
        from_address="ben@example.com",
        to_address="me@ours.dev",
        subject="Re: quick note",
        text_body="Interesting, tell me more.",
        date=datetime.now(timezone.utc),
    )
    base.update(overrides)
    return InboundEmail(**base)


def test_ingest_matches_by_in_reply_to(db):
    prospect, enrollment, sent = make_thread(db)

    stored = ingest(db, make_inbound(in_reply_to=sent.rfc_message_id))

    assert stored is not None
    assert stored.direction == MessageDirection.inbound
    assert stored.kind == MessageKind.incoming
    assert stored.state == MessageState.received
    assert stored.enrollment_id == enrollment.id
    assert stored.prospect_id == prospect.id


def test_ingest_matches_by_references_header(db):
    """Some clients only carry References; that must be enough."""
    _prospect, enrollment, sent = make_thread(db)

    stored = ingest(
        db,
        make_inbound(
            references=f"<unrelated@x> {sent.rfc_message_id}",
            from_address="forwarded-from-elsewhere@example.com",
        ),
    )

    assert stored is not None
    assert stored.enrollment_id == enrollment.id


def test_ingest_falls_back_to_email_match(db):
    """Clients that strip threading headers still get matched by address to
    the newest open enrollment."""
    _prospect, enrollment, _sent = make_thread(db)

    stored = ingest(db, make_inbound(in_reply_to=None, references=None))

    assert stored is not None
    assert stored.enrollment_id == enrollment.id


def test_ingest_dedupes_by_message_id(db):
    _prospect, _enrollment, sent = make_thread(db)
    inbound = make_inbound(in_reply_to=sent.rfc_message_id)

    first = ingest(db, inbound)
    second = ingest(db, inbound)

    assert first is not None
    assert second is None
    count = (
        db.query(Message)
        .filter(Message.direction == MessageDirection.inbound)
        .count()
    )
    assert count == 1


def test_our_own_sent_mail_echoed_back_is_ignored(db):
    """Mailpit catches what we SEND; the poller must not mistake our own
    delivery for a prospect writing back."""
    _prospect, _enrollment, sent = make_thread(db)

    stored = ingest(
        db,
        make_inbound(
            message_id=sent.rfc_message_id,  # the copy of our own email
            from_address="me@ours.dev",
            subject=sent.subject,
        ),
    )

    assert stored is None
    assert (
        db.query(Message).filter(Message.direction == MessageDirection.inbound).count()
        == 0
    )


def test_unmatched_stranger_mail_is_ignored(db):
    make_thread(db)

    stored = ingest(
        db,
        make_inbound(
            message_id="<spam@nowhere>", from_address="stranger@nowhere.example"
        ),
    )

    assert stored is None
    assert (
        db.query(Message).filter(Message.direction == MessageDirection.inbound).count()
        == 0
    )


def test_bounce_by_sender_is_detected_and_suppresses(db):
    prospect, enrollment, sent = make_thread(db)

    stored = ingest(
        db,
        make_inbound(
            message_id="<bounce-1@mta>",
            from_address="mailer-daemon@mta.example.com",
            subject="Undelivered Mail Returned to Sender",
            in_reply_to=sent.rfc_message_id,
        ),
    )

    # Fully handled inside ingest: nothing left for the replier.
    assert stored is None
    assert enrollment.state == EnrollmentState.bounced
    suppression = db.query(Suppression).filter_by(email=prospect.email).one()
    assert suppression.reason == SuppressionReason.hard_bounce
    # The bounce itself is still on the record.
    assert (
        db.query(Message).filter(Message.direction == MessageDirection.inbound).count()
        == 1
    )


def test_bounce_by_subject_is_detected(db):
    _prospect, enrollment, sent = make_thread(db)

    ingest(
        db,
        make_inbound(
            message_id="<bounce-2@mta>",
            from_address="postmaster@mta.example.com",
            subject="Delivery Status Notification (Failure)",
            in_reply_to=sent.rfc_message_id,
        ),
    )

    assert enrollment.state == EnrollmentState.bounced


def test_unmatched_bounce_is_ignored(db):
    make_thread(db)

    stored = ingest(
        db,
        make_inbound(
            message_id="<bounce-3@mta>",
            from_address="mailer-daemon@somewhere.else",
            subject="Undelivered Mail Returned to Sender",
        ),
    )

    assert stored is None
    assert db.query(Suppression).count() == 0
