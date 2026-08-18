"use client";

import { useEffect, useRef, useState } from "react";

/** Copy one value to the clipboard.
 *
 *  Sits inline next to the value it copies rather than in a toolbar: with a
 *  dozen fields on the card, a single "copy" affordance would need the user
 *  to first say which field they meant. */
export function CopyButton({
  value,
  label,
  className = "",
}: {
  value: string;
  label: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // A pending timer must not fire into an unmounted component.
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // Clipboard needs a secure context; http://localhost counts, but a LAN
      // IP does not. Fall back rather than failing silently.
      const area = document.createElement("textarea");
      area.value = value;
      area.style.position = "fixed";
      area.style.opacity = "0";
      document.body.appendChild(area);
      area.select();
      try {
        document.execCommand("copy");
      } finally {
        document.body.removeChild(area);
      }
    }
    setCopied(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(false), 1400);
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? `${label} copied` : `Copy ${label.toLowerCase()}`}
      title={copied ? "Copied" : `Copy ${label.toLowerCase()}`}
      className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded align-middle text-muted transition-colors hover:bg-surface-2 hover:text-ink focus:opacity-100 focus-visible:outline focus-visible:outline-1 focus-visible:outline-accent ${
        // Always visible where there is no hover to reveal them: on a touch
        // screen an opacity-0 button is simply a missing feature.
        copied
          ? "text-accent opacity-100"
          : "opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      } ${className}`}
    >
      {copied ? (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <path
            d="M3.5 8.5l3 3 6-6"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" aria-hidden>
          <rect
            x="5.75"
            y="5.75"
            width="7.5"
            height="7.5"
            rx="1.5"
            stroke="currentColor"
            strokeWidth="1.5"
          />
          <path
            d="M10.25 5.5v-1a1.5 1.5 0 00-1.5-1.5h-4.5a1.5 1.5 0 00-1.5 1.5v4.5a1.5 1.5 0 001.5 1.5h1"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      )}
    </button>
  );
}
