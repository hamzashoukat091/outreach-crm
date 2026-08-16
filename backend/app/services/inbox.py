"""Inbound mail: fetching it and attaching it to the right conversation.

Two sources behind one interface. ImapSource is the real thing, pointed at the
user's mailbox via the AutomationSettings imap_* fields. MailpitSource exists
because Mailpit -- the dev catcher -- speaks no IMAP at all, only a REST API;
it is selected automatically whenever no IMAP host is configured, so the whole
reply pipeline is exercisable locally without a real mailbox.

Both yield the same InboundEmail dataclass, and ingest() neither knows nor
cares which one produced it.
"""

import email
import email.policy
import imaplib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parseaddr, parsedate_to_datetime
from typing import Protocol

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings as env_settings
from app.models import (
    AutomationSettings,
    EnrollmentState,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    Prospect,
    SequenceEnrollment,
)
from app.services.sequencer import on_bounce

logger = logging.getLogger("outreach.inbox")


@dataclass
class InboundEmail:
    message_id: str
    in_reply_to: str | None
    references: str | None
    from_address: str
    to_address: str
    subject: str
    text_body: str
    date: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


class InboxSource(Protocol):
    def fetch_new(self) -> list[InboundEmail]: ...


def get_inbox_source(settings_row: AutomationSettings) -> "InboxSource":
    """IMAP when the user configured a mailbox, Mailpit otherwise."""
    if (settings_row.imap_host or "").strip():
        return ImapSource(settings_row)
    return MailpitSource()


# ---------- Mailpit (dev) ----------


class MailpitSource:
    """Polls Mailpit's REST API and marks what it ingests as read.

    Read flags, not deletion: Mailpit is the only window onto what the engine
    actually put on the wire, and deleting made sent mail vanish seconds after
    it appeared -- including our own outbound, which ingest() ignores anyway.
    Only unread mail is fetched, so the flag is the dedupe; the dedupe_key
    constraint in ingest() remains the backstop if a crash lands between fetch
    and flag.
    """

    def __init__(self, base_url: str | None = None) -> None:
        self.base_url = (base_url or env_settings.mailpit_api_url).rstrip("/")

    def fetch_new(self) -> list[InboundEmail]:
        results: list[InboundEmail] = []
        ingested_ids: list[str] = []

        with httpx.Client(base_url=self.base_url, timeout=15.0) as client:
            # Only unread: read mail has already been through ingest(), so
            # refetching it would just re-run the dedupe check every tick.
            listing = client.get(
                "/api/v1/search", params={"query": "is:unread", "limit": 50}
            )
            listing.raise_for_status()
            for summary in listing.json().get("messages") or []:
                mailpit_id = summary["ID"]
                try:
                    detail = client.get(f"/api/v1/message/{mailpit_id}")
                    detail.raise_for_status()
                    headers = client.get(f"/api/v1/message/{mailpit_id}/headers")
                    headers.raise_for_status()
                    results.append(self._to_inbound(detail.json(), headers.json()))
                    ingested_ids.append(mailpit_id)
                except Exception:  # noqa: BLE001 - one bad message must not block the rest
                    logger.exception("failed to fetch mailpit message %s", mailpit_id)

            if ingested_ids:
                # Mark read so the next poll skips them, but leave the mail in
                # place: Mailpit is how you see what the engine actually sent.
                client.put(
                    "/api/v1/messages", json={"IDs": ingested_ids, "Read": True}
                ).raise_for_status()

        return results

    @staticmethod
    def _header(headers: dict, name: str) -> str | None:
        # Mailpit returns {Header-Name: [values]} with canonical casing.
        for key, values in (headers or {}).items():
            if key.lower() == name.lower() and values:
                return values[0]
        return None

    def _to_inbound(self, detail: dict, headers: dict) -> InboundEmail:
        sender = (detail.get("From") or {}).get("Address") or ""
        to_list = detail.get("To") or []
        recipient = to_list[0].get("Address") if to_list else ""

        date = datetime.now(timezone.utc)
        raw_date = detail.get("Date")
        if raw_date:
            try:
                date = datetime.fromisoformat(raw_date.replace("Z", "+00:00"))
            except ValueError:
                pass

        return InboundEmail(
            message_id=self._header(headers, "Message-Id")
            or detail.get("MessageID")
            or "",
            in_reply_to=self._header(headers, "In-Reply-To"),
            references=self._header(headers, "References"),
            from_address=sender.lower(),
            to_address=(recipient or "").lower(),
            subject=detail.get("Subject") or "",
            text_body=detail.get("Text") or "",
            date=date,
        )


# ---------- IMAP (production) ----------


class ImapSource:
    """Real mailbox polling over IMAP, for when the user connects their own
    account. Unseen mail is fetched and thereby marked seen, which is what
    keeps it from being re-ingested."""

    def __init__(self, settings_row: AutomationSettings) -> None:
        self.host = settings_row.imap_host or ""
        self.port = settings_row.imap_port or (993 if settings_row.imap_use_ssl else 143)
        self.username = settings_row.imap_username or ""
        self.password = settings_row.imap_password or ""
        self.use_ssl = settings_row.imap_use_ssl
        self.folder = settings_row.imap_folder or "INBOX"

    def fetch_new(self) -> list[InboundEmail]:
        results: list[InboundEmail] = []

        if self.use_ssl:
            conn = imaplib.IMAP4_SSL(self.host, self.port)
        else:
            conn = imaplib.IMAP4(self.host, self.port)
        try:
            conn.login(self.username, self.password)
            conn.select(self.folder)
            status, data = conn.search(None, "UNSEEN")
            if status != "OK":
                return results

            for num in data[0].split():
                # Fetching BODY[] sets \Seen, which is the "already ingested" marker.
                status, parts = conn.fetch(num, "(RFC822)")
                if status != "OK" or not parts or not isinstance(parts[0], tuple):
                    continue
                try:
                    results.append(self._parse(parts[0][1]))
                except Exception:  # noqa: BLE001
                    logger.exception("failed to parse IMAP message %s", num)
        finally:
            try:
                conn.logout()
            except Exception:  # noqa: BLE001
                pass

        return results

    @staticmethod
    def _parse(raw: bytes) -> InboundEmail:
        msg = email.message_from_bytes(raw, policy=email.policy.default)

        body = ""
        text_part = msg.get_body(preferencelist=("plain",))
        if text_part is not None:
            body = text_part.get_content()
        elif (html := msg.get_body(preferencelist=("html",))) is not None:
            body = html.get_content()  # better than nothing; classifier copes

        date = datetime.now(timezone.utc)
        if msg.get("Date"):
            try:
                date = parsedate_to_datetime(msg["Date"])
            except (TypeError, ValueError):
                pass

        return InboundEmail(
            message_id=(msg.get("Message-Id") or "").strip(),
            in_reply_to=(msg.get("In-Reply-To") or "").strip() or None,
            references=(msg.get("References") or "").strip() or None,
            from_address=parseaddr(msg.get("From") or "")[1].lower(),
            to_address=parseaddr(msg.get("To") or "")[1].lower(),
            subject=msg.get("Subject") or "",
            text_body=body,
            date=date,
        )


# ---------- Ingestion ----------

BOUNCE_SENDERS = ("mailer-daemon@", "postmaster@")
BOUNCE_SUBJECTS = ("undelivered", "delivery status")


def _looks_like_bounce(inbound: InboundEmail) -> bool:
    sender = inbound.from_address.lower()
    if any(sender.startswith(prefix) for prefix in BOUNCE_SENDERS):
        return True
    return inbound.subject.lower().startswith(BOUNCE_SUBJECTS)


def _referenced_ids(inbound: InboundEmail) -> list[str]:
    ids: list[str] = []
    if inbound.in_reply_to:
        ids.append(inbound.in_reply_to.strip())
    for ref in (inbound.references or "").split():
        if ref.strip() and ref.strip() not in ids:
            ids.append(ref.strip())
    return ids


def _match_enrollment(db: Session, inbound: InboundEmail) -> SequenceEnrollment | None:
    """Headers first, address second.

    In-Reply-To/References carry the message ids we generated at send time, so
    a header match is authoritative. The address fallback covers clients that
    strip threading headers: the newest open enrollment for that prospect.
    """
    ref_ids = _referenced_ids(inbound)
    if ref_ids:
        ours = db.scalar(
            select(Message)
            .where(Message.rfc_message_id.in_(ref_ids), Message.enrollment_id.isnot(None))
            .order_by(Message.created_at.desc())
        )
        if ours:
            return ours.enrollment

    if inbound.from_address:
        prospect = db.scalar(select(Prospect).where(Prospect.email == inbound.from_address))
        if prospect:
            return db.scalar(
                select(SequenceEnrollment)
                .where(
                    SequenceEnrollment.prospect_id == prospect.id,
                    SequenceEnrollment.state.in_(
                        (EnrollmentState.active, EnrollmentState.paused)
                    ),
                )
                .order_by(SequenceEnrollment.enrolled_at.desc())
            )
    return None


def ingest(db: Session, inbound: InboundEmail) -> Message | None:
    """Store one inbound email as a Message row and return it for the replier.

    Returns None when there is nothing left for the caller to do: duplicates,
    mail from strangers, and bounces (which are handled to completion here --
    stored, enrollment bounced, address suppressed)."""
    dedupe_key = inbound.message_id.strip() or (
        # No Message-Id at all (rare, broken senders): synthesize something
        # stable enough to catch the same mail arriving twice.
        f"{inbound.from_address}|{inbound.date.isoformat()}|{inbound.subject[:100]}"
    )
    if db.scalar(select(Message).where(Message.dedupe_key == dedupe_key)):
        logger.info("skipping duplicate inbound %s", dedupe_key)
        return None

    # Our own sends, echoed back. Mailpit catches OUTBOUND mail, so polling it
    # as an inbox necessarily re-fetches what we just delivered; recognising
    # our own Message-Id keeps a follow-up from being "matched" to its own
    # thread and classified as a prospect reply.
    if inbound.message_id and db.scalar(
        select(Message).where(
            Message.rfc_message_id == inbound.message_id,
            Message.direction == MessageDirection.outbound,
        )
    ):
        logger.debug("skipping echo of our own send %s", inbound.message_id)
        return None

    is_bounce = _looks_like_bounce(inbound)
    enrollment = _match_enrollment(db, inbound)

    if is_bounce:
        if not enrollment:
            # A bounce we cannot tie to anything we sent teaches us nothing.
            logger.warning("unmatched bounce from %s ignored", inbound.from_address)
            return None
        _store(db, inbound, enrollment.prospect_id, enrollment, dedupe_key)
        on_bounce(db, enrollment, detail=inbound.subject)
        return None

    if enrollment:
        prospect_id = enrollment.prospect_id
    else:
        prospect = (
            db.scalar(select(Prospect).where(Prospect.email == inbound.from_address))
            if inbound.from_address
            else None
        )
        if not prospect:
            logger.info("ignoring mail from unknown sender %s", inbound.from_address)
            return None
        prospect_id = prospect.id

    return _store(db, inbound, prospect_id, enrollment, dedupe_key)


def _store(db, inbound, prospect_id, enrollment, dedupe_key) -> Message:
    message = Message(
        prospect_id=prospect_id,
        # Via the relationship so a loaded enrollment.messages stays truthful.
        enrollment=enrollment,
        direction=MessageDirection.inbound,
        kind=MessageKind.incoming,
        state=MessageState.received,
        subject=inbound.subject[:500],
        body=inbound.text_body,
        from_address=inbound.from_address[:320],
        to_address=inbound.to_address[:320],
        rfc_message_id=inbound.message_id[:400] or None,
        in_reply_to=(inbound.in_reply_to or "")[:400] or None,
        references=inbound.references,
        dedupe_key=dedupe_key[:400],
        received_at=inbound.date,
    )
    db.add(message)
    db.flush()
    return message
