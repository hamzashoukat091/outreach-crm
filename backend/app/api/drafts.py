import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
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


@router.get("/{draft_id}/prompt")
def get_draft_prompt(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    """The exact API call behind this draft.

    Served separately from the draft itself so list endpoints don't carry
    several KB of prompt text per row.
    """
    draft = _get(db, draft_id)

    return {
        "draft_id": str(draft.id),
        "available": bool(draft.user_prompt),
        "model": draft.model,
        "strategy_name": draft.strategy_name,
        "context_quality": draft.context_quality,
        "system_prompt": draft.system_prompt,
        "user_prompt": draft.user_prompt,
        "raw_response": draft.raw_response,
        "input_tokens": draft.input_tokens,
        "output_tokens": draft.output_tokens,
        "created_at": draft.created_at.isoformat() if draft.created_at else None,
        "prospect_email": draft.prospect.email if draft.prospect else None,
    }


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


def _revert_if_no_live_drafts(db: Session, draft: EmailDraft) -> None:
    """Undo the 'drafted' status when the last live draft goes away.

    Generating moves a prospect new -> drafted, so removing the draft has to
    move it back, or the prospect claims a draft that no longer exists: the
    pipeline chart counts them as drafted forever and the list offers to
    review nothing. Only 'drafted' is reverted -- a prospect who was approved,
    replied or won has moved past this and must not regress.
    """
    prospect = draft.prospect
    if not prospect or prospect.status != ProspectStatus.drafted:
        return

    live = db.scalar(
        select(func.count())
        .select_from(EmailDraft)
        .where(
            EmailDraft.prospect_id == prospect.id,
            EmailDraft.id != draft.id,
            EmailDraft.status != DraftStatus.discarded,
        )
    )
    if not live:
        prospect.status = ProspectStatus.new


@router.post("/{draft_id}/discard", response_model=DraftOut)
def discard_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    draft = _get(db, draft_id)
    if draft.status == DraftStatus.approved:
        raise HTTPException(
            status.HTTP_409_CONFLICT, "This draft was already sent and can't be discarded"
        )
    draft.status = DraftStatus.discarded
    _revert_if_no_live_drafts(db, draft)
    db.commit()
    db.refresh(draft)
    return _out(draft)


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_draft(draft_id: uuid.UUID, db: Session = Depends(get_db)):
    draft = _get(db, draft_id)
    _revert_if_no_live_drafts(db, draft)
    db.delete(draft)
    db.commit()
