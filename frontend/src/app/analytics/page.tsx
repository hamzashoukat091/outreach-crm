import { api } from "@/lib/api";
import { EmptyState, PageHeader, StatCard } from "@/components/ui";
import { ProspectStatusBadge } from "@/components/prospect-ui";
import type { ProspectStatus } from "@/lib/prospect-types";

export const dynamic = "force-dynamic";

function BarList({
  title,
  items,
  empty,
}: {
  title: string;
  items: { label: string; count: number }[];
  empty: string;
}) {
  const max = Math.max(...items.map((i) => i.count), 1);

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-4 space-y-3">
          {items.map((item) => (
            <li key={item.label} className="flex items-center gap-3">
              <span
                className="w-40 shrink-0 truncate text-xs text-muted"
                title={item.label}
              >
                {item.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className="h-full rounded-full bg-accent"
                  style={{ width: `${(item.count / max) * 100}%` }}
                />
              </div>
              <span className="w-8 text-right text-sm tabular-nums text-muted">
                {item.count}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default async function AnalyticsPage() {
  let stats;
  try {
    stats = await api.analytics();
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

  const pipeline = stats.by_status.filter((b) => b.count > 0);
  const maxPipeline = Math.max(...pipeline.map((b) => b.count), 1);
  const maxActivity = Math.max(...stats.activity.map((d) => d.generated), 1);

  // Only meaningful once both kinds of draft exist.
  const canCompareContext =
    stats.rich_context_drafts > 0 && stats.thin_context_drafts > 0;

  return (
    <>
      <PageHeader
        title="Analytics"
        description="Pipeline, data quality, and how your strategies are performing."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Prospects" value={stats.total_prospects} />
        <StatCard
          label="Data completeness"
          value={`${stats.data_completeness}%`}
          hint={`${stats.incomplete} missing company info`}
        />
        <StatCard
          label="Emails sent"
          value={stats.approved_drafts}
          hint={`${stats.total_drafts} generated`}
        />
        <StatCard
          label="Reply rate"
          value={`${stats.reply_rate}%`}
          hint={`${stats.replied_count} replied`}
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="card p-5">
          <h2 className="text-sm font-semibold text-ink">Pipeline</h2>
          {pipeline.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No prospects yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {pipeline.map((bucket) => (
                <li key={bucket.status} className="flex items-center gap-3">
                  <div className="w-28 shrink-0">
                    <ProspectStatusBadge status={bucket.status as ProspectStatus} />
                  </div>
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className="h-full rounded-full bg-accent"
                      style={{ width: `${(bucket.count / maxPipeline) * 100}%` }}
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
          <h2 className="text-sm font-semibold text-ink">Does context quality matter?</h2>
          <p className="mt-1 text-xs text-muted">
            Approval rate for emails written with full company data vs. job title alone.
          </p>

          {!canCompareContext ? (
            <p className="mt-4 text-sm text-muted">
              Approve a few of each kind to see the comparison.
            </p>
          ) : (
            <div className="mt-4 space-y-4">
              {[
                {
                  label: "Full context",
                  rate: stats.rich_approval_rate,
                  n: stats.rich_context_drafts,
                  tone: "bg-emerald-500",
                },
                {
                  label: "Limited context",
                  rate: stats.thin_approval_rate,
                  n: stats.thin_context_drafts,
                  tone: "bg-amber-500",
                },
              ].map((row) => (
                <div key={row.label}>
                  <div className="flex items-baseline justify-between text-sm">
                    <span className="text-ink">{row.label}</span>
                    <span className="tabular-nums text-muted">
                      {row.rate}% of {row.n}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full rounded-full ${row.tone}`}
                      style={{ width: `${Math.min(row.rate, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <BarList
          title="By seniority"
          items={stats.by_seniority.map((s) => ({
            label: s.label.toUpperCase(),
            count: s.count,
          }))}
          empty="No seniority data."
        />
        <BarList
          title="By industry"
          items={stats.by_industry}
          empty="No industry data — most rows are missing company info."
        />
        <BarList
          title="Top research signals"
          items={stats.top_intent_topics.map((t) => ({
            label: t.label.split(":").pop()?.trim() ?? t.label,
            count: t.count,
          }))}
          empty="No intent data in this import."
        />
        <BarList
          title="By company size"
          items={stats.by_employee_range}
          empty="No company size data."
        />
      </div>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-semibold text-ink">Strategy performance</h2>
        {stats.strategy_performance.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Generate some emails to compare strategies.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 font-medium">Strategy</th>
                  <th className="pb-2 text-right font-medium">Generated</th>
                  <th className="pb-2 text-right font-medium">Sent</th>
                  <th className="pb-2 text-right font-medium">Approval</th>
                  <th className="pb-2 text-right font-medium">Replies</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {stats.strategy_performance.map((row) => (
                  <tr key={row.name}>
                    <td className="py-2.5 text-ink">{row.name}</td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {row.generated}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {row.approved}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-ink">
                      {row.approval_rate}%
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-muted">
                      {row.replied}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {stats.activity.length > 0 && (
        <section className="card mt-6 p-5">
          <h2 className="text-sm font-semibold text-ink">Activity (30 days)</h2>
          <div className="mt-4 flex items-end gap-1 overflow-x-auto">
            {stats.activity.map((day) => (
              <div key={day.day} className="flex min-w-6 flex-1 flex-col items-center gap-1">
                <div
                  className="flex w-full flex-col justify-end"
                  style={{ height: 100 }}
                  title={`${day.day}: ${day.generated} generated, ${day.approved} sent`}
                >
                  <div
                    className="w-full rounded-t bg-accent/30"
                    style={{ height: `${(day.generated / maxActivity) * 100}%` }}
                  >
                    <div
                      className="w-full rounded-t bg-accent"
                      style={{
                        height: `${day.generated ? (day.approved / day.generated) * 100 : 0}%`,
                      }}
                    />
                  </div>
                </div>
                <span className="text-[10px] text-muted">{day.day.slice(5)}</span>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Solid = sent, light = generated but not sent.
          </p>
        </section>
      )}

      <p className="mt-6 text-xs text-muted">
        Token usage: {stats.total_input_tokens.toLocaleString()} in ·{" "}
        {stats.total_output_tokens.toLocaleString()} out
      </p>
    </>
  );
}
