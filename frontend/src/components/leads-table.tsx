"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { enrollAction } from "@/app/actions";
import type { Lead, Sequence } from "@/lib/types";
import { EmptyState, StatusBadge, Tag } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

export function LeadsTable({
  leads,
  sequences,
}: {
  leads: Lead[];
  sequences: Sequence[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sequenceId, setSequenceId] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const allSelected = leads.length > 0 && selected.size === leads.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(leads.map((l) => l.id)));
  }

  function handleEnroll() {
    const target = sequenceId || sequences[0]?.id;
    if (!target) {
      show({ ok: false, message: "Create a sequence first." });
      return;
    }

    startTransition(async () => {
      const result = await enrollAction(target, [...selected]);
      show(result);
      if (result.ok) {
        setSelected(new Set());
        router.refresh();
      }
    });
  }

  if (leads.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No leads match"
          description="Try clearing the search or filters, or import a CSV to get started."
        />
      </div>
    );
  }

  return (
    <>
      {selected.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-accent/30 bg-accent-soft px-4 py-3">
          <span className="text-sm font-medium text-ink">
            {selected.size} selected
          </span>
          <select
            value={sequenceId}
            onChange={(e) => setSequenceId(e.target.value)}
            className="input h-9 w-auto min-w-48 py-0"
            disabled={sequences.length === 0}
          >
            {sequences.length === 0 ? (
              <option value="">No sequences yet</option>
            ) : (
              sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.steps.length} steps)
                </option>
              ))
            )}
          </select>
          <button
            onClick={handleEnroll}
            disabled={pending || sequences.length === 0}
            className="btn-primary h-9"
          >
            {pending ? "Enrolling…" : "Enroll"}
          </button>
          <button onClick={() => setSelected(new Set())} className="btn-ghost h-9">
            Clear
          </button>
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
                    onChange={toggleAll}
                    aria-label="Select all leads"
                    className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                  />
                </th>
                <th className="px-4 py-3 font-medium">Name</th>
                <th className="px-4 py-3 font-medium">Company</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="hidden px-4 py-3 font-medium md:table-cell">Tags</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {leads.map((lead) => (
                <tr
                  key={lead.id}
                  className={`transition-colors hover:bg-surface-2/50 ${
                    selected.has(lead.id) ? "bg-accent-soft/40" : ""
                  }`}
                >
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(lead.id)}
                      onChange={() => toggle(lead.id)}
                      aria-label={`Select ${lead.full_name}`}
                      className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/leads/${lead.id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {lead.full_name}
                    </Link>
                    <p className="text-xs text-muted">{lead.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-ink">{lead.company ?? "—"}</p>
                    {lead.title && <p className="text-xs text-muted">{lead.title}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={lead.status} />
                  </td>
                  <td className="hidden px-4 py-3 md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {lead.tags.length === 0 ? (
                        <span className="text-xs text-muted">—</span>
                      ) : (
                        lead.tags.slice(0, 3).map((tag) => <Tag key={tag}>{tag}</Tag>)
                      )}
                    </div>
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
