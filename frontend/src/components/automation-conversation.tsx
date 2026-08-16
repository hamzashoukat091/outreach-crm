"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AutomationMessage } from "@/lib/types";
import { SimulateReplyBox } from "@/components/inbox-view";
import { MessageStateBadge, SituationBadge } from "@/components/automation-ui";
import { PromptInspector } from "@/components/prompt-inspector";
import { formatDate } from "@/components/ui";

function MessageRow({ message }: { message: AutomationMessage }) {
  const [open, setOpen] = useState(false);
  const outbound = message.direction === "outbound";
  const timestamp =
    message.sent_at ?? message.received_at ?? message.scheduled_for ?? message.created_at;

  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            title={outbound ? "Outbound" : "Inbound"}
            className={`shrink-0 text-sm ${outbound ? "text-accent" : "text-muted"}`}
          >
            {outbound ? "→" : "←"}
          </span>
          <span className="truncate text-sm text-ink">
            {message.subject || "(no subject)"}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {message.kind.replace(/_/g, " ")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!outbound && <SituationBadge situation={message.situation} />}
          <MessageStateBadge state={message.state} />
          <time className="hidden text-xs text-muted sm:block">
            {formatDate(timestamp)}
          </time>
        </span>
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-surface-2 p-3">
          <p className="prose-email text-sm text-muted">{message.body ?? ""}</p>
          <div className="mt-2 flex items-center justify-between gap-2">
            <time className="text-xs text-muted sm:hidden">{formatDate(timestamp)}</time>
            {outbound && (message.strategy_name || message.model) && (
              <span className="text-xs text-muted">
                {[message.strategy_name, message.model].filter(Boolean).join(" · ")}
              </span>
            )}
            {/* Same transparency as manual drafts: the exact API call. */}
            {outbound && message.state !== "drafting" && (
              <PromptInspector draftId={message.id} source="message" />
            )}
          </div>
        </div>
      )}
    </li>
  );
}

/** The automated half of a prospect's history, above the manual drafts. */
export function AutomationConversation({
  messages,
  prospectId,
}: {
  messages: AutomationMessage[];
  prospectId: string;
}) {
  const router = useRouter();
  const hasSent = messages.some(
    (m) => m.direction === "outbound" && m.state === "sent",
  );
  const ordered = [...messages].sort((a, b) => {
    const ta = a.sent_at ?? a.received_at ?? a.created_at;
    const tb = b.sent_at ?? b.received_at ?? b.created_at;
    return ta < tb ? -1 : 1;
  });

  return (
    <section className="card p-5">
      <h2 className="mb-1 text-sm font-semibold text-ink">
        Automated conversation ({messages.length})
      </h2>
      <p className="mb-3 text-xs text-muted">
        Emails the automation engine sent and received for this prospect.
      </p>
      <ul className="divide-y divide-line">
        {ordered.map((message) => (
          <MessageRow key={message.id} message={message} />
        ))}
      </ul>

      {/* Only once something has actually gone out -- there is nothing to
          reply to before that, and the endpoint refuses it anyway. */}
      {hasSent && (
        <div className="mt-3 border-t border-line pt-3">
          <SimulateReplyBox prospectId={prospectId} onDone={router.refresh} />
        </div>
      )}
    </section>
  );
}
