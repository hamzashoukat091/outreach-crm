"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { createSequenceAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";

interface DraftStep {
  key: number;
  delay_days: number;
  subject: string;
  body: string;
}

const MERGE_FIELDS = ["first_name", "last_name", "full_name", "company", "title"];

let nextKey = 1;
const newStep = (delay: number): DraftStep => ({
  key: nextKey++,
  delay_days: delay,
  subject: "",
  body: "",
});

export function SequenceBuilder() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<DraftStep[]>([newStep(0)]);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function patchStep(key: number, patch: Partial<DraftStep>) {
    setSteps((prev) => prev.map((s) => (s.key === key ? { ...s, ...patch } : s)));
  }

  function reset() {
    setName("");
    setDescription("");
    setSteps([newStep(0)]);
    setOpen(false);
  }

  function submit() {
    startTransition(async () => {
      const result = await createSequenceAction({
        name,
        description,
        steps: steps.map((s, i) => ({
          step_order: i + 1,
          delay_days: Number(s.delay_days) || 0,
          subject: s.subject,
          body: s.body,
        })),
      });
      show(result);
      if (result.ok) {
        reset();
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="btn-primary">
          New sequence
        </button>
        <Toast state={toast} />
      </>
    );
  }

  return (
    <>
      <div className="card w-full p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="seq-name">
              Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="seq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cold outreach — 3 touch"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="seq-desc">Description</label>
            <input
              id="seq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input"
            />
          </div>
        </div>

        <p className="mt-4 text-xs text-muted">
          Merge fields:{" "}
          {MERGE_FIELDS.map((f) => (
            <code key={f} className="mr-1.5 rounded bg-surface-2 px-1.5 py-0.5">
              {`{{${f}}}`}
            </code>
          ))}
          — blanks render as empty text.
        </p>

        <div className="mt-5 space-y-4">
          {steps.map((step, index) => (
            <div key={step.key} className="rounded-lg border border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-ink">Step {index + 1}</span>
                <div className="flex items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted">
                    Wait
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={step.delay_days}
                      onChange={(e) =>
                        patchStep(step.key, { delay_days: Number(e.target.value) })
                      }
                      className="input h-8 w-16 py-0 text-center"
                    />
                    days
                  </label>
                  {steps.length > 1 && (
                    <button
                      onClick={() =>
                        setSteps((prev) => prev.filter((s) => s.key !== step.key))
                      }
                      className="text-xs text-rose-600 hover:underline"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              <input
                value={step.subject}
                onChange={(e) => patchStep(step.key, { subject: e.target.value })}
                placeholder="Quick question about {{company}}"
                className="input mb-2"
              />
              <textarea
                value={step.body}
                onChange={(e) => patchStep(step.key, { body: e.target.value })}
                rows={5}
                placeholder="Hi {{first_name}},&#10;&#10;…"
                className="input resize-y"
              />
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={() =>
              setSteps((prev) => [...prev, newStep(prev.length === 0 ? 0 : 3)])
            }
            className="btn-secondary"
          >
            Add step
          </button>
          <div className="ml-auto flex gap-2">
            <button onClick={reset} className="btn-ghost">
              Cancel
            </button>
            <button onClick={submit} disabled={pending} className="btn-primary">
              {pending ? "Creating…" : "Create sequence"}
            </button>
          </div>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
