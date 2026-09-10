"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { enrollProspectsAction } from "@/app/automation-actions";
import { api } from "@/lib/api";
import type { AutomationSequence, AutomationSettings, EnrollMode } from "@/lib/types";
import type { Prospect } from "@/lib/prospect-types";
import type { ActionState } from "@/app/prospect-actions";
import {
  clampToWindow,
  formatInZone,
  relativeDay,
  scheduleFrom,
  windowSummary,
} from "@/lib/schedule-preview";
import { SendIcon } from "@/components/send-icon";

/**
 * Enroll the rows already selected on the Prospects page.
 *
 * The Sequences page has its own enroll panel with a prospect picker. This one
 * deliberately has no picker: you arrived here having already chosen who, and
 * asking you to tick the same names a second time on another page was the
 * reason enrolling felt like a chore.
 *
 * Sequence and settings are fetched when the dialog opens rather than passed
 * down, so the Prospects page keeps loading at the same speed for the far more
 * common case where nobody enrolls anything.
 */
export function EnrollDialog({
  prospects,
  extraIds = [],
  onClose,
  onDone,
}: {
  prospects: Prospect[];
  /**
   * Selected ids that are not on the current page, from "select all matching".
   * Their enrollment state is unknown here, so they are always submitted and
   * the backend decides -- it already skips per prospect with a reason.
   */
  extraIds?: string[];
  onClose: () => void;
  onDone: (result: ActionState) => void;
}) {
  const [sequences, setSequences] = useState<AutomationSequence[] | null>(null);
  const [settings, setSettings] = useState<AutomationSettings | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [sequenceId, setSequenceId] = useState("");
  const [mode, setMode] = useState<EnrollMode>("draft_now_send_later");
  const [sendAt, setSendAt] = useState("");
  const [allowReenroll, setAllowReenroll] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listAutomationSequences(),
      api.getAutomationSettings().catch(() => null),
    ])
      .then(([rows, config]) => {
        if (cancelled) return;
        setSequences(rows);
        setSettings(config);
        // Only sequences that can actually send are worth defaulting to.
        const usable = rows.filter((s) => s.is_active && s.step_count > 0);
        if (usable.length) setSequenceId(usable[0].id);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Escape closes, matching every other dismissable surface in the app.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !pending) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, pending]);

  // Same rules the Sequences panel enforces, applied to the selection you
  // arrived with. Splitting them here means the button can say how many will
  // really go through before you press it, rather than reporting skips after.
  const groups = useMemo(() => {
    const running: Prospect[] = [];
    const finished: Prospect[] = [];
    const ready: Prospect[] = [];
    const FINISHED = new Set(["replied", "completed", "stopped", "bounced"]);
    for (const p of prospects) {
      const state = p.enrollment_state ?? "";
      if (state === "active" || state === "paused") running.push(p);
      else if (FINISHED.has(state)) finished.push(p);
      else ready.push(p);
    }
    return { running, finished, ready };
  }, [prospects]);

  const eligibleOnPage = allowReenroll
    ? [...groups.ready, ...groups.finished]
    : groups.ready;
  // Off-page ids go through unfiltered: the backend refuses a suppressed,
  // already-enrolled or previously-declined prospect on its own and reports
  // each skip, so guessing here would only make the count less accurate.
  const submitIds = [...eligibleOnPage.map((p) => p.id), ...extraIds];
  const totalSelected = prospects.length + extraIds.length;

  const selectedSequence = sequences?.find((s) => s.id === sequenceId) ?? null;
  const usable = (sequences ?? []).filter((s) => s.is_active && s.step_count > 0);

  // When the first email actually leaves, under each option -- computed, not
  // described, because "uses your configured delay" never told you which day.
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
            scheduleFrom(
              now,
              settings.default_delay_days,
              settings.default_send_time,
              settings,
            ),
            settings.timezone,
          )} — you can read every email before it goes. Recommended.`,
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
        {
          value: "draft_now_send_later",
          label: "Write now, send later",
          hint: "Uses your configured delay. Recommended.",
        },
        { value: "send_now", label: "Send as soon as possible", hint: "Subject to the send window." },
        { value: "send_at", label: "Send at a time I pick", hint: "Clamped to the send window." },
      ];

  // The rest of the sequence, stacked onto that first send.
  const plan: { position: number; when: string; strategy: string }[] = [];
  if (settings && firstSend && selectedSequence) {
    let cursor = firstSend;
    selectedSequence.steps
      .filter((s) => s.is_active)
      .sort((a, b) => a.position - b.position)
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

  function submit() {
    startTransition(async () => {
      const result = await enrollProspectsAction(
        sequenceId,
        submitIds,
        mode,
        mode === "send_at" && sendAt ? new Date(sendAt).toISOString() : undefined,
        allowReenroll,
      );
      onDone(result);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm sm:items-center"
      onClick={(e) => {
        if (e.target === e.currentTarget && !pending) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Enroll in a sequence"
        className="card my-auto w-full max-w-lg p-5 shadow-xl animate-fade-up"
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Enroll in a sequence</h2>
            <p className="mt-0.5 text-xs text-muted">
              {totalSelected} prospect{totalSelected === 1 ? "" : "s"} selected.
              Enrolling moves them to automation — no handoff needed.
            </p>
          </div>
          <button
            onClick={onClose}
            disabled={pending}
            aria-label="Close"
            className="-mr-1 -mt-1 rounded-lg px-2 py-1 text-lg leading-none text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-50"
          >
            ×
          </button>
        </div>

        {loadError ? (
          <p className="mt-4 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:bg-rose-950 dark:text-rose-300">
            Couldn&apos;t load your sequences. Check the connection and reopen this.
          </p>
        ) : sequences === null ? (
          <p className="mt-4 text-sm text-muted">Loading sequences…</p>
        ) : usable.length === 0 ? (
          <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            No sequence is ready to enroll into — one needs to be active and have
            at least one step. Build one on the Sequences page first.
          </p>
        ) : (
          <>
            <label className="label mt-4 block" htmlFor="enroll-sequence">
              Sequence
            </label>
            <select
              id="enroll-sequence"
              value={sequenceId}
              onChange={(e) => setSequenceId(e.target.value)}
              className="input mt-1"
            >
              {usable.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.step_count} step{s.step_count === 1 ? "" : "s"}
                </option>
              ))}
            </select>

            {/* Selected beyond this page, so their state is not loaded here.
                Saying so beats a confident count that quietly excluded them. */}
            {extraIds.length > 0 && (
              <p className="mt-3 rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
                <strong className="text-ink">{extraIds.length}</strong> of these
                are on other pages. Anyone already running or finished among them
                is skipped by the server, and the result will say how many.
              </p>
            )}

            {/* Why the count on the button may be lower than what you picked.
                Saying it here beats reporting skips after the fact. */}
            {(groups.running.length > 0 || groups.finished.length > 0) && (
              <div className="mt-3 space-y-2">
                {groups.running.length > 0 && (
                  <p className="rounded-lg border border-line bg-surface-2/60 px-3 py-2 text-xs text-muted">
                    <strong className="text-ink">{groups.running.length}</strong> of
                    your selection {groups.running.length === 1 ? "is" : "are"} already
                    running in a sequence and will be skipped. Stop those runs on the
                    Enrollments page to move them.
                  </p>
                )}
                {groups.finished.length > 0 && (
                  <label className="flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted hover:bg-surface-2">
                    <input
                      type="checkbox"
                      checked={allowReenroll}
                      onChange={(e) => setAllowReenroll(e.target.checked)}
                      className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
                    />
                    <span>
                      Also enroll {groups.finished.length} who already finished a run
                      — replied, completed, stopped or bounced.
                      {allowReenroll && (
                        <strong className="block text-amber-600">
                          They receive this sequence from step 1 again.
                        </strong>
                      )}
                    </span>
                  </label>
                )}
              </div>
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
                      name="enroll-dialog-mode"
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

            {settings && firstSend && plan.length > 0 && (
              <div className="mt-4 rounded-lg border border-line bg-surface-2/50 px-3 py-3">
                <p className="text-xs font-medium text-ink">
                  What happens to {submitIds.length} prospect
                  {submitIds.length === 1 ? "" : "s"}
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

            <div className="mt-4 flex gap-2">
              <button
                onClick={onClose}
                disabled={pending}
                className="btn-secondary flex-1"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={
                  pending ||
                  submitIds.length === 0 ||
                  !sequenceId ||
                  (mode === "send_at" && !sendAt)
                }
                className="btn-send flex-1"
              >
                <SendIcon />
                {pending
                  ? `Enrolling ${submitIds.length}…`
                  : submitIds.length
                    ? `Enroll ${submitIds.length}`
                    : "Nothing to enroll"}
              </button>
            </div>

            {/* Enrolling now returns as soon as the rows are written; the
                worker does the drafting. Point at where the progress shows,
                since a dialog that closes instantly otherwise looks like
                nothing happened. */}
            {mode !== "send_at" && submitIds.length > 5 && (
              <p className="mt-2 text-center text-xs text-muted">
                Claude writes these in the background — progress shows in the
                sidebar. You can close this and keep working.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
