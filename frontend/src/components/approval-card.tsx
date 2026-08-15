"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveMessageAction,
  regenerateMessageAction,
  rejectMessageAction,
} from "@/app/automation-actions";
import type { ApprovalItem } from "@/lib/types";
import { SituationBadge } from "@/components/automation-ui";
import { formatDate } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

export function ApprovalCard({ item }: { item: ApprovalItem }) {
  const { message, trigger } = item;
  const [subject, setSubject] = useState(message.subject ?? "");
  const [body, setBody] = useState(message.body ?? "");
  const [showInbound, setShowInbound] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function approve() {
    startTransition(async () => {
      const result = await approveMessageAction(message.id, { subject, body });
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function regenerate() {
    startTransition(async () => {
      const result = await regenerateMessageAction(message.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  function reject() {
    if (!window.confirm("Reject this reply? Nothing will be sent.")) return;
    startTransition(async () => {
      const result = await rejectMessageAction(message.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  // The classification lives on the inbound trigger; escalation on the held reply.
  const heldReason =
    message.escalation_reason ??
    trigger?.classification_reason ??
    message.classification_reason;
  const situation = trigger?.situation ?? message.situation;

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <Link
              href={`/prospects/${message.prospect_id}`}
              className="text-sm font-medium text-ink hover:text-accent"
            >
              {message.prospect_name || message.prospect_email}{" "}
              <span className="font-normal text-muted">{message.prospect_email}</span>
            </Link>
            <p className="mt-0.5 text-xs text-muted">
              {message.kind.replace(/_/g, " ")} · {formatDate(message.created_at)}
            </p>
          </div>
          <SituationBadge situation={situation} />
        </div>

        {heldReason && (
          <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            <strong>Why it&apos;s held:</strong> {heldReason}
          </p>
        )}

        {trigger && (
          <div className="mt-3 rounded-lg border border-line">
            <button
              onClick={() => setShowInbound((v) => !v)}
              aria-expanded={showInbound}
              className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
            >
              <span className="min-w-0 truncate text-xs text-muted">
                <span className="font-semibold text-ink">Their email:</span>{" "}
                {trigger.subject || "(no subject)"} ·{" "}
                {formatDate(trigger.received_at ?? trigger.created_at)}
              </span>
              <span className="shrink-0 text-xs text-muted">
                {showInbound ? "Hide" : "Show"}
              </span>
            </button>
            {showInbound && (
              <p className="prose-email border-t border-line px-3 py-2.5 text-sm text-muted">
                {trigger.body}
              </p>
            )}
          </div>
        )}

        <div className="mt-3 space-y-2">
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
            className="input resize-y text-sm"
          />
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button onClick={approve} disabled={pending} className="btn-primary h-9">
            {pending ? "Working…" : "Approve & send"}
          </button>
          <button onClick={regenerate} disabled={pending} className="btn-secondary h-9">
            Regenerate
          </button>
          <button
            onClick={reject}
            disabled={pending}
            className="btn-ghost ml-auto h-9 text-rose-600"
          >
            Reject
          </button>
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
