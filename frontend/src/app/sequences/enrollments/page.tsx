import Link from "next/link";
import { api } from "@/lib/api";
import { EnrollmentsTable } from "@/components/enrollments-table";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const STATES = ["active", "paused", "replied", "stopped", "bounced", "completed"];

export default async function EnrollmentsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; sequence_id?: string }>;
}) {
  const params = await searchParams;

  let enrollments;
  let sequences;
  try {
    [enrollments, sequences] = await Promise.all([
      api.listAutomationEnrollments({
        state: params.state,
        sequence_id: params.sequence_id,
      }),
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
        description="Every prospect currently moving through a sequence."
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
        <div className="flex flex-wrap gap-1">
          <Link
            href={filterHref({ state: undefined })}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              !params.state
                ? "bg-accent-soft text-accent"
                : "text-muted hover:bg-surface-2 hover:text-ink"
            }`}
          >
            All
          </Link>
          {STATES.map((state) => (
            <Link
              key={state}
              href={filterHref({ state })}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium capitalize transition-colors ${
                params.state === state
                  ? "bg-accent-soft text-accent"
                  : "text-muted hover:bg-surface-2 hover:text-ink"
              }`}
            >
              {state}
            </Link>
          ))}
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

      <EnrollmentsTable enrollments={enrollments} />
    </>
  );
}
