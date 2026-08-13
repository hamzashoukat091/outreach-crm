import type { ReactNode } from "react";
import type { EnrollmentStatus, LeadStatus, SendStatus } from "@/lib/types";

const STATUS_TONE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  contacted: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  replied: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  qualified: "bg-violet-50 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  won: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  lost: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  unsubscribed: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
  active: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  paused: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  completed: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  stopped: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  scheduled: "bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300",
  sent: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  failed: "bg-rose-50 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  canceled: "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400",
};

export function StatusBadge({
  status,
}: {
  status: LeadStatus | EnrollmentStatus | SendStatus | string;
}) {
  const tone = STATUS_TONE[status] ?? STATUS_TONE.new;
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium capitalize ${tone}`}
    >
      {status.replace("_", " ")}
    </span>
  );
}

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs text-muted">
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-sm text-sm text-muted">{description}</p>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string | number;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31536000],
  ["month", 2592000],
  ["day", 86400],
  ["hour", 3600],
  ["minute", 60],
];

/** "in 3 days" / "2 hours ago" — used across the timeline and send queue. */
export function relativeTime(iso: string): string {
  const diff = (new Date(iso).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [unit, seconds] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= seconds) {
      return rtf.format(Math.round(diff / seconds), unit);
    }
  }
  return rtf.format(Math.round(diff), "second");
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Format a timestamp identically on the server and in the browser.
 *
 * toLocaleString() would resolve the API container's UTC clock on the server
 * and the viewer's local zone on the client, producing different HTML for the
 * same node -- a hydration mismatch (React #418). Formatting explicitly from
 * UTC parts keeps both renders byte-identical.
 */
export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";

  const hours24 = d.getUTCHours();
  const hours12 = hours24 % 12 || 12;
  const minutes = String(d.getUTCMinutes()).padStart(2, "0");
  const meridiem = hours24 < 12 ? "AM" : "PM";

  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${hours12}:${minutes} ${meridiem} UTC`;
}
