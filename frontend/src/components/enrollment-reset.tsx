"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { resetEnrollmentAction } from "@/app/automation-actions";
import { Toast, useToast } from "@/components/toast";

const ENDED_REASON: Record<string, string> = {
  stopped: "This sequence was stopped.",
  completed: "This sequence finished every step without a reply.",
  bounced: "The last send bounced, so the sequence stopped.",
};

/** The way back from an ended run.
 *
 *  Stopping had no inverse. Resume only accepts a paused enrollment, the row
 *  leaves the Running tab, and the enroll list locks anyone whose run ended --
 *  all correct for a deliberate stop, and a dead end for a misclick.
 *
 *  Shown on the prospect's own page because that is where you land after
 *  realising the mistake, rather than on a tab you would have to know to
 *  look under. `replied` is deliberately absent: someone mid-conversation
 *  should not be quietly reset back into the funnel. */
export function EnrollmentReset({
  enrollmentId,
  state,
  prospectName,
}: {
  enrollmentId: string;
  state: string;
  prospectName: string;
}) {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const reason = ENDED_REASON[state];
  if (!reason) return null;

  function reset() {
    if (
      !window.confirm(
        `Reset ${prospectName}?\n\nThis clears the ended run so they can be ` +
          `enrolled again. Emails already sent are kept.`,
      )
    ) {
      return;
    }
    startTransition(async () => {
      const result = await resetEnrollmentAction(enrollmentId);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <section className="card flex flex-wrap items-center justify-between gap-3 p-4">
        <div className="min-w-0">
          <p className="text-sm text-ink">{reason}</p>
          <p className="mt-0.5 text-xs text-muted">
            Resetting clears it so they can be enrolled again. Anything already
            sent stays on the record.
          </p>
        </div>
        <button onClick={reset} disabled={pending} className="btn-secondary shrink-0">
          {pending ? "Resetting…" : "Reset to not enrolled"}
        </button>
      </section>
      <Toast state={toast} />
    </>
  );
}
