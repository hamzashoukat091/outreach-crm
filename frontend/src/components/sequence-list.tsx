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
import { stepSummary } from "@/components/automation-ui";
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
      <div className="card p-5">
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
              {stepSummary(sequence.steps)} · {sequence.total_enrollments} enrolled ·{" "}
              {sequence.active_enrollments} active
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
              className="btn-ghost h-9 text-rose-600"
            >
              Delete
            </button>
          </div>
        </div>
      </div>
      <Toast state={toast} />
    </>
  );
}

export function SequenceList({ sequences }: { sequences: AutomationSequence[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-4">
      {creating ? (
        <NewSequenceForm onDone={() => setCreating(false)} />
      ) : (
        <div className="flex justify-end">
          <button onClick={() => setCreating(true)} className="btn-primary">
            New sequence
          </button>
        </div>
      )}

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
