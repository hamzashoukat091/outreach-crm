"""Sequences, steps, and enrollments."""

import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import (
    EnrollmentState,
    Message,
    MessageState,
    Prospect,
    Sequence,
    SequenceEnrollment,
    SequenceStep,
    Strategy,
)
from app.schemas.automation import (
    EnrollmentDetail,
    EnrollmentOut,
    EnrollRequest,
    EnrollResult,
    EnrollResultItem,
    MessageOut,
    SequenceCreate,
    SequenceOut,
    SequenceUpdate,
    StepCreate,
    StepOut,
    StepReorderRequest,
    StepUpdate,
)
from app.services.sequencer import SequencerError, enroll, stop

router = APIRouter(prefix="/api/automation", tags=["automation"])

OPEN_STATES = (EnrollmentState.active, EnrollmentState.paused)


def _get_sequence(db: Session, sequence_id: uuid.UUID) -> Sequence:
    sequence = db.scalar(
        select(Sequence)
        .options(selectinload(Sequence.steps))
        .where(Sequence.id == sequence_id)
    )
    if not sequence:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")
    return sequence


def _step_out(step: SequenceStep, strategy_names: dict[uuid.UUID, str] | None = None) -> StepOut:
    out = StepOut.model_validate(step)
    if strategy_names and step.strategy_id:
        out.strategy_name = strategy_names.get(step.strategy_id)
    return out


def _strategy_names(db: Session, steps: list[SequenceStep]) -> dict[uuid.UUID, str]:
    ids = [s.strategy_id for s in steps if s.strategy_id]
    if not ids:
        return {}
    rows = db.execute(select(Strategy.id, Strategy.name).where(Strategy.id.in_(ids))).all()
    return {r[0]: r[1] for r in rows}


def _sequence_out(db: Session, sequence: Sequence) -> SequenceOut:
    out = SequenceOut.model_validate(sequence)
    names = _strategy_names(db, sequence.steps)
    out.steps = [_step_out(s, names) for s in sorted(sequence.steps, key=lambda s: s.position)]
    out.step_count = len(sequence.steps)

    counts = dict(
        db.execute(
            select(SequenceEnrollment.state, func.count(SequenceEnrollment.id))
            .where(SequenceEnrollment.sequence_id == sequence.id)
            .group_by(SequenceEnrollment.state)
        ).all()
    )
    out.total_enrollments = sum(counts.values())
    out.active_enrollments = counts.get(EnrollmentState.active, 0) + counts.get(
        EnrollmentState.paused, 0
    )
    out.replied_enrollments = counts.get(EnrollmentState.replied, 0)
    return out


# ---------- Sequences ----------


@router.get("/sequences", response_model=list[SequenceOut])
def list_sequences(db: Session = Depends(get_db)):
    sequences = db.scalars(
        select(Sequence).options(selectinload(Sequence.steps)).order_by(Sequence.created_at)
    ).unique().all()
    return [_sequence_out(db, s) for s in sequences]


@router.post("/sequences", response_model=SequenceOut, status_code=status.HTTP_201_CREATED)
def create_sequence(payload: SequenceCreate, db: Session = Depends(get_db)):
    sequence = Sequence(**payload.model_dump())
    db.add(sequence)
    db.commit()
    db.refresh(sequence)
    return _sequence_out(db, sequence)


@router.get("/sequences/{sequence_id}", response_model=SequenceOut)
def get_sequence(sequence_id: uuid.UUID, db: Session = Depends(get_db)):
    return _sequence_out(db, _get_sequence(db, sequence_id))


@router.patch("/sequences/{sequence_id}", response_model=SequenceOut)
def update_sequence(
    sequence_id: uuid.UUID, payload: SequenceUpdate, db: Session = Depends(get_db)
):
    sequence = _get_sequence(db, sequence_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(sequence, key, value)
    db.commit()
    db.refresh(sequence)
    return _sequence_out(db, sequence)


@router.delete("/sequences/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sequence(sequence_id: uuid.UUID, db: Session = Depends(get_db)):
    sequence = _get_sequence(db, sequence_id)
    open_count = db.scalar(
        select(func.count(SequenceEnrollment.id)).where(
            SequenceEnrollment.sequence_id == sequence.id,
            SequenceEnrollment.state.in_(OPEN_STATES),
        )
    )
    if open_count:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"{open_count} prospect(s) are still enrolled. Stop them first.",
        )
    db.delete(sequence)
    db.commit()


# ---------- Steps ----------


@router.post(
    "/sequences/{sequence_id}/steps",
    response_model=StepOut,
    status_code=status.HTTP_201_CREATED,
)
def add_step(sequence_id: uuid.UUID, payload: StepCreate, db: Session = Depends(get_db)):
    sequence = _get_sequence(db, sequence_id)

    data = payload.model_dump()
    position = data.pop("position", None)
    if position is None:
        position = max((s.position for s in sequence.steps), default=0) + 1
    elif any(s.position == position for s in sequence.steps):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Position {position} is taken; use reorder instead"
        )

    if data.get("strategy_id") and not db.get(Strategy, data["strategy_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Strategy not found")

    step = SequenceStep(sequence_id=sequence.id, position=position, **data)
    db.add(step)
    db.commit()
    db.refresh(step)
    return _step_out(step, _strategy_names(db, [step]))


@router.patch("/steps/{step_id}", response_model=StepOut)
def update_step(step_id: uuid.UUID, payload: StepUpdate, db: Session = Depends(get_db)):
    step = db.get(SequenceStep, step_id)
    if not step:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Step not found")

    updates = payload.model_dump(exclude_unset=True)
    if updates.get("strategy_id") and not db.get(Strategy, updates["strategy_id"]):
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Strategy not found")
    for key, value in updates.items():
        setattr(step, key, value)
    db.commit()
    db.refresh(step)
    return _step_out(step, _strategy_names(db, [step]))


@router.delete("/steps/{step_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_step(step_id: uuid.UUID, db: Session = Depends(get_db)):
    step = db.get(SequenceStep, step_id)
    if not step:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Step not found")
    # Queued messages for this step lose their FK (SET NULL) but keep their
    # content; enrollments already past it are unaffected.
    db.delete(step)
    db.commit()


@router.post("/sequences/{sequence_id}/steps/reorder", response_model=list[StepOut])
def reorder_steps(
    sequence_id: uuid.UUID, payload: StepReorderRequest, db: Session = Depends(get_db)
):
    sequence = _get_sequence(db, sequence_id)
    by_id = {s.id: s for s in sequence.steps}
    if set(payload.ids) != set(by_id):
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "ids must be exactly this sequence's step ids, each once",
        )

    # Two-phase renumber: the (sequence_id, position) unique constraint would
    # otherwise trip mid-shuffle when two steps swap places.
    for offset, step_id in enumerate(payload.ids):
        by_id[step_id].position = 1000 + offset
    db.flush()
    for index, step_id in enumerate(payload.ids, start=1):
        by_id[step_id].position = index
    db.commit()

    names = _strategy_names(db, sequence.steps)
    return [
        _step_out(s, names) for s in sorted(sequence.steps, key=lambda s: s.position)
    ]


# ---------- Enroll ----------


@router.post("/sequences/{sequence_id}/enroll", response_model=EnrollResult)
def enroll_prospects(
    sequence_id: uuid.UUID, payload: EnrollRequest, db: Session = Depends(get_db)
):
    sequence = _get_sequence(db, sequence_id)
    if payload.mode == "send_at" and payload.send_at is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "mode 'send_at' requires send_at")

    result = EnrollResult(enrolled=0, skipped=0)
    for prospect_id in payload.prospect_ids:
        prospect = db.get(Prospect, prospect_id)
        if not prospect:
            result.skipped += 1
            result.results.append(
                EnrollResultItem(
                    prospect_id=prospect_id, status="skipped", reason="Prospect not found"
                )
            )
            continue
        try:
            enrollment = enroll(db, prospect, sequence, payload.mode, payload.send_at)
        except SequencerError as exc:
            result.skipped += 1
            result.results.append(
                EnrollResultItem(
                    prospect_id=prospect_id,
                    email=prospect.email,
                    status="skipped",
                    reason=str(exc),
                )
            )
            continue
        result.enrolled += 1
        result.results.append(
            EnrollResultItem(
                prospect_id=prospect_id,
                email=prospect.email,
                status="enrolled",
                enrollment_id=enrollment.id,
            )
        )

    db.commit()
    return result


# ---------- Enrollments ----------


def _enrollment_out(db: Session, enrollment: SequenceEnrollment) -> EnrollmentOut:
    out = EnrollmentOut.model_validate(enrollment)
    out.prospect_name = enrollment.prospect.full_name
    out.prospect_email = enrollment.prospect.email
    out.sequence_name = enrollment.sequence.name
    out.total_steps = len([s for s in enrollment.sequence.steps if s.is_active])
    out.next_message_at = db.scalar(
        select(func.min(Message.scheduled_for)).where(
            Message.enrollment_id == enrollment.id,
            Message.state.in_((MessageState.drafting, MessageState.scheduled)),
        )
    )
    return out


def _get_enrollment(db: Session, enrollment_id: uuid.UUID) -> SequenceEnrollment:
    enrollment = db.scalar(
        select(SequenceEnrollment)
        .options(
            selectinload(SequenceEnrollment.prospect),
            selectinload(SequenceEnrollment.sequence).selectinload(Sequence.steps),
            selectinload(SequenceEnrollment.messages),
        )
        .where(SequenceEnrollment.id == enrollment_id)
    )
    if not enrollment:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Enrollment not found")
    return enrollment


@router.get("/enrollments", response_model=list[EnrollmentOut])
def list_enrollments(
    db: Session = Depends(get_db),
    state: EnrollmentState | None = None,
    sequence_id: uuid.UUID | None = None,
    q: str | None = Query(None, description="Search prospect name or email"),
    limit: int = Query(100, ge=1, le=500),
):
    stmt = (
        select(SequenceEnrollment)
        .join(Prospect, SequenceEnrollment.prospect_id == Prospect.id)
        .options(
            selectinload(SequenceEnrollment.prospect),
            selectinload(SequenceEnrollment.sequence).selectinload(Sequence.steps),
        )
    )
    if state:
        stmt = stmt.where(SequenceEnrollment.state == state)
    if sequence_id:
        stmt = stmt.where(SequenceEnrollment.sequence_id == sequence_id)
    if q:
        pattern = f"%{q.lower()}%"
        stmt = stmt.where(
            or_(
                func.lower(Prospect.email).like(pattern),
                func.lower(func.coalesce(Prospect.first_name, "")).like(pattern),
                func.lower(func.coalesce(Prospect.last_name, "")).like(pattern),
            )
        )

    rows = db.scalars(
        stmt.order_by(SequenceEnrollment.enrolled_at.desc()).limit(limit)
    ).unique().all()
    return [_enrollment_out(db, e) for e in rows]


@router.get("/enrollments/{enrollment_id}", response_model=EnrollmentDetail)
def get_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _get_enrollment(db, enrollment_id)
    out = EnrollmentDetail.model_validate(_enrollment_out(db, enrollment), from_attributes=True)
    out.messages = [MessageOut.model_validate(m) for m in enrollment.messages]
    return out


@router.post("/enrollments/{enrollment_id}/pause", response_model=EnrollmentOut)
def pause_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _get_enrollment(db, enrollment_id)
    if enrollment.state != EnrollmentState.active:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only active enrollments can be paused")
    enrollment.state = EnrollmentState.paused
    db.commit()
    return _enrollment_out(db, enrollment)


@router.post("/enrollments/{enrollment_id}/resume", response_model=EnrollmentOut)
def resume_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _get_enrollment(db, enrollment_id)
    if enrollment.state != EnrollmentState.paused:
        raise HTTPException(status.HTTP_409_CONFLICT, "Only paused enrollments can be resumed")
    enrollment.state = EnrollmentState.active
    db.commit()
    return _enrollment_out(db, enrollment)


@router.post("/enrollments/{enrollment_id}/stop", response_model=EnrollmentOut)
def stop_enrollment(enrollment_id: uuid.UUID, db: Session = Depends(get_db)):
    enrollment = _get_enrollment(db, enrollment_id)
    if not enrollment.is_open:
        raise HTTPException(status.HTTP_409_CONFLICT, "Enrollment is already ended")
    stop(db, enrollment, "Stopped manually")
    db.commit()
    return _enrollment_out(db, enrollment)
