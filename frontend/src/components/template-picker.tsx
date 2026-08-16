"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { applyTemplateAction } from "@/app/automation-actions";
import { api } from "@/lib/api";
import type { SequenceTemplate } from "@/lib/types";
import { Toast, useToast } from "@/components/toast";

/** Ready-made shapes, so building a sequence is picking one rather than
 *  assembling steps and remembering which strategy belongs where. */
export function TemplatePicker({ onClose }: { onClose: () => void }) {
  const [templates, setTemplates] = useState<SequenceTemplate[] | null>(null);
  const [pending, startTransition] = useTransition();
  const [applying, setApplying] = useState<string | null>(null);
  const { toast, show } = useToast();
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    api
      .listSequenceTemplates()
      .then((data) => !cancelled && setTemplates(data))
      .catch(() => !cancelled && setTemplates([]));
    return () => {
      cancelled = true;
    };
  }, []);

  function apply(template: SequenceTemplate) {
    setApplying(template.key);
    startTransition(async () => {
      const result = await applyTemplateAction(template.key);
      show(result);
      setApplying(null);
      // Land in the editor: the template is a starting point, and the first
      // thing anyone does is rename it or adjust the timing.
      if (result.ok && result.id) router.push(`/sequences/${result.id}`);
    });
  }

  return (
    <>
      <div className="card p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Start from a template</h2>
            <p className="mt-0.5 text-xs text-muted">
              Each one creates a real sequence you can edit. Nothing sends until
              you enroll someone.
            </p>
          </div>
          <button onClick={onClose} className="btn-ghost h-8 shrink-0 text-xs">
            Close
          </button>
        </div>

        {templates === null ? (
          <p className="mt-4 text-sm text-muted">Loading templates…</p>
        ) : (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <div
                key={template.key}
                className="flex flex-col rounded-xl border border-line p-4"
              >
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="text-sm font-medium text-ink">{template.name}</h3>
                  <span className="shrink-0 text-xs text-muted">
                    {template.steps.length} step
                    {template.steps.length === 1 ? "" : "s"}
                    {template.total_days > 0 ? ` · ${template.total_days}d` : ""}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted">{template.best_for}</p>

                <ol className="mt-3 space-y-1">
                  {template.steps.map((step) => (
                    <li key={step.position} className="flex gap-2 text-xs">
                      <span className="w-10 shrink-0 tabular-nums text-muted">
                        {step.position === 1 ? "Day 0" : `+${step.wait_days}d`}
                      </span>
                      <span className="min-w-0 truncate text-ink">
                        {step.strategy_name}
                      </span>
                    </li>
                  ))}
                </ol>

                {/* An angle this preset expects but the database lacks. It
                    still applies -- the step is simply left unset -- so say
                    so rather than letting it look configured. */}
                {template.missing_strategies.length > 0 && (
                  <p className="mt-2 text-xs text-amber-600">
                    Missing: {template.missing_strategies.join(", ")} — those
                    steps need a strategy after creating.
                  </p>
                )}

                <button
                  onClick={() => apply(template)}
                  disabled={pending}
                  className="btn-secondary mt-3 h-8 w-full text-xs"
                >
                  {applying === template.key ? "Creating…" : "Use this"}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Toast state={toast} />
    </>
  );
}
