"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { acceptMissingInfoAction } from "@/app/prospect-actions";
import { Toast, useToast } from "@/components/toast";

/** Warns on the prospect record itself when company data is missing.
 *
 *  Dismissable, because the warning is advice and not every prospect needs
 *  the data: a one-person practice has no employee range worth chasing, and a
 *  banner that cannot be answered is one you stop reading -- including on the
 *  prospects where it matters. */
export function IncompleteWarning({
  prospectId,
  missing,
  inferred,
  accepted = false,
}: {
  prospectId: string;
  missing: string[];
  inferred: boolean;
  /** Already dismissed: show the way back rather than the warning. */
  accepted?: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const { toast, show } = useToast();

  function setAccepted(next: boolean) {
    startTransition(async () => {
      const result = await acceptMissingInfoAction(prospectId, next);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  if (!missing.length) return null;

  const pretty = missing.map((f) => f.replace("company_", "").replace("_", " ")).join(", ");

  // Dismissed: a quiet line, not a banner. The fact stays visible because the
  // emails really are thinner, but it no longer asks for anything.
  if (accepted) {
    return (
      <>
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-xs text-muted">
          <span>
            No {pretty} — accepted, so this is not flagged as needing info.
          </span>
          <button
            onClick={() => setAccepted(false)}
            disabled={pending}
            className="shrink-0 font-medium text-accent underline underline-offset-2 hover:no-underline disabled:opacity-60"
          >
            Warn me again
          </button>
        </div>
        <Toast state={toast} />
      </>
    );
  }

  return (
    <>
      <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
        <p className="font-medium text-amber-900 dark:text-amber-200">
          Missing company info
        </p>
        <p className="mt-1 text-amber-800 dark:text-amber-300">
          No {pretty} in the import.
          {inferred && " The company name was derived from the email domain."} Generated
          emails will rely on the job title alone — fill these in below for a stronger email.
        </p>
        <button
          onClick={() => setAccepted(true)}
          disabled={pending}
          className="mt-2 text-xs font-medium text-amber-900 underline underline-offset-2 hover:no-underline disabled:opacity-60 dark:text-amber-200"
        >
          {pending ? "Saving…" : "This one's fine — don't warn me again"}
        </button>
      </div>
      <Toast state={toast} />
    </>
  );
}
