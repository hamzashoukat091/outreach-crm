"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { deleteSequenceAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";
import type { Sequence } from "@/lib/types";

export function SequenceCard({ sequence }: { sequence: Sequence }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function remove() {
    const warning = sequence.active_enrollments
      ? `"${sequence.name}" has ${sequence.active_enrollments} active enrollment(s). Deleting it cancels their queued emails. Continue?`
      : `Delete "${sequence.name}"?`;
    if (!window.confirm(warning)) return;

    startTransition(async () => {
      const result = await deleteSequenceAction(sequence.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-medium text-ink">{sequence.name}</h3>
            {sequence.description && (
              <p className="mt-0.5 text-sm text-muted">{sequence.description}</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {sequence.steps.length} step{sequence.steps.length === 1 ? "" : "s"} ·{" "}
              {sequence.active_enrollments} active enrollment
              {sequence.active_enrollments === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setExpanded((v) => !v)} className="btn-secondary h-9">
              {expanded ? "Hide" : "View"}
            </button>
            <button
              onClick={remove}
              disabled={pending}
              className="btn-ghost h-9 text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
            >
              Delete
            </button>
          </div>
        </div>

        {expanded && (
          <ol className="mt-4 space-y-3 border-t border-line pt-4">
            {sequence.steps.map((step) => (
              <li key={step.id} className="rounded-lg bg-surface-2 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-ink">
                    Step {step.step_order}: {step.subject}
                  </span>
                  <span className="text-xs text-muted">
                    {step.delay_days === 0
                      ? "sends immediately"
                      : `waits ${step.delay_days} day${step.delay_days === 1 ? "" : "s"}`}
                  </span>
                </div>
                <p className="prose-email mt-2 text-xs text-muted">{step.body}</p>
              </li>
            ))}
          </ol>
        )}
      </div>

      <Toast state={toast} />
    </>
  );
}
