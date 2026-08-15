"""Delivery of automation messages.

Distinct from services.mailer (the manual side's console/SMTP toggle): these
sends carry RFC threading headers, retry bookkeeping, and a dry-run mode that
exercises every code path except the socket -- so a rehearsal run produces
exactly the rows, events, and rate-limit pressure a live run would.
"""

import logging
import smtplib
import uuid
from datetime import datetime, timezone
from email.message import EmailMessage
from email.utils import formataddr

from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.models import (
    AutomationSettings,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    ProspectEventType,
)

logger = logging.getLogger("outreach.smtp_sender")

MAX_ATTEMPTS = 3


class SendError(Exception):
    pass


def _resolve_transport(settings_row: AutomationSettings) -> dict:
    """The user's SMTP settings, falling back to the env-configured Mailpit.

    The fallback is all-or-nothing: mixing the user's username with Mailpit's
    host would be nonsense, so an empty smtp_host means the whole env block.
    """
    if settings_row.smtp_host:
        return {
            "host": settings_row.smtp_host,
            "port": settings_row.smtp_port or 587,
            "username": settings_row.smtp_username or "",
            "password": settings_row.smtp_password or "",
            "use_tls": settings_row.smtp_use_tls,
        }
    return {
        "host": env_settings.smtp_host,
        "port": env_settings.smtp_port,
        "username": env_settings.smtp_user,
        "password": env_settings.smtp_password,
        "use_tls": env_settings.smtp_use_tls,
    }


def _from_parts(settings_row: AutomationSettings) -> tuple[str, str]:
    address = settings_row.from_address or env_settings.mail_from
    name = settings_row.from_name or env_settings.mail_from_name
    return name, address


def _make_message_id(from_address: str) -> str:
    domain = from_address.split("@")[-1] or "localhost"
    return f"<{uuid.uuid4().hex}@{domain}>"


def _thread_headers(message: Message) -> tuple[str | None, str | None]:
    """(in_reply_to, references) from the enrollment's history.

    References accumulate every message id in the thread in order; In-Reply-To
    points at the most recent one. This is what makes the prospect's mail
    client show one conversation instead of five cold emails.
    """
    enrollment = message.enrollment
    if not enrollment:
        return None, None

    ids = [
        m.rfc_message_id
        for m in sorted(
            enrollment.messages,
            key=lambda m: (m.sent_at or m.received_at or m.created_at or datetime.min),
        )
        if m.rfc_message_id and m.id != message.id
    ]
    if not ids:
        return None, None
    return ids[-1], " ".join(ids)


def _sent_event_type(message: Message) -> ProspectEventType:
    if message.kind == MessageKind.reply:
        return ProspectEventType.reply_sent
    return ProspectEventType.message_sent


def send(db: Session, message: Message, settings_row: AutomationSettings) -> bool:
    """Deliver one outbound message. Returns True when it is now 'sent'.

    Failures are absorbed into the row: attempts is bumped, the error stored,
    and after MAX_ATTEMPTS the state flips to 'failed'. The caller never needs
    a try/except.
    """
    from app.services.sequencer import log_event  # circular-import guard

    if message.direction != MessageDirection.outbound:
        raise SendError("Only outbound messages can be sent")
    if not message.body:
        raise SendError("Refusing to send a message with no body")

    from_name, from_address = _from_parts(settings_row)
    rfc_id = _make_message_id(from_address)
    in_reply_to, references = _thread_headers(message)

    message.from_address = from_address
    message.rfc_message_id = rfc_id
    message.in_reply_to = in_reply_to
    message.references = references

    enrollment = message.enrollment
    if enrollment and not enrollment.thread_root_message_id:
        enrollment.thread_root_message_id = rfc_id

    if settings_row.dry_run:
        # Everything except the socket: headers, thread bookkeeping, state,
        # events. The pipeline must be indistinguishable from live so dry-run
        # actually rehearses it.
        message.simulated = True
        message.state = MessageState.sent
        message.sent_at = datetime.now(timezone.utc)
        if enrollment:
            enrollment.last_activity_at = message.sent_at
        log_event(
            db,
            message.prospect_id,
            _sent_event_type(message),
            f"[dry run] Would send: {message.subject}",
            {"message_id": str(message.id), "simulated": True},
        )
        db.flush()
        logger.info("[dry-run] simulated send to=%s subject=%r", message.to_address, message.subject)
        return True

    email = EmailMessage()
    email["From"] = formataddr((from_name, from_address))
    email["To"] = message.to_address
    email["Subject"] = message.subject or ""
    email["Message-ID"] = rfc_id
    if in_reply_to:
        email["In-Reply-To"] = in_reply_to
    if references:
        email["References"] = references
    if settings_row.reply_to:
        email["Reply-To"] = settings_row.reply_to
    email.set_content(message.body)

    transport = _resolve_transport(settings_row)
    message.attempts += 1

    try:
        with smtplib.SMTP(transport["host"], transport["port"], timeout=30) as server:
            if transport["use_tls"]:
                server.starttls()
            if transport["username"]:
                server.login(transport["username"], transport["password"])
            server.send_message(email)
    except Exception as exc:  # noqa: BLE001 - every transport failure lands in the row
        message.error = str(exc)[:2000]
        if message.attempts >= MAX_ATTEMPTS:
            message.state = MessageState.failed
            log_event(
                db,
                message.prospect_id,
                ProspectEventType.message_failed,
                f"Send failed after {message.attempts} attempts: {message.subject}",
                {"message_id": str(message.id), "error": message.error},
            )
            logger.error("send failed permanently id=%s: %s", message.id, exc)
        else:
            # Back to scheduled; the next worker tick retries.
            message.state = MessageState.scheduled
            logger.warning("send attempt %s failed id=%s: %s", message.attempts, message.id, exc)
        db.flush()
        return False

    message.error = None
    message.simulated = False
    message.state = MessageState.sent
    message.sent_at = datetime.now(timezone.utc)
    if enrollment:
        enrollment.last_activity_at = message.sent_at
    log_event(
        db,
        message.prospect_id,
        _sent_event_type(message),
        f"Sent: {message.subject}",
        {"message_id": str(message.id)},
    )
    db.flush()
    logger.info("sent id=%s to=%s subject=%r", message.id, message.to_address, message.subject)
    return True
