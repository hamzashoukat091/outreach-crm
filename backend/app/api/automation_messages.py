"""Messages, the conversation inbox, and the approval queue."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import (
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    SequenceEnrollment,
)
from app.schemas.automation import (
    ApprovalOut,
    InboxItem,
    MessageApproveRequest,
    MessageDetail,
    MessageList,
    MessageOut,
)
from app.services.generator import GenerationError
from app.services.replier import redraft_reply
from app.services.sequencer import draft_message as sequencer_draft

router = APIRouter(prefix="/api/automation", tags=["automation"])


def _get_message(db: Session, message_id: uuid.UUID) -> Message:
    message = db.scalar(
        select(Message)
        .options(selectinload(Message.prospect), selectinload(Message.enrollment))
        .where(Message.id == message_id)
    )
    if not message:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Message not found")
    return message


def _out(message: Message) -> MessageOut:
    out = MessageOut.model_validate(message)
    if message.prospect:
        out.prospect_name = message.prospect.full_name
        out.prospect_email = message.prospect.email
    return out


# ---------- Messages ----------


@router.get("/messages", response_model=MessageList)
def list_messages(
    db: Session = Depends(get_db),
    state: MessageState | None = None,
    direction: MessageDirection | None = None,
    kind: MessageKind | None = None,
    prospect_id: uuid.UUID | None = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(25, ge=1, le=200),
):
    stmt = select(Message).options(selectinload(Message.prospect))
    if state:
        stmt = stmt.where(Message.state == state)
    if direction:
        stmt = stmt.where(Message.direction == direction)
    if kind:
        stmt = stmt.where(Message.kind == kind)
    if prospect_id:
        stmt = stmt.where(Message.prospect_id == prospect_id)

    total = db.scalar(select(func.count()).select_from(stmt.order_by(None).subquery())) or 0
    rows = db.scalars(
        stmt.order_by(Message.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return MessageList(
        items=[_out(m) for m in rows], total=total, page=page, page_size=page_size
    )


@router.get("/messages/{message_id}", response_model=MessageDetail)
def get_message(message_id: uuid.UUID, db: Session = Depends(get_db)):
    message = _get_message(db, message_id)
    # Validate from the ORM row, not through _out: a MessageOut intermediate
    # would silently drop the provenance fields this endpoint exists to expose.
    out = MessageDetail.model_validate(message)
    if message.prospect:
        out.prospect_name = message.prospect.full_name
        out.prospect_email = message.prospect.email
    return out


@router.post("/messages/{message_id}/approve", response_model=MessageOut)
def approve_message(
    message_id: uuid.UUID,
    payload: MessageApproveRequest | None = None,
    db: Session = Depends(get_db),
):
    """Release a held message (optionally editing it first).

    Approving means "send this as soon as the worker's guardrails allow" --
    the message jumps to scheduled-now rather than waiting for a window.
    """
    message = _get_message(db, message_id)
    if message.state != MessageState.needs_approval:
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"Message is '{message.state.value}', not awaiting approval"
        )

    if payload:
        for field in ("subject", "body"):
            value = getattr(payload, field)
            if value is not None and value != getattr(message, field):
                setattr(message, field, value)
                message.edited = True

    if not (message.body or "").strip():
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST,
            "This message has no body yet. Write one in the approve call or regenerate it.",
        )

    message.state = MessageState.scheduled
    message.scheduled_for = datetime.now(timezone.utc)
    message.approved_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(message)
    return _out(message)


@router.post("/messages/{message_id}/reject", response_model=MessageOut)
def reject_message(message_id: uuid.UUID, db: Session = Depends(get_db)):
    message = _get_message(db, message_id)
    if message.state not in (
        MessageState.needs_approval,
        MessageState.scheduled,
        MessageState.drafting,
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT, f"A '{message.state.value}' message can't be rejected"
        )
    message.state = MessageState.cancelled
    db.commit()
    db.refresh(message)
    return _out(message)


@router.post("/messages/{message_id}/regenerate", response_model=MessageOut)
def regenerate_message(message_id: uuid.UUID, db: Session = Depends(get_db)):
    """Throw the current text away and have Claude write it again in place."""
    message = _get_message(db, message_id)
    if message.direction != MessageDirection.outbound or message.state not in (
        MessageState.drafting,
        MessageState.scheduled,
        MessageState.needs_approval,
    ):
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            "Only queued outbound messages (drafting/scheduled/needs approval) can be regenerated",
        )
    held = message.state == MessageState.needs_approval
    try:
        if message.kind == MessageKind.reply:
            # Redrafts from the stored classification -- classify is not
            # re-run, so timeline events aren't doubled. This is the
            # fill-facts-then-regenerate loop the approvals queue depends on.
            redraft_reply(db, message)
        else:
            sequencer_draft(db, message)
    except GenerationError as exc:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)) from exc

    if held:
        # Regenerating does not bypass a hold.
        message.state = MessageState.needs_approval
    message.edited = False
    db.commit()
    db.refresh(message)
    return _out(message)


# ---------- Inbox ----------


@router.get("/inbox", response_model=list[InboxItem])
def inbox(db: Session = Depends(get_db), limit: int = Query(50, ge=1, le=200)):
    """Conversations: every enrollment that has heard back, newest first."""
    has_inbound = (
        select(Message.enrollment_id)
        .where(
            Message.direction == MessageDirection.inbound,
            Message.enrollment_id.isnot(None),
        )
        .distinct()
    )
    enrollments = db.scalars(
        select(SequenceEnrollment)
        .options(
            selectinload(SequenceEnrollment.prospect),
            selectinload(SequenceEnrollment.sequence),
            selectinload(SequenceEnrollment.messages),
        )
        .where(SequenceEnrollment.id.in_(has_inbound))
        .order_by(SequenceEnrollment.last_activity_at.desc().nulls_last())
        .limit(limit)
    ).unique().all()

    items: list[InboxItem] = []
    for enrollment in enrollments:
        inbound = [
            m for m in enrollment.messages if m.direction == MessageDirection.inbound
        ]
        outbound_sent = [
            m
            for m in enrollment.messages
            if m.direction == MessageDirection.outbound and m.state == MessageState.sent
        ]
        latest_inbound = max(
            inbound, key=lambda m: m.received_at or m.created_at, default=None
        )
        latest_outbound = max(
            outbound_sent, key=lambda m: m.sent_at or m.created_at, default=None
        )
        pending = any(
            m.state == MessageState.needs_approval for m in enrollment.messages
        )
        items.append(
            InboxItem(
                enrollment_id=enrollment.id,
                prospect_id=enrollment.prospect_id,
                prospect_name=enrollment.prospect.full_name,
                prospect_email=enrollment.prospect.email,
                sequence_name=enrollment.sequence.name,
                state=enrollment.state,
                situation=latest_inbound.situation if latest_inbound else None,
                pending_approval=pending,
                latest_inbound=MessageOut.model_validate(latest_inbound)
                if latest_inbound
                else None,
                latest_outbound=MessageOut.model_validate(latest_outbound)
                if latest_outbound
                else None,
                last_activity_at=enrollment.last_activity_at,
            )
        )
    return items


# ---------- Approvals ----------


@router.get("/approvals", response_model=list[ApprovalOut])
def approvals(db: Session = Depends(get_db)):
    """Everything waiting on a human, with the email that triggered it."""
    held = db.scalars(
        select(Message)
        .options(selectinload(Message.prospect))
        .where(Message.state == MessageState.needs_approval)
        .order_by(Message.created_at)
    ).all()

    results: list[ApprovalOut] = []
    for message in held:
        trigger = None
        if message.enrollment_id:
            trigger = db.scalar(
                select(Message)
                .where(
                    Message.enrollment_id == message.enrollment_id,
                    Message.direction == MessageDirection.inbound,
                    Message.created_at <= message.created_at,
                )
                .order_by(Message.created_at.desc())
            )
        results.append(
            ApprovalOut(
                message=_out(message),
                trigger=_out(trigger) if trigger else None,
            )
        )
    return results
