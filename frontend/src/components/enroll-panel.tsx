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
  // Bumped after a successful enroll so the list below re-fetches. router
  // .refresh() re-runs the server components, but this list is client-side
  // state fetched in an effect -- without this it still showed everyone as
  // enrollable seconds after enrolling them.
  const [reloadKey, setReloadKey] = useState(0);
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
  }, [query, reloadKey]);

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

  // Someone who has already been through a sequence. Locked by default: step
  // 2 of a restarted run opens "they did not reply to the first email", which
  // sent to someone who replied -- or who said no -- reads as nobody paying
  // attention, and a second cold email is what gets reported as spam.
  //
  // Not permanent. "Allow re-enrolling" below unlocks the current list, so
  // running a genuinely new campaign months later stays possible; it just
  // cannot happen by dragging down a column of checkboxes.
  const FINISHED_LABEL: Record<string, string> = {
    replied: "Replied — already in conversation",
    completed: "Completed this sequence",
    stopped: "Sequence was stopped",
    bounced: "Bounced — address may be dead",
  };
  function finishedState(prospect: Prospect): string | null {
    if (runningIn(prospect)) return null;
    const state = prospect.enrollment_state ?? "";
    return FINISHED_LABEL[state] ?? null;
  }
  const [allowReenroll, setAllowReenroll] = useState(false);
  // Locked = finished a run, and the override is off.
  function lockedReason(prospect: Prospect): string | null {
    if (allowReenroll) return null;
    return finishedState(prospect);
  }
  const finishedCount = prospects.filter((p) => finishedState(p)).length;

  // Handed off to automation and never run through anything. Someone who
  // already replied is not "waiting" -- counting them here put a live
  // conversation at the top of a list headed "ready to enroll".
  const waiting = prospects.filter(
    (p) =>
      p.pipeline_mode === "automated" && !runningIn(p) && !finishedState(p),
  );
  const ordered = [
    ...waiting,
    ...prospects.filter(
      (p) => !waiting.includes(p) && !runningIn(p) && !finishedState(p),
    ),
    // Finished a run: still selectable, but below the fresh ones.
    ...prospects.filter((p) => !runningIn(p) && finishedState(p)),
    // Already running, so they sink to the bottom rather than disappear --
    // seeing "already in Standard 3-step" is the answer to "where did they go".
    ...prospects.filter(runningIn),
  ];

  // Selections can outlive the search that produced them. Never submit an id
  // that has since started running somewhere.
  const blocked = new Set(
    prospects.filter((p) => runningIn(p) || lockedReason(p)).map((p) => p.id),
  );
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
        allowReenroll,
      );
      show(result);
      if (result.ok) {
        setSelected(new Set());
        setReloadKey((k) => k + 1);
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
            : `${total} to choose from. Enrolling starts the sequence and moves them to automation. You can also enroll straight from the Prospects page.`}
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

        {/* Prospects marked for automation by an older handoff, or by a run
            that was reset -- marked but scheduled nothing. Without this they
            sit between the two sections waiting for an enrollment nobody
            knows to create. */}
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
            {waiting.length === 1 ? " is" : "s are"} ready to enroll and not in
            a sequence yet — select {waiting.length === 1 ? "it" : "them"}
          </button>
        )}

        {/* The escape hatch. Locked rows stay locked until this is ticked, so
            a fresh campaign to an old list is possible but never accidental. */}
        {finishedCount > 0 && (
          <label className="mt-2 flex cursor-pointer items-start gap-2 rounded-lg border border-line px-3 py-2 text-xs text-muted hover:bg-surface-2">
            <input
              type="checkbox"
              checked={allowReenroll}
              onChange={(e) => {
                setAllowReenroll(e.target.checked);
                if (!e.target.checked) setSelected(new Set());
              }}
              className="mt-0.5 h-3.5 w-3.5 shrink-0 rounded border-line accent-[rgb(var(--accent))]"
            />
            <span>
              Allow re-enrolling {finishedCount} prospect
              {finishedCount === 1 ? "" : "s"} who already finished a run.
              {allowReenroll && (
                <strong className="block text-amber-600">
                  They will receive this sequence from step 1 again.
                </strong>
              )}
            </span>
          </label>
        )}

        <div className="mt-3 max-h-64 divide-y divide-line overflow-y-auto rounded-lg border border-line">
          {loading && prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">Loading…</p>
          ) : prospects.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted">No prospects match.</p>
          ) : (
            ordered.map((prospect) => {
              const running = runningIn(prospect);
              const finished = finishedState(prospect);
              const locked = lockedReason(prospect);
              const disabled = !!running || !!locked;
              return (
              <label
                key={prospect.id}
                title={
                  running
                    ? `Already enrolled in ${running}. Stop that run first to re-enroll.`
                    : locked
                    ? `${locked}. Tick "Allow re-enrolling" to include them.`
                    : finished
                    ? `${finished}. Enrolling again restarts the sequence from step 1.`
                    : undefined
                }
                className={`flex items-center gap-3 px-3 py-2 ${
                  disabled
                    ? "cursor-not-allowed opacity-55"
                    : "cursor-pointer hover:bg-surface-2"
                }`}
              >
                <input
                  type="checkbox"
                  checked={!disabled && selected.has(prospect.id)}
                  disabled={disabled}
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
                    ) : finished ? (
                      <span className={locked ? "text-muted" : "text-amber-600"}>
                        {finished}
                        {locked ? " · locked" : " · will restart from step 1"}
                      </span>
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
            ? `Writing ${selectable.length} email${selectable.length === 1 ? "" : "s"}…`
            : selectable.length
              ? `Enroll ${selectable.length} prospect${selectable.length === 1 ? "" : "s"}`
              : "Enroll prospects"}
        </button>

        {/* A silent three-minute button is indistinguishable from a hung one.
            "draft now" writes every email with Claude before returning, so
            say that, and say roughly how long it will take. */}
        {pending && mode !== "send_at" && (
          <p className="mt-2 text-center text-xs text-muted">
            Claude is drafting each one — about{" "}
            {Math.max(1, Math.round((selectable.length * 5.5) / 60))} minute
            {Math.round((selectable.length * 5.5) / 60) === 1 ? "" : "s"} for{" "}
            {selectable.length}. Leave this tab open.
          </p>
        )}
      </div>

      <Toast state={toast} />
    </>
  );
}
