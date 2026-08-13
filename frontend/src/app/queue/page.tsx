import Link from "next/link";
import { api } from "@/lib/api";
import { RunNowButton } from "@/components/run-now-button";
import { StopEnrollmentButton } from "@/components/stop-enrollment-button";
import { EmptyState, PageHeader, StatusBadge, formatDate, relativeTime } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function QueuePage() {
  let enrollments;
  try {
    enrollments = await api.listEnrollments();
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

  const active = enrollments.filter((e) => e.status === "active" || e.status === "paused");
  const finished = enrollments.filter((e) => e.status !== "active" && e.status !== "paused");

  return (
    <>
      <PageHeader
        title="Send queue"
        description="Every enrollment and the emails waiting to go out."
        action={<RunNowButton />}
      />

      {enrollments.length === 0 ? (
        <div className="card">
          <EmptyState
            title="Nothing enrolled"
            description="Select leads from the leads list and enroll them in a sequence to fill this queue."
            action={
              <Link href="/leads" className="btn-primary">
                Go to leads
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">
              In flight ({active.length})
            </h2>
            {active.length === 0 ? (
              <div className="card px-5 py-8 text-center text-sm text-muted">
                No active enrollments.
              </div>
            ) : (
              <div className="space-y-3">
                {active.map((enrollment) => {
                  // The API returns sends in due order; sort defensively so the
                  // progress bar segments always line up with their step number.
                  const sends = [...enrollment.sends].sort(
                    (a, b) => (a.step_order ?? 0) - (b.step_order ?? 0),
                  );
                  const queued = sends.filter((s) => s.status === "scheduled");
                  const next = queued[0];
                  return (
                    <div key={enrollment.id} className="card p-5">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <Link
                            href={`/leads/${enrollment.lead_id}`}
                            className="font-medium text-ink hover:text-accent"
                          >
                            {enrollment.lead_email}
                          </Link>
                          <p className="mt-0.5 text-sm text-muted">
                            {enrollment.sequence_name}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <StatusBadge status={enrollment.status} />
                          <StopEnrollmentButton
                            enrollmentId={enrollment.id}
                            leadEmail={enrollment.lead_email ?? "this lead"}
                            queued={queued.length}
                          />
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {sends.map((send, i) => (
                          <div
                            key={send.id}
                            title={`Step ${send.step_order ?? i + 1}: ${send.status}`}
                            className={`h-1.5 flex-1 rounded-full ${
                              send.status === "sent"
                                ? "bg-emerald-500"
                                : send.status === "failed"
                                  ? "bg-rose-500"
                                  : send.status === "canceled"
                                    ? "bg-zinc-300 dark:bg-zinc-700"
                                    : "bg-surface-2"
                            }`}
                          />
                        ))}
                      </div>

                      <p className="mt-2 text-xs text-muted">
                        {next
                          ? `Next: step ${next.step_order ?? enrollment.current_step + 1} ${relativeTime(next.scheduled_for)} (${formatDate(next.scheduled_for)})`
                          : "All steps delivered."}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {finished.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-semibold text-ink">
                Finished ({finished.length})
              </h2>
              <div className="card divide-y divide-line">
                {finished.map((enrollment) => (
                  <div
                    key={enrollment.id}
                    className="flex flex-wrap items-center justify-between gap-3 px-5 py-3"
                  >
                    <div className="min-w-0">
                      <Link
                        href={`/leads/${enrollment.lead_id}`}
                        className="text-sm text-ink hover:text-accent"
                      >
                        {enrollment.lead_email}
                      </Link>
                      <p className="text-xs text-muted">{enrollment.sequence_name}</p>
                    </div>
                    <StatusBadge status={enrollment.status} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      )}
    </>
  );
}
