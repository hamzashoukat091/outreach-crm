"""Archive keeps a prospect's real outcome; a status would overwrite it."""

from app.api.prospects import _set_archived
from app.models import Prospect, ProspectEvent, ProspectEventType, ProspectStatus


def make_prospect(db, email="a@example.com", status=ProspectStatus.new):
    p = Prospect(email=email, first_name="A", last_name="B", status=status)
    db.add(p)
    db.flush()
    return p


def test_archiving_hides_without_touching_status(db):
    p = make_prospect(db, status=ProspectStatus.replied)

    _set_archived(db, p, True, "not a fit")
    db.flush()

    assert p.is_archived is True
    assert p.archive_reason == "not a fit"
    assert p.archived_at is not None
    # The whole point: a prospect who replied is still 'replied'.
    assert p.status == ProspectStatus.replied


def test_restoring_clears_archive_metadata_and_keeps_outcome(db):
    p = make_prospect(db, status=ProspectStatus.won)
    _set_archived(db, p, True, "parked")
    db.flush()

    _set_archived(db, p, False)
    db.flush()

    assert p.is_archived is False
    assert p.archived_at is None
    assert p.archive_reason is None
    assert p.status == ProspectStatus.won


def test_archive_and_restore_are_logged(db):
    p = make_prospect(db)
    _set_archived(db, p, True, "too small")
    _set_archived(db, p, False)
    db.flush()

    types = [
        e.type
        for e in db.query(ProspectEvent).filter(ProspectEvent.prospect_id == p.id).all()
    ]
    assert ProspectEventType.archived in types
    assert ProspectEventType.unarchived in types


def test_archiving_twice_is_a_no_op(db):
    """Bulk actions can include already-archived rows; don't double-log."""
    p = make_prospect(db)
    _set_archived(db, p, True, "first")
    db.flush()
    first_time = p.archived_at

    _set_archived(db, p, True, "second")
    db.flush()

    assert p.archive_reason == "first"
    assert p.archived_at == first_time
    events = (
        db.query(ProspectEvent)
        .filter(
            ProspectEvent.prospect_id == p.id,
            ProspectEvent.type == ProspectEventType.archived,
        )
        .count()
    )
    assert events == 1


def test_new_prospects_are_not_archived(db):
    p = make_prospect(db)
    db.flush()
    assert p.is_archived is False
