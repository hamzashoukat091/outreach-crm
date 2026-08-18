"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState, useTransition } from "react";
import {
  archiveProspectAction,
  deleteProspectAction,
  generateAction,
  logProspectEventAction,
  setProspectStatusAction,
  updateProspectAction,
} from "@/app/prospect-actions";
import type { Prospect, ProspectStatus, Strategy } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

// 'archived' is not a status here -- use the Archive button, which preserves
// whatever real outcome the prospect already had.
const STATUSES: ProspectStatus[] = [
  "new",
  "drafted",
  "approved",
  "replied",
  "bounced",
  "not_interested",
  "won",
];

const STATUS_LABEL: Record<string, string> = {
  approved: "Sent (copied manually)",
  not_interested: "Not interested",
};

// Filling any of these turns a thin prospect into a well-grounded one.
const CONTEXT_FIELDS: { name: keyof Prospect; label: string; textarea?: boolean }[] = [
  { name: "company_name", label: "Company name" },
  { name: "industry", label: "Industry" },
  { name: "employee_range", label: "Employees (e.g. 51-200)" },
  { name: "company_description", label: "What the company does", textarea: true },
];

export function ProspectPanel({
  prospect,
  strategies,
  aiConfigured,
}: {
  prospect: Prospect;
  strategies: Strategy[];
  aiConfigured: boolean;
}) {
  const router = useRouter();
  const { toast, show } = useToast();
  const [pending, startTransition] = useTransition();
  const [strategyId, setStrategyId] = useState(
    strategies.find((s) => s.is_default)?.id ?? strategies[0]?.id ?? "",
  );
  const [editingContext, setEditingContext] = useState(false);

  const logEvent = logProspectEventAction.bind(null, prospect.id);
  const [eventState, eventAction, eventPending] = useActionState(logEvent, null);

  const saveContext = updateProspectAction.bind(null, prospect.id);
  const [contextState, contextAction, contextPending] = useActionState(saveContext, null);

  useEffect(() => {
    if (eventState) {
      show(eventState);
      if (eventState.ok) router.refresh();
    }
  }, [eventState, show, router]);

  useEffect(() => {
    if (contextState) {
      show(contextState);
      if (contextState.ok) {
        setEditingContext(false);
        router.refresh();
      }
    }
  }, [contextState, show, router]);

  function generate() {
    if (!strategyId) {
      show({ ok: false, message: "Create a strategy first." });
      return;
    }
    startTransition(async () => {
      const result = await generateAction(prospect.id, strategyId);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function changeStatus(status: ProspectStatus) {
    if (status === prospect.status) return;
    startTransition(async () => {
      show(await setProspectStatusAction(prospect.id, status));
      router.refresh();
    });
  }

  function toggleArchive() {
    if (prospect.is_archived) {
      startTransition(async () => {
        show(await archiveProspectAction(prospect.id, false));
        router.refresh();
      });
      return;
    }

    const reason = window.prompt(
      "Archive this prospect? They'll be hidden from your list and excluded " +
        "from analytics, but nothing is deleted.\n\nReason (optional):",
      "",
    );
    // prompt() returns null when cancelled; empty string is a valid "no reason".
    if (reason === null) return;

    startTransition(async () => {
      show(await archiveProspectAction(prospect.id, true, reason || undefined));
      router.refresh();
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Delete ${prospect.full_name}? Their drafts and history go too. This can't be undone.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await deleteProspectAction(prospect.id);
      show(result);
      if (result.ok) router.push("/prospects");
    });
  }

  return (
    <>
      <div className="space-y-4">
        <div className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Generate email</h2>

          {!aiConfigured && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              No API key configured. Add ANTHROPIC_API_KEY to .env and restart the api service.
            </p>
          )}

          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className="input mt-3"
            disabled={strategies.length === 0}
          >
            {strategies.length === 0 ? (
              <option value="">No strategies yet</option>
            ) : (
              strategies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.is_default ? " (default)" : ""}
                </option>
              ))
            )}
          </select>

          <button
            onClick={generate}
            disabled={
              pending || !aiConfigured || strategies.length === 0 || prospect.is_archived
            }
            className="btn-primary mt-3 w-full"
          >
            {pending ? "Generating…" : "Generate draft"}
          </button>

          <p className="mt-2 text-xs text-muted">
            {prospect.is_archived
              ? "Archived — restore this prospect to generate emails."
              : prospect.is_complete
              ? "Full company context available."
              : "Limited context — the email will rely on the job title."}
          </p>
        </div>

        {!prospect.is_complete && (
          <div className="card p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-ink">Add company context</h2>
              {!editingContext && (
                <button
                  onClick={() => setEditingContext(true)}
                  className="text-xs text-accent hover:underline"
                >
                  Fill in
                </button>
              )}
            </div>

            {editingContext ? (
              <form action={contextAction} className="mt-3 space-y-3">
                {CONTEXT_FIELDS.map((field) => (
                  <div key={field.name}>
                    <label className="label text-xs" htmlFor={`f-${field.name}`}>
                      {field.label}
                    </label>
                    {field.textarea ? (
                      <textarea
                        id={`f-${field.name}`}
                        name={field.name}
                        rows={3}
                        defaultValue={(prospect[field.name] as string) ?? ""}
                        className="input resize-y text-sm"
                      />
                    ) : (
                      <input
                        id={`f-${field.name}`}
                        name={field.name}
                        defaultValue={(prospect[field.name] as string) ?? ""}
                        className="input text-sm"
                      />
                    )}
                  </div>
                ))}
                <div className="flex gap-2">
                  <button type="submit" disabled={contextPending} className="btn-primary h-9">
                    {contextPending ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingContext(false)}
                    className="btn-ghost h-9"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : (
              <p className="mt-2 text-xs text-muted">
                A sentence about what they do makes a noticeably better email.
              </p>
            )}
          </div>
        )}

        <div className="card p-5">
          <label className="label" htmlFor="p-status">Status</label>
          <select
            id="p-status"
            value={prospect.status}
            disabled={pending}
            onChange={(e) => changeStatus(e.target.value as ProspectStatus)}
            className="input"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </select>

          <form action={eventAction} className="mt-5">
            <label className="label" htmlFor="p-summary">Log activity</label>
            <textarea
              id="p-summary"
              name="summary"
              rows={3}
              placeholder="Replied asking about pricing."
              className="input resize-y"
            />
            <div className="mt-2 flex items-center gap-2">
              <select name="type" defaultValue="note" className="input h-9 w-auto py-0">
                <option value="note">Note</option>
                <option value="replied">They replied</option>
                <option value="bounced">Bounced</option>
              </select>
              <button type="submit" disabled={eventPending} className="btn-primary h-9">
                {eventPending ? "Saving…" : "Add"}
              </button>
            </div>
          </form>

          {/* Archive is the reversible option, so it sits above delete. */}
          <button
            onClick={toggleArchive}
            disabled={pending}
            className="btn-secondary mt-5 w-full"
          >
            {prospect.is_archived ? "Restore to active list" : "Archive prospect"}
          </button>

          <button
            onClick={remove}
            disabled={pending}
            className="btn-danger mt-2 w-full"
          >
            Delete prospect
          </button>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
