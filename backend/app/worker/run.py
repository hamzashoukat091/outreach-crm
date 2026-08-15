"""Background automation loop.

One process, three phases per tick: draft what is due soon, send what is due
now, poll the inbox. Each phase runs in its own session and its own try/except
so a Claude outage cannot stop sends and an SMTP outage cannot stop drafting.
The SKIP LOCKED claims mean a second replica could be added later without any
code change.
"""

import logging
import random
import signal
import sys
import time
from datetime import datetime, timedelta, timezone
from types import FrameType

from sqlalchemy import select

from app.core.config import settings
from app.core.db import SessionLocal
from app.models import (
    EnrollmentState,
    Message,
    MessageDirection,
    MessageKind,
    MessageState,
    ProspectEventType,
)
from app.services import smtp_sender
from app.services.automation_settings import (
    get_settings_row,
    is_suppressed,
    next_window_open,
    sends_in_last_day,
    sends_in_last_hour,
    within_send_window,
)
from app.services.generator import GenerationError
from app.services.inbox import get_inbox_source, ingest
from app.services.replier import handle_inbound
from app.services.sequencer import SEQUENCE_KINDS, advance, draft_message, log_event

logging.basicConfig(
    level=logging.INFO, format="%(asctime)s %(levelname)s [%(name)s] %(message)s"
)
logger = logging.getLogger("outreach.worker")

_running = True
# Messages are drafted this far ahead of their send time, so a Claude outage
# shorter than the head start never delays a send.
DRAFT_HORIZON = timedelta(hours=24)


def _shutdown(signum: int, _frame: FrameType | None) -> None:
    global _running
    logger.info("received signal %s, finishing current tick then exiting", signum)
    _running = False


def _heartbeat() -> None:
    with SessionLocal() as db:
        row = get_settings_row(db)
        row.worker_heartbeat_at = datetime.now(timezone.utc)
        db.commit()


def draft_due_messages() -> None:
    """Phase A: write every queued message whose send time is inside the
    drafting horizon."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        rows = (
            db.scalars(
                select(Message)
                .where(
                    Message.state == MessageState.drafting,
                    Message.direction == MessageDirection.outbound,
                    Message.scheduled_for <= now + DRAFT_HORIZON,
                )
                .order_by(Message.scheduled_for)
                .limit(settings.send_batch_size)
                .with_for_update(skip_locked=True)
            )
            .all()
        )

        for message in rows:
            try:
                draft_message(db, message)
                db.commit()
                logger.info("drafted message %s (%s)", message.id, message.kind.value)
            except GenerationError as exc:
                # Leave it in 'drafting'; the next tick retries. The scheduled
                # time still gates the actual send, so a long Claude outage
                # delays mail rather than losing it.
                db.rollback()
                logger.warning("drafting %s failed: %s", message.id, exc)
            except Exception:
                db.rollback()
                logger.exception("unexpected error drafting %s", message.id)


def send_due_messages() -> None:
    """Phase B: put scheduled messages on the wire, guardrails first."""
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        settings_row = get_settings_row(db)

        if settings_row.sending_paused:
            return

        rows = (
            db.scalars(
                select(Message)
                .where(
                    Message.state == MessageState.scheduled,
                    Message.direction == MessageDirection.outbound,
                    Message.scheduled_for <= now,
                )
                .order_by(Message.scheduled_for)
                .limit(settings.send_batch_size)
                .with_for_update(skip_locked=True)
            )
            .all()
        )
        if not rows:
            return

        hourly_used = sends_in_last_hour(db, now)
        daily_used = sends_in_last_day(db, now)

        for message in rows:
            # A paused enrollment holds its mail without cancelling it.
            if message.enrollment and message.enrollment.state == EnrollmentState.paused:
                continue

            # Replies ignore the window -- answering in the evening is what a
            # person would do -- but sequence sends wait for office hours.
            if message.kind in SEQUENCE_KINDS and not within_send_window(settings_row, now):
                message.scheduled_for = next_window_open(settings_row, now)
                db.commit()
                logger.info(
                    "deferred %s to window open %s", message.id, message.scheduled_for
                )
                continue

            if (
                hourly_used >= settings_row.hourly_send_limit
                or daily_used >= settings_row.daily_send_limit
            ):
                # Limits exhausted: leave the rest scheduled for the next tick.
                logger.info(
                    "rate limit reached (hour %s/%s, day %s/%s); pausing sends",
                    hourly_used,
                    settings_row.hourly_send_limit,
                    daily_used,
                    settings_row.daily_send_limit,
                )
                db.commit()
                break

            if is_suppressed(db, message.to_address or ""):
                message.state = MessageState.cancelled
                log_event(
                    db,
                    message.prospect_id,
                    ProspectEventType.suppressed,
                    "Send cancelled: address is suppressed",
                    {"message_id": str(message.id)},
                )
                db.commit()
                continue

            message.state = MessageState.sending
            db.commit()

            ok = smtp_sender.send(db, message, settings_row)
            if ok:
                hourly_used += 1
                daily_used += 1
                if message.kind in SEQUENCE_KINDS and message.enrollment:
                    advance(db, message.enrollment)
            db.commit()

            # Human-ish spacing between sends, and a natural yield point.
            time.sleep(random.uniform(1.0, 5.0))


_last_poll: datetime | None = None


def poll_inbox() -> None:
    """Phase C: fetch new mail, store it, and let the replier act on it."""
    global _last_poll
    now = datetime.now(timezone.utc)

    with SessionLocal() as db:
        settings_row = get_settings_row(db)
        interval = max(10, settings_row.imap_poll_seconds)
        if _last_poll and (now - _last_poll).total_seconds() < interval:
            return
        _last_poll = now

        source = get_inbox_source(settings_row)
        try:
            inbound_batch = source.fetch_new()
        except Exception:
            logger.exception("inbox fetch failed (%s)", type(source).__name__)
            return

        for inbound in inbound_batch:
            try:
                # ingest returns None for duplicates, strangers, and bounces
                # (bounces are handled to completion inside it).
                stored = ingest(db, inbound)
                db.commit()
                if stored is not None and stored.kind == MessageKind.incoming:
                    handle_inbound(db, stored, settings_row)
                    db.commit()
            except Exception:
                db.rollback()
                logger.exception("failed handling inbound %s", inbound.message_id)


def main() -> int:
    signal.signal(signal.SIGTERM, _shutdown)
    signal.signal(signal.SIGINT, _shutdown)

    logger.info(
        "automation worker started (interval=%ss, batch=%s)",
        settings.worker_interval_seconds,
        settings.send_batch_size,
    )

    while _running:
        for phase in (_heartbeat, draft_due_messages, send_due_messages, poll_inbox):
            if not _running:
                break
            try:
                phase()
            except Exception:  # noqa: BLE001 - one bad phase must not kill the loop
                logger.exception("%s failed; continuing", phase.__name__)

        # Sleep in slices so SIGTERM is honored promptly.
        for _ in range(settings.worker_interval_seconds):
            if not _running:
                break
            time.sleep(1)

    logger.info("worker stopped")
    return 0


if __name__ == "__main__":
    sys.exit(main())
