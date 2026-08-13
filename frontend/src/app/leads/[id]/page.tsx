import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { LeadDetailPanel } from "@/components/lead-detail-panel";
import { EmptyState, StatusBadge, Tag, formatDate, relativeTime } from "@/components/ui";
import type { ActivityType } from "@/lib/types";

export const dynamic = "force-dynamic";

const ACTIVITY_DOT: Record<ActivityType, string> = {
  created: "bg-slate-400",
  status_changed: "bg-blue-500",
  note: "bg-slate-400",
  email_sent: "bg-emerald-500",
  email_failed: "bg-rose-500",
  enrolled: "bg-violet-500",
  unenrolled: "bg-amber-500",
  replied: "bg-amber-500",
};

export default async function LeadDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let lead;
  let activities;
  let enrollments;
  try {
    [lead, activities, enrollments] = await Promise.all([
      api.getLead(id),
      api.leadActivities(id),
      api.listEnrollments({ lead_id: id }),
    ]);
  } catch {
    notFound();
  }

  const detailRows = [
    ["Email", lead.email],
    ["Company", lead.company],
    ["Title", lead.title],
    ["Phone", lead.phone],
    ["Website", lead.website],
    ["Source", lead.source],
  ].filter(([, value]) => value) as [string, string][];

  return (
    <>
      <Link href="/leads" className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← Back to leads
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-semibold tracking-tight text-ink">
              {lead.full_name}
            </h1>
            <StatusBadge status={lead.status} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {[lead.title, lead.company].filter(Boolean).join(" · ") || lead.email}
          </p>
          {lead.tags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {lead.tags.map((tag) => (
                <Tag key={tag}>{tag}</Tag>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Details</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {detailRows.map(([label, value]) => (
                <div key={label}>
                  <dt className="text-xs text-muted">{label}</dt>
                  <dd className="mt-0.5 break-words text-sm text-ink">{value}</dd>
                </div>
              ))}
              {Object.entries(lead.custom_fields ?? {}).map(([key, value]) => (
                <div key={key}>
                  <dt className="text-xs capitalize text-muted">{key.replace("_", " ")}</dt>
                  <dd className="mt-0.5 break-words text-sm text-ink">{String(value)}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Sequences</h2>
            {enrollments.length === 0 ? (
              <p className="text-sm text-muted">
                Not enrolled in any sequence. Select this lead from the{" "}
                <Link href="/leads" className="text-accent hover:underline">
                  leads list
                </Link>{" "}
                to enroll.
              </p>
            ) : (
              <ul className="space-y-3">
                {enrollments.map((enrollment) => {
                  const sent = enrollment.sends.filter((s) => s.status === "sent").length;
                  return (
                    <li
                      key={enrollment.id}
                      className="rounded-lg border border-line px-4 py-3"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink">
                          {enrollment.sequence_name}
                        </span>
                        <StatusBadge status={enrollment.status} />
                      </div>
                      <p className="mt-1 text-xs text-muted">
                        {sent} of {enrollment.sends.length} steps sent · enrolled{" "}
                        {relativeTime(enrollment.enrolled_at)}
                      </p>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Timeline</h2>
            {activities.length === 0 ? (
              <EmptyState
                title="Nothing logged yet"
                description="Notes, status changes, and sent emails will appear here."
              />
            ) : (
              <ol className="space-y-4">
                {activities.map((activity) => (
                  <li key={activity.id} className="flex gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        ACTIVITY_DOT[activity.type] ?? "bg-slate-400"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-ink">{activity.summary}</p>
                        <time className="shrink-0 text-xs text-muted">
                          {formatDate(activity.created_at)}
                        </time>
                      </div>
                      {typeof activity.detail?.body === "string" && (
                        <p className="prose-email mt-2 rounded-lg bg-surface-2 p-3 text-xs text-muted">
                          {activity.detail.body}
                        </p>
                      )}
                      {typeof activity.detail?.error === "string" && (
                        <p className="mt-1 text-xs text-rose-600">
                          {activity.detail.error}
                        </p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="lg:col-span-1">
          <LeadDetailPanel lead={lead} />
        </div>
      </div>
    </>
  );
}
