import { api } from "@/lib/api";
import { MailboxView } from "@/components/mailbox-view";
import { PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";
import type { GmailStatus, MailListItem } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function MailboxPage() {
  let items: MailListItem[];
  let status: GmailStatus | null = null;

  try {
    // Status is best-effort: a mailbox that has never synced still renders,
    // and the view surfaces last_error itself.
    [items, status] = await Promise.all([
      api.mail("prospects"),
      api.mailStatus().catch(() => null),
    ]);
  } catch {
    return <ApiError what="The mailbox" />;
  }

  return (
    <>
      <PageHeader
        title="Mailbox"
        description={
          status?.email_address
            ? `Everything in ${status.email_address}, synced every 5 minutes.`
            : "Connect a Gmail account to sync mail into the app."
        }
      />
      <MailboxView initialItems={items} initialStatus={status} />
    </>
  );
}
