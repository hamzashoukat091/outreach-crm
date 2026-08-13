import { api } from "@/lib/api";
import { SequenceBuilder } from "@/components/sequence-builder";
import { SequenceCard } from "@/components/sequence-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  let sequences;
  try {
    sequences = await api.listSequences();
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
        title="Sequences"
        description="Multi-step email templates with a delay between each touch."
        action={sequences.length > 0 ? <SequenceBuilder /> : undefined}
      />

      {sequences.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No sequences yet"
            description="A sequence is an ordered set of emails with a wait between each one. Create your first to start enrolling leads."
            action={<SequenceBuilder />}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {sequences.map((sequence) => (
            <SequenceCard key={sequence.id} sequence={sequence} />
          ))}
        </div>
      )}
    </>
  );
}
