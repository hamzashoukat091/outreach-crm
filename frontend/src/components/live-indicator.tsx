"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AutomationStatus } from "@/lib/types";
import { shortTimeInZone } from "@/lib/schedule-preview";

/** Persistent "is this thing armed?" readout, pinned in the sidebar.
 *
 *  Whether a send reaches a real person was stated once, as a pill on the
 *  Settings page. That is the single highest-consequence piece of state in
 *  the app and it was invisible from every screen where you actually act --
 *  so it lives on the frame instead, on every page.
 *
 *  Deliberately not colour-only: each state has its own word and its own dot,
 *  because "green vs amber" is precisely the pair that fails for the most
 *  common form of colour blindness. */
export function LiveIndicator({ compact = false }: { compact?: boolean } = {}) {
  const pathname = usePathname();
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const drafting = (status?.drafting ?? 0) > 0;

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .automationStatus()
        .then((d) => {
          if (cancelled) return;
          setStatus(d);
          setFailed(false);
        })
        .catch(() => !cancelled && setFailed(true));
    load();
    // Faster while a batch is being written: at 30s a bar that finishes in a
    // minute would show two frames, which is indistinguishable from stuck.
    const timer = setInterval(load, drafting ? 3_000 : 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname, drafting]);

  // Say nothing rather than guess: claiming "dry run" while live would be the
  // worst possible failure mode for this component.
  if (failed || !status) return null;

  const paused = status.sending_paused;
  const live = !status.dry_run && !paused;

  // The window only qualifies the live state. While paused or in dry run the
  // question "is the window open" is moot -- nothing is going out either way,
  // and saying so twice buries the reason that actually matters.
  const windowShut = live && !status.window_open;
  const opensAt =
    windowShut && status.window_opens_at
      ? shortTimeInZone(new Date(status.window_opens_at), status.send_timezone)
      : null;

  const tone = live
    ? "border-send/30 bg-send-soft text-send-ink"
    : paused
      ? "border-rose-500/25 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      : "border-amber-500/25 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";

  const label = live ? "Live" : paused ? "Paused" : "Dry run";
  const detail = live
    ? windowShut
      ? opensAt
        ? `Window closed · opens ${opensAt}`
        : "Window closed"
      : "Window open · emails reach real people"
    : paused
      ? "Sending is stopped"
      : "Nothing is delivered";

  // Mobile: a dot and one word on the brand row. The full card would cost a
  // whole block of vertical space on a screen that has none to spare, but
  // dropping the state entirely is not an option -- it is the one thing you
  // must be able to see from anywhere.
  if (compact) {
    return (
      <Link
        href="/settings"
        title={`${label} — ${detail}`}
        aria-label={`${label}. ${detail}. Open settings.`}
        className={`flex min-h-11 items-center gap-1.5 rounded-lg border px-2.5 text-xs
          font-semibold ${tone}`}
      >
        <span className="relative flex h-1.5 w-1.5 shrink-0">
          {live && status.window_open && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full
              bg-send opacity-60 motion-reduce:hidden" />
          )}
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-current" />
        </span>
        {label}
      </Link>
    );
  }

  const total = status.drafting_total || 0;
  const written = Math.max(0, total - (status.drafting ?? 0));

  return (
    <div className="px-3 pb-4 lg:px-5">
      {/* Enrolling returns immediately and the worker writes the emails, so
          this is the only place that says the work is happening. Shown only
          while it is: a permanent 0-of-0 bar would be furniture. */}
      {drafting && total > 0 && (
        <div className="mb-2 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-[11px] font-semibold leading-tight text-ink">
              Writing emails
            </span>
            <span className="tabular text-[11px] leading-tight text-muted">
              {written}/{total}
            </span>
          </div>
          <div
            className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={written}
            aria-label={`Writing emails: ${written} of ${total} done`}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
              style={{ width: `${Math.round((written / total) * 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[11px] leading-tight text-muted">
            Claude is drafting. You can leave this page.
          </p>
        </div>
      )}

      <Link
        href="/settings"
        title={`${label} — ${detail}. Open settings to change this.`}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors
          hover:brightness-[0.98] ${tone}`}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {/* Pulses only when a send could happen this minute: armed AND
              inside the window. A pulsing dot on a closed window would be
              claiming activity that cannot occur. */}
          {live && status.window_open && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full
              bg-send opacity-60 motion-reduce:hidden" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold leading-tight">{label}</span>
          {/* Wraps rather than truncates: "Window closed · opens tomorrow
              12:00 pm" is longer than the sidebar and the opening time is the
              half that would be cut. */}
          <span className="block text-[11px] leading-tight opacity-80">{detail}</span>
        </span>
      </Link>
    </div>
  );
}
