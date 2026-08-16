"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  bulkArchiveAction,
  bulkDeleteProspectsAction,
  generateBulkAction,
} from "@/app/prospect-actions";
import { bulkHandoffAction } from "@/app/automation-actions";
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
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <span className="text-sm font-medium text-ink">{selected.size} selected</span>

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
              <button
                onClick={handoff}
                disabled={pending}
                className="btn-secondary h-9"
                title="Let the automation engine run outreach for the selected prospects"
              >
                Hand off
              </button>
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
            <thead className="border-b border-line bg-surface-2/60">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="w-10 px-4 py-3">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={() =>
                      setSelected(allSelected ? new Set() : new Set(prospects.map((p) => p.id)))
                    }
                    aria-label="Select all prospects"
                    className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Intent</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Pipeline</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {prospects.map((prospect) => (
                <tr
                  key={prospect.id}
                  className={`transition-colors hover:bg-surface-2/50 ${
                    selected.has(prospect.id) ? "bg-accent-soft/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(prospect.id)}
                      onChange={() => toggle(prospect.id)}
                      aria-label={`Select ${prospect.full_name}`}
                      className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                    />
                  </td>

                  <td className="px-4 py-3">
                    <Link
                      href={`/prospects/${prospect.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {prospect.full_name}
                    </Link>
                    <p className="text-xs text-muted">{prospect.email}</p>
                    {prospect.job_title && (
                      <p className="mt-0.5 text-xs text-muted">{prospect.job_title}</p>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1.5">
                      <span className="text-ink">{prospect.display_company}</span>
                      {prospect.company_inferred && (
                        <span
                          title="Company name derived from the email domain — not verified"
                          className="text-xs text-amber-600"
                        >
                          ~
                        </span>
                      )}
                    </div>
                    {prospect.industry ? (
                      <p className="text-xs text-muted">{prospect.industry}</p>
                    ) : (
                      <p className="text-xs text-amber-600">Needs company info</p>
                    )}
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

                  {/* A prospect is either being worked by hand or by a
                      sequence. Showing the live run here means the list says
                      what is happening, not just which pipeline owns them. */}
                  <td className="px-4 py-3">
                    {prospect.sequence_name ? (
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
                    ) : prospect.pipeline_mode === "automated" ? (
                      <span className="text-xs text-amber-600">
                        Automated — not enrolled
                      </span>
                    ) : prospect.draft_count > 0 ? (
                      <Tag>
                        {prospect.draft_count} draft{prospect.draft_count === 1 ? "" : "s"}
                      </Tag>
                    ) : (
                      <span className="text-xs text-muted">Manual</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
