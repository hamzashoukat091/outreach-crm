import type { ReactNode } from "react";

export function Tag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-md bg-surface-2 px-2 py-0.5 text-xs
      text-muted ring-1 ring-inset ring-line">
      {children}
    </span>
  );
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-3 px-6 py-16 text-center">
      {/* A soft plate behind the glyph keeps an empty screen from reading as a
          loading failure. */}
      {icon && (
        <div className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl
          bg-surface-2 text-muted ring-1 ring-inset ring-line">
          {icon}
        </div>
      )}
      <p className="text-base font-medium text-ink">{title}</p>
      <p className="max-w-sm text-sm leading-relaxed text-muted">{description}</p>
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
    <div className="card group relative overflow-hidden p-5 transition-shadow duration-200
      hover:shadow-card-hover">
      {/* A barely-there wash from the top-left. At 3% it is not perceived as
          colour, only as the surface not being perfectly flat. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 bg-gradient-to-br
          from-accent/[0.035] to-transparent"
      />
      <div className="relative">
        <p className="eyebrow">{label}</p>
        <p className="tabular mt-2 text-[2rem] font-semibold leading-none tracking-tight text-ink">
          {value}
        </p>
        {hint && <p className="mt-2 text-xs leading-relaxed text-muted">{hint}</p>}
      </div>
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
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold leading-tight tracking-[-0.02em] text-ink sm:text-[1.75rem]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-muted">{description}</p>
        )}
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
