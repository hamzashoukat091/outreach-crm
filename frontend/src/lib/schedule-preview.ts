/** Turning "day 3" into "Thu 20 Aug, 9:00am".
 *
 * The builder used to show step offsets and the settings page held the window,
 * with nothing connecting them -- so the only way to know when an email would
 * actually leave was to do the arithmetic yourself. This mirrors the backend's
 * clamping (services/automation_settings.py) closely enough to preview it.
 *
 * It is a preview, not the source of truth: the worker re-derives every send
 * time at run time from the settings as they are then. Sequence steps here are
 * previewed from "now" for illustration, since a real enrollment starts from
 * whenever the first email actually goes out.
 */

import type { AutomationSettings } from "@/lib/types";

/** "09:00:00" | "09:00" -> minutes since midnight. */
function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** ISO weekday, 1=Mon..7=Sun, in the settings timezone. */
function isoWeekday(date: Date, timeZone: string): number {
  const name = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone }).format(date);
  const index = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(name);
  return index + 1;
}

/** Minutes since midnight in the settings timezone. */
function minutesInZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone,
  }).format(date);
  return minutesOf(parts);
}

/**
 * Move `from` forward to the next moment inside the send window.
 * Returns the same instant when it is already open.
 */
export function clampToWindow(from: Date, settings: AutomationSettings): Date {
  const tz = settings.timezone;
  const open = minutesOf(settings.send_window_start);
  const close = minutesOf(settings.send_window_end);
  const days = settings.send_days ?? [];
  if (days.length === 0) return from;

  const cursor = new Date(from);

  // At most a fortnight of hops: enough to clear any weekday selection.
  for (let hop = 0; hop < 15; hop++) {
    const dayOk = days.includes(isoWeekday(cursor, tz));
    const nowMin = minutesInZone(cursor, tz);

    // End is EXCLUSIVE, matching within_send_window's `start <= t < end`.
    // Treating it as inclusive put 09:00 inside a 01:00-09:00 window, so the
    // preview showed a send the backend would actually defer to the next day.
    const inWindow =
      open <= close
        ? nowMin >= open && nowMin < close
        : nowMin >= open || nowMin < close; // overnight window
    if (dayOk && inWindow) return cursor;

    if (dayOk && nowMin < open) {
      cursor.setMinutes(cursor.getMinutes() + (open - nowMin));
      return cursor;
    }

    // Past closing, or a day we don't send: move to the NEXT day's opening.
    // Stepping by (24h - nowMin) lands on 00:00 of the next day, so adding
    // `open` from there is the opening time -- adding it to the current
    // clock instead would skip a whole extra day whenever nowMin > open,
    // which is every non-send day at 9am.
    const toMidnight = 24 * 60 - nowMin;
    cursor.setMinutes(cursor.getMinutes() + toMidnight);
    // Re-read: DST can shift what midnight-plus-open means in this zone.
    const atMidnight = minutesInZone(cursor, tz);
    cursor.setMinutes(cursor.getMinutes() + (open - atMidnight));
  }
  return cursor;
}

/** The calendar date `days` ahead of `from`, as seen in `timeZone`. */
function localDateParts(
  from: Date,
  days: number,
  timeZone: string,
): { y: number; m: number; d: number } {
  const shifted = new Date(from.getTime() + days * 86_400_000);
  const parts = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone,
  }).format(shifted);
  const [y, m, d] = parts.split("-").map(Number);
  return { y, m, d };
}

/** The UTC instant of `hhmm` on a given local date in `timeZone`. */
function instantAt(
  date: { y: number; m: number; d: number },
  hhmm: string,
  timeZone: string,
): Date {
  const target = minutesOf(hhmm);
  // Start from the UTC reading of that wall clock, then correct by however
  // far the zone actually sits from UTC at that moment. Two passes settle
  // the DST edge where the offset changes across the guess.
  let guess = new Date(Date.UTC(date.y, date.m - 1, date.d, 0, 0) + target * 60_000);
  for (let i = 0; i < 2; i++) {
    const drift = minutesInZone(guess, timeZone) - target;
    if (drift === 0) break;
    // Drift wraps when the correction crosses midnight in the zone.
    const adjust = drift > 720 ? drift - 1440 : drift < -720 ? drift + 1440 : drift;
    guess = new Date(guess.getTime() - adjust * 60_000);
  }
  return guess;
}

/**
 * Add whole days, land on `hhmm` in the settings timezone, clamp into the
 * window. Mirrors resolve_send_time / next_window_open in the backend: the
 * calendar date is computed in the SETTINGS zone, not the browser's, or a
 * viewer in another timezone previews a different day than will be sent.
 */
export function scheduleFrom(
  start: Date,
  days: number,
  hhmm: string | null,
  settings: AutomationSettings,
): Date {
  const tz = settings.timezone;

  if (!hhmm) {
    return clampToWindow(new Date(start.getTime() + days * 86_400_000), settings);
  }

  const date = localDateParts(start, days, tz);
  let candidate = instantAt(date, hhmm, tz);
  // Delay 0 with an early send time can land in the past; never preview a
  // send behind the clock.
  const now = new Date();
  if (candidate < now) candidate = now;
  return clampToWindow(candidate, settings);
}

/** "Thu 20 Aug, 9:00 am" in the settings timezone. */
export function formatInZone(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone,
  }).format(date);
}

/** "in 3 days" / "tomorrow" / "today" — the human reading of a gap. */
export function relativeDay(from: Date, to: Date): string {
  const ms = to.getTime() - from.getTime();
  const days = Math.round(ms / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "tomorrow";
  if (days < 7) return `in ${days} days`;
  if (days < 14) return "in a week";
  return `in ${Math.round(days / 7)} weeks`;
}

/** True when the window is open right now. */
export function windowOpenNow(settings: AutomationSettings): boolean {
  const now = new Date();
  return clampToWindow(now, settings).getTime() - now.getTime() < 60_000;
}

/** Short human summary: "Mon–Fri, 9:00am–5:00pm UTC". */
export function windowSummary(settings: AutomationSettings): string {
  const names = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const days = [...(settings.send_days ?? [])].sort((a, b) => a - b);

  let dayText: string;
  if (days.length === 7) dayText = "Every day";
  else if (days.length === 0) dayText = "No days selected";
  else if (days.length > 1 && days[days.length - 1] - days[0] === days.length - 1) {
    dayText = `${names[days[0] - 1]}–${names[days[days.length - 1] - 1]}`;
  } else {
    dayText = days.map((d) => names[d - 1]).join(", ");
  }

  const time = (hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    const suffix = h >= 12 ? "pm" : "am";
    const hour = h % 12 === 0 ? 12 : h % 12;
    return m ? `${hour}:${String(m).padStart(2, "0")}${suffix}` : `${hour}${suffix}`;
  };

  return `${dayText}, ${time(settings.send_window_start)}–${time(
    settings.send_window_end,
  )} ${settings.timezone}`;
}
