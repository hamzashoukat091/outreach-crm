"""Keeping the stored mailbox in step with Gmail.

Two modes. Full sync walks a window of message ids and stores them; partial
sync asks history.list what changed since the stored cursor. Partial is the
normal path -- full runs once at connect, and again whenever the cursor ages
out of Gmail's ~1 week history retention.

The cursor is only advanced after a batch commits. A crash mid-sync therefore
re-fetches rather than skips, and the unique index on (account_id, gmail_id)
turns that re-fetch into a no-op.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.models import (
    EmailMessage,
    EnrollmentState,
    GmailAccount,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    Prospect,
    SequenceEnrollment,
)
from app.services.gmail import (
    GmailAuthError,
    GmailClient,
    GmailError,
    HistoryExpired,
    ParsedEmail,
)

logger = logging.getLogger("outreach.gmail_sync")


def get_account(db: Session) -> GmailAccount | None:
    return db.scalar(select(GmailAccount))


def ensure_account(db: Session, email_address: str) -> GmailAccount:
    """The single account row, created on first use.

    Address changes are handled by updating in place rather than inserting:
    the singleton index would reject a second row, and re-pointing at another
    mailbox should reset the cursor anyway.
    """
    account = get_account(db)
    if account is None:
        account = GmailAccount(email_address=email_address.lower())
        db.add(account)
        db.flush()
        logger.info("created gmail account row for %s", email_address)
    elif account.email_address != email_address.lower():
        logger.warning(
            "gmail address changed %s -> %s; resetting cursor",
            account.email_address,
            email_address,
        )
        account.email_address = email_address.lower()
        account.history_id = None
    return account


def _match_prospect(db: Session, parsed: ParsedEmail) -> Prospect | None:
    """The prospect this email belongs to, if any.

    For received mail that is the sender. For mail we sent, the sender is us,
    so the prospect is on the recipient side -- without this, every outbound
    message would be unattributed and the thread would show only one half.
    """
    if parsed.is_sent:
        for address in parsed.to_addresses:
            found = db.scalar(select(Prospect).where(Prospect.email == address))
            if found:
                return found
        return None
    if not parsed.from_address:
        return None
    return db.scalar(select(Prospect).where(Prospect.email == parsed.from_address))


def store_email(db: Session, account: GmailAccount, parsed: ParsedEmail) -> tuple[EmailMessage, bool]:
    """Upsert one email. Returns (row, created).

    Existing rows are refreshed rather than skipped: labels change over the
    life of a message (UNREAD clears when you read it elsewhere) and the
    inbox should reflect that.
    """
    existing = db.scalar(
        select(EmailMessage).where(
            EmailMessage.account_id == account.id,
            EmailMessage.gmail_id == parsed.gmail_id,
        )
    )
    if existing is not None:
        existing.label_ids = parsed.label_ids
        existing.is_unread = parsed.is_unread
        return existing, False

    prospect = _match_prospect(db, parsed)
    row = EmailMessage(
        account_id=account.id,
        gmail_id=parsed.gmail_id,
        gmail_thread_id=parsed.gmail_thread_id,
        rfc_message_id=(parsed.rfc_message_id or "")[:400] or None,
        in_reply_to=(parsed.in_reply_to or "")[:400] or None,
        references=parsed.references,
        from_address=parsed.from_address[:320] or None,
        from_name=parsed.from_name[:300] or None,
        to_addresses=parsed.to_addresses,
        cc_addresses=parsed.cc_addresses,
        reply_to=parsed.reply_to,
        subject=parsed.subject,
        snippet=parsed.snippet,
        body_text=parsed.body_text,
        body_html=parsed.body_html,
        attachments=parsed.attachments,
        label_ids=parsed.label_ids,
        is_unread=parsed.is_unread,
        is_sent=parsed.is_sent,
        is_draft=parsed.is_draft,
        prospect_id=prospect.id if prospect else None,
        internal_date=parsed.internal_date,
    )
    db.add(row)
    db.flush()
    return row, True


def _already_in_pipeline(db: Session, parsed: ParsedEmail, row: EmailMessage) -> bool:
    """True when this email is one we sent, or has already been ingested.

    Two distinct cases with the same answer. Mail we sent comes back through
    sync because SENT lives in the same mailbox; treating it as a reply would
    have the classifier reading our own copy. And a message already linked to
    a pipeline row must not be linked twice.
    """
    if parsed.is_sent or parsed.is_draft:
        return True
    if db.scalar(select(Message).where(Message.email_message_id == row.id)):
        return True
    if parsed.rfc_message_id and db.scalar(
        select(Message).where(
            Message.rfc_message_id == parsed.rfc_message_id,
            Message.direction == MessageDirection.outbound,
        )
    ):
        return True
    return False


def _match_enrollment(
    db: Session, parsed: ParsedEmail, prospect_id
) -> SequenceEnrollment | None:
    """The sequence run this reply belongs to, if any.

    Thread id first: Google assigns it and it is exact, where RFC header
    parsing is a reconstruction. The header route stays as a fallback for
    mail that reached the thread from outside Gmail, and the newest open
    enrollment last, for clients that strip threading headers entirely.

    Without this the reply is stored but detached: approvals cannot show what
    it answers, the conversation view has no thread, and -- worst -- the
    sequence keeps running, so someone who replied still receives the
    "you did not reply" follow-up.
    """
    ours = db.scalar(
        select(Message)
        .where(
            Message.gmail_thread_id == parsed.gmail_thread_id,
            Message.enrollment_id.isnot(None),
        )
        .order_by(Message.created_at.desc())
    )
    if ours is not None:
        return ours.enrollment

    ref_ids = [r.strip() for r in (parsed.references or "").split() if r.strip()]
    if parsed.in_reply_to:
        ref_ids.insert(0, parsed.in_reply_to.strip())
    if ref_ids:
        ours = db.scalar(
            select(Message)
            .where(
                Message.rfc_message_id.in_(ref_ids),
                Message.enrollment_id.isnot(None),
            )
            .order_by(Message.created_at.desc())
        )
        if ours is not None:
            return ours.enrollment

    if prospect_id is None:
        return None
    return db.scalar(
        select(SequenceEnrollment)
        .where(
            SequenceEnrollment.prospect_id == prospect_id,
            SequenceEnrollment.state.in_(
                (EnrollmentState.active, EnrollmentState.paused)
            ),
        )
        .order_by(SequenceEnrollment.enrolled_at.desc())
    )


def to_inbound_message(db: Session, row: EmailMessage, parsed: ParsedEmail) -> Message | None:
    """Create the pipeline row for a prospect reply, or None.

    Only mail from a known prospect enters the pipeline. Everything else is
    still stored and still visible in the inbox -- it simply has nothing to
    classify against.
    """
    if row.prospect_id is None:
        return None
    if _already_in_pipeline(db, parsed, row):
        return None

    enrollment = _match_enrollment(db, parsed, row.prospect_id)

    message = Message(
        prospect_id=row.prospect_id,
        # Via the relationship so an already-loaded enrollment.messages sees
        # it without a round-trip -- handle_inbound reads that collection.
        enrollment=enrollment,
        direction=MessageDirection.inbound,
        kind=MessageKind.incoming,
        state=MessageState.received,
        subject=(parsed.subject or "")[:500],
        body=parsed.body_text or parsed.snippet or "",
        from_address=parsed.from_address[:320] or None,
        # Message stores a single recipient; the full list stays on the
        # EmailMessage row this one links to.
        to_address=(parsed.to_addresses[0] if parsed.to_addresses else None),
        rfc_message_id=(parsed.rfc_message_id or "")[:400] or None,
        in_reply_to=(parsed.in_reply_to or "")[:400] or None,
        references=parsed.references,
        # Gmail's id is assigned by Google and always present, unlike the RFC
        # Message-Id the old IMAP path had to synthesise for broken senders.
        dedupe_key=f"gmail:{parsed.gmail_id}"[:400],
        received_at=parsed.internal_date,
        email_message_id=row.id,
        gmail_thread_id=parsed.gmail_thread_id,
    )
    db.add(message)
    db.flush()
    return message


def _full_sync(db: Session, client: GmailClient, account: GmailAccount) -> list[tuple[EmailMessage, ParsedEmail]]:
    """Walk a window of the mailbox from scratch."""
    since = datetime.now(timezone.utc) - timedelta(days=env_settings.gmail_initial_sync_days)
    query = f"after:{since.strftime('%Y/%m/%d')}"
    ids = client.list_message_ids(query=query, max_results=env_settings.gmail_max_full_sync)
    logger.info("full sync: %s messages in the last %sd", len(ids), env_settings.gmail_initial_sync_days)

    account.full_sync_count += 1
    stored: list[tuple[EmailMessage, ParsedEmail]] = []
    for gmail_id in ids:
        parsed = client.get_message(gmail_id)
        row, created = store_email(db, account, parsed)
        if created:
            stored.append((row, parsed))

    # The cursor comes from the profile, not from the messages: it is the
    # mailbox's current position, which is what history.list expects next.
    account.history_id = int(client.profile()["historyId"])
    return stored


def _partial_sync(db: Session, client: GmailClient, account: GmailAccount) -> list[tuple[EmailMessage, ParsedEmail]]:
    """Fetch only what changed since the cursor."""
    ids, latest = client.history_since(account.history_id)
    stored: list[tuple[EmailMessage, ParsedEmail]] = []
    for gmail_id in ids:
        parsed = client.get_message(gmail_id)
        row, created = store_email(db, account, parsed)
        if created:
            stored.append((row, parsed))
    if latest:
        account.history_id = latest
    return stored


def sync(db: Session, client: GmailClient | None = None) -> list[Message]:
    """Bring the stored mailbox up to date. Returns new inbound pipeline rows.

    The caller commits. Errors are recorded on the account row and re-raised
    so the worker can log them; a mailbox that stopped syncing is otherwise
    indistinguishable from a quiet one.
    """
    client = client or GmailClient()
    if not client.configured:
        return []

    address = env_settings.gmail_address or client.profile().get("emailAddress", "")
    account = ensure_account(db, address)
    if not account.sync_enabled:
        return []

    try:
        if account.history_id is None:
            stored = _full_sync(db, client, account)
        else:
            try:
                stored = _partial_sync(db, client, account)
            except HistoryExpired:
                # Expected roughly whenever the worker is down longer than
                # Gmail's history retention. Recover rather than fail.
                logger.warning("history cursor expired; falling back to a full sync")
                account.history_id = None
                stored = _full_sync(db, client, account)
    except GmailAuthError as exc:
        account.last_error = str(exc)[:2000]
        account.last_error_at = datetime.now(timezone.utc)
        raise
    except GmailError as exc:
        account.last_error = str(exc)[:2000]
        account.last_error_at = datetime.now(timezone.utc)
        raise

    inbound: list[Message] = []
    for row, parsed in stored:
        message = to_inbound_message(db, row, parsed)
        if message is not None:
            inbound.append(message)

    account.last_synced_at = datetime.now(timezone.utc)
    account.last_error = None
    account.last_error_at = None
    logger.info(
        "gmail sync: %s new emails, %s entered the pipeline (cursor=%s)",
        len(stored),
        len(inbound),
        account.history_id,
    )
    return inbound
