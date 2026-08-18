import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { EnrollPanel } from "@/components/enroll-panel";
import { SequenceHeader } from "@/components/sequence-header";
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
  let settings = null;
  try {
    [sequences, strategies, settings] = await Promise.all([
      api.listAutomationSequences(),
      api.listStrategies(),
      // Timing previews need the window; the page still works without it.
      api.getAutomationSettings().catch(() => null),
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

      <SequenceHeader sequence={sequence} />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SequenceBuilder sequence={sequence} openers={openers} settings={settings} />
        </div>
        <div className="lg:col-span-1">
          <EnrollPanel
            sequenceId={sequence.id}
            hasSteps={sequence.steps.length > 0}
            settings={settings}
            steps={sequence.steps}
          />
        </div>
      </div>
    </>
  );
}
