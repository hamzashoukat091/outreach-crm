import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import (
    DraftStatus,
    EmailDraft,
    ProspectEvent,
    ProspectEventType,
    ProspectStatus,
)
from app.schemas.prospects import DraftOut, DraftUpdate

router = APIRouter(prefix="/api/drafts", tags=["drafts"])


def _get(db: Session, draft_id: uuid.UUID) -> EmailDraft:
    draft = db.scalar(
        select(EmailDraft)
        .options(selectinload(EmailDraft.prospect))
        .where(EmailDraft.id == draft_id)
    )
    if not draft:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return draft


def _out(draft: EmailDraft) -> DraftOut:
    out = DraftOut.model_validate(draft)
    if draft.prospect:
        out.prospect_email = draft.prospect.email
        out.prospect_name = draft.prospect.full_name
    return out


@router.get("", response_model=list[DraftOut])
def list_drafts(
    db: Session = Depends(get_db),
    draft_status: DraftStatus | None = Query(None, alias="status"),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = select(EmailDraft).options(selectinload(EmailDraft.prospect))
    if draft_status:
        stmt = stmt.where(EmailDraft.status == draft_status)
    rows = db.scalars(stmt.order_by(EmailDraft.created_at.desc()).limit(limit)).all()
    return [_out(d) for d in rows]


@router.get("/{draft_id}", response_model=DraftOut)
def get_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    return _out(_get(db, draft_id))


@router.patch("/{draft_id}", response_model=DraftOut)
def update_draft(draft_id: uuid.UUID, payload: DraftUpdate, db: Session = Depends(get_db)):
    """Edit a draft before approving. Edits are flagged for analytics."""
    draft = _get(db, draft_id)
    if draft.status == DraftStatus.approved:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This draft was already sent and can't be edited"
        )

    updates = payload.model_dump(exclude_unset=True)
    changed = False
    for key, value in updates.items():
        if value is not None and value != getattr(draft, key):
            setattr(draft, key, value)
            changed = True

    if changed:
        draft.edited = True

    db.commit()
    db.refresh(draft)
    return _out(draft)


@router.post("/{draft_id}/approve", response_model=DraftOut)
def approve_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    """Approve = 'I copied this and sent it by hand'.

    Marks the draft sent, stamps the time, advances the prospect, and writes the
    timeline entry. The frontend copies the text to the clipboard in the same
    click, so approval and the real-world send stay in step.
    """
    draft = _get(db, draft_id)
    if draft.status == DraftStatus.approved:
        raise HTTPException(status.HTTP_409_CONFLICT, "Already marked as sent")

    now = datetime.now(timezone.utc)
    draft.status = DraftStatus.approved
    draft.approved_at = now

    prospect = draft.prospect
    if prospect:
        # Don't regress a prospect who already replied or was marked won.
        if prospect.status in (ProspectStatus.new, ProspectStatus.drafted):
            prospect.status = ProspectStatus.approved

        db.add(
            ProspectEvent(
                prospect_id=prospect.id,
                type=ProspectEventType.approved,
                summary=f"Email approved and sent: {draft.subject}",
                detail={
                    "draft_id": str(draft.id),
                    "strategy": draft.strategy_name,
                    "edited": draft.edited,
                    "context_quality": draft.context_quality,
                    "body": draft.body,
                },
            )
        )

    # Other outstanding drafts for this prospect are now moot.
    siblings = db.scalars(
        select(EmailDraft).where(
            EmailDraft.prospect_id == draft.prospect_id,
            EmailDraft.id != draft.id,
            EmailDraft.status == DraftStatus.draft,
        )
    ).all()
    for sibling in siblings:
        sibling.status = DraftStatus.discarded

    db.commit()
    db.refresh(draft)
    return _out(draft)


@router.post("/{draft_id}/discard", response_model=DraftOut)
def discard_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    draft = _get(db, draft_id)
    if draft.status == DraftStatus.approved:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This draft was already sent and can't be discarded"
        )
    draft.status = DraftStatus.discarded
    db.commit()
    db.refresh(draft)
    return _out(draft)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    draft = _get(db, draft_id)
    db.delete(draft)
    db.commit()
