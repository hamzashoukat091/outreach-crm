import Link from "next/link";
import { api } from "@/lib/api";
import { AutomationSettingsPanel } from "@/components/automation-settings";
import { EmptyState, PageHeader, formatDate } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  let settings;
  let status;
  let facts;
  let approvals;
  try {
    [settings, status, facts, approvals] = await Promise.all([
      api.getAutomationSettings(),
      api.automationStatus().catch(() => null),
      api.getSenderFacts(),
      api.automationApprovals().catch(() => []),
    ]);
  } catch {
    return (
      <div className="card">
        <EmptyState
          title="Can't reach the API"
          description="The backend isn't responding. Check `docker compose ps`."
        />
      </div>
    );
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="The control panel for the automation engine. Every section saves on its own."
      />

      {/* Status strip */}
      {status && (
        <div className="card mb-6 flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-4 text-sm">
          {/* The pill states the mode; the sentence beside it says what that
              means. Together they replace the separate banner that used to sit
              below and repeat both. */}
          <span
            className={`inline-flex shrink-0 items-center rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide ${
              status.dry_run
                ? "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300"
                : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300"
            }`}
          >
            {status.dry_run ? "Dry run" : "Live"}
          </span>
          <span className="text-muted">
            {status.dry_run
              ? "Nothing is delivered"
              : "Emails are delivered for real"}
          </span>
          {status.sending_paused && (
            <span className="inline-flex shrink-0 items-center rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300">
              Paused
            </span>
          )}
          <span className="text-muted">
            Window {status.window_open ? "open" : "closed"}
          </span>
          <span className="tabular-nums text-muted">
            Sent today {status.sends_today}/{status.daily_send_limit}
          </span>
          <span className="tabular-nums text-muted">
            This hour {status.sends_this_hour}/{status.hourly_send_limit}
          </span>
          {status.next_scheduled_at && (
            <span className="text-muted">
              Next send {formatDate(status.next_scheduled_at)}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5 text-muted">
            <span
              className={`h-2 w-2 rounded-full ${
                status.worker_alive ? "bg-emerald-500" : "bg-rose-500"
              }`}
            />
            worker {status.worker_alive ? "alive" : "down"}
          </span>
        </div>
      )}

      {approvals.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <p className="text-ink">
            <strong>{approvals.length}</strong> held repl
            {approvals.length === 1 ? "y is" : "ies are"} waiting for review.
          </p>
          <Link href="/approvals" className="shrink-0 font-medium text-accent hover:underline">
            Review them
          </Link>
        </div>
      )}

      <AutomationSettingsPanel settings={settings} facts={facts} />
    </>
  );
}
