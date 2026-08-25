"""The stored mailbox: listing, reading, and connection status.

Separate from automation_messages.py, which serves the CRM pipeline. These
endpoints serve the mailbox itself -- including the majority of mail that has
no prospect attached and never enters the pipeline at all.
"""

import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.core.db import get_db
from app.models import EmailMessage, GmailAccount, Message, Prospect
from app.services.gmail import GmailClient
from app.services.html_sanitize import sanitize_email_html

router = APIRouter(prefix="/api/mail", tags=["mail"])


class MailListItem(BaseModel):
    id: uuid.UUID
    gmail_id: str
    gmail_thread_id: str
    from_address: str | None
    from_name: str | None
    to_addresses: list[str]
    subject: str | None
    snippet: str | None
    is_unread: bool
    is_sent: bool
    has_attachments: bool
    internal_date: datetime
    prospect_id: uuid.UUID | None
    prospect_name: str | None = None
    in_pipeline: bool = False


class MailDetail(MailListItem):
    body_text: str | None
    # Sanitised at read time -- never the raw stored markup.
    body_html_safe: str
    blocked_images: int
    cc_addresses: list[str]
    reply_to: str | None
    attachments: list[dict]
    label_ids: list[str]


class GmailStatus(BaseModel):
    connected: bool
    configured: bool
    email_address: str | None = None
    last_synced_at: datetime | None = None
    last_error: str | None = None
    history_id: int | None = None
    total_emails: int = 0
    unread_count: int = 0
    full_sync_count: int = 0


def _prospect_name(prospect: Prospect | None) -> str | None:
    if prospect is None:
        return None
    name = " ".join(p for p in (prospect.first_name, prospect.last_name) if p).strip()
    return name or prospect.email


def _to_item(row: EmailMessage, in_pipeline: bool = False) -> MailListItem:
    return MailListItem(
        id=row.id,
        gmail_id=row.gmail_id,
        gmail_thread_id=row.gmail_thread_id,
        from_address=row.from_address,
        from_name=row.from_name,
        to_addresses=row.to_addresses or [],
        subject=row.subject,
        snippet=row.snippet,
        is_unread=row.is_unread,
        is_sent=row.is_sent,
        has_attachments=bool(row.attachments),
        internal_date=row.internal_date,
        prospect_id=row.prospect_id,
        prospect_name=_prospect_name(row.prospect),
        in_pipeline=in_pipeline,
    )


@router.get("/status", response_model=GmailStatus)
def gmail_status(db: Session = Depends(get_db)):
    """Whether the mailbox is connected, and whether it is actually syncing.

    Reports last_error explicitly: a mailbox whose token was revoked looks
    exactly like a quiet one from the message list alone.
    """
    client = GmailClient()
    account = db.scalar(select(GmailAccount))
    if account is None:
        return GmailStatus(connected=False, configured=client.configured)

    total = db.scalar(
        select(func.count()).select_from(EmailMessage).where(
            EmailMessage.account_id == account.id
        )
    )
    unread = db.scalar(
        select(func.count()).select_from(EmailMessage).where(
            EmailMessage.account_id == account.id,
            EmailMessage.is_unread.is_(True),
            EmailMessage.is_sent.is_(False),
        )
    )
    return GmailStatus(
        connected=account.sync_enabled and not account.last_error,
        configured=client.configured,
        email_address=account.email_address,
        last_synced_at=account.last_synced_at,
        last_error=account.last_error,
        history_id=account.history_id,
        total_emails=total or 0,
        unread_count=unread or 0,
        full_sync_count=account.full_sync_count,
    )


@router.get("", response_model=list[MailListItem])
def list_mail(
    db: Session = Depends(get_db),
    filter: str = Query("prospects", pattern="^(all|prospects|unread|sent)$"),
    search: str | None = Query(None, max_length=200),
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
):
    """The mailbox, newest first.

    Defaults to `prospects` rather than `all`: this is a CRM inbox, and the
    common case is wanting the conversations that matter, not the receipts.
    """
    stmt = select(EmailMessage).options(selectinload(EmailMessage.prospect))

    if filter == "prospects":
        stmt = stmt.where(EmailMessage.prospect_id.isnot(None))
    elif filter == "unread":
        stmt = stmt.where(
            EmailMessage.is_unread.is_(True), EmailMessage.is_sent.is_(False)
        )
    elif filter == "sent":
        stmt = stmt.where(EmailMessage.is_sent.is_(True))

    if search:
        like = f"%{search}%"
        stmt = stmt.where(
            or_(
                EmailMessage.subject.ilike(like),
                EmailMessage.from_address.ilike(like),
                EmailMessage.from_name.ilike(like),
                EmailMessage.snippet.ilike(like),
            )
        )

    rows = db.scalars(
        stmt.order_by(EmailMessage.internal_date.desc()).limit(limit).offset(offset)
    ).all()

    # One query for pipeline membership rather than one per row.
    linked = set(
        db.scalars(
            select(Message.email_message_id).where(
                Message.email_message_id.in_([r.id for r in rows] or [None])
            )
        ).all()
    )
    return [_to_item(row, row.id in linked) for row in rows]


@router.get("/{email_id}", response_model=MailDetail)
def get_mail(email_id: uuid.UUID, db: Session = Depends(get_db), images: bool = False):
    """One email, with its HTML sanitised.

    Images are off unless explicitly asked for: remote images in email are
    predominantly tracking pixels, and loading one tells the sender the mail
    was opened.
    """
    row = db.scalar(
        select(EmailMessage)
        .options(selectinload(EmailMessage.prospect))
        .where(EmailMessage.id == email_id)
    )
    if row is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Email not found")

    safe_html, blocked = sanitize_email_html(row.body_html, allow_images=images)
    in_pipeline = bool(
        db.scalar(select(Message).where(Message.email_message_id == row.id))
    )

    base = _to_item(row, in_pipeline)
    return MailDetail(
        **base.model_dump(),
        body_text=row.body_text,
        body_html_safe=safe_html,
        blocked_images=blocked,
        cc_addresses=row.cc_addresses or [],
        reply_to=row.reply_to,
        attachments=row.attachments or [],
        label_ids=row.label_ids or [],
    )


@router.post("/sync", status_code=status.HTTP_202_ACCEPTED)
def trigger_sync(db: Session = Depends(get_db)):
    """Sync on demand, for when five minutes is too long to wait."""
    from app.services import gmail_sync

    client = GmailClient()
    if not client.configured:
        raise HTTPException(
            status.HTTP_400_BAD_REQUEST, "Gmail is not configured on this server"
        )
    try:
        inbound = gmail_sync.sync(db, client)
        db.commit()
    except Exception as exc:  # noqa: BLE001 - surfaced to the caller as-is
        db.commit()  # keep the error recorded on the account row
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, str(exc)[:300]) from exc
    return {"new_pipeline_messages": len(inbound)}
