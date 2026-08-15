import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { EnrollPanel } from "@/components/enroll-panel";
import { SequenceBuilder } from "@/components/sequence-builder";

export const dynamic = "force-dynamic";

export default async function SequenceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let sequences;
  let strategies;
  try {
    [sequences, strategies] = await Promise.all([
      api.listAutomationSequences(),
      api.listStrategies(),
    ]);
  } catch {
    notFound();
  }

  const sequence = sequences.find((s) => s.id === id);
  if (!sequence) notFound();

  const openers = strategies.filter((s) => s.kind === "opener" && s.is_active);

  return (
    <>
      <Link href="/sequences" className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← Back to sequences
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {sequence.name}
          </h1>
          {!sequence.is_active && (
            <span className="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-medium text-muted">
              inactive
            </span>
          )}
        </div>
        <p className="mt-1 text-sm text-muted">
          {sequence.description || "No description."} · {sequence.total_enrollments}{" "}
          enrolled, {sequence.active_enrollments} active
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SequenceBuilder sequence={sequence} openers={openers} />
        </div>
        <div className="lg:col-span-1">
          <EnrollPanel sequenceId={sequence.id} hasSteps={sequence.steps.length > 0} />
        </div>
      </div>
    </>
  );
}
