import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import Enrollment, EnrollmentStatus, Lead, Sequence
from app.schemas import EnrollmentOut, EnrollRequest, EnrollResult
from app.services.engine import enroll_lead, process_due_sends, stop_enrollment

router = APIRouter(prefix="/api/enrollments", tags=["enrollments"])


def _serialize(enrollment: Enrollment) -> EnrollmentOut:
    out = EnrollmentOut.model_validate(enrollment)
    out.sequence_name = enrollment.sequence.name if enrollment.sequence else None
    out.lead_email = enrollment.lead.email if enrollment.lead else None
    return out


@router.get("", response_model=list[EnrollmentOut])
def list_enrollments(
    lead_id: uuid.UUID | None = None,
    sequence_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    stmt = select(Enrollment).options(
        selectinload(Enrollment.sends),
        selectinload(Enrollment.lead),
        selectinload(Enrollment.sequence),
    )
    if lead_id:
        stmt = stmt.where(Enrollment.lead_id == lead_id)
    if sequence_id:
        stmt = stmt.where(Enrollment.sequence_id == sequence_id)

    rows = db.scalars(stmt.order_by(Enrollment.enrolled_at.desc())).all()
    return [_serialize(e) for e in rows]


@router.post("", response_model=EnrollResult, status_code=status.HTTP_201_CREATED)
def enroll(payload: EnrollRequest, db: Session = Depends(get_db)):
    """Bulk-enroll leads. Ineligible leads are skipped with a reason, not an error."""
    sequence = db.scalar(
        select(Sequence)
        .options(selectinload(Sequence.steps))
        .where(Sequence.id == payload.sequence_id)
    )
    if not sequence:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")
    if not sequence.is_active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Sequence is not active")

    leads = db.scalars(select(Lead).where(Lead.id.in_(payload.lead_ids))).all()
    found = {lead.id for lead in leads}

    result = EnrollResult(enrolled=0, skipped=0)
    for missing in set(payload.lead_ids) - found:
        result.skipped += 1
        result.reasons[str(missing)] = "lead not found"

    for lead in leads:
        _enrollment, reason = enroll_lead(db, lead, sequence)
        if reason:
            result.skipped += 1
            result.reasons[lead.email] = reason
        else:
            result.enrolled += 1

    db.commit()
    return result


@router.post("/{enrollment_id}/pause", response_model=EnrollmentOut)
def pause_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _load(db, enrollment_id)
    if enrollment.status != EnrollmentStatus.active:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only active enrollments can be paused")
    enrollment.status = EnrollmentStatus.paused
    db.commit()
    db.refresh(enrollment)
    return _serialize(enrollment)


@router.post("/{enrollment_id}/resume", response_model=EnrollmentOut)
def resume_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _load(db, enrollment_id)
    if enrollment.status != EnrollmentStatus.paused:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Only paused enrollments can be resumed")
    enrollment.status = EnrollmentStatus.active
    db.commit()
    db.refresh(enrollment)
    return _serialize(enrollment)


@router.delete("/{enrollment_id}", status_code=status.HTTP_204_NO_CONTENT)
def stop(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _load(db, enrollment_id)
    stop_enrollment(db, enrollment, "stopped manually")
    db.commit()


@router.post("/run-now", tags=["ops"])
def run_now(db: Session = Depends(get_db)):
    """Force a worker tick. Handy for demos instead of waiting for the interval."""
    return process_due_sends(db)


def _load(db: Session, enrollment_id: uuid.UUID) -> Enrollment:
    enrollment = db.scalar(
        select(Enrollment)
        .options(
            selectinload(Enrollment.sends),
            selectinload(Enrollment.lead),
            selectinload(Enrollment.sequence),
        )
        .where(Enrollment.id == enrollment_id)
    )
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment not found")
    return enrollment
