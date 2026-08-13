import Link from "next/link";
import { api } from "@/lib/api";
import { DraftCard } from "@/components/draft-card";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function OutboxPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const { view } = await searchParams;
  const showSent = view === "sent";

  let drafts;
  try {
    drafts = await api.listDrafts({ status: showSent ? "approved" : "draft", limit: 100 });
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
        title="Outbox"
        description={
          showSent
            ? "Emails you approved and sent by hand."
            : "Review each draft, then copy and mark it sent."
        }
      />

      <div className="mb-4 flex gap-2">
        <Link
          href="/outbox"
          className={showSent ? "btn-secondary" : "btn-primary"}
        >
          Pending review
        </Link>
        <Link
          href="/outbox?view=sent"
          className={showSent ? "btn-primary" : "btn-secondary"}
        >
          Sent
        </Link>
      </div>

      {drafts.length === 0 ? (
        <div className="card">
          <EmptyState
            title={showSent ? "Nothing sent yet" : "No drafts waiting"}
            description={
              showSent
                ? "Approved emails appear here once you've copied and sent them."
                : "Select prospects and generate emails to fill this queue."
            }
            action={
              <Link href="/prospects" className="btn-primary">
                Go to prospects
              </Link>
            }
          />
        </div>
      ) : (
        <div className="space-y-4">
          {drafts.map((draft) => (
            <DraftCard key={draft.id} draft={draft} showProspect />
          ))}
        </div>
      )}
    </>
  );
}
