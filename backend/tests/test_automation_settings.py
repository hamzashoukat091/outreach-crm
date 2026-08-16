"""Send-window arithmetic and settings management.

The window logic runs on plain attribute access, so most tests use a
SimpleNamespace instead of a database row -- what matters is the calendar
math, not the ORM.
"""

from datetime import datetime, time, timezone
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from app.api.automation_admin import reset_settings_section, update_settings
from app.models import DEFAULT_SETTINGS
from app.schemas.automation import AutomationSettingsUpdate, SettingsResetRequest
from app.services.automation_settings import (
    get_settings_row,
    next_window_open,
    resolve_send_time,
    within_send_window,
)


def make_settings(**overrides):
    base = dict(
        timezone="America/New_York",
        send_days=[1, 2, 3, 4, 5],
        send_window_start=time(9, 0),
        send_window_end=time(17, 0),
        default_delay_days=1,
        default_send_time=time(9, 0),
    )
    base.update(overrides)
    return SimpleNamespace(**base)


# 2026-01-07 is a Wednesday; New York is on EST (UTC-5) in January.
WED_10AM_NY = datetime(2026, 1, 7, 15, 0, tzinfo=timezone.utc)
WED_6PM_NY = datetime(2026, 1, 7, 23, 0, tzinfo=timezone.utc)
SAT_10AM_NY = datetime(2026, 1, 10, 15, 0, tzinfo=timezone.utc)
FRI_6PM_NY = datetime(2026, 1, 9, 23, 0, tzinfo=timezone.utc)


def test_inside_window_on_a_weekday():
    assert within_send_window(make_settings(), WED_10AM_NY) is True


def test_outside_window_same_day():
    assert within_send_window(make_settings(), WED_6PM_NY) is False


def test_weekend_is_outside_even_at_a_valid_hour():
    assert within_send_window(make_settings(), SAT_10AM_NY) is False


def test_window_is_evaluated_in_the_settings_timezone():
    """15:00 UTC is 10am in New York but midnight in Auckland -- the same
    instant must flip based on the configured zone, not the server's."""
    ny = make_settings(timezone="America/New_York")
    auckland = make_settings(timezone="Pacific/Auckland")

    assert within_send_window(ny, WED_10AM_NY) is True
    assert within_send_window(auckland, WED_10AM_NY) is False


def test_next_window_open_passes_through_when_already_open():
    assert next_window_open(make_settings(), WED_10AM_NY) == WED_10AM_NY


def test_next_window_open_jumps_a_weekend():
    """Friday evening defers to Monday 9am local, not Saturday."""
    result = next_window_open(make_settings(), FRI_6PM_NY)

    local = result.astimezone(ZoneInfo("America/New_York"))
    assert local.isoweekday() == 1  # Monday
    assert local.date() == datetime(2026, 1, 12).date()
    assert local.time() == time(9, 0)


def test_next_window_open_defers_to_next_morning():
    result = next_window_open(make_settings(), WED_6PM_NY)

    local = result.astimezone(ZoneInfo("America/New_York"))
    assert local.date() == datetime(2026, 1, 8).date()  # Thursday
    assert local.time() == time(9, 0)


def test_resolve_send_now_is_now():
    before = datetime.now(timezone.utc)
    result = resolve_send_time(make_settings(), "send_now")
    after = datetime.now(timezone.utc)

    assert before <= result <= after


def test_resolve_send_at_honors_the_exact_instant():
    """An explicit user-picked time overrides the window entirely."""
    picked = SAT_10AM_NY  # deliberately a weekend
    assert resolve_send_time(make_settings(), "send_at", send_at=picked) == picked


def test_resolve_draft_later_lands_on_the_default_time():
    # All seven days allowed removes weekend variability from the assertion.
    settings = make_settings(send_days=[1, 2, 3, 4, 5, 6, 7])
    result = resolve_send_time(settings, "draft_now_send_later")

    local = result.astimezone(ZoneInfo("America/New_York"))
    now_local = datetime.now(timezone.utc).astimezone(ZoneInfo("America/New_York"))
    assert local.time() == time(9, 0)
    # Tomorrow, unless 9am tomorrow already passed relative to a late-night run.
    assert (local.date() - now_local.date()).days in (1, 2)


def test_resolve_draft_later_clamps_into_the_window():
    """A default send time outside the window must be pushed to the next
    window opening rather than sent at a configured-but-forbidden hour."""
    settings = make_settings(
        send_days=[1, 2, 3, 4, 5, 6, 7], default_send_time=time(20, 0)
    )
    result = resolve_send_time(settings, "draft_now_send_later")

    assert within_send_window(settings, result)
    local = result.astimezone(ZoneInfo("America/New_York"))
    assert local.time() == time(9, 0)  # clamped to the next day's opening


def test_resolve_draft_later_never_schedules_in_the_past():
    settings = make_settings(send_days=[1, 2, 3, 4, 5, 6, 7], default_delay_days=0)
    # Take the reference BEFORE the call: comparing against a now() sampled
    # afterwards fails whenever the clock ticks mid-test, which is a race in
    # the assertion rather than a send scheduled in the past.
    before = datetime.now(timezone.utc)
    result = resolve_send_time(settings, "draft_now_send_later")

    assert result >= before


# ---------- Settings row management ----------


def test_settings_row_is_created_lazily(db):
    row = get_settings_row(db)

    assert row.dry_run is True  # safe default: nothing leaves the building
    assert get_settings_row(db).id == row.id  # single row, not one per call


def test_section_reset_restores_only_that_section(db):
    row = get_settings_row(db)
    update_settings(
        AutomationSettingsUpdate(
            hourly_send_limit=3, daily_send_limit=7, timezone="Europe/Berlin"
        ),
        db,
    )

    reset_settings_section(SettingsResetRequest(section="limits"), db)
    db.refresh(row)

    assert row.hourly_send_limit == DEFAULT_SETTINGS["hourly_send_limit"]
    assert row.daily_send_limit == DEFAULT_SETTINGS["daily_send_limit"]
    # Outside the section: untouched.
    assert row.timezone == "Europe/Berlin"


def test_password_is_write_only_and_clearable(db):
    row = get_settings_row(db)

    out = update_settings(AutomationSettingsUpdate(smtp_password="hunter2"), db)
    assert out.has_smtp_password is True
    assert not hasattr(out, "smtp_password") or "smtp_password" not in out.model_dump()
    assert row.smtp_password == "hunter2"

    # Absent means keep.
    out = update_settings(AutomationSettingsUpdate(smtp_host="smtp.example.com"), db)
    assert row.smtp_password == "hunter2"
    assert out.has_smtp_password is True

    # Empty string means clear.
    out = update_settings(AutomationSettingsUpdate(smtp_password=""), db)
    assert row.smtp_password is None
    assert out.has_smtp_password is False
