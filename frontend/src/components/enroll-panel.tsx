"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { enrollProspectsAction } from "@/app/automation-actions";
import { api } from "@/lib/api";
import type { EnrollMode } from "@/lib/types";
import type { Prospect } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

const MODES: { value: EnrollMode; label: string; hint: string }[] = [
  {
    value: "draft_now_send_later",
    label: "Draft now, send later",
    hint: "Default — uses your configured delay before sending.",
  },
  {
    value: "send_now",
    label: "Draft and send at next opportunity",
    hint: "Goes out as soon as the send window and limits allow.",
  },
  {
    value: "send_at",
    label: "Draft now, send at a specific time",
    hint: "Pick exactly when the first email leaves.",
  },
];

export function EnrollPanel({
  sequenceId,
  hasSteps,
}: {
  sequenceId: string;
  hasSteps: boolean;
}) {
  const [query, setQuery] = useState("");
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<EnrollMode>("draft_now_send_later");
  const [sendAt, setSendAt] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .listProspects({ q: query || undefined, archived: false, page_size: 50 })
      .then((data) => {
        if (cancelled) return;
        setProspects(data.items);
        setTotal(data.total);
      })
      .catch(() => {
        if (!cancelled) show({ ok: false, message: "Couldn't load prospects." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function enroll() {
    startTransition(async () => {
      const result = await enrollProspectsAction(
        sequenceId,
        [...selected],
        mode,
        mode === "send_at" && sendAt ? new Date(sendAt).toISOString() : undefined,
      );
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="card p-5">
        <h2 className="text-sm font-semibold text-ink">Enroll prospects</h2>
        <p className="mt-1 text-xs text-muted">
          {total === null
            ? "Loading eligible prospects…"
            : `${total} eligible prospect${total === 1 ? "" : "s"}. Enrolling hands them off to automation.`}
        </p>

        {!hasSteps && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Add at least one step first — enrolled prospects would have nothing
            to receive.
          </p>
        )}

        <input
          type="search"
          placeholder="Search name, email, or company…"
          onChange={(e) => {
            const value = e.target.value;
            clearTimeout(searchTimer.current);
            searchTimer.current = setTimeout(() => setQuery(value), 350);
          }}
          className="input mt-3"
        />

        <div className="mt-3 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {loading && prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">Loading…</p>
          ) : prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No prospects match.</p>
          ) : (
            prospects.map((prospect) => (
              <label
                key={prospect.id}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-surface-2"
              >
                <input
                  type="checkbox"
                  checked={selected.has(prospect.id)}
                  onChange={() => toggle(prospect.id)}
                  className="h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">
                    {prospect.full_name}
                    {prospect.pipeline_mode === "automated" && (
                      <span className="ml-1.5 text-xs text-accent">automated</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {prospect.email}
                    {prospect.display_company ? ` · ${prospect.display_company}` : ""}
                  </span>
                </span>
              </label>
            ))
          )}
        </div>
        {total !== null && total > prospects.length && (
          <p className="mt-1.5 text-xs text-muted">
            Showing the first {prospects.length} — search to narrow down.
          </p>
        )}

        <fieldset className="mt-4">
          <legend className="label">First email timing</legend>
          <div className="space-y-2">
            {MODES.map((option) => (
              <label
                key={option.value}
                className="flex cursor-pointer items-start gap-2.5"
              >
                <input
                  type="radio"
                  name="enroll-mode"
                  value={option.value}
                  checked={mode === option.value}
                  onChange={() => setMode(option.value)}
                  className="mt-0.5 h-4 w-4 shrink-0 accent-[rgb(var(--accent))]"
                />
                <span>
                  <span className="block text-sm text-ink">{option.label}</span>
                  <span className="block text-xs text-muted">{option.hint}</span>
                </span>
              </label>
            ))}
          </div>
          {mode === "send_at" && (
            <input
              type="datetime-local"
              value={sendAt}
              onChange={(e) => setSendAt(e.target.value)}
              aria-label="Send at"
              className="input mt-2"
            />
          )}
        </fieldset>

        <button
          onClick={enroll}
          disabled={
            pending ||
            selected.size === 0 ||
            !hasSteps ||
            (mode === "send_at" && !sendAt)
          }
          className="btn-primary mt-4 w-full"
        >
          {pending
            ? "Enrolling…"
            : `Enroll ${selected.size || ""} prospect${selected.size === 1 ? "" : "s"}`}
        </button>
      </div>

      <Toast state={toast} />
    </>
  );
}
