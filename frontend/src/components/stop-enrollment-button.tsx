"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { stopEnrollmentAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";

export function StopEnrollmentButton({
  enrollmentId,
  leadEmail,
  queued,
}: {
  enrollmentId: string;
  leadEmail: string;
  queued: number;
}) {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function stop() {
    const ok = window.confirm(
      `Stop this sequence for ${leadEmail}? ${queued} queued email(s) will be canceled.`,
    );
    if (!ok) return;

    startTransition(async () => {
      const result = await stopEnrollmentAction(enrollmentId);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <button onClick={stop} disabled={pending} className="btn-ghost h-8 text-xs text-rose-600">
        {pending ? "Stopping…" : "Stop"}
      </button>
      <Toast state={toast} />
    </>
  );
}
