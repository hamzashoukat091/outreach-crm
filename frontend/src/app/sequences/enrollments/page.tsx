import Link from "next/link";
import { api } from "@/lib/api";
import { EnrollmentsTable } from "@/components/enrollments-table";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

// 'Running' is the default view and covers the two live states, so the page
// opens on what is actually in flight rather than on every run ever created.
const RUNNING = "running";
const STATES = [RUNNING, "active", "paused", "replied", "stopped", "bounced", "completed"];
const STATE_LABEL: Record<string, string> = {
  [RUNNING]: "Running",
  active: "Active",
  paused: "Paused",
  replied: "Replied",
  stopped: "Stopped",
  bounced: "Bounced",
  completed: "Completed",
};

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; sequence_id?: string }>;
}) {
  const params = await searchParams;
  // No filter means "what is running", not "everything that ever ran".
  const view = params.state ?? RUNNING;

  let all;
  let sequences;
  try {
    [all, sequences] = await Promise.all([
      // Fetch unfiltered and slice locally: the tab counts have to reflect the
      // same sequence filter the rows do, and that is one request, not seven.
      api.listAutomationEnrollments({ sequence_id: params.sequence_id }),
      api.listAutomationSequences(),
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

  const isRunning = (state: string) => state === "active" || state === "paused";
  const countFor = (state: string) =>
    state === RUNNING
      ? all.filter((e) => isRunning(e.state)).length
      : all.filter((e) => e.state === state).length;

  const enrollments =
    view === RUNNING
      ? all.filter((e) => isRunning(e.state))
      : all.filter((e) => e.state === view);

  function filterHref(next: { state?: string; sequence_id?: string }) {
    const qs = new URLSearchParams();
    const state = "state" in next ? next.state : params.state;
    const sequenceId = "sequence_id" in next ? next.sequence_id : params.sequence_id;
    if (state) qs.set("state", state);
    if (sequenceId) qs.set("sequence_id", sequenceId);
    const suffix = qs.toString() ? `?${qs}` : "";
    return `/sequences/enrollments${suffix}`;
  }

  return (
    <>
      <PageHeader
        title="Enrollments"
        description={
          view === RUNNING
            ? "Prospects a sequence is working on right now. Finished runs are on the other tabs."
            : view === "active"
            ? "Enrollments currently sending on schedule."
            : view === "paused"
            ? "Held mid-sequence. They send nothing until you resume them."
            : `Enrollments that ended as ${STATE_LABEL[view]?.toLowerCase() ?? view}. These send nothing further.`
        }
      />

      <div className="mb-4 flex gap-2">
        <Link href="/sequences" className="btn-secondary">
          Sequences
        </Link>
        <Link href="/sequences/enrollments" className="btn-primary">
          Enrollments
        </Link>
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {/* Counts sit on the tabs so an empty view is explained before it is
            opened -- "Stopped 2" answers "where did my enrollment go?". */}
        <div className="flex flex-wrap gap-1">
          {STATES.map((state) => {
            const count = countFor(state);
            return (
              <Link
                key={state}
                href={filterHref({ state: state === RUNNING ? undefined : state })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  view === state
                    ? "bg-accent-soft text-accent"
                    : count === 0
                    ? "text-muted/50 hover:bg-surface-2 hover:text-ink"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {STATE_LABEL[state]}
                <span className="ml-1.5 tabular-nums opacity-70">{count}</span>
              </Link>
            );
          })}
        </div>

        {sequences.length > 0 && (
          <div className="ml-auto flex flex-wrap gap-1">
            <Link
              href={filterHref({ sequence_id: undefined })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                !params.sequence_id
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              All sequences
            </Link>
            {sequences.map((sequence) => (
              <Link
                key={sequence.id}
                href={filterHref({ sequence_id: sequence.id })}
                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
                  params.sequence_id === sequence.id
                    ? "bg-accent-soft text-accent"
                    : "text-muted hover:bg-surface-2 hover:text-ink"
                }`}
              >
                {sequence.name}
              </Link>
            ))}
          </div>
        )}
      </div>

      <EnrollmentsTable
        enrollments={enrollments}
        emptyTitle={
          view === RUNNING ? "Nothing running" : `No ${STATE_LABEL[view]?.toLowerCase() ?? view} enrollments`
        }
        emptyDescription={
          view === RUNNING && all.length > 0
            ? `No sequence is sending right now. ${all.length} run${
                all.length === 1 ? " has" : "s have"
              } already finished — see the tabs above.`
            : view === RUNNING
            ? "Enroll prospects from a sequence page to start one."
            : "Nothing has ended in this state yet."
        }
      />
    </>
  );
}
