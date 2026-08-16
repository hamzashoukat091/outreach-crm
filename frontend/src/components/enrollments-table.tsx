"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fragment, useState, useTransition } from "react";
import {
  pauseEnrollmentAction,
  resumeEnrollmentAction,
  stopEnrollmentAction,
} from "@/app/automation-actions";
import type { EnrollmentRow } from "@/lib/types";
import { EnrollmentStateBadge } from "@/components/automation-ui";
import { EmptyState, formatDate } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

export function EnrollmentsTable({
  enrollments,
  emptyTitle,
  emptyDescription,
}: {
  enrollments: EnrollmentRow[];
  emptyTitle?: string;
  emptyDescription?: string;
}) {
  const [pending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);
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

  // Stopping has two useful endings -- park them in automation, or hand them
  // back to the Outreach section -- so this asks rather than assuming. A
  // confirm() dialog only offers yes/no, hence the inline row.
  function stop(row: EnrollmentRow, returnToManual: boolean) {
    setConfirming(null);
    startTransition(async () => {
      const result = await stopEnrollmentAction(row.id, returnToManual);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  if (enrollments.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title={emptyTitle ?? "No enrollments"}
          description={
            emptyDescription ??
            "Nothing matches these filters. Enroll prospects from a sequence's builder page."
          }
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
                <Fragment key={row.id}>
                <tr className="transition-colors hover:bg-surface-2/50">
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
                          onClick={() =>
                            setConfirming(confirming === row.id ? null : row.id)
                          }
                          disabled={pending}
                          className="btn-ghost h-8 text-xs text-rose-600"
                        >
                          Stop
                        </button>
                      )}
                    </div>
                  </td>
                </tr>

                {confirming === row.id && (
                  <tr className="bg-surface-2/60">
                    <td colSpan={7} className="px-4 py-3">
                      <p className="text-xs text-muted">
                        Ending the sequence for{" "}
                        <span className="text-ink">{label(row)}</span> cancels
                        everything unsent. This can&apos;t be resumed.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <button
                          onClick={() => stop(row, true)}
                          disabled={pending}
                          className="btn-primary h-8 text-xs"
                        >
                          Stop and return to manual
                        </button>
                        <button
                          onClick={() => stop(row, false)}
                          disabled={pending}
                          className="btn-secondary h-8 text-xs"
                        >
                          Stop, keep in automation
                        </button>
                        <button
                          onClick={() => setConfirming(null)}
                          className="btn-ghost h-8 text-xs"
                        >
                          Cancel
                        </button>
                      </div>
                      <p className="mt-2 text-xs text-muted">
                        Returning to manual moves them back to the Outreach
                        section, where you write and send by hand.
                      </p>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
