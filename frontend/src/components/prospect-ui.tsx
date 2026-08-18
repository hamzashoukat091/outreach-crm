import type { DraftStatus, ProspectStatus } from "@/lib/prospect-types";

/* Shared badge shape. A 1px inset ring is what stops a coloured pill from
   looking like a flat highlight -- it gives the token an edge at any size. */
export const BADGE_BASE =
  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium " +
  "ring-1 ring-inset whitespace-nowrap";

const PROSPECT_TONE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700 ring-slate-600/15 dark:bg-slate-800/60 dark:text-slate-300 dark:ring-slate-400/20",
  drafted: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-400/25",
  approved: "bg-violet-50 text-violet-700 ring-violet-600/20 dark:bg-violet-950/60 dark:text-violet-300 dark:ring-violet-400/25",
  replied: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/25",
  bounced: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-400/25",
  not_interested: "bg-zinc-100 text-zinc-600 ring-zinc-500/15 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-400/20",
  won: "bg-emerald-100 text-emerald-800 ring-emerald-600/25 dark:bg-emerald-900/70 dark:text-emerald-200 dark:ring-emerald-400/30",
  archived: "bg-zinc-100 text-zinc-600 ring-zinc-500/15 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-400/20",
};

const LABEL: Record<string, string> = {
  approved: "sent",
  not_interested: "not interested",
};

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <span
      className={`${BADGE_BASE} ${PROSPECT_TONE[status] ?? PROSPECT_TONE.new}`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}

const DRAFT_TONE: Record<DraftStatus, string> = {
  draft: "bg-blue-50 text-blue-700 ring-blue-600/20 dark:bg-blue-950/60 dark:text-blue-300 dark:ring-blue-400/25",
  approved: "bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/25",
  discarded: "bg-zinc-100 text-zinc-600 ring-zinc-500/15 dark:bg-zinc-800/60 dark:text-zinc-400 dark:ring-zinc-400/20",
  failed: "bg-rose-50 text-rose-700 ring-rose-600/20 dark:bg-rose-950/60 dark:text-rose-300 dark:ring-rose-400/25",
};

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  // "draft" is the word people trip over: the section holds sent emails too,
  // so the unsent state says what it is waiting for instead.
  const label =
    status === "approved" ? "sent" : status === "draft" ? "not sent" : status;
  return (
    <span
      className={`${BADGE_BASE} ${DRAFT_TONE[status]}`}
    >
      {label}
    </span>
  );
}

/** Flags how much real context the model had. The honest signal on a draft. */
export function ContextBadge({ quality }: { quality: "rich" | "thin" | null }) {
  if (!quality) return null;

  if (quality === "thin") {
    return (
      <span
        title="No verified company data was available. The email was written from the job title alone — check it before sending."
        className={`${BADGE_BASE} bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/25`}
      >
        limited context
      </span>
    );
  }

  return (
    <span
      title="Written with the company description, industry, and size."
      className={`${BADGE_BASE} bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/25`}
    >
      full context
    </span>
  );
}

/**
 * Deliverability of the work address.
 *
 * `catch_all` matters: the domain accepts mail to any address, so the
 * verifier could not confirm this mailbox actually exists. Worth knowing
 * before you spend a send on it.
 */
export function EmailStatusBadge({ status }: { status: string | null }) {
  if (!status) return null;

  if (status === "catch_all") {
    return (
      <span
        title="This domain accepts mail to any address, so the mailbox couldn't be verified. Delivery isn't guaranteed."
        className={`${BADGE_BASE} ml-2 bg-amber-50 text-amber-700 ring-amber-600/20 dark:bg-amber-950/60 dark:text-amber-300 dark:ring-amber-400/25`}
      >
        catch-all
      </span>
    );
  }

  if (status === "valid") {
    return (
      <span
        title="The mailbox was verified as deliverable."
        className={`${BADGE_BASE} ml-2 bg-emerald-50 text-emerald-700 ring-emerald-600/20 dark:bg-emerald-950/60 dark:text-emerald-300 dark:ring-emerald-400/25`}
      >
        valid
      </span>
    );
  }

  return (
    <span className={`${BADGE_BASE} ml-2 bg-surface-2 text-muted ring-line`}>
      {status.replace("_", " ")}
    </span>
  );
}

/** Warns on the prospect record itself when company data is missing. */
export function IncompleteWarning({
  missing,
  inferred,
}: {
  missing: string[];
  inferred: boolean;
}) {
  if (!missing.length) return null;

  const pretty = missing.map((f) => f.replace("company_", "").replace("_", " ")).join(", ");

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
      <p className="font-medium text-amber-900 dark:text-amber-200">
        Missing company info
      </p>
      <p className="mt-1 text-amber-800 dark:text-amber-300">
        No {pretty} in the import.
        {inferred && " The company name was derived from the email domain."} Generated
        emails will rely on the job title alone — fill these in below for a stronger email.
      </p>
    </div>
  );
}
