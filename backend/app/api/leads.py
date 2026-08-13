import uuid

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import Activity, ActivityType, Lead, LeadStatus
from app.schemas import (
    ActivityCreate,
    ActivityOut,
    ImportResult,
    LeadCreate,
    LeadList,
    LeadOut,
    LeadUpdate,
    PreviewRequest,
    PreviewResponse,
)
from app.services.engine import HALT_STATUSES, halt_lead_enrollments, log_activity
from app.services.importer import import_leads_csv
from app.services.templating import render_for_lead

router = APIRouter(prefix="/api/leads", tags=["leads"])

MAX_UPLOAD_BYTES = 10 * 1024 * 1024


def _get_lead(db: Session, lead_id: uuid.UUID) -> Lead:
    lead = db.get(Lead, lead_id)
    if not lead:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Lead not found")
    return lead


@router.get("", response_model=LeadList)
def list_leads(
    db: Session = Depends(get_db),
    q: str | None = Query(None, description="Search name, email, or company"),
    lead_status: LeadStatus | None = Query(None, alias="status"),
    tag: str | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    stmt = select(Lead)

    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Lead.email).like(pattern),
                func.lower(func.coalesce(Lead.first_name, "")).like(pattern),
                func.lower(func.coalesce(Lead.last_name, "")).like(pattern),
                func.lower(func.coalesce(Lead.company, "")).like(pattern),
            )
        )
    if lead_status:
        stmt = stmt.where(Lead.status == lead_status)
    if tag:
        stmt = stmt.where(Lead.tags.contains([tag]))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Lead.created_at.desc()).offset((page - 1) * page_size).limit(page_size)
    ).all()

    return LeadList(items=rows, total=total, page=page, page_size=page_size)


@router.post("", response_model=LeadOut, status_code=status.HTTP_201_CREATED)
def create_lead(payload: LeadCreate, db: Session = Depends(get_db)):
    email = payload.email.lower()
    if db.scalar(select(Lead).where(Lead.email == email)):
        raise HTTPException(status.HTTP_409_CONFLICT, "A lead with that email already exists")

    lead = Lead(**{**payload.model_dump(), "email": email})
    db.add(lead)
    db.flush()
    log_activity(db, lead.id, ActivityType.created, "Lead created")
    db.commit()
    db.refresh(lead)
    return lead


@router.get("/{lead_id}", response_model=LeadOut)
def get_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    return _get_lead(db, lead_id)


@router.patch("/{lead_id}", response_model=LeadOut)
def update_lead(lead_id: uuid.UUID, payload: LeadUpdate, db: Session = Depends(get_db)):
    lead = _get_lead(db, lead_id)
    updates = payload.model_dump(exclude_unset=True)

    if "email" in updates:
        updates["email"] = updates["email"].lower()
        clash = db.scalar(
            select(Lead).where(Lead.email == updates["email"], Lead.id != lead.id)
        )
        if clash:
            raise HTTPException(status.HTTP_409_CONFLICT, "A lead with that email already exists")

    previous_status = lead.status
    for key, value in updates.items():
        setattr(lead, key, value)

    new_status = updates.get("status")
    if new_status and new_status != previous_status:
        log_activity(
            db,
            lead.id,
            ActivityType.status_changed,
            f"Status: {previous_status.value} -> {new_status.value}",
            {"from": previous_status.value, "to": new_status.value},
        )
        # Moving to a terminal status pulls the lead out of every sequence, so a
        # prospect who already replied never receives the next scheduled step.
        if new_status in HALT_STATUSES:
            halted = halt_lead_enrollments(db, lead, f"status changed to '{new_status.value}'")
            if halted:
                log_activity(
                    db,
                    lead.id,
                    ActivityType.unenrolled,
                    f"Stopped {halted} active sequence(s)",
                )

    db.commit()
    db.refresh(lead)
    return lead


@router.delete("/{lead_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_lead(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    lead = _get_lead(db, lead_id)
    db.delete(lead)
    db.commit()


@router.get("/{lead_id}/activities", response_model=list[ActivityOut])
def list_activities(lead_id: uuid.UUID, db: Session = Depends(get_db)):
    _get_lead(db, lead_id)
    return db.scalars(
        select(Activity).where(Activity.lead_id == lead_id).order_by(Activity.created_at.desc())
    ).all()


@router.post(
    "/{lead_id}/activities", response_model=ActivityOut, status_code=status.HTTP_201_CREATED
)
def add_activity(lead_id: uuid.UUID, payload: ActivityCreate, db: Session = Depends(get_db)):
    lead = _get_lead(db, lead_id)
    activity = log_activity(db, lead.id, payload.type, payload.summary, payload.detail)

    # Logging a reply is the usual way a rep pulls someone out of a sequence.
    if payload.type == ActivityType.replied:
        lead.status = LeadStatus.replied
        halt_lead_enrollments(db, lead, "lead replied")

    db.commit()
    db.refresh(activity)
    return activity


@router.post("/import", response_model=ImportResult)
async def import_csv(
    file: UploadFile = File(...),
    update_existing: bool = Query(True),
    db: Session = Depends(get_db),
):
    if not (file.filename or "").lower().endswith(".csv"):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Please upload a .csv file")

    content = await file.read()
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "File exceeds 10MB limit")
    if not content.strip():
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "File is empty")

    return import_leads_csv(db, content, update_existing=update_existing)


@router.post("/preview", response_model=PreviewResponse)
def preview_template(payload: PreviewRequest, db: Session = Depends(get_db)):
    """Render a template against a real lead (or the newest one) for the composer."""
    lead = (
        _get_lead(db, payload.lead_id)
        if payload.lead_id
        else db.scalar(select(Lead).order_by(Lead.created_at.desc()).limit(1))
    )
    if not lead:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Add a lead first to preview a template")

    subject, body, missing = render_for_lead(payload.subject, payload.body, lead)
    return PreviewResponse(subject=subject, body=body, missing_fields=missing)
