"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import {
  pauseEnrollmentAction,
  resumeEnrollmentAction,
  stopEnrollmentAction,
} from "@/app/automation-actions";
import type { EnrollmentRow } from "@/lib/types";
import { EnrollmentStateBadge } from "@/components/automation-ui";
import { EmptyState, formatDate } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

export function EnrollmentsTable({ enrollments }: { enrollments: EnrollmentRow[] }) {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function label(row: EnrollmentRow) {
    return row.prospect_name || row.prospect_email || "this prospect";
  }

  function pause(row: EnrollmentRow) {
    if (!window.confirm(`Pause ${label(row)}? No more emails until you resume.`)) {
      return;
    }
    startTransition(async () => {
      const result = await pauseEnrollmentAction(row.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function resume(row: EnrollmentRow) {
    startTransition(async () => {
      const result = await resumeEnrollmentAction(row.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function stop(row: EnrollmentRow) {
    if (
      !window.confirm(
        `Stop ${label(row)}'s enrollment? This ends the sequence for them — it can't be resumed.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await stopEnrollmentAction(row.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  if (enrollments.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No enrollments"
          description="Nothing matches these filters. Enroll prospects from a sequence's builder page."
        />
      </div>
    );
  }

  return (
    <>
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-surface-2/60">
              <tr className="text-left text-xs uppercase tracking-wide text-muted">
                <th className="px-4 py-3 font-medium">Prospect</th>
                <th className="px-4 py-3 font-medium">Sequence</th>
                <th className="px-4 py-3 font-medium">State</th>
                <th className="px-4 py-3 font-medium">Progress</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">Next send</th>
                <th className="hidden px-4 py-3 font-medium lg:table-cell">
                  Last activity
                </th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {enrollments.map((row) => (
                <tr key={row.id} className="transition-colors hover:bg-surface-2/50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/prospects/${row.prospect_id}`}
                      className="font-medium text-ink hover:text-accent"
                    >
                      {row.prospect_name || row.prospect_email}
                    </Link>
                    <p className="text-xs text-muted">{row.prospect_email}</p>
                  </td>
                  <td className="px-4 py-3 text-ink">{row.sequence_name}</td>
                  <td className="px-4 py-3">
                    <EnrollmentStateBadge state={row.state} />
                  </td>
                  <td className="px-4 py-3 tabular-nums text-muted">
                    step {row.current_position}/{row.total_steps}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted lg:table-cell">
                    {row.next_message_at ? formatDate(row.next_message_at) : "—"}
                  </td>
                  <td className="hidden px-4 py-3 text-xs text-muted lg:table-cell">
                    {row.last_activity_at ? formatDate(row.last_activity_at) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-1">
                      {row.state === "active" && (
                        <button
                          onClick={() => pause(row)}
                          disabled={pending}
                          className="btn-ghost h-8 text-xs"
                        >
                          Pause
                        </button>
                      )}
                      {row.state === "paused" && (
                        <button
                          onClick={() => resume(row)}
                          disabled={pending}
                          className="btn-ghost h-8 text-xs"
                        >
                          Resume
                        </button>
                      )}
                      {(row.state === "active" || row.state === "paused") && (
                        <button
                          onClick={() => stop(row)}
                          disabled={pending}
                          className="btn-ghost h-8 text-xs text-rose-600"
                        >
                          Stop
                        </button>
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
