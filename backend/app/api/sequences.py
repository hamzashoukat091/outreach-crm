import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import Enrollment, EnrollmentStatus, Sequence, SequenceStep
from app.schemas import SequenceCreate, SequenceOut, SequenceUpdate

router = APIRouter(prefix="/api/sequences", tags=["sequences"])


def _get_sequence(db: Session, sequence_id: uuid.UUID) -> Sequence:
    sequence = db.scalar(
        select(Sequence).options(selectinload(Sequence.steps)).where(Sequence.id == sequence_id)
    )
    if not sequence:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Sequence not found")
    return sequence


def _active_counts(db: Session, sequence_ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not sequence_ids:
        return {}
    rows = db.execute(
        select(Enrollment.sequence_id, func.count(Enrollment.id))
        .where(
            Enrollment.sequence_id.in_(sequence_ids),
            Enrollment.status == EnrollmentStatus.active,
        )
        .group_by(Enrollment.sequence_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def _validate_steps(steps: list) -> None:
    orders = [s.step_order for s in steps]
    if len(set(orders)) != len(orders):
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Step order values must be unique")


def _serialize(sequence: Sequence, active: int) -> SequenceOut:
    out = SequenceOut.model_validate(sequence)
    out.active_enrollments = active
    return out


@router.get("", response_model=list[SequenceOut])
def list_sequences(db: Session = Depends(get_db)):
    sequences = db.scalars(
        select(Sequence).options(selectinload(Sequence.steps)).order_by(Sequence.created_at.desc())
    ).all()
    counts = _active_counts(db, [s.id for s in sequences])
    return [_serialize(s, counts.get(s.id, 0)) for s in sequences]


@router.post("", response_model=SequenceOut, status_code=status.HTTP_201_CREATED)
def create_sequence(payload: SequenceCreate, db: Session = Depends(get_db)):
    _validate_steps(payload.steps)

    sequence = Sequence(
        name=payload.name, description=payload.description, is_active=payload.is_active
    )
    for step in payload.steps:
        sequence.steps.append(SequenceStep(**step.model_dump()))

    db.add(sequence)
    db.commit()
    db.refresh(sequence)
    return _serialize(sequence, 0)


@router.get("/{sequence_id}", response_model=SequenceOut)
def get_sequence(sequence_id: uuid.UUID, db: Session = Depends(get_db)):
    sequence = _get_sequence(db, sequence_id)
    return _serialize(sequence, _active_counts(db, [sequence.id]).get(sequence.id, 0))


@router.patch("/{sequence_id}", response_model=SequenceOut)
def update_sequence(
    sequence_id: uuid.UUID, payload: SequenceUpdate, db: Session = Depends(get_db)
):
    sequence = _get_sequence(db, sequence_id)
    updates = payload.model_dump(exclude_unset=True)
    steps = updates.pop("steps", None)

    for key, value in updates.items():
        setattr(sequence, key, value)

    if steps is not None:
        _validate_steps(payload.steps or [])
        active = _active_counts(db, [sequence.id]).get(sequence.id, 0)
        if active:
            # Replacing steps would orphan the scheduled sends that point at them.
            raise HTTPException(
                status.HTTP_409_CONFLICT,
                f"{active} active enrollment(s) use these steps. "
                "Pause or finish them before editing the sequence.",
            )
        sequence.steps.clear()
        db.flush()
        for step in payload.steps or []:
            sequence.steps.append(SequenceStep(**step.model_dump()))

    db.commit()
    db.refresh(sequence)
    return _serialize(sequence, _active_counts(db, [sequence.id]).get(sequence.id, 0))


@router.delete("/{sequence_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_sequence(sequence_id: uuid.UUID, db: Session = Depends(get_db)):
    sequence = _get_sequence(db, sequence_id)
    db.delete(sequence)
    db.commit()
