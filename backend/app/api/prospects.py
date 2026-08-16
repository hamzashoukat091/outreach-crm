import uuid
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import (
    DraftStatus,
    EmailDraft,
    EnrollmentState,
    Message,
    MessageState,
    Prospect,
    ProspectEvent,
    ProspectEventType,
    ProspectStatus,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
    Strategy,
)
from app.schemas.automation import BulkHandoffRequest
from app.schemas.prospects import (
    ArchiveRequest,
    BulkArchiveRequest,
    BulkGenerateRequest,
    BulkGenerateResult,
    DraftOut,
    DraftUpdate,
    GenerateRequest,
    ProspectCreate,
    ProspectEventCreate,
    ProspectEventOut,
    ProspectImportResult,
    ProspectList,
    ProspectOut,
    ProspectUpdate,
)
from app.api.sender import get_or_create_profile
from app.services.generator import GenerationError, generate_email
from app.services.prospect_import import COMPANY_SIGNALS, import_prospects_csv

router = APIRouter(prefix="/api/prospects", tags=["prospects"])

MAX_UPLOAD_BYTES = 20 * 1024 * 1024


def _get(db: Session, prospect_id: uuid.UUID) -> Prospect:
    prospect = db.get(Prospect, prospect_id)
    if not prospect:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Prospect not found")
    return prospect


def _log(
    db: Session,
    prospect_id: uuid.UUID,
    type_: ProspectEventType,
    summary: str,
    detail: dict | None = None,
) -> None:
    db.add(
        ProspectEvent(
            prospect_id=prospect_id, type=type_, summary=summary, detail=detail or {}
        )
    )


def _serialize(prospect: Prospect, drafts: list[EmailDraft] | None = None) -> ProspectOut:
    out = ProspectOut.model_validate(prospect)
    items = prospect.drafts if drafts is None else drafts
    live = [d for d in items if d.status != DraftStatus.discarded]
    out.draft_count = len(live)
    out.last_draft_status = live[0].status if live else None
    return out


def _attach_enrollments(db: Session, items: list[ProspectOut]) -> None:
    """Fill in live automation state for a page of prospects.

    One query for the whole page rather than one per row: the list is the
    place people scan to see what is running, and it should not cost 25
    round trips to say so. Open enrollments win over finished ones, so a
    prospect who completed a sequence and was re-enrolled shows the live run.
    """
    ids = [p.id for p in items]
    if not ids:
        return

    rows = db.execute(
        select(
            SequenceEnrollment.id,
            SequenceEnrollment.prospect_id,
            SequenceEnrollment.state,
            SequenceEnrollment.current_position,
            Sequence.name,
            func.count(SequenceStep.id).label("total_steps"),
            func.min(
                case(
                    (
                        Message.state.in_(
                            (MessageState.scheduled, MessageState.drafting)
                        ),
                        Message.scheduled_for,
                    )
                )
            ).label("next_at"),
        )
        .join(Sequence, Sequence.id == SequenceEnrollment.sequence_id)
        .outerjoin(SequenceStep, SequenceStep.sequence_id == Sequence.id)
        .outerjoin(Message, Message.enrollment_id == SequenceEnrollment.id)
        .where(SequenceEnrollment.prospect_id.in_(ids))
        .group_by(
            SequenceEnrollment.id,
            SequenceEnrollment.prospect_id,
            SequenceEnrollment.state,
            SequenceEnrollment.current_position,
            Sequence.name,
        )
        .order_by(
            SequenceEnrollment.prospect_id,
            # Open runs first, then most recent.
            case(
                (
                    SequenceEnrollment.state.in_(
                        (EnrollmentState.active, EnrollmentState.paused)
                    ),
                    0,
                ),
                else_=1,
            ),
            SequenceEnrollment.enrolled_at.desc(),
        )
    ).all()

    best: dict[uuid.UUID, Any] = {}
    for row in rows:
        best.setdefault(row.prospect_id, row)

    for item in items:
        row = best.get(item.id)
        if not row:
            continue
        item.enrollment_id = row.id
        item.sequence_name = row.name
        item.enrollment_state = row.state.value
        item.enrollment_step = row.current_position
        item.enrollment_total_steps = row.total_steps
        item.next_message_at = row.next_at


def _resolve_strategy(db: Session, strategy_id: uuid.UUID | None) -> Strategy:
    if strategy_id:
        strategy = db.get(Strategy, strategy_id)
        if not strategy:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Strategy not found")
        return strategy

    strategy = db.scalar(
        select(Strategy).where(Strategy.is_default.is_(True), Strategy.is_active.is_(True))
    ) or db.scalar(
        select(Strategy).where(Strategy.is_active.is_(True)).order_by(Strategy.created_at)
    )
    if not strategy:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "No strategy available. Create one on the Strategies page first.",
        )
    return strategy


# ---------- CRUD ----------


@router.get("", response_model=ProspectList)
def list_prospects(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="Search name, email, company, or title"),
    prospect_status: ProspectStatus | None = Query(None, alias="status"),
    seniority: str | None = None,
    industry: str | None = None,
    completeness: str | None = Query(None, pattern="^(complete|incomplete)$"),
    has_draft: bool | None = None,
    archived: bool = Query(
        False, description="Show archived prospects instead of active ones"
    ),
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    # Archived prospects are hidden unless explicitly asked for -- that is the
    # point of archiving.
    stmt = select(Prospect).options(selectinload(Prospect.drafts)).where(
        Prospect.is_archived.is_(archived)
    )

    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Prospect.email).like(pattern),
                func.lower(func.coalesce(Prospect.first_name, "")).like(pattern),
                func.lower(func.coalesce(Prospect.last_name, "")).like(pattern),
                func.lower(func.coalesce(Prospect.company_name, "")).like(pattern),
                func.lower(func.coalesce(Prospect.job_title, "")).like(pattern),
            )
        )
    if prospect_status:
        stmt = stmt.where(Prospect.status == prospect_status)
    if seniority:
        stmt = stmt.where(Prospect.seniority == seniority)
    if industry:
        stmt = stmt.where(Prospect.industry == industry)
    if completeness == "complete":
        stmt = stmt.where(Prospect.is_complete.is_(True))
    elif completeness == "incomplete":
        stmt = stmt.where(Prospect.is_complete.is_(False))

    if has_draft is not None:
        live_drafts = (
            select(EmailDraft.prospect_id)
            .where(EmailDraft.status != DraftStatus.discarded)
            .distinct()
        )
        stmt = stmt.where(
            Prospect.id.in_(live_drafts) if has_draft else ~Prospect.id.in_(live_drafts)
        )

    total = db.scalar(
        select(func.count()).select_from(stmt.order_by(None).subquery())
    ) or 0
    rows = db.scalars(
        stmt.order_by(Prospect.is_complete.desc(), Prospect.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).unique().all()

    items = [_serialize(p) for p in rows]
    _attach_enrollments(db, items)
    return ProspectList(items=items, total=total, page=page, page_size=page_size)


@router.post("", response_model=ProspectOut, status_code=status.HTTP_201_CREATED)
def create_prospect(payload: ProspectCreate, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(Prospect).where(Prospect.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A prospect with that email exists")

    data = payload.model_dump()
    data["email"] = email
    prospect = Prospect(**data)

    missing = [f for f in COMPANY_SIGNALS if not getattr(prospect, f, None)]
    prospect.missing_fields = missing
    prospect.is_complete = not missing

    db.add(prospect)
    db.flush()
    _log(db, prospect.id, ProspectEventType.imported, "Created manually")
    db.commit()
    db.refresh(prospect)
    return _serialize(prospect, [])


@router.get("/{prospect_id}", response_model=ProspectOut)
def get_prospect(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    return _serialize(_get(db, prospect_id))


@router.patch("/{prospect_id}", response_model=ProspectOut)
def update_prospect(
    prospect_id: uuid.UUID, payload: ProspectUpdate, db: Session = Depends(get_db)
):
    prospect = _get(db, prospect_id)
    updates = payload.model_dump(exclude_unset=True)

    if "email" in updates and updates["email"]:
        updates["email"] = updates["email"].lower()
        clash = db.scalar(
            select(Prospect).where(
                Prospect.email == updates["email"], Prospect.id != prospect.id
            )
        )
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "That email belongs to another prospect")

    previous_status = prospect.status
    filled: list[str] = []

    for key, value in updates.items():
        if key in COMPANY_SIGNALS and not getattr(prospect, key, None) and value:
            filled.append(key)
        setattr(prospect, key, value)

    # Re-evaluate completeness after a manual edit.
    missing = [f for f in COMPANY_SIGNALS if not getattr(prospect, f, None)]
    prospect.missing_fields = missing
    was_incomplete = not prospect.is_complete
    prospect.is_complete = not missing

    if prospect.company_inferred and updates.get("company_name"):
        prospect.company_inferred = False

    new_status = updates.get("status")
    if new_status and new_status != previous_status:
        _log(
            db,
            prospect.id,
            ProspectEventType.status_changed,
            f"Status: {previous_status.value} → {new_status.value}",
            {"from": previous_status.value, "to": new_status.value},
        )
    if filled:
        _log(
            db,
            prospect.id,
            ProspectEventType.updated,
            f"Filled in: {', '.join(filled)}",
            {"fields": filled},
        )
        if was_incomplete and prospect.is_complete:
            _log(db, prospect.id, ProspectEventType.updated, "Now has full company context")

    db.commit()
    db.refresh(prospect)
    return _serialize(prospect)


@router.delete("/{prospect_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_prospect(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    prospect = _get(db, prospect_id)
    db.delete(prospect)
    db.commit()


@router.post("/bulk-delete")
def bulk_delete(ids: list[uuid.UUID], db: Session = Depends(get_db)):
    if not ids:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No prospects selected")
    rows = db.scalars(select(Prospect).where(Prospect.id.in_(ids))).all()
    for prospect in rows:
        db.delete(prospect)
    db.commit()
    return {"deleted": len(rows)}


# ---------- Archive ----------


def _set_archived(
    db: Session, prospect: Prospect, archived: bool, reason: str | None = None
) -> None:
    """Shelve or restore a prospect. Status is untouched, so a prospect who
    replied is still 'replied' when they come back."""
    if prospect.is_archived == archived:
        return

    prospect.is_archived = archived
    prospect.archived_at = datetime.now(timezone.utc) if archived else None
    prospect.archive_reason = reason if archived else None

    if archived:
        _log(
            db,
            prospect.id,
            ProspectEventType.archived,
            f"Archived{f': {reason}' if reason else ''}",
            {"reason": reason},
        )
    else:
        _log(db, prospect.id, ProspectEventType.unarchived, "Restored from archive")


@router.post("/{prospect_id}/archive", response_model=ProspectOut)
def archive_prospect(
    prospect_id: uuid.UUID,
    payload: ArchiveRequest | None = None,
    db: Session = Depends(get_db),
):
    prospect = _get(db, prospect_id)
    _set_archived(db, prospect, True, payload.reason if payload else None)
    db.commit()
    db.refresh(prospect)
    return _serialize(prospect)


@router.post("/{prospect_id}/unarchive", response_model=ProspectOut)
def unarchive_prospect(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    prospect = _get(db, prospect_id)
    _set_archived(db, prospect, False)
    db.commit()
    db.refresh(prospect)
    return _serialize(prospect)


@router.post("/bulk-archive")
def bulk_archive(payload: BulkArchiveRequest, db: Session = Depends(get_db)):
    rows = db.scalars(
        select(Prospect).where(Prospect.id.in_(payload.prospect_ids))
    ).all()
    for prospect in rows:
        _set_archived(db, prospect, payload.archived, payload.reason)
    db.commit()
    return {"updated": len(rows), "archived": payload.archived}


# ---------- Pipeline handoff ----------


def _open_enrollment_count(db: Session, prospect_id: uuid.UUID) -> int:
    return (
        db.scalar(
            select(func.count(SequenceEnrollment.id)).where(
                SequenceEnrollment.prospect_id == prospect_id,
                SequenceEnrollment.state.in_(
                    (EnrollmentState.active, EnrollmentState.paused)
                ),
            )
        )
        or 0
    )


def _set_pipeline_mode(db: Session, prospect: Prospect, mode: str) -> bool:
    """Flip which side of the app owns the prospect. Returns True on change."""
    if prospect.pipeline_mode == mode:
        return False
    prospect.pipeline_mode = mode
    if mode == "automated":
        _log(db, prospect.id, ProspectEventType.handed_off, "Handed off to automation")
    else:
        _log(db, prospect.id, ProspectEventType.returned_to_manual, "Returned to manual outreach")
    return True


@router.post("/{prospect_id}/handoff", response_model=ProspectOut)
def handoff_prospect(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    """Move a prospect to the automated pipeline. Enrolling is a separate,
    deliberate step -- handoff alone sends nothing."""
    prospect = _get(db, prospect_id)
    _set_pipeline_mode(db, prospect, "automated")
    db.commit()
    db.refresh(prospect)
    return _serialize(prospect)


@router.post("/{prospect_id}/return-to-manual", response_model=ProspectOut)
def return_prospect_to_manual(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    prospect = _get(db, prospect_id)
    open_count = _open_enrollment_count(db, prospect.id)
    if open_count:
        # Returning while enrolled would leave a sequence firing at a prospect
        # the user believes they now handle by hand.
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"This prospect has {open_count} open enrollment(s). "
            "Stop them on the Sequences page first, then return to manual.",
        )
    _set_pipeline_mode(db, prospect, "manual")
    db.commit()
    db.refresh(prospect)
    return _serialize(prospect)


@router.post("/bulk-handoff")
def bulk_handoff(payload: BulkHandoffRequest, db: Session = Depends(get_db)):
    rows = db.scalars(select(Prospect).where(Prospect.id.in_(payload.ids))).all()
    changed = sum(1 for p in rows if _set_pipeline_mode(db, p, "automated"))
    db.commit()
    return {"updated": changed, "total": len(rows)}


@router.post("/bulk-return-to-manual")
def bulk_return_to_manual(payload: BulkHandoffRequest, db: Session = Depends(get_db)):
    """Hand prospects back to the Outreach section.

    Anyone still running in a sequence is skipped rather than failing the whole
    batch -- selecting 20 people should not be blocked by one of them being
    mid-flight. The count of skipped rows is returned so the UI can say so.
    """
    rows = db.scalars(select(Prospect).where(Prospect.id.in_(payload.ids))).all()
    changed = 0
    blocked = 0
    for prospect in rows:
        if _open_enrollment_count(db, prospect.id):
            blocked += 1
            continue
        changed += _set_pipeline_mode(db, prospect, "manual")
    db.commit()
    return {"updated": changed, "blocked": blocked, "total": len(rows)}


# ---------- Import ----------


@router.post("/import", response_model=ProspectImportResult)
async def import_csv(
    file: UploadFile = File(...),
    update_existing: bool = Query(True),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please upload a .csv file")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 20MB")
    if not content.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")

    return import_prospects_csv(db, content, update_existing=update_existing)


# ---------- Events ----------


@router.get("/{prospect_id}/events", response_model=list[ProspectEventOut])
def list_events(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    _get(db, prospect_id)
    return db.scalars(
        select(ProspectEvent)
        .where(ProspectEvent.prospect_id == prospect_id)
        .order_by(ProspectEvent.created_at.desc())
    ).all()


@router.post(
    "/{prospect_id}/events", response_model=ProspectEventOut, status_code=status.HTTP_201_CREATED
)
def add_event(
    prospect_id: uuid.UUID, payload: ProspectEventCreate, db: Session = Depends(get_db)
):
    prospect = _get(db, prospect_id)
    event = ProspectEvent(
        prospect_id=prospect.id,
        type=payload.type,
        summary=payload.summary,
        detail=payload.detail,
    )
    db.add(event)

    # Logging an outcome moves the prospect's status to match.
    if payload.type == ProspectEventType.replied:
        prospect.status = ProspectStatus.replied
    elif payload.type == ProspectEventType.bounced:
        prospect.status = ProspectStatus.bounced

    db.commit()
    db.refresh(event)
    return event


# ---------- Generation ----------


def _draft_out(draft: EmailDraft) -> DraftOut:
    out = DraftOut.model_validate(draft)
    if draft.prospect:
        out.prospect_email = draft.prospect.email
        out.prospect_name = draft.prospect.full_name
    return out


@router.post("/{prospect_id}/generate", response_model=DraftOut)
def generate(
    prospect_id: uuid.UUID, payload: GenerateRequest, db: Session = Depends(get_db)
):
    prospect = _get(db, prospect_id)
    strategy = _resolve_strategy(db, payload.strategy_id)

    sender = get_or_create_profile(db)

    try:
        result = generate_email(prospect, strategy, sender)
    except GenerationError as exc:
        # Record the failure so the timeline explains why nothing appeared.
        _log(
            db,
            prospect.id,
            ProspectEventType.generated,
            "Generation failed",
            {"error": str(exc), "strategy": strategy.name},
        )
        db.commit()
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    draft = EmailDraft(
        prospect_id=prospect.id,
        strategy_id=strategy.id,
        strategy_name=strategy.name,
        status=DraftStatus.draft,
        **result,
    )
    db.add(draft)

    if prospect.status == ProspectStatus.new:
        prospect.status = ProspectStatus.drafted

    _log(
        db,
        prospect.id,
        ProspectEventType.generated,
        f"Draft generated with '{strategy.name}'",
        {
            "strategy": strategy.name,
            "context_quality": result["context_quality"],
            "model": result["model"],
        },
    )

    db.commit()
    db.refresh(draft)
    return _draft_out(draft)


@router.post("/generate-bulk", response_model=BulkGenerateResult)
def generate_bulk(payload: BulkGenerateRequest, db: Session = Depends(get_db)):
    """Generate for several prospects. One failure doesn't abort the rest."""
    strategy = _resolve_strategy(db, payload.strategy_id)
    prospects = db.scalars(
        select(Prospect).where(Prospect.id.in_(payload.prospect_ids))
    ).all()

    sender = get_or_create_profile(db)
    result = BulkGenerateResult(generated=0, failed=0)

    for prospect in prospects:
        try:
            generated = generate_email(prospect, strategy, sender)
        except GenerationError as exc:
            result.failed += 1
            result.errors[prospect.email] = str(exc)
            continue

        draft = EmailDraft(
            prospect_id=prospect.id,
            strategy_id=strategy.id,
            strategy_name=strategy.name,
            status=DraftStatus.draft,
            **generated,
        )
        db.add(draft)
        db.flush()

        if prospect.status == ProspectStatus.new:
            prospect.status = ProspectStatus.drafted

        _log(
            db,
            prospect.id,
            ProspectEventType.generated,
            f"Draft generated with '{strategy.name}'",
            {"strategy": strategy.name, "context_quality": generated["context_quality"]},
        )
        result.generated += 1
        result.drafts.append(_draft_out(draft))

    db.commit()
    return result


# ---------- Drafts ----------


@router.get("/{prospect_id}/drafts", response_model=list[DraftOut])
def list_drafts(prospect_id: uuid.UUID, db: Session = Depends(get_db)):
    _get(db, prospect_id)
    rows = db.scalars(
        select(EmailDraft)
        .options(selectinload(EmailDraft.prospect))
        .where(EmailDraft.prospect_id == prospect_id)
        .order_by(EmailDraft.created_at.desc())
    ).all()
    return [_draft_out(d) for d in rows]
