import type { DraftStatus, ProspectStatus } from "@/lib/prospect-types";

const PROSPECT_TONE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  drafted: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  replied: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  bounced: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  not_interested: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  won: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200",
  archived: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

const LABEL: Record<string, string> = {
  approved: "sent",
  not_interested: "not interested",
};

export function ProspectStatusBadge({ status }: { status: ProspectStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${
        PROSPECT_TONE[status] ?? PROSPECT_TONE.new
      }`}
    >
      {LABEL[status] ?? status}
    </span>
  );
}

const DRAFT_TONE: Record<DraftStatus, string> = {
  draft: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  approved: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  discarded: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
};

export function DraftStatusBadge({ status }: { status: DraftStatus }) {
  // "draft" is the word people trip over: the section holds sent emails too,
  // so the unsent state says what it is waiting for instead.
  const label =
    status === "approved" ? "sent" : status === "draft" ? "not sent" : status;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${DRAFT_TONE[status]}`}
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
        className="inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      >
        limited context
      </span>
    );
  }

  return (
    <span
      title="Written with the company description, industry, and size."
      className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
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
        className="ml-2 inline-flex items-center rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300"
      >
        catch-all
      </span>
    );
  }

  if (status === "valid") {
    return (
      <span
        title="The mailbox was verified as deliverable."
        className="ml-2 inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300"
      >
        valid
      </span>
    );
  }

  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
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
