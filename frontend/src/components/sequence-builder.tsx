"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  addStepAction,
  deleteStepAction,
  reorderStepsAction,
  updateStepAction,
} from "@/app/automation-actions";
import type { AutomationSequence, AutomationSettings, SequenceStep } from "@/lib/types";
import { windowSummary } from "@/lib/schedule-preview";
import type { Strategy } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

/** The API sends times as "HH:MM:SS"; <input type="time"> wants "HH:MM". */
const toHHMM = (t: string | null) => (t ? t.slice(0, 5) : "");

function StepRow({
  step,
  index,
  total,
  dayOffset,
  sequenceId,
  openers,
  defaultTimeLabel,
  onMove,
  moving,
}: {
  step: SequenceStep;
  index: number;
  total: number;
  dayOffset: number;
  sequenceId: string;
  openers: Strategy[];
  defaultTimeLabel: string;
  onMove: (index: number, direction: -1 | 1) => void;
  moving: boolean;
}) {
  const [form, setForm] = useState({
    wait_days: step.wait_days,
    send_at_time: toHHMM(step.send_at_time),
    strategy_id: step.strategy_id ?? "",
    step_instructions: step.step_instructions ?? "",
  });
  const [showInstructions, setShowInstructions] = useState(
    Boolean(step.step_instructions),
  );
  const [showTime, setShowTime] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const dirty =
    form.wait_days !== step.wait_days ||
    form.send_at_time !== toHHMM(step.send_at_time) ||
    form.strategy_id !== (step.strategy_id ?? "") ||
    form.step_instructions !== (step.step_instructions ?? "");

  function save() {
    startTransition(async () => {
      const result = await updateStepAction(step.id, sequenceId, {
        wait_days: form.wait_days,
        send_at_time: form.send_at_time || null,
        // Undefined is dropped by JSON.stringify, so an unset strategy is kept.
        strategy_id: form.strategy_id || undefined,
        step_instructions: form.step_instructions.trim() || null,
      });
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function toggleActive() {
    startTransition(async () => {
      const result = await updateStepAction(step.id, sequenceId, {
        is_active: !step.is_active,
      });
      show(
        result.ok
          ? {
              ok: true,
              message: step.is_active ? "Step skipped from now on." : "Step re-enabled.",
            }
          : result,
      );
      if (result.ok) router.refresh();
    });
  }

  function remove() {
    if (!window.confirm(`Remove step ${index + 1}?`)) return;
    startTransition(async () => {
      const result = await deleteStepAction(step.id, sequenceId);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <div className={`card p-5 ${step.is_active ? "" : "opacity-60"}`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-ink">
            Step {index + 1}
            <span className="ml-2 font-normal text-muted">
              Day {dayOffset}
              {index === 0 && step.wait_days === 0 ? " (on enrollment)" : ""}
            </span>
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => onMove(index, -1)}
              disabled={pending || moving || index === 0}
              aria-label="Move step up"
              className="btn-ghost h-8 px-2"
            >
              ↑
            </button>
            <button
              onClick={() => onMove(index, 1)}
              disabled={pending || moving || index === total - 1}
              aria-label="Move step down"
              className="btn-ghost h-8 px-2"
            >
              ↓
            </button>
            <label className="ml-2 flex items-center gap-1.5 text-xs text-ink">
              <input
                type="checkbox"
                checked={step.is_active}
                onChange={toggleActive}
                disabled={pending}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
              />
              Active
            </label>
            <button
              onClick={remove}
              disabled={pending}
              className="btn-ghost h-8 text-rose-600"
            >
              Remove
            </button>
          </div>
        </div>

        {/* Strategy is what this step IS; the wait is when. Time-of-day is a
            rarely-needed override and sits behind a disclosure so it stops
            competing with the two fields that matter. */}
        <div className="mt-3 grid gap-4 sm:grid-cols-[1fr_auto]">
          <div>
            <label className="label text-xs" htmlFor={`strategy-${step.id}`}>
              Write it with
            </label>
            <select
              id={`strategy-${step.id}`}
              value={form.strategy_id}
              onChange={(e) => setForm((f) => ({ ...f, strategy_id: e.target.value }))}
              className="input"
            >
              {/* Keep the saved strategy visible even if it's no longer an active opener. */}
              {!openers.some((s) => s.id === step.strategy_id) && (
                <option value={step.strategy_id ?? ""}>
                  {step.strategy_name ?? "(no strategy)"}
                </option>
              )}
              {openers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:w-40">
            <label className="label text-xs" htmlFor={`wait-${step.id}`}>
              {index === 0 ? "Days after enrolling" : "Days after step " + index}
            </label>
            <input
              id={`wait-${step.id}`}
              type="number"
              min={0}
              max={90}
              value={form.wait_days}
              onChange={(e) =>
                setForm((f) => ({ ...f, wait_days: Number(e.target.value) }))
              }
              className="input"
            />
          </div>
        </div>

        {showTime || form.send_at_time ? (
          <div className="mt-3 sm:w-56">
            <label className="label text-xs" htmlFor={`time-${step.id}`}>
              Send at this time of day
            </label>
            <input
              id={`time-${step.id}`}
              type="time"
              value={form.send_at_time}
              onChange={(e) => setForm((f) => ({ ...f, send_at_time: e.target.value }))}
              className="input"
            />
            <p className="mt-1 text-xs text-muted">
              Leave empty to use your default{defaultTimeLabel}.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setShowTime(true)}
            className="mt-2 text-xs text-accent hover:underline"
          >
            + Set a time of day for this step
          </button>
        )}

        {showInstructions ? (
          <div className="mt-3">
            <label className="label text-xs" htmlFor={`instr-${step.id}`}>
              Step instructions (optional)
            </label>
            <textarea
              id={`instr-${step.id}`}
              rows={3}
              value={form.step_instructions}
              onChange={(e) =>
                setForm((f) => ({ ...f, step_instructions: e.target.value }))
              }
              placeholder="Reference the earlier email. Keep it to three sentences."
              className="input resize-y text-sm"
            />
            <p className="mt-1 text-xs text-muted">
              Appended to the strategy prompt for this step only.
            </p>
          </div>
        ) : (
          <button
            onClick={() => setShowInstructions(true)}
            className="mt-3 text-xs text-accent hover:underline"
          >
            + Add per-step instructions
          </button>
        )}

        {dirty && (
          <div className="mt-3 flex gap-2 border-t border-line pt-3">
            <button onClick={save} disabled={pending} className="btn-primary h-9">
              {pending ? "Saving…" : "Save step"}
            </button>
            <button
              onClick={() =>
                setForm({
                  wait_days: step.wait_days,
                  send_at_time: toHHMM(step.send_at_time),
                  strategy_id: step.strategy_id ?? "",
                  step_instructions: step.step_instructions ?? "",
                })
              }
              className="btn-ghost h-9"
            >
              Discard
            </button>
          </div>
        )}
      </div>
      <Toast state={toast} />
    </>
  );
}

function AddStepForm({
  sequenceId,
  openers,
  isFirst,
}: {
  sequenceId: string;
  openers: Strategy[];
  isFirst: boolean;
}) {
  const [waitDays, setWaitDays] = useState(isFirst ? 0 : 3);
  const [strategyId, setStrategyId] = useState(openers[0]?.id ?? "");
  const [sendAtTime, setSendAtTime] = useState("");
  const [instructions, setInstructions] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function add() {
    startTransition(async () => {
      const result = await addStepAction(sequenceId, {
        wait_days: waitDays,
        send_at_time: sendAtTime || null,
        strategy_id: strategyId,
        step_instructions: instructions.trim() || null,
      });
      show(result);
      if (result.ok) {
        setInstructions("");
        setSendAtTime("");
        setWaitDays(3);
        router.refresh();
      }
    });
  }

  return (
    <>
      <div className="card border-dashed p-5">
        <p className="text-sm font-semibold text-ink">Add a step</p>
        <div className="mt-3 grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label text-xs" htmlFor="new-wait">Wait (days)</label>
            <input
              id="new-wait"
              type="number"
              min={0}
              max={90}
              value={waitDays}
              onChange={(e) => setWaitDays(Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label className="label text-xs" htmlFor="new-strategy">Strategy</label>
            <select
              id="new-strategy"
              value={strategyId}
              onChange={(e) => setStrategyId(e.target.value)}
              className="input"
              disabled={openers.length === 0}
            >
              {openers.length === 0 ? (
                <option value="">No opener strategies yet</option>
              ) : (
                openers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))
              )}
            </select>
          </div>
          <div>
            <label className="label text-xs" htmlFor="new-time">Send at (optional)</label>
            <input
              id="new-time"
              type="time"
              value={sendAtTime}
              onChange={(e) => setSendAtTime(e.target.value)}
              className="input"
            />
          </div>
        </div>
        <div className="mt-3">
          <textarea
            rows={2}
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Per-step instructions (optional)"
            aria-label="Per-step instructions"
            className="input resize-y text-sm"
          />
        </div>
        <button
          onClick={add}
          disabled={pending || !strategyId}
          className="btn-primary mt-3 h-9"
        >
          {pending ? "Adding…" : "Add step"}
        </button>
      </div>
      <Toast state={toast} />
    </>
  );
}

export function SequenceBuilder({
  sequence,
  openers,
  settings,
}: {
  sequence: AutomationSequence;
  openers: Strategy[];
  settings: AutomationSettings | null;
}) {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const steps = [...sequence.steps].sort((a, b) => a.position - b.position);

  // Cumulative day each step lands on.
  const offsets: number[] = [];
  let day = 0;
  for (const step of steps) {
    day += step.wait_days;
    offsets.push(day);
  }

  // "(9:00 am)" -- so the per-step override says what it overrides.
  const defaultTimeLabel = settings
    ? ` (${settings.default_send_time.slice(0, 5)})`
    : "";

  function move(index: number, direction: -1 | 1) {
    const ids = steps.map((s) => s.id);
    const target = index + direction;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];

    startTransition(async () => {
      const result = await reorderStepsAction(sequence.id, ids);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-ink">Steps</h2>
        {settings && (
          <p className="mt-1 text-xs text-muted">
            Each step is written by Claude when it comes due, using the whole
            thread so far. Sends {windowSummary(settings)}.
          </p>
        )}
      </div>

      {openers.length === 0 && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
          No active opener strategies. Create one on the Strategies page — steps
          write their emails from a strategy.
        </div>
      )}

      {steps.length === 0 && (
        <p className="text-sm text-muted">
          No steps yet. The first step usually waits 0 days, so it drafts as soon
          as a prospect is enrolled.
        </p>
      )}

      {steps.map((step, index) => (
        <StepRow
          key={step.id}
          step={step}
          index={index}
          total={steps.length}
          dayOffset={offsets[index]}
          sequenceId={sequence.id}
          openers={openers}
          defaultTimeLabel={defaultTimeLabel}
          onMove={move}
          moving={pending}
        />
      ))}

      <AddStepForm
        sequenceId={sequence.id}
        openers={openers}
        isFirst={steps.length === 0}
      />

      <Toast state={toast} />
    </div>
  );
}
