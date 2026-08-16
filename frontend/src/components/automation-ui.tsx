import type { AutomationSequence, EnrollmentState, SequenceStep } from "@/lib/types";
import type { ReplySituation } from "@/lib/prospect-types";

/** Live enrollment state in words. "Enrolled" always means right now --
 *  finished runs are named separately, or the two numbers look contradictory
 *  ("2 enrolled, 0 active") once anyone stops. */
export function enrollmentSummary(sequence: AutomationSequence): string {
  const parts: string[] = [];

  if (sequence.open_enrollments === 0) {
    parts.push("No one enrolled");
  } else {
    parts.push(
      `${sequence.open_enrollments} enrolled` +
        (sequence.paused_enrollments
          ? ` (${sequence.paused_enrollments} paused)`
          : ""),
    );
  }

  // Only mention history when there is some, so a fresh sequence stays quiet.
  if (sequence.finished_enrollments > 0) {
    parts.push(`${sequence.finished_enrollments} finished`);
  }
  return parts.join(" · ");
}

const ENROLLMENT_TONE: Record<EnrollmentState, string> = {
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  replied: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  stopped: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  bounced: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  completed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function EnrollmentStateBadge({ state }: { state: EnrollmentState }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        ENROLLMENT_TONE[state] ?? ENROLLMENT_TONE.completed
      }`}
    >
      {state}
    </span>
  );
}

const SITUATION_TONE: Record<ReplySituation, string> = {
  interested: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  question: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  objection: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  not_now: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  referral: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  not_interested: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  unsubscribe: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  auto_reply: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  unclear: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function SituationBadge({ situation }: { situation: ReplySituation | null }) {
  if (!situation) return null;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        SITUATION_TONE[situation] ?? SITUATION_TONE.unclear
      }`}
    >
      {situation.replace("_", " ")}
    </span>
  );
}

const MESSAGE_STATE_TONE: Record<string, string> = {
  sent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  pending_approval: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  queued: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  scheduled: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  draft: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  received: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
};

export function MessageStateBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        MESSAGE_STATE_TONE[state] ??
        "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
      }`}
    >
      {state.replace(/_/g, " ")}
    </span>
  );
}

export function PipelineModeBadge({ mode }: { mode: "manual" | "automated" }) {
  return (
    <span
      title={
        mode === "automated"
          ? "The automation engine owns this prospect's outreach."
          : "You send emails to this prospect by hand."
      }
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        mode === "automated"
          ? "bg-accent-soft text-accent"
          : "bg-surface-2 text-muted"
      }`}
    >
      {mode}
    </span>
  );
}

/** "3 steps · Day 0, 3, 8" — cumulative wait_days across ordered steps. */
export function stepSummary(steps: SequenceStep[]): string {
  if (steps.length === 0) return "No steps yet";

  const ordered = [...steps].sort((a, b) => a.position - b.position);
  let day = 0;
  const days = ordered.map((step) => {
    day += step.wait_days;
    return day;
  });

  return `${steps.length} step${steps.length === 1 ? "" : "s"} · Day ${days.join(", ")}`;
}
