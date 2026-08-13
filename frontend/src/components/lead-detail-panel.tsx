"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useTransition } from "react";
import { addNoteAction, deleteLeadAction, updateLeadStatusAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";
import type { Lead, LeadStatus } from "@/lib/types";

const STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "replied",
  "qualified",
  "won",
  "lost",
  "unsubscribed",
];

// Changing to one of these pulls the lead out of every active sequence.
const HALTING: LeadStatus[] = ["replied", "won", "lost", "unsubscribed"];

export function LeadDetailPanel({ lead }: { lead: Lead }) {
  const router = useRouter();
  const { toast, show } = useToast();
  const [pending, startTransition] = useTransition();

  const addNote = addNoteAction.bind(null, lead.id);
  const [noteState, noteAction, notePending] = useActionState(addNote, null);

  useEffect(() => {
    if (noteState) {
      show(noteState);
      if (noteState.ok) router.refresh();
    }
  }, [noteState, show, router]);

  function changeStatus(status: LeadStatus) {
    if (status === lead.status) return;

    if (HALTING.includes(status)) {
      const ok = window.confirm(
        `Setting this lead to "${status}" will stop any active sequences and cancel their queued emails. Continue?`,
      );
      if (!ok) return;
    }

    startTransition(async () => {
      show(await updateLeadStatusAction(lead.id, status));
      router.refresh();
    });
  }

  function remove() {
    const ok = window.confirm(
      `Delete ${lead.full_name}? This removes their timeline and any scheduled emails. This cannot be undone.`,
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await deleteLeadAction(lead.id);
      show(result);
      if (result.ok) router.push("/leads");
    });
  }

  return (
    <>
      <div className="card p-5">
        <label className="label" htmlFor="status">Status</label>
        <select
          id="status"
          value={lead.status}
          disabled={pending}
          onChange={(e) => changeStatus(e.target.value as LeadStatus)}
          className="input"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <form action={noteAction} className="mt-5">
          <label className="label" htmlFor="summary">Log activity</label>
          <textarea
            id="summary"
            name="summary"
            rows={3}
            placeholder="Left a voicemail; asked to follow up next week."
            className="input resize-y"
          />
          <div className="mt-2 flex items-center gap-2">
            <select name="type" className="input h-9 w-auto py-0" defaultValue="note">
              <option value="note">Note</option>
              <option value="replied">They replied</option>
            </select>
            <button type="submit" disabled={notePending} className="btn-primary h-9">
              {notePending ? "Saving…" : "Add"}
            </button>
          </div>
          <p className="mt-2 text-xs text-muted">
            Logging a reply stops every active sequence for this lead.
          </p>
        </form>

        <button
          onClick={remove}
          disabled={pending}
          className="btn-ghost mt-5 w-full text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950"
        >
          Delete lead
        </button>
      </div>

      <Toast state={toast} />
    </>
  );
}
