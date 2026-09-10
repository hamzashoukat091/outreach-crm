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
          {/* A queued message has no subject because Claude has not written
              it yet, which "(no subject)" reads as a defect rather than a
              not-yet. Say which it is. */}
          <span
            className={`truncate text-sm ${
              message.subject ? "text-ink" : "italic text-muted"
            }`}
          >
            {message.subject ||
              (message.state === "drafting"
                ? "Not written yet"
                : "(no subject)")}
          </span>
          <span className="shrink-0 text-xs text-muted">
            {message.kind.replace(/_/g, " ")}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {!outbound && <SituationBadge situation={message.situation} />}
          <MessageStateBadge
            state={message.state}
            scheduledFor={message.scheduled_for}
          />
          <time className="hidden text-xs text-muted sm:block">
            {formatDate(timestamp)}
          </time>
        </span>
      </button>

      {open && (
        <div className="mt-2 rounded-lg bg-surface-2 p-3">
          {message.body ? (
            <p className="prose-email text-sm text-muted">{message.body}</p>
          ) : (
            <p className="text-sm italic text-muted">
              {message.state === "drafting"
                ? "Claude writes this about a day before it sends, so the copy is not stale by the time it goes out."
                : "No body."}
            </p>
          )}
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
  // Sort on the date each row actually displays. The old version fell back to
  // created_at, which for a queued follow-up is when it was booked -- the day
  // the previous step sent -- while the row shows scheduled_for, days later.
  // A message booked Sep 4 for Sep 14 therefore sorted before a Sep 7 send
  // and displayed after it: the list read 4th, 14th, 7th.
  const when = (m: AutomationMessage) =>
    m.sent_at ?? m.received_at ?? m.scheduled_for ?? m.created_at;
  const ordered = [...messages].sort((a, b) => (when(a) < when(b) ? -1 : 1));

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
