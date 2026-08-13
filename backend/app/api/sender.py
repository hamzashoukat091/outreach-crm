from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import SenderProfile
from app.schemas.prospects import SenderProfileOut, SenderProfileUpdate

router = APIRouter(prefix="/api/sender", tags=["sender"])


def get_or_create_profile(db: Session) -> SenderProfile:
    """The profile is a single row; create it lazily on first access."""
    profile = db.scalar(select(SenderProfile).limit(1))
    if not profile:
        profile = SenderProfile()
        db.add(profile)
        db.commit()
        db.refresh(profile)
    return profile


@router.get("", response_model=SenderProfileOut)
def get_profile(db: Session = Depends(get_db)):
    return get_or_create_profile(db)


@router.put("", response_model=SenderProfileOut)
def update_profile(payload: SenderProfileUpdate, db: Session = Depends(get_db)):
    profile = get_or_create_profile(db)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(profile, key, value)
    db.commit()
    db.refresh(profile)
    return profile
