import Link from "next/link";
import { api } from "@/lib/api";
import { SequenceList } from "@/components/sequence-list";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  let sequences;
  try {
    sequences = await api.listAutomationSequences();
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
        description="Automated multi-step outreach. Enroll prospects and the engine drafts, waits, and follows up."
      />

      <div className="mb-4 flex gap-2">
        <Link href="/sequences" className="btn-primary">
          Sequences
        </Link>
        <Link href="/sequences/enrollments" className="btn-secondary">
          Enrollments
        </Link>
      </div>

      <SequenceList sequences={sequences} />
    </>
  );
}
