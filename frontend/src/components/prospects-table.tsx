"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  bulkArchiveAction,
  bulkDeleteProspectsAction,
  generateBulkAction,
} from "@/app/prospect-actions";
import {
  bulkHandoffAction,
  bulkReturnToManualAction,
} from "@/app/automation-actions";
import type { Prospect, Strategy } from "@/lib/prospect-types";
import type { EnrollmentState } from "@/lib/types";
import { EmptyState, Tag, formatDate } from "@/components/ui";
import { EnrollmentStateBadge } from "@/components/automation-ui";
import { ProspectStatusBadge } from "@/components/prospect-ui";
import { Toast, useToast } from "@/components/toast";

export function ProspectsTable({
  prospects,
  strategies,
  archivedView = false,
}: {
  prospects: Prospect[];
  strategies: Strategy[];
  archivedView?: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [strategyId, setStrategyId] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const allSelected = prospects.length > 0 && selected.size === prospects.length;
  const defaultStrategy = strategies.find((s) => s.is_default) ?? strategies[0];

  // How many of the selected rows the automation side currently owns. Decides
  // which direction the pipeline button offers.
  const selectedAutomated = prospects.filter(
    (p) => selected.has(p.id) && p.pipeline_mode === "automated",
  ).length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function generate() {
    const target = strategyId || defaultStrategy?.id;
    if (!target) {
      show({ ok: false, message: "Create a strategy first." });
      return;
    }

    startTransition(async () => {
      const result = await generateBulkAction([...selected], target);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function archive(archived: boolean) {
    if (archived && !window.confirm(
      `Archive ${selected.size} prospect(s)? They'll be hidden from this list ` +
      `and excluded from analytics. Nothing is deleted.`,
    )) {
      return;
    }

    startTransition(async () => {
      const result = await bulkArchiveAction([...selected], archived);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function handoff() {
    if (
      !window.confirm(
        `Hand off ${selected.size} prospect(s) to automation? The engine takes over their outreach.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await bulkHandoffAction([...selected]);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function returnToManual() {
    if (
      !window.confirm(
        `Return ${selected.size} prospect(s) to manual outreach? You write and ` +
          `send their emails by hand again. Anyone mid-sequence is skipped.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await bulkReturnToManualAction([...selected]);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  function remove() {
    if (
      !window.confirm(
        `Delete ${selected.size} prospect(s)? Their drafts and history go too. This can't be undone.`,
      )
    ) {
      return;
    }

    startTransition(async () => {
      const result = await bulkDeleteProspectsAction([...selected]);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  if (prospects.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title={archivedView ? "Nothing archived" : "No prospects match"}
          description={
            archivedView
              ? "Prospects you archive are kept here, out of your active list and analytics."
              : "Clear the filters, or import a CSV to get started."
          }
        />
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-3 rounded-xl
          border border-accent/25 bg-accent-soft/90 px-4 py-3 shadow-card backdrop-blur-md
          animate-fade-up">
          <span className="tabular text-sm font-medium text-ink">
            {selected.size} selected
          </span>

          <select
            value={strategyId}
            onChange={(e) => setStrategyId(e.target.value)}
            className={`input h-9 w-auto min-w-52 py-0 ${archivedView ? "hidden" : ""}`}
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

          {archivedView ? (
            <button
              onClick={() => archive(false)}
              disabled={pending}
              className="btn-primary h-9"
            >
              {pending ? "Restoring…" : `Restore ${selected.size}`}
            </button>
          ) : (
            <>
              <button
                onClick={generate}
                disabled={pending || strategies.length === 0 || selected.size > 25}
                className="btn-primary h-9"
                title={selected.size > 25 ? "Generate at most 25 at a time" : undefined}
              >
                {pending ? "Generating…" : `Generate ${selected.size} email(s)`}
              </button>
              {/* Whichever direction the selection can actually move. Showing
                  both at once invites picking the one that does nothing. */}
              {selectedAutomated > 0 ? (
                <button
                  onClick={returnToManual}
                  disabled={pending}
                  className="btn-secondary h-9"
                  title="Take these prospects back into the manual Outreach pipeline"
                >
                  Return to manual
                  {selectedAutomated < selected.size ? ` (${selectedAutomated})` : ""}
                </button>
              ) : (
                <button
                  onClick={handoff}
                  disabled={pending}
                  className="btn-secondary h-9"
                  title="Let the automation engine run outreach for the selected prospects"
                >
                  Hand off
                </button>
              )}
              <button
                onClick={() => archive(true)}
                disabled={pending}
                className="btn-secondary h-9"
              >
                Archive
              </button>
            </>
          )}

          <button onClick={remove} disabled={pending} className="btn-ghost h-9 text-rose-600">
            Delete
          </button>
          <button onClick={() => setSelected(new Set())} className="btn-ghost h-9">
            Clear
          </button>

          {selected.size > 25 && (
            <span className="text-xs text-rose-600">Max 25 per batch.</span>
          )}
        </div>
      )}

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            {/* Sticky: scanning row 40 is useless if the column labels
                scrolled away at row 10. */}
            <thead className="sticky top-0 z-10 border-b border-line bg-surface-2/85 backdrop-blur-md">
              <tr className="text-left text-[11px] uppercase tracking-[0.07em] text-muted">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(prospects.map((p) => p.id)))
                    }
                    aria-label="Select all prospects"
                    className="h-4 w-4 cursor-pointer rounded border-line accent-[rgb(var(--accent))]"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Intent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft">
              {prospects.map((prospect) => {
                // A sequence is mid-flight for this person. Marked with a left
                // edge rather than a tint: selection already owns the row
                // background, and the two states have to be able to coexist.
                const running =
                  prospect.enrollment_state === "active" ||
                  prospect.enrollment_state === "paused";

                return (
                <tr
                  key={prospect.id}
                  className={`transition-colors duration-100 hover:bg-surface-2/60 ${
                    selected.has(prospect.id) ? "bg-accent-soft/50" : ""
                  }`}
                >
                  <td
                    className={`px-4 py-3 ${
                      running
                        ? "border-l-2 border-accent bg-accent-soft/20"
                        : "border-l-2 border-transparent"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(prospect.id)}
                      onChange={() => toggle(prospect.id)}
                      aria-label={`Select ${prospect.full_name}`}
                      className="h-4 w-4 cursor-pointer rounded border-line accent-[rgb(var(--accent))]"
                    />
                  </td>

                  <td className="max-w-64 px-4 py-3">
                    <Link
                      href={`/prospects/${prospect.id}`}
                      className="block truncate font-medium text-ink hover:text-accent"
                    >
                      {prospect.full_name}
                    </Link>
                    <p className="truncate text-xs text-muted">{prospect.email}</p>
                    {prospect.job_title && (
                      <p className="truncate text-xs text-muted" title={prospect.job_title}>
                        {prospect.job_title}
                      </p>
                    )}
                  </td>

                  <td className="max-w-72 px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-ink">{prospect.display_company}</span>
                      {prospect.company_inferred && (
                        <span
                          title="Company name derived from the email domain — not verified"
                          className="shrink-0 text-xs text-amber-600"
                        >
                          ~
                        </span>
                      )}
                    </div>
                    {/* Category rides on the industry line rather than as its
                        own badge: filtered to one vertical it would repeat on
                        every row, which is noise, not information. */}
                    <p className="truncate text-xs">
                      {prospect.industry ? (
                        <span className="text-muted">{prospect.industry}</span>
                      ) : (
                        <span className="text-amber-600">Needs company info</span>
                      )}
                      {prospect.category && (
                        <span className="text-muted/70"> · {prospect.category}</span>
                      )}
                    </p>
                  </td>

                  <td className="hidden max-w-56 px-4 py-3 lg:table-cell">
                    {prospect.top_intent ? (
                      <span className="text-xs text-muted" title={prospect.top_intent}>
                        {prospect.top_intent.split(":").pop()?.trim()}
                      </span>
                    ) : (
                      <span className="text-xs text-muted">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <ProspectStatusBadge status={prospect.status} />
                  </td>

                  {/* Ownership decides this column, not enrollment history:
                      someone stopped and returned to manual still has a
                      finished enrollment attached, and rendering that would
                      claim a sequence owns a prospect you took back. */}
                  <td className="px-4 py-3">
                    {prospect.pipeline_mode !== "automated" ? (
                      prospect.draft_count > 0 ? (
                        <Tag>
                          {prospect.draft_count} draft
                          {prospect.draft_count === 1 ? "" : "s"}
                        </Tag>
                      ) : (
                        <span className="text-xs text-muted">Manual</span>
                      )
                    ) : running && prospect.sequence_name ? (
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <EnrollmentStateBadge
                            state={prospect.enrollment_state as EnrollmentState}
                          />
                          <span className="truncate text-xs text-ink">
                            {prospect.sequence_name}
                          </span>
                        </div>
                        <p className="mt-0.5 text-xs text-muted">
                          {prospect.enrollment_total_steps
                            ? `Step ${Math.max(prospect.enrollment_step ?? 0, 1)} of ${prospect.enrollment_total_steps}`
                            : ""}
                          {prospect.next_message_at
                            ? ` · next ${formatDate(prospect.next_message_at)}`
                            : ""}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-amber-600">
                        Automated — not enrolled
                      </span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
