"""Discarding a draft must not leave the prospect claiming one exists."""

from sqlalchemy import select

from app.api.drafts import delete_draft, discard_draft
from app.models import DraftStatus, EmailDraft, Prospect, ProspectStatus


def make_drafted(db, email="ann@example.com", n=1):
    """A prospect at 'drafted' with n live drafts, as generate() leaves them."""
    prospect = Prospect(email=email, status=ProspectStatus.drafted)
    db.add(prospect)
    db.flush()
    drafts = []
    for i in range(n):
        draft = EmailDraft(
            prospect_id=prospect.id,
            subject=f"s{i}",
            body="b",
            status=DraftStatus.draft,
        )
        db.add(draft)
        drafts.append(draft)
    db.flush()
    return prospect, drafts


def test_discarding_the_only_draft_returns_the_prospect_to_new(db):
    prospect, drafts = make_drafted(db)

    discard_draft(drafts[0].id, db)

    assert prospect.status == ProspectStatus.new


def test_a_remaining_draft_keeps_the_prospect_drafted(db):
    prospect, drafts = make_drafted(db, n=2)

    discard_draft(drafts[0].id, db)

    assert prospect.status == ProspectStatus.drafted


def test_an_approved_prospect_never_regresses(db):
    """Discarding a leftover draft must not un-send a sent email."""
    prospect, drafts = make_drafted(db, n=2)
    prospect.status = ProspectStatus.approved
    db.flush()

    discard_draft(drafts[0].id, db)

    assert prospect.status == ProspectStatus.approved


def test_a_replied_prospect_never_regresses(db):
    prospect, drafts = make_drafted(db)
    prospect.status = ProspectStatus.replied
    db.flush()

    discard_draft(drafts[0].id, db)

    assert prospect.status == ProspectStatus.replied


def test_deleting_the_last_draft_also_reverts(db):
    """Delete has the same consequence as discard, so the same rule applies."""
    prospect, drafts = make_drafted(db)

    delete_draft(drafts[0].id, db)

    assert prospect.status == ProspectStatus.new
    assert db.scalar(select(EmailDraft).where(EmailDraft.id == drafts[0].id)) is None
