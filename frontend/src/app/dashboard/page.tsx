import Link from "next/link";
import { api } from "@/lib/api";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let prospects;
  let automation;
  let status;
  try {
    [prospects, automation, status] = await Promise.all([
      api.analytics().catch(() => null),
      api.automationAnalytics().catch(() => null),
      api.automationStatus().catch(() => null),
    ]);
  } catch {
    prospects = automation = status = null;
  }

  if (!prospects && !automation) {
    return (
      <div className="card">
        <EmptyState
          title="Can't reach the API"
          description="The backend isn't responding. Check `docker compose ps`."
        />
      </div>
    );
  }

  // Ordered by urgency: something waiting on you, then something stalled,
  // then the obvious first move. The first match wins.
  const nextStep = (() => {
    if (automation && automation.pending_approvals > 0) {
      return {
        text: `${automation.pending_approvals} repl${
          automation.pending_approvals === 1 ? "y is" : "ies are"
        } written and waiting for you to approve.`,
        cta: "Review them",
        href: "/approvals",
      };
    }
    if (!prospects || prospects.total_prospects === 0) {
      return {
        text: "No prospects yet. Import a CSV to get started.",
        cta: "Go to prospects",
        href: "/prospects",
      };
    }
    if (automation && automation.active_enrollments === 0) {
      return {
        text: "Nothing is running. Enroll prospects in a sequence to start automated outreach.",
        cta: "Open sequences",
        href: "/sequences",
      };
    }
    return null;
  })();

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Your pipeline at a glance — manual outreach and the automation engine."
      />

      {status && (status.dry_run || status.sending_paused) && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="text-amber-900 dark:text-amber-200">
            {status.dry_run && (
              <>
                <strong>Dry run is on</strong> — emails are processed but not delivered.{" "}
              </>
            )}
            {status.sending_paused && (
              <>
                <strong>Sending is paused.</strong>{" "}
              </>
            )}
          </p>
          <Link
            href="/settings"
            className="shrink-0 font-medium text-amber-900 underline dark:text-amber-200"
          >
            Review in Settings
          </Link>
        </div>
      )}

      {/* Numbers describe the state; they do not say what to do about it.
          One line naming the single most useful next action, chosen from what
          is actually true right now. */}
      {nextStep && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-lg border border-line bg-surface-2/60 px-4 py-3 text-sm">
          <span className="text-ink">{nextStep.text}</span>
          <Link
            href={nextStep.href}
            className="shrink-0 font-medium text-accent hover:underline"
          >
            {nextStep.cta} →
          </Link>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Prospects" value={prospects?.total_prospects ?? "—"} />
        <StatCard
          label="Active enrollments"
          value={automation?.active_enrollments ?? "—"}
          hint="in automated sequences"
        />
        <StatCard
          label="Automated sends"
          value={automation?.total_sent ?? "—"}
          hint={
            automation
              ? `${automation.sends_today}/${automation.daily_send_limit} today`
              : undefined
          }
        />
        {/* A rate over zero sends is not 0% success, it is no data. Saying
            "0%" next to an engine that has never sent reads as failure. */}
        <StatCard
          label="Reply rate"
          value={
            !automation
              ? "—"
              : automation.total_sent === 0
              ? "—"
              : `${automation.reply_rate}%`
          }
          hint={
            !automation
              ? undefined
              : automation.total_sent === 0
              ? "no automated sends yet"
              : `${automation.replies_received} of ${automation.total_sent} sent`
          }
        />
      </div>

      {automation && automation.pending_approvals > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent/30 bg-accent-soft px-4 py-3 text-sm">
          <p className="text-ink">
            <strong>{automation.pending_approvals}</strong> repl
            {automation.pending_approvals === 1 ? "y is" : "ies are"} waiting for
            your approval.
          </p>
          <Link href="/approvals" className="shrink-0 font-medium text-accent hover:underline">
            Review them
          </Link>
        </div>
      )}

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-semibold text-ink">Sequence performance</h2>
        {!automation || automation.sequences.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            No sequences yet.{" "}
            <Link href="/sequences" className="text-accent hover:underline">
              Build one
            </Link>{" "}
            to start automated outreach.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Sequence</th>
                  <th className="pb-2 text-right font-medium">Enrolled</th>
                  <th className="pb-2 text-right font-medium">Active</th>
                  <th className="pb-2 text-right font-medium">Completed</th>
                  <th className="pb-2 text-right font-medium">Replied</th>
                  <th className="pb-2 text-right font-medium">Reply rate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {automation.sequences.map((seq) => (
                  <tr key={seq.sequence_id}>
                    <td className="py-2.5">
                      <Link
                        href={`/sequences/${seq.sequence_id}`}
                        className="text-ink hover:text-accent"
                      >
                        {seq.name}
                      </Link>
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {seq.enrolled}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {seq.active}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {seq.completed}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {seq.replied}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">
                      {seq.enrolled === 0 ? (
                        <span className="text-muted">—</span>
                      ) : (
                        `${seq.reply_rate}%`
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Manual pipeline</h2>
          {!prospects ? (
            <p className="mt-4 text-sm text-muted">Prospect analytics unavailable.</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Emails written</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{prospects.total_drafts}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Copied &amp; sent</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{prospects.approved_drafts}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Replies</dt>
                <dd className="mt-0.5 tabular-nums text-ink">{prospects.replied_count}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Data completeness</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {prospects.data_completeness}%
                </dd>
              </div>
            </dl>
          )}
          <Link
            href="/analytics"
            className="mt-4 inline-block text-xs text-accent hover:underline"
          >
            Full analytics →
          </Link>
        </section>

        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Engine status</h2>
          {!status ? (
            <p className="mt-4 text-sm text-muted">Status unavailable.</p>
          ) : (
            <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Worker</dt>
                <dd className="mt-0.5 flex items-center gap-1.5 text-ink">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      status.worker_alive ? "bg-emerald-500" : "bg-rose-500"
                    }`}
                  />
                  {status.worker_alive ? "alive" : "not running"}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Send window</dt>
                <dd className="mt-0.5 text-ink">{status.window_open ? "open" : "closed"}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">This hour</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {status.sends_this_hour}/{status.hourly_send_limit}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Today</dt>
                <dd className="mt-0.5 tabular-nums text-ink">
                  {status.sends_today}/{status.daily_send_limit}
                </dd>
              </div>
            </dl>
          )}
          <Link
            href="/settings"
            className="mt-4 inline-block text-xs text-accent hover:underline"
          >
            Open the control panel →
          </Link>
        </section>
      </div>
    </>
  );
}
