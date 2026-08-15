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

export function Toast({ state }: { state: ActionState | null }) {
  if (!state) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className={`fixed bottom-6 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg px-4 py-3 text-sm shadow-pop ${
        state.ok
          ? "bg-emerald-600 text-white"
          : "bg-rose-600 text-white"
      }`}
    >
      {state.message}
    </div>
  );
}
