import Link from "next/link";
import { api } from "@/lib/api";
import { InboxView } from "@/components/inbox-view";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function InboxPage() {
  let items;
  try {
    items = await api.automationInbox();
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

  const pendingCount = items.filter((item) => item.pending_approval).length;

  return (
    <>
      <PageHeader
        title="Inbox"
        description="Automated conversations. Replies land here with their classification."
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
            title="No conversations yet"
            description="When a prospect in an automated sequence replies, the thread shows up here."
          />
        </div>
      ) : (
        <InboxView items={items} />
      )}
    </>
  );
}
