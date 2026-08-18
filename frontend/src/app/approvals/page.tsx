import { api } from "@/lib/api";
import { ApprovalCard } from "@/components/approval-card";
import { EmptyState, PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function ApprovalsPage() {
  let approvals;
  try {
    approvals = await api.automationApprovals();
  } catch {
    return (
      <ApiError what="Approvals" />
    );
  }

  return (
    <>
      <PageHeader
        title="Approvals"
        description={
          approvals.length === 0
            ? "Replies the engine won't send without you."
            : `${approvals.length} held repl${approvals.length === 1 ? "y" : "ies"} waiting for review.`
        }
      />

      {approvals.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Logo className="h-5 w-5" />}
            title="Nothing waiting"
            description="Held replies appear here."
          />
        </div>
      ) : (
        <div className="space-y-4">
          {approvals.map((item) => (
            <ApprovalCard key={item.message.id} item={item} />
          ))}
        </div>
      )}
    </>
  );
}
