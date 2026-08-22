"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { useConnectivity } from "@/components/connectivity";

/** The offline banner.
 *
 *  Announced politely rather than assertively: losing wifi is not an
 *  emergency, and `assertive` would cut across whatever the user was already
 *  hearing. It is also the focus target when the region below goes disabled
 *  (see OfflineGuard) -- hence tabIndex -1.
 */
export function OfflineBanner() {
  const { online, checking, recheck } = useConnectivity();
  const ref = useRef<HTMLDivElement>(null);

  if (online) {
    // A live region has to stay mounted to announce anything, but an empty
    // one takes no space and reads as nothing.
    return <div role="status" aria-live="polite" className="sr-only" />;
  }

  return (
    <div
      ref={ref}
      data-offline-banner
      role="status"
      aria-live="polite"
      tabIndex={-1}
      className="sticky top-0 z-40 flex items-center gap-2.5 border-b border-amber-500/30
        bg-amber-50 px-4 py-2.5 text-amber-900 outline-none
        dark:border-amber-400/25 dark:bg-amber-950/60 dark:text-amber-100"
    >
      <svg viewBox="0 0 20 20" className="h-4 w-4 shrink-0" fill="none" aria-hidden>
        <path
          d="M10 4.5v6"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
        />
        <circle cx="10" cy="14" r="0.95" fill="currentColor" />
        <circle cx="10" cy="10" r="7.6" stroke="currentColor" strokeWidth="1.5" />
      </svg>
      <p className="min-w-0 flex-1 text-xs leading-snug sm:text-sm">
        <span className="font-medium">You&rsquo;re offline.</span>{" "}
        <span className="opacity-90">
          Outreach needs a connection — actions are paused until it returns.
        </span>
      </p>
      <button
        type="button"
        onClick={recheck}
        disabled={checking}
        className="shrink-0 rounded-md border border-amber-600/30 px-2.5 py-1 text-xs
          font-medium transition-colors hover:bg-amber-500/15 disabled:opacity-60
          dark:border-amber-300/30"
      >
        {checking ? "Checking…" : "Retry"}
      </button>
    </div>
  );
}

/** Disables everything inside while the connection is down.
 *
 *  A <fieldset disabled> rather than a prop threaded through ~90 buttons:
 *  the platform disables every form control descendant for free, which is
 *  both fewer edits and impossible to forget at a new call site. Every
 *  mutating control in this app is a real <button>, so the well-known gap --
 *  fieldset does not disable <a> or a div with onClick -- costs nothing
 *  here: the links only navigate, and the single div handler closes a modal,
 *  which should keep working offline.
 *
 *  Layout: `min-w-0` is load-bearing. The UA stylesheet gives fieldset
 *  `min-inline-size: min-content`, which Tailwind's reset does not clear, and
 *  which stops flex and grid children from ever shrinking -- tables would
 *  push the page sideways. Tailwind Preflight already zeroes the margin,
 *  padding and border.
 *
 *  `display: contents` would also neutralise the layout, but it drops the
 *  element from the accessibility tree in current browsers, taking the
 *  group semantics with it. Keeping the box is the safer trade.
 */
export function OfflineGuard({ children }: { children: ReactNode }) {
  const { online } = useConnectivity();
  const wasOnline = useRef(online);

  useEffect(() => {
    /* Disabling a fieldset while something inside it has focus silently
       resets activeElement to <body> and fires no blur or focusout, so a
       keyboard user loses their place with nothing to hook. Moving focus to
       the banner keeps it somewhere sensible and makes the reason the next
       thing a screen reader reads. */
    if (wasOnline.current && !online) {
      const banner = document.querySelector<HTMLElement>('[data-offline-banner]');
      banner?.focus();
    }
    wasOnline.current = online;
  }, [online]);

  return (
    <fieldset disabled={!online} className="m-0 min-w-0 border-0 p-0">
      {children}
    </fieldset>
  );
}
