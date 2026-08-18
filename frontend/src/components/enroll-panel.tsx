"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { enrollProspectsAction } from "@/app/automation-actions";
import { api } from "@/lib/api";
import type { AutomationSettings, EnrollMode, SequenceStep } from "@/lib/types";
import type { Prospect } from "@/lib/prospect-types";
import {
  clampToWindow,
  formatInZone,
  relativeDay,
  scheduleFrom,
  windowSummary,
} from "@/lib/schedule-preview";
import { Toast, useToast } from "@/components/toast";
import { SendIcon } from "@/components/send-icon";

export function EnrollPanel({
  sequenceId,
  hasSteps,
  settings,
  steps,
}: {
  sequenceId: string;
  hasSteps: boolean;
  settings: AutomationSettings | null;
  steps: SequenceStep[];
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

  // A prospect mid-sequence cannot be enrolled again -- the database enforces
  // one open enrollment per prospect per sequence, so ticking them here would
  // only produce a failure at submit time. Disable them instead, and say why.
  function runningIn(prospect: Prospect): string | null {
    const open =
      prospect.enrollment_state === "active" ||
      prospect.enrollment_state === "paused";
    return open ? prospect.sequence_name ?? "a sequence" : null;
  }

  // Handed off to automation but sitting in no sequence. They are the ones
  // most likely to be enrolled next, so they sort to the top.
  const waiting = prospects.filter(
    (p) => p.pipeline_mode === "automated" && !runningIn(p),
  );
  const ordered = [
    ...waiting,
    ...prospects.filter((p) => !waiting.includes(p) && !runningIn(p)),
    // Already running, so they sink to the bottom rather than disappear --
    // seeing "already in Standard 3-step" is the answer to "where did they go".
    ...prospects.filter(runningIn),
  ];

  // Selections can outlive the search that produced them. Never submit an id
  // that has since started running somewhere.
  const blocked = new Set(prospects.filter(runningIn).map((p) => p.id));
  const selectable = [...selected].filter((id) => !blocked.has(id));

  // When the first email actually leaves, under each option. Computed rather
  // than described, because "uses your configured delay" told you nothing
  // about which day that lands on.
  const now = new Date();
  const firstSend = settings
    ? mode === "send_now"
      ? clampToWindow(now, settings)
      : mode === "send_at"
      ? sendAt
        ? clampToWindow(new Date(sendAt), settings)
        : null
      : scheduleFrom(
          now,
          settings.default_delay_days,
          settings.default_send_time,
          settings,
        )
    : null;

  const modes: { value: EnrollMode; label: string; hint: string }[] = settings
    ? [
        {
          value: "draft_now_send_later",
          label: `Write now, send ${relativeDay(
            now,
            scheduleFrom(
              now,
              settings.default_delay_days,
              settings.default_send_time,
              settings,
            ),
          )}`,
          hint: `${formatInZone(
            scheduleFrom(now, settings.default_delay_days, settings.default_send_time, settings),
            settings.timezone,
          )} — you can read it before it goes. Recommended.`,
        },
        {
          value: "send_now",
          label: "Send as soon as possible",
          hint:
            clampToWindow(now, settings).getTime() - now.getTime() < 60_000
              ? "The window is open, so this goes out within a minute or two."
              : `The window is closed, so it waits until ${formatInZone(
                  clampToWindow(now, settings),
                  settings.timezone,
                )}.`,
        },
        {
          value: "send_at",
          label: "Send at a time I pick",
          hint: "Moved forward if it lands outside your send window.",
        },
      ]
    : [
        { value: "draft_now_send_later", label: "Write now, send later", hint: "Uses your configured delay." },
        { value: "send_now", label: "Send as soon as possible", hint: "Subject to the send window." },
        { value: "send_at", label: "Send at a time I pick", hint: "Clamped to the send window." },
      ];

  // The rest of the sequence, stacked onto that first send.
  const plan: { position: number; when: string; strategy: string }[] = [];
  if (settings && firstSend) {
    let cursor = firstSend;
    steps
      .filter((s) => s.is_active)
      .forEach((step, index) => {
        if (index > 0) {
          cursor = scheduleFrom(cursor, step.wait_days, step.send_at_time, settings);
        }
        plan.push({
          position: step.position,
          when: formatInZone(cursor, settings.timezone),
          strategy: step.strategy_name ?? "No strategy set",
        });
      });
  }

  function enroll() {
    startTransition(async () => {
      const result = await enrollProspectsAction(
        sequenceId,
        selectable,
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
            : `${total} to choose from. Enrolling starts the sequence and moves them to automation — you don't need to hand them off first.`}
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

        {/* Handing a prospect off marks them for automation but schedules
            nothing. Without this they sit invisibly between the two sections,
            waiting for an enrollment nobody knows to create. */}
        {waiting.length > 0 && (
          <button
            onClick={() =>
              setSelected((prev) => {
                const next = new Set(prev);
                waiting.forEach((p) => next.add(p.id));
                return next;
              })
            }
            className="mt-2 w-full rounded-lg border border-accent/30 bg-accent-soft px-3 py-2 text-left text-xs text-ink hover:bg-accent-soft/70"
          >
            <strong>{waiting.length}</strong> prospect
            {waiting.length === 1 ? " is" : "s are"} handed off but not enrolled
            anywhere — select {waiting.length === 1 ? "it" : "them"}
          </button>
        )}

        <div className="mt-3 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {loading && prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">Loading…</p>
          ) : prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No prospects match.</p>
          ) : (
            ordered.map((prospect) => {
              const running = runningIn(prospect);
              return (
              <label
                key={prospect.id}
                title={
                  running
                    ? `Already enrolled in ${running}. Stop that run first to re-enroll.`
                    : undefined
                }
                className={`flex items-center gap-3 px-3 py-2 ${
                  running
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-pointer hover:bg-surface-2"
                }`}
              >
                <input
                  type="checkbox"
                  checked={!running && selected.has(prospect.id)}
                  disabled={!!running}
                  onChange={() => toggle(prospect.id)}
                  className="h-4 w-4 shrink-0 rounded border-line accent-[rgb(var(--accent))] disabled:cursor-not-allowed"
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm text-ink">
                    {prospect.full_name}
                    {!running && prospect.pipeline_mode === "automated" && (
                      <span className="ml-1.5 text-xs text-accent">automated</span>
                    )}
                  </span>
                  <span className="block truncate text-xs text-muted">
                    {running ? (
                      <>Already in {running}</>
                    ) : (
                      <>
                        {prospect.email}
                        {prospect.display_company ? ` · ${prospect.display_company}` : ""}
                      </>
                    )}
                  </span>
                </span>
              </label>
              );
            })
          )}
        </div>
        {total !== null && total > prospects.length && (
          <p className="mt-1.5 text-xs text-muted">
            Showing the first {prospects.length} — search to narrow down.
          </p>
        )}

        <fieldset className="mt-4">
          <legend className="label">When does the first email go out?</legend>
          <div className="space-y-2">
            {modes.map((option) => (
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
                <span className="min-w-0">
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

        {/* The whole plan in real dates. The builder shows day offsets; this
            is where they become moments, which is what you actually agree to
            when you press the button. */}
        {settings && firstSend && (
          <div className="mt-4 rounded-lg border border-line bg-surface-2/50 px-3 py-3">
            <p className="text-xs font-medium text-ink">
              What happens{" "}
              {selectable.length > 0
                ? `to ${selectable.length} prospect${selectable.length === 1 ? "" : "s"}`
                : "next"}
            </p>
            <ol className="mt-2 space-y-1">
              {plan.map((entry) => (
                <li key={entry.position} className="flex gap-2 text-xs">
                  <span className="shrink-0 text-muted">{entry.position}.</span>
                  <span className="min-w-0 text-muted">
                    <span className="text-ink">{entry.when}</span>
                    {" · "}
                    {entry.strategy}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-2 border-t border-line pt-2 text-xs text-muted">
              Sends {windowSummary(settings)}. A reply cancels the rest.
            </p>
          </div>
        )}

        {settings?.dry_run && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Dry run is on — these will be written and scheduled, but nothing is
            delivered.
          </p>
        )}

        <button
          onClick={enroll}
          disabled={
            pending ||
            selectable.length === 0 ||
            !hasSteps ||
            (mode === "send_at" && !sendAt)
          }
          className="btn-send mt-4 w-full"
        >
          <SendIcon />
          {pending
            ? "Enrolling…"
            : selectable.length
              ? `Enroll ${selectable.length} prospect${selectable.length === 1 ? "" : "s"}`
              : "Enroll prospects"}
        </button>
      </div>

      <Toast state={toast} />
    </>
  );
}
