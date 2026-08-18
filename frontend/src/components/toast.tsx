"use client";

import { useCallback, useEffect, useState } from "react";
import type { ActionState } from "@/app/prospect-actions";

export function useToast(timeoutMs = 4000) {
  const [toast, setToast] = useState<ActionState | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), timeoutMs);
    return () => clearTimeout(timer);
  }, [toast, timeoutMs]);

  const show = useCallback((state: ActionState | null) => setToast(state), []);

  return { toast, show };
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2">
      <path d="M4.5 10.5l3.5 3.5 7.5-8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function AlertIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="2.2">
      <path d="M10 6v5" strokeLinecap="round" />
      <circle cx="10" cy="14.2" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10" cy="10" r="7.5" />
    </svg>
  );
}

export function Toast({ state }: { state: ActionState | null }) {
  if (!state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 flex max-w-md -translate-x-1/2 animate-fade-up
        items-start gap-2.5 rounded-xl px-4 py-3 text-sm text-white shadow-pop
        ring-1 ring-inset ring-white/15 ${state.ok ? "bg-emerald-600" : "bg-rose-600"}`}
    >
      {/* Colour alone should never carry the outcome. */}
      <span aria-hidden className="mt-px shrink-0">
        {state.ok ? <CheckIcon /> : <AlertIcon />}
      </span>
      <span>{state.message}</span>
    </div>
  );
}
