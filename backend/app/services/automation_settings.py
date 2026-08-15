"""Operator settings and the scheduling arithmetic built on them.

Everything that decides WHEN a message may go out lives here: the send window,
the day-of-week filter, the rate limits, and the suppression check. The
sequencer and the worker both call in, so the two can never disagree about
whether 6pm Friday is inside the window.
"""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import AutomationSettings, Message, MessageDirection, MessageState, Suppression


def get_settings_row(db: Session) -> AutomationSettings:
    """The settings are a single row; create it lazily so reads never 404.

    Migration 0006 inserts the row, but a test database built via create_all()
    starts empty -- this keeps both paths working.
    """
    row = db.scalar(select(AutomationSettings).limit(1))
    if not row:
        row = AutomationSettings()
        db.add(row)
        db.flush()
    return row


def is_suppressed(db: Session, email: str) -> bool:
    if not email:
        return True  # nowhere to send it anyway
    return (
        db.scalar(select(Suppression).where(Suppression.email == email.lower().strip()))
        is not None
    )


def _tz(settings_row: AutomationSettings) -> ZoneInfo:
    try:
        return ZoneInfo(settings_row.timezone or "UTC")
    except Exception:  # noqa: BLE001 - a typo'd timezone must not stop sending
        return ZoneInfo("UTC")


def _as_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def within_send_window(settings_row: AutomationSettings, now_utc: datetime) -> bool:
    """Is this instant inside the operator's send window?

    Evaluated in the operator's own timezone: a 9-17 window in Europe/Berlin
    means Berlin office hours regardless of where the server runs.
    """
    local = _as_utc(now_utc).astimezone(_tz(settings_row))
    if local.isoweekday() not in (settings_row.send_days or []):
        return False

    start, end = settings_row.send_window_start, settings_row.send_window_end
    t = local.time()
    if start <= end:
        return start <= t < end
    # Overnight window (e.g. 20:00-04:00) -- unusual but valid.
    return t >= start or t < end


def next_window_open(settings_row: AutomationSettings, from_dt: datetime) -> datetime:
    """The earliest instant at or after from_dt inside the window, as UTC.

    Returns from_dt unchanged when it is already inside. Scans day by day
    rather than doing calendar arithmetic so weekend gaps and single-day
    windows fall out naturally.
    """
    from_dt = _as_utc(from_dt)
    if within_send_window(settings_row, from_dt):
        return from_dt

    tz = _tz(settings_row)
    local = from_dt.astimezone(tz)
    send_days = settings_row.send_days or []
    if not send_days:
        # No send days at all is a misconfiguration; deferring forever would
        # silently strand every message, so pass through instead.
        return from_dt

    for offset in range(0, 8):
        day = (local + timedelta(days=offset)).date()
        if day.isoweekday() not in send_days:
            continue
        start_dt = datetime.combine(day, settings_row.send_window_start, tzinfo=tz)
        if start_dt > local:
            return start_dt.astimezone(timezone.utc)
        # Same day, but we're already past the start -- inside would have been
        # caught above, so we're past the end; try the next allowed day.
    return from_dt  # unreachable with a sane 1-7 send_days list


def sends_in_last_hour(db: Session, now_utc: datetime | None = None) -> int:
    return _sent_since(db, (now_utc or datetime.now(timezone.utc)) - timedelta(hours=1))


def sends_in_last_day(db: Session, now_utc: datetime | None = None) -> int:
    return _sent_since(db, (now_utc or datetime.now(timezone.utc)) - timedelta(days=1))


def _sent_since(db: Session, since: datetime) -> int:
    # Simulated (dry-run) sends count on purpose: the limiter must behave
    # identically in both modes or dry-run stops being a rehearsal.
    return (
        db.scalar(
            select(func.count(Message.id)).where(
                Message.direction == MessageDirection.outbound,
                Message.state == MessageState.sent,
                Message.sent_at >= since,
            )
        )
        or 0
    )


def resolve_send_time(
    settings_row: AutomationSettings,
    mode: str,
    send_at: datetime | None = None,
    step_time: time | None = None,
) -> datetime:
    """When should an enrollment's first message go out? Returns UTC.

    - send_now: immediately (the worker still applies window/limits at send).
    - send_at: exactly the instant the user picked -- their explicit choice
      overrides the window.
    - draft_now_send_later: default_delay_days out, at the step's send time
      (falling back to the account default), clamped forward into the window.
    """
    now = datetime.now(timezone.utc)

    if mode == "send_now":
        return now
    if mode == "send_at":
        if send_at is None:
            raise ValueError("mode 'send_at' requires a send_at datetime")
        return _as_utc(send_at)
    if mode == "draft_now_send_later":
        tz = _tz(settings_row)
        at = step_time or settings_row.default_send_time
        local_day = (now.astimezone(tz) + timedelta(days=settings_row.default_delay_days)).date()
        candidate = datetime.combine(local_day, at, tzinfo=tz).astimezone(timezone.utc)
        # Delay 0 with an early send time can land in the past; never schedule
        # behind the clock.
        candidate = max(candidate, now)
        return next_window_open(settings_row, candidate)

    raise ValueError(f"Unknown scheduling mode: {mode!r}")
