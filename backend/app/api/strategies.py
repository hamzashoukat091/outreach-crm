import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.models import EmailDraft, Prospect, Strategy
from app.schemas.prospects import (
    StrategyCreate,
    StrategyOut,
    StrategyUpdate,
)
from app.services.generator import build_prompt

router = APIRouter(prefix="/api/strategies", tags=["strategies"])


def _get(db: Session, strategy_id: uuid.UUID) -> Strategy:
    strategy = db.get(Strategy, strategy_id)
    if not strategy:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Strategy not found")
    return strategy


def _usage(db: Session, ids: list[uuid.UUID]) -> dict[uuid.UUID, int]:
    if not ids:
        return {}
    rows = db.execute(
        select(EmailDraft.strategy_id, func.count(EmailDraft.id))
        .where(EmailDraft.strategy_id.in_(ids))
        .group_by(EmailDraft.strategy_id)
    ).all()
    return {row[0]: row[1] for row in rows}


def _serialize(strategy: Strategy, usage: int) -> StrategyOut:
    out = StrategyOut.model_validate(strategy)
    out.usage_count = usage
    return out


def _clear_other_defaults(db: Session, keep_id: uuid.UUID | None) -> None:
    others = db.scalars(select(Strategy).where(Strategy.is_default.is_(True))).all()
    for other in others:
        if other.id != keep_id:
            other.is_default = False


@router.get("", response_model=list[StrategyOut])
def list_strategies(db: Session = Depends(get_db)):
    strategies = db.scalars(
        select(Strategy).order_by(Strategy.is_default.desc(), Strategy.created_at)
    ).all()
    usage = _usage(db, [s.id for s in strategies])
    return [_serialize(s, usage.get(s.id, 0)) for s in strategies]


@router.post("", response_model=StrategyOut, status_code=status.HTTP_201_CREATED)
def create_strategy(payload: StrategyCreate, db: Session = Depends(get_db)):
    strategy = Strategy(**payload.model_dump())
    db.add(strategy)
    db.flush()
    if strategy.is_default:
        _clear_other_defaults(db, strategy.id)
    db.commit()
    db.refresh(strategy)
    return _serialize(strategy, 0)


@router.get("/{strategy_id}", response_model=StrategyOut)
def get_strategy(strategy_id: uuid.UUID, db: Session = Depends(get_db)):
    strategy = _get(db, strategy_id)
    return _serialize(strategy, _usage(db, [strategy.id]).get(strategy.id, 0))


@router.patch("/{strategy_id}", response_model=StrategyOut)
def update_strategy(
    strategy_id: uuid.UUID, payload: StrategyUpdate, db: Session = Depends(get_db)
):
    strategy = _get(db, strategy_id)
    for key, value in payload.model_dump(exclude_unset=True).items():
        setattr(strategy, key, value)

    if strategy.is_default:
        _clear_other_defaults(db, strategy.id)

    db.commit()
    db.refresh(strategy)
    return _serialize(strategy, _usage(db, [strategy.id]).get(strategy.id, 0))


@router.delete("/{strategy_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_strategy(strategy_id: uuid.UUID, db: Session = Depends(get_db)):
    strategy = _get(db, strategy_id)
    # Drafts keep strategy_name, so history survives the deletion.
    db.delete(strategy)
    db.commit()


@router.post("/{strategy_id}/preview")
def preview_prompt(
    strategy_id: uuid.UUID,
    prospect_id: uuid.UUID | None = None,
    db: Session = Depends(get_db),
):
    """Show the exact prompt this strategy would send, without calling the API."""
    strategy = _get(db, strategy_id)

    prospect = (
        db.get(Prospect, prospect_id)
        if prospect_id
        else db.scalar(select(Prospect).order_by(Prospect.is_complete.desc()).limit(1))
    )
    if not prospect:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Import prospects first to preview a prompt"
        )

    system, user_message = build_prompt(prospect, strategy)
    return {
        "prospect_email": prospect.email,
        "prospect_name": prospect.full_name,
        "context_quality": "rich" if prospect.is_complete else "thin",
        "system_prompt": system,
        "user_message": user_message,
    }
