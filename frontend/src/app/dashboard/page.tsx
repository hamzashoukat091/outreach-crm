import Link from "next/link";
import { api } from "@/lib/api";
import { EmptyState, PageHeader, StatCard, StatusBadge, relativeTime } from "@/components/ui";
import { RunNowButton } from "@/components/run-now-button";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  let stats;
  try {
    stats = await api.dashboard();
  } catch {
    return (
      <div className="card">
        <EmptyState
          title="Can't reach the API"
          description="The backend isn't responding. Check that the api service is running with `docker compose ps`."
        />
      </div>
    );
  }

  const pipeline = stats.pipeline.filter((b) => b.count > 0);
  const maxCount = Math.max(...pipeline.map((b) => b.count), 1);

  return (
    <>
      <PageHeader
        title="Dashboard"
        description="Pipeline health and what's going out next."
        action={<RunNowButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total leads" value={stats.total_leads} />
        <StatCard label="Active sequences" value={stats.active_enrollments} hint="enrollments in flight" />
        <StatCard label="Sent (7 days)" value={stats.sends_last_7_days} />
        <StatCard
          label="Reply rate"
          value={`${stats.reply_rate}%`}
          hint="of leads contacted"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Pipeline</h2>
          {pipeline.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No leads yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {pipeline.map((bucket) => (
                <li key={bucket.status} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <StatusBadge status={bucket.status} />
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(bucket.count / maxCount) * 100}%` }}
                    />
                  </div>
                  <span className="w-8 text-right text-sm tabular-nums text-muted">
                    {bucket.count}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-ink">Next sends</h2>
            <span className="text-xs text-muted">{stats.sends_scheduled} queued</span>
          </div>

          {stats.upcoming.length === 0 ? (
            <p className="mt-4 text-sm text-muted">
              Nothing scheduled.{" "}
              <Link href="/leads" className="text-accent hover:underline">
                Enroll some leads
              </Link>{" "}
              to fill the queue.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-line">
              {stats.upcoming.slice(0, 6).map((send) => (
                <li key={send.id} className="py-3 first:pt-0">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="truncate text-sm font-medium text-ink">{send.subject}</p>
                    <span className="shrink-0 text-xs text-muted">
                      {relativeTime(send.scheduled_for)}
                    </span>
                  </div>
                  <p className="mt-0.5 truncate text-xs text-muted">
                    {send.lead_name} · {send.sequence_name}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
