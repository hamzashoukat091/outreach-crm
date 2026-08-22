"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

/* Pull down to refresh.
 *
 * Chrome's own pull-to-refresh is switched off (overscroll-behavior on html):
 * it bounced the whole page, which read as a bug, and it reloads the document
 * -- losing the app shell and any unsaved text on the way. But the data does
 * go stale, and without a gesture the only options were navigating away and
 * back or relaunching the app. So this replaces it rather than removing it.
 *
 * router.refresh() re-runs the server components in place: every page here is
 * force-dynamic, so it re-queries the API and swaps in fresh markup while
 * preserving client state, scroll position and the shell. It is the same call
 * the app already makes after a mutation.
 *
 * Only fires from a genuine top-of-page downward drag, so it can never
 * interfere with normal scrolling further down a list.
 */

const TRIGGER_PX = 72; // pull distance that commits to a refresh
const MAX_PULL = 96; // travel cap, so the indicator cannot be dragged away
const RESISTANCE = 0.5; // finger travel is halved, which is what makes it feel elastic

export function PullToRefresh() {
  const router = useRouter();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  const startY = useRef<number | null>(null);
  const active = useRef(false);

  const scroller = useCallback((): HTMLElement | null => {
    // Desktop scrolls an inner column (lg:overflow-y-auto); mobile scrolls the
    // document. Whichever is doing the scrolling is the one whose position
    // decides if we are at the top.
    const col = document.querySelector<HTMLElement>("[data-scroll-root]");
    if (col && col.scrollHeight > col.clientHeight) return col;
    return null;
  }, []);

  const atTop = useCallback(() => {
    const col = scroller();
    if (col) return col.scrollTop <= 0;
    return window.scrollY <= 0;
  }, [scroller]);

  useEffect(() => {
    // Touch only. A mouse has other affordances and would fire this on any
    // downward drag over text.
    if (!window.matchMedia("(pointer: coarse)").matches) return;

    const onStart = (e: TouchEvent) => {
      if (refreshing || e.touches.length !== 1) return;
      // Record the origin only when already at the top, so a drag that begins
      // mid-list never becomes a pull.
      startY.current = atTop() ? e.touches[0].clientY : null;
      active.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (startY.current === null || refreshing) return;
      const delta = e.touches[0].clientY - startY.current;

      if (delta <= 0) {
        // Scrolling up: abandon the gesture rather than fighting it.
        startY.current = null;
        if (active.current) setPull(0);
        active.current = false;
        return;
      }
      // Still at the top? A page that scrolled away under the finger is no
      // longer pulling.
      if (!atTop()) {
        startY.current = null;
        setPull(0);
        active.current = false;
        return;
      }

      active.current = true;
      setPull(Math.min(delta * RESISTANCE, MAX_PULL));
    };

    const onEnd = () => {
      if (startY.current === null || !active.current) {
        startY.current = null;
        return;
      }
      startY.current = null;
      active.current = false;

      setPull((current) => {
        if (current >= TRIGGER_PX) {
          setRefreshing(true);
          // Hold the indicator at the trigger point while the server work
          // happens, so the spinner does not flash and vanish.
          return TRIGGER_PX;
        }
        return 0;
      });
    };

    // passive: the handlers never preventDefault -- the browser's own
    // overscroll is already contained by CSS, so there is nothing to cancel,
    // and a non-passive listener would cost scroll performance on every page.
    const opts = { passive: true } as AddEventListenerOptions;
    window.addEventListener("touchstart", onStart, opts);
    window.addEventListener("touchmove", onMove, opts);
    window.addEventListener("touchend", onEnd, opts);
    window.addEventListener("touchcancel", onEnd, opts);
    return () => {
      window.removeEventListener("touchstart", onStart);
      window.removeEventListener("touchmove", onMove);
      window.removeEventListener("touchend", onEnd);
      window.removeEventListener("touchcancel", onEnd);
    };
  }, [atTop, refreshing]);

  useEffect(() => {
    if (!refreshing) return;
    let cancelled = false;

    router.refresh();

    /* refresh() returns before the new markup arrives and gives no completion
       signal, so the indicator is held briefly rather than tied to the render.
       Long enough to read as work happening; short enough not to feel stuck. */
    const timer = setTimeout(() => {
      if (cancelled) return;
      setRefreshing(false);
      setPull(0);
    }, 650);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [refreshing, router]);

  if (pull <= 0 && !refreshing) return null;

  const progress = Math.min(pull / TRIGGER_PX, 1);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center"
      style={{ transform: `translateY(${pull - 40}px)` }}
    >
      <span
        className="flex h-9 w-9 items-center justify-center rounded-full border border-line
          bg-surface shadow-pop"
        style={{ opacity: Math.max(progress, refreshing ? 1 : 0.35) }}
      >
        <svg
          viewBox="0 0 20 20"
          className={`h-4 w-4 text-accent ${refreshing ? "animate-spin" : ""}`}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        >
          <path d="M16.5 10a6.5 6.5 0 1 1-1.9-4.6" />
          <path d="M16.5 3.5v3h-3" />
        </svg>
      </span>
    </div>
  );
}
