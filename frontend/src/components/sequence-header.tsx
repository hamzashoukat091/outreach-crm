"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { updateSequenceAction } from "@/app/automation-actions";
import type { AutomationSequence } from "@/lib/types";
import { enrollmentSummary } from "@/components/automation-ui";
import { Toast, useToast } from "@/components/toast";

/** The sequence title, editable in place.
 *
 *  Every template creates a sequence named after the preset, so renaming is
 *  the expected first move -- and the name was plain text with no way to
 *  change it anywhere in the app. */
export function SequenceHeader({ sequence }: { sequence: AutomationSequence }) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(sequence.name);
  const [description, setDescription] = useState(sequence.description ?? "");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function save() {
    const trimmed = name.trim();
    if (!trimmed) {
      show({ ok: false, message: "A sequence needs a name." });
      return;
    }

    startTransition(async () => {
      const result = await updateSequenceAction(sequence.id, {
        name: trimmed,
        description: description.trim(),
      });
      show(result);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function cancel() {
    setName(sequence.name);
    setDescription(sequence.description ?? "");
    setEditing(false);
  }

  if (editing) {
    return (
      <>
        <div className="mb-6 card p-5">
          <label className="label" htmlFor="seq-name">
            Name
          </label>
          <input
            id="seq-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={200}
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            className="input font-medium"
          />

          <label className="label mt-3" htmlFor="seq-description">
            Description
          </label>
          <input
            id="seq-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What this sequence is for"
            onKeyDown={(e) => {
              if (e.key === "Enter") save();
              if (e.key === "Escape") cancel();
            }}
            className="input"
          />

          <div className="mt-3 flex items-center gap-2">
            <button onClick={save} disabled={pending} className="btn-primary h-9">
              {pending ? "Saving…" : "Save"}
            </button>
            <button onClick={cancel} disabled={pending} className="btn-ghost h-9">
              Cancel
            </button>
          </div>
        </div>
        <Toast state={toast} />
      </>
    );
  }

  return (
    <>
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {sequence.name}
          </h1>
          {!sequence.is_active && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              inactive
            </span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-sm text-accent hover:underline"
          >
            Rename
          </button>
        </div>
        <p className="mt-1 text-sm text-muted">
          {sequence.description || "No description."} · {enrollmentSummary(sequence)}
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
      <Toast state={toast} />
    </>
  );
}
