import { api } from "@/lib/api";
import { SequencesPanel } from "@/components/sequences-panel";
import { PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  let sequences;
  try {
    sequences = await api.listAutomationSequences();
  } catch {
    return (
      <ApiError what="Sequences" />
    );
  }

  return (
    <>
      <PageHeader
        title="Sequences"
        description="Automated multi-step outreach. Enroll prospects and the engine drafts, waits, and follows up."
      />

      <SequencesPanel sequences={sequences} />
    </>
  );
}
