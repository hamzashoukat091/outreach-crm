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
          {status.dry_run && (
            <span
              title="Emails are fully processed but not delivered. Flip off to send for real."
              className="inline-flex items-center rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              Dry run
            </span>
          )}
          {status.sending_paused && (
            <span className="inline-flex items-center rounded-full bg-rose-50 px-3 py-1 text-xs font-semibold uppercase tracking-wide text-rose-700 dark:bg-rose-950 dark:text-rose-300">
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

      {status?.dry_run && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="text-amber-900 dark:text-amber-200">
            <strong>Dry run is on.</strong> Emails are fully processed — drafted,
            scheduled, logged — but not delivered. Flip it off below to send for
            real.
          </p>
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
