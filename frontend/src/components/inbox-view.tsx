"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import {
  approveMessageAction,
  regenerateMessageAction,
  rejectMessageAction,
  simulateReplyAction,
} from "@/app/automation-actions";
import { api } from "@/lib/api";
import type { AutomationMessage, EnrollmentDetail, InboxItem } from "@/lib/types";
import { SituationBadge } from "@/components/automation-ui";
import { formatDate } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";
import { SendIcon } from "@/components/send-icon";

// An outbound bubble labelled "Sent" when the message was cancelled or is
// still waiting claims mail went out that never did. Say the actual state.
const OUTBOUND_LABEL: Record<string, string> = {
  sent: "Sent",
  scheduled: "Scheduled",
  drafting: "Being written",
  needs_approval: "Waiting for approval",
  sending: "Sending",
  cancelled: "Cancelled — never sent",
  failed: "Failed to send",
};

function snippet(text: string, max = 90): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

function MessageBubble({
  message,
  isPendingApproval,
}: {
  message: AutomationMessage;
  isPendingApproval: boolean;
}) {
  const outbound = message.direction === "outbound";
  const sent = message.state === "sent";
  const timestamp =
    message.sent_at ?? message.received_at ?? message.scheduled_for ?? message.created_at;

  if (isPendingApproval) return null; // rendered separately as the editable card

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-xl border px-4 py-3 ${
          outbound
            ? sent
              ? "border-accent/20 bg-accent-soft"
              : // Not on the wire yet (or never will be): dashed and muted, so
                // it cannot be mistaken for something the prospect received.
                "border-dashed border-line bg-surface-2/60"
            : "border-line bg-surface-2"
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-xs font-medium text-muted">
            {outbound ? OUTBOUND_LABEL[message.state] ?? "Sent" : "Received"}
            {message.kind ? ` · ${message.kind.replace(/_/g, " ")}` : ""}
          </p>
          <time className="text-xs text-muted">{formatDate(timestamp)}</time>
        </div>
        {message.subject && (
          <p className="mt-1 text-sm font-medium text-ink">{message.subject}</p>
        )}
        <p className="prose-email mt-1.5 text-sm text-ink">{message.body ?? ""}</p>
        {!outbound && message.situation && (
          <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
            <SituationBadge situation={message.situation} />
            {message.classification_confidence !== null && (
              <span className="text-xs text-muted">
                {message.classification_confidence}% confident
              </span>
            )}
            {message.classification_reason && (
              <span className="text-xs text-muted">
                — {message.classification_reason}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function PendingApprovalCard({
  messageId,
  initialSubject,
  initialBody,
  escalationReason,
  onDone,
}: {
  messageId: string;
  initialSubject: string;
  initialBody: string;
  escalationReason: string | null;
  onDone: () => void;
}) {
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();

  function approve() {
    startTransition(async () => {
      const result = await approveMessageAction(messageId, { subject, body });
      show(result);
      if (result.ok) onDone();
    });
  }

  function regenerate() {
    startTransition(async () => {
      const result = await regenerateMessageAction(messageId);
      show(result);
      if (result.ok) onDone();
    });
  }

  function reject() {
    if (!window.confirm("Reject this reply? Nothing will be sent.")) return;
    startTransition(async () => {
      const result = await rejectMessageAction(messageId);
      show(result);
      if (result.ok) onDone();
    });
  }

  return (
    <>
      <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-4 dark:border-amber-800 dark:bg-amber-950/40">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-semibold text-amber-800 dark:text-amber-300">
            Drafted reply — waiting for your approval
          </p>
          {escalationReason && (
            <p className="text-xs text-amber-800 dark:text-amber-300">
              Held: {escalationReason}
            </p>
          )}
        </div>
        <input
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          aria-label="Subject"
          className="input font-medium"
        />
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          aria-label="Body"
          className="input mt-2 resize-y text-sm"
        />
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={approve} disabled={pending} className="btn-send h-9">
            <SendIcon />
            {pending ? "Working…" : "Approve & send"}
          </button>
          <button onClick={regenerate} disabled={pending} className="btn-secondary h-9">
            Regenerate
          </button>
          <button
            onClick={reject}
            disabled={pending}
            className="btn-danger ml-auto h-9"
          >
            Reject
          </button>
        </div>
      </div>
      <Toast state={toast} />
    </>
  );
}

/** Type a reply as the prospect and push it through the real pipeline.
 *
 *  Mailpit has no relay configured, so its own Reply button cannot deliver,
 *  and live prospects will not answer a test system. Without this there is no
 *  way to exercise the receiving half at all. */
export function SimulateReplyBox({
  prospectId,
  onDone,
}: {
  prospectId: string;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();

  function send() {
    startTransition(async () => {
      const result = await simulateReplyAction(prospectId, body);
      show(result);
      if (result.ok) {
        setBody("");
        setOpen(false);
        onDone();
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="w-full rounded-xl border border-dashed border-line px-4 py-3 text-left text-xs text-muted hover:border-accent/40 hover:text-ink"
      >
        + Reply as this prospect — to test how the engine answers
      </button>
    );
  }

  return (
    <>
      <div className="rounded-xl border border-dashed border-line bg-surface-2/60 px-4 py-3">
        <p className="text-xs font-medium text-ink">Reply as the prospect</p>
        <p className="mt-0.5 text-xs text-muted">
          Goes through the same ingest, classify and draft path as real mail.
        </p>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          autoFocus
          placeholder="Interested, but what would this cost us?"
          className="input mt-2 resize-y text-sm"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            onClick={send}
            disabled={pending || !body.trim()}
            className="btn-primary h-8 text-xs"
          >
            {pending ? "Sending…" : "Send reply"}
          </button>
          <button
            onClick={() => setOpen(false)}
            disabled={pending}
            className="btn-ghost h-8 text-xs"
          >
            Cancel
          </button>
        </div>
      </div>
      <Toast state={toast} />
    </>
  );
}

export function InboxView({ items }: { items: InboxItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(
    items[0]?.enrollment_id ?? null,
  );
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast, show } = useToast();
  const router = useRouter();

  const selected = items.find((i) => i.enrollment_id === selectedId) ?? null;

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    setLoading(true);
    api
      .getAutomationEnrollment(selectedId)
      .then((data) => {
        if (!cancelled) setDetail(data);
      })
      .catch(() => {
        if (!cancelled) show({ ok: false, message: "Couldn't load the conversation." });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  function reloadThread() {
    router.refresh();
    if (selectedId) {
      api
        .getAutomationEnrollment(selectedId)
        .then(setDetail)
        .catch(() => {});
    }
  }

  const messages = detail
    ? [...detail.messages].sort((a, b) => {
        const ta = a.sent_at ?? a.received_at ?? a.created_at;
        const tb = b.sent_at ?? b.received_at ?? b.created_at;
        return ta < tb ? -1 : 1;
      })
    : [];
  // The inbox only flags THAT something is held; the message itself is found
  // in the client-fetched thread.
  const pendingMessage = selected?.pending_approval
    ? (messages.find(
        (m) => m.direction === "outbound" && m.state === "needs_approval",
      ) ?? null)
    : null;
  const pendingId = pendingMessage?.id ?? null;

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: conversation list */}
        <div className="card max-h-[75vh] overflow-y-auto lg:col-span-1">
          <ul className="divide-y divide-line">
            {items.map((item) => {
              const active = item.enrollment_id === selectedId;
              return (
                <li key={item.enrollment_id}>
                  <button
                    onClick={() => setSelectedId(item.enrollment_id)}
                    className={`w-full px-4 py-3 text-left transition-colors ${
                      active ? "bg-accent-soft/60" : "hover:bg-surface-2"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {item.prospect_name || item.prospect_email}
                      </p>
                      {item.pending_approval && (
                        <span
                          title="A drafted reply is waiting for approval"
                          className="h-2 w-2 shrink-0 rounded-full bg-amber-500"
                        />
                      )}
                    </div>
                    <p className="mt-0.5 truncate text-xs text-muted">
                      {item.sequence_name}
                      {item.last_activity_at
                        ? ` · ${formatDate(item.last_activity_at)}`
                        : ""}
                    </p>
                    {item.latest_inbound && (
                      <>
                        <p className="mt-1 truncate text-xs text-muted">
                          {snippet(item.latest_inbound.body ?? "")}
                        </p>
                        <div className="mt-1.5">
                          <SituationBadge situation={item.latest_inbound.situation} />
                        </div>
                      </>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* Right: thread */}
        <div className="card max-h-[75vh] overflow-y-auto p-5 lg:col-span-2">
          {!selected ? (
            <p className="text-sm text-muted">Select a conversation.</p>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div className="min-w-0">
                  <Link
                    href={`/prospects/${selected.prospect_id}`}
                    className="text-sm font-semibold text-ink hover:text-accent"
                  >
                    {selected.prospect_name || selected.prospect_email}
                  </Link>
                  <p className="text-xs text-muted">
                    {selected.prospect_email} · {selected.sequence_name}
                  </p>
                </div>
              </div>

              {loading && !detail ? (
                <p className="text-sm text-muted">Loading conversation…</p>
              ) : messages.length === 0 ? (
                <p className="text-sm text-muted">No messages on this enrollment yet.</p>
              ) : (
                <div className="space-y-3">
                  {messages.map((message) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      isPendingApproval={message.id === pendingId}
                    />
                  ))}
                  {pendingMessage && (
                    <PendingApprovalCard
                      key={pendingMessage.id}
                      messageId={pendingMessage.id}
                      initialSubject={pendingMessage.subject ?? ""}
                      initialBody={pendingMessage.body ?? ""}
                      escalationReason={pendingMessage.escalation_reason}
                      onDone={reloadThread}
                    />
                  )}
                  {selected.prospect_id && (
                    <SimulateReplyBox
                      prospectId={selected.prospect_id}
                      onDone={reloadThread}
                    />
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
