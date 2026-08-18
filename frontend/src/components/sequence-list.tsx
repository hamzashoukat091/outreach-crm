"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  createSequenceAction,
  deleteSequenceAction,
  updateSequenceAction,
} from "@/app/automation-actions";
import type { AutomationSequence } from "@/lib/types";
import { enrollmentSummary, stepSummary } from "@/components/automation-ui";
import { EmptyState } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

function NewSequenceForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function create() {
    startTransition(async () => {
      const result = await createSequenceAction({ name, description });
      show(result);
      if (result.ok) {
        router.refresh();
        if (result.id) router.push(`/sequences/${result.id}`);
        onDone();
      }
    });
  }

  return (
    <>
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="seq-name">
              Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="seq-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Cold outreach — 3 touches"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="seq-desc">Description</label>
            <input
              id="seq-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Opener plus two follow-ups over a week"
              className="input"
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button onClick={create} disabled={pending} className="btn-primary">
            {pending ? "Creating…" : "Create sequence"}
          </button>
          <button onClick={onDone} className="btn-ghost">
            Cancel
          </button>
        </div>
      </div>
      <Toast state={toast} />
    </>
  );
}

function SequenceCard({ sequence }: { sequence: AutomationSequence }) {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function toggleActive() {
    startTransition(async () => {
      const result = await updateSequenceAction(sequence.id, {
        is_active: !sequence.is_active,
      });
      show(
        result.ok
          ? {
              ok: true,
              message: sequence.is_active
                ? "Sequence deactivated — no new sends from it."
                : "Sequence activated.",
            }
          : result,
      );
      if (result.ok) router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Delete "${sequence.name}"? Its steps go too, and no more automated emails will be sent from it.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteSequenceAction(sequence.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <div className="card p-5 transition-shadow duration-200 hover:shadow-card-hover">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Link
                href={`/sequences/${sequence.id}`}
                className="font-medium text-ink hover:text-accent"
              >
                {sequence.name}
              </Link>
              {!sequence.is_active && (
                <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
                  inactive
                </span>
              )}
            </div>
            {sequence.description && (
              <p className="mt-0.5 text-sm text-muted">{sequence.description}</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {enrollmentSummary(sequence)}
              {sequence.total_enrollments > 0 && (
                <>
                  {" · "}
                  <Link
                    href={`/sequences/enrollments?sequence_id=${sequence.id}`}
                    className="text-accent hover:underline"
                  >
                    View enrollments
                  </Link>
                </>
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={sequence.is_active}
                onChange={toggleActive}
                disabled={pending}
                className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
              />
              Active
            </label>
            <Link href={`/sequences/${sequence.id}`} className="btn-secondary h-9">
              Edit
            </Link>
            <button
              onClick={remove}
              disabled={pending}
              className="btn-danger h-9"
            >
              Delete
            </button>
          </div>
        </div>

        {/* The steps themselves. "3 steps · Day 0, 3, 8" said how many and
            when but never what -- and what it sends is the thing you are
            deciding about when you look at this card. */}
        {sequence.steps.length > 0 && (
          <ol className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-2 border-t border-line pt-3">
            {[...sequence.steps]
              .sort((a, b) => a.position - b.position)
              .map((step, index) => (
                <li key={step.id} className="flex items-center gap-2">
                  {index > 0 && (
                    <span aria-hidden className="text-xs text-muted/50">
                      →
                    </span>
                  )}
                  <span
                    className={`rounded-lg border px-2 py-1 text-xs ${
                      step.is_active
                        ? "border-line bg-surface-2/60 text-ink"
                        : "border-dashed border-line text-muted line-through"
                    }`}
                    title={step.is_active ? undefined : "This step is turned off"}
                  >
                    <span className="text-muted">
                      {index === 0 ? "Day 0" : `+${step.wait_days}d`}
                    </span>{" "}
                    {step.strategy_name ?? (
                      <span className="text-amber-600">no strategy</span>
                    )}
                  </span>
                </li>
              ))}
          </ol>
        )}
      </div>
      <Toast state={toast} />
    </>
  );
}

export function SequenceList({
  sequences,
  creating,
  onCreatingChange,
}: {
  sequences: AutomationSequence[];
  creating: boolean;
  onCreatingChange: (value: boolean) => void;
}) {
  const setCreating = onCreatingChange;

  return (
    <div className="space-y-3">
      {creating && <NewSequenceForm onDone={() => setCreating(false)} />}

      {sequences.length === 0 && !creating ? (
        <div className="card">
          <EmptyState
            title="No sequences yet"
            description="A sequence is an ordered set of steps — each one drafts an email with a strategy, waits, and moves on. Create one to start."
            action={
              <button onClick={() => setCreating(true)} className="btn-primary">
                New sequence
              </button>
            }
          />
        </div>
      ) : (
        sequences.map((sequence) => (
          <SequenceCard key={sequence.id} sequence={sequence} />
        ))
      )}
    </div>
  );
}
