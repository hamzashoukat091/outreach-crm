import Link from "next/link";
import { api } from "@/lib/api";
import { InboxView } from "@/components/inbox-view";
import { EmptyState, PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";
import { Logo } from "@/components/logo";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  let items;
  try {
    items = await api.automationInbox();
  } catch {
    return (
      <ApiError what="The inbox" />
    );
  }

  const pendingCount = items.filter((item) => item.pending_approval).length;

  return (
    <>
      <PageHeader
        title="Conversations"
        description="Prospects who replied. Each thread carries its classification and any drafted reply awaiting approval."
        action={
          pendingCount > 0 ? (
            <Link href="/approvals" className="btn-secondary">
              {pendingCount} waiting approval
            </Link>
          ) : undefined
        }
      />

      {items.length === 0 ? (
        <div className="card">
          <EmptyState
            icon={<Logo className="h-5 w-5" />}
            title="No conversations yet"
            description="When a prospect in an automated sequence replies, the thread shows up here. All other mail lives in Mailbox."
          />
        </div>
      ) : (
        <InboxView items={items} />
      )}
    </>
  );
}
