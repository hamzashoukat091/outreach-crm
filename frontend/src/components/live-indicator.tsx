"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AutomationStatus } from "@/lib/types";

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
export function LiveIndicator() {
  const pathname = usePathname();
  const [status, setStatus] = useState<AutomationStatus | null>(null);
  const [failed, setFailed] = useState(false);

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
    const timer = setInterval(load, 30_000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [pathname]);

  // Say nothing rather than guess: claiming "dry run" while live would be the
  // worst possible failure mode for this component.
  if (failed || !status) return null;

  const paused = status.sending_paused;
  const live = !status.dry_run && !paused;

  const tone = live
    ? "border-send/30 bg-send-soft text-send-ink"
    : paused
      ? "border-rose-500/25 bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300"
      : "border-amber-500/25 bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300";

  const label = live ? "Live" : paused ? "Paused" : "Dry run";
  const detail = live
    ? "Emails reach real people"
    : paused
      ? "Sending is stopped"
      : "Nothing is delivered";

  return (
    <div className="px-3 pb-4 lg:px-5">
      <Link
        href="/settings"
        title={`${label} — ${detail}. Open settings to change this.`}
        className={`flex items-center gap-2.5 rounded-lg border px-3 py-2.5 transition-colors
          hover:brightness-[0.98] ${tone}`}
      >
        <span className="relative flex h-2 w-2 shrink-0">
          {/* Only the armed state pulses. Motion here means "this is running". */}
          {live && (
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full
              bg-send opacity-60 motion-reduce:hidden" />
          )}
          <span className="relative inline-flex h-2 w-2 rounded-full bg-current" />
        </span>
        <span className="min-w-0">
          <span className="block text-xs font-semibold leading-tight">{label}</span>
          <span className="block truncate text-[11px] leading-tight opacity-80">{detail}</span>
        </span>
      </Link>
    </div>
  );
}
