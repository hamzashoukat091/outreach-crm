"use client";

import { useEffect, useState } from "react";

/** Registers the service worker.
 *
 *  Waits for `load` so the registration never competes with the first paint
 *  for bandwidth. Rendered from the root layout, which means it also runs on
 *  /login -- deliberate: the worker should be installed before sign-in so the
 *  offline page works from the very first visit.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // A worker registered from a dev build caches Next's dev chunks and then
    // serves them against a later production build; skipping dev avoids a
    // class of "why is my change not showing" that is genuinely hard to spot.
    if (process.env.NODE_ENV !== "production") return;

    const register = () => {
      navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
        // Registration failing is not worth surfacing: the app works without
        // it, just without offline support.
      });
    };

    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register);
      return () => window.removeEventListener("load", register);
    }
  }, []);

  return null;
}

const DISMISS_KEY = "outreach:ios-install-dismissed";

/** The iOS install hint.
 *
 *  Safari has no `beforeinstallprompt`, so there is no way to offer a real
 *  install button -- the user has to tap Share then "Add to Home Screen".
 *  Unprompted, most people never discover that, so the app is never installed
 *  and Web Push (which iOS restricts to home-screen apps) can never work.
 *
 *  Shown only when all three are true: iOS Safari, not already installed, not
 *  previously dismissed.
 */
export function IosInstallHint() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const ua = window.navigator.userAgent;
    // iPadOS 13+ reports itself as a Mac; the touch-point check separates a
    // real iPad from a desktop Safari.
    const isIos =
      /iPad|iPhone|iPod/.test(ua) ||
      (ua.includes("Macintosh") && navigator.maxTouchPoints > 1);
    if (!isIos) return;

    // `standalone` is the iOS-specific signal that we are already installed.
    const installed =
      window.matchMedia("(display-mode: standalone)").matches ||
      (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
    if (installed) return;

    // Chrome/Firefox on iOS cannot add to the home screen at all -- showing
    // them Safari's instructions would just be wrong.
    const isSafari = !/CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
    if (!isSafari) return;

    try {
      if (localStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Private mode can throw on localStorage; showing the hint is the safe
      // side of that failure.
    }

    setShow(true);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      /* nothing to do -- it just reappears next launch */
    }
    setShow(false);
  };

  return (
    <div
      role="dialog"
      aria-label="Install Outreach"
      className="fixed inset-x-3 z-50 rounded-xl border border-line bg-surface p-3.5 shadow-lg
        bottom-[max(0.75rem,calc(env(safe-area-inset-bottom)+0.75rem))]
        sm:inset-x-auto sm:right-4 sm:max-w-xs"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-solid">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icon-192.png" alt="" className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink">Install Outreach</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted">
            Tap <ShareGlyph /> below, then <span className="font-medium">Add to Home Screen</span>{" "}
            for full-screen access and reply alerts.
          </p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss install hint"
          className="-m-1.5 shrink-0 rounded-md p-1.5 text-muted hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
            <path
              d="M4 4l8 8M12 4l-8 8"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}

/** iOS share glyph, inline so the instruction points at the actual button. */
function ShareGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="inline-block h-3.5 w-3.5 -translate-y-px align-middle text-accent"
      aria-label="Share"
      role="img"
    >
      <path
        d="M8 10.5V2m0 0L5.5 4.5M8 2l2.5 2.5"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
      <path
        d="M4 7H3v6.5h10V7h-1"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
