"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  approveDraftAction,
  discardDraftAction,
  saveDraftAction,
} from "@/app/prospect-actions";
import type { EmailDraft } from "@/lib/prospect-types";
import { ContextBadge, DraftStatusBadge } from "@/components/prospect-ui";
import { PromptInspector } from "@/components/prompt-inspector";
import { Toast, useToast } from "@/components/toast";
import { formatDate } from "@/components/ui";

/** Clipboard write, with a fallback for non-secure contexts. */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = text;
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

export function DraftCard({
  draft,
  showProspect = false,
}: {
  draft: EmailDraft;
  showProspect?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(draft.body);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  const sent = draft.status === "approved";
  const dirty = subject !== draft.subject || body !== draft.body;

  /** Approve = copy to clipboard + mark sent, in one action. */
  function approve() {
    startTransition(async () => {
      if (dirty) {
        const saved = await saveDraftAction(draft.id, { subject, body });
        if (!saved.ok) {
          show(saved);
          return;
        }
      }

      const copied = await copyText(`Subject: ${subject}\n\n${body}`);
      const result = await approveDraftAction(draft.id);

      show(
        result.ok
          ? {
              ok: true,
              message: copied
                ? "Copied to clipboard and marked as sent."
                : "Marked as sent, but the copy failed — select the text manually.",
            }
          : result,
      );

      if (result.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function copyOnly() {
    startTransition(async () => {
      const ok = await copyText(`Subject: ${subject}\n\n${body}`);
      show({
        ok,
        message: ok ? "Copied. Not marked as sent." : "Copy failed — select the text manually.",
      });
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveDraftAction(draft.id, { subject, body });
      show(result);
      if (result.ok) {
        setEditing(false);
        router.refresh();
      }
    });
  }

  function discard() {
    if (!window.confirm("Discard this draft?")) return;
    startTransition(async () => {
      const result = await discardDraftAction(draft.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <>
      <div
        // A sent email sits in the same list as ones still waiting, so the
        // difference has to be visible before reading the badge.
        className={`card p-5 transition-shadow duration-200 hover:shadow-card-hover ${
          draft.status === "discarded" ? "opacity-60" : ""
        } ${
          sent ? "border-l-2 border-l-emerald-500/60" : ""
        }`}
      >
        <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            {showProspect && draft.prospect_name && (
              <Link
                href={`/prospects/${draft.prospect_id}`}
                className="text-sm font-medium text-ink hover:text-accent"
              >
                {draft.prospect_name}{" "}
                <span className="font-normal text-muted">{draft.prospect_email}</span>
              </Link>
            )}
            <p className="text-xs text-muted">
              {draft.strategy_name ?? "—"} · {formatDate(draft.created_at)}
              {draft.edited && " · edited"}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ContextBadge quality={draft.context_quality} />
            <DraftStatusBadge status={draft.status} />
          </div>
        </div>

        {editing ? (
          <div className="space-y-2">
            <input
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              className="input font-medium"
              aria-label="Subject"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={12}
              className="input resize-y font-mono text-xs"
              aria-label="Body"
            />
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-inset">
            <p className="border-b border-line-soft bg-surface-2/50 px-4 py-2.5 text-sm
              font-semibold text-ink">
              {subject}
            </p>
            <p className="prose-email px-4 py-3.5 text-[13.5px] leading-[1.65] text-ink/85">
              {body}
            </p>
          </div>
        )}

        {sent ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-emerald-700 dark:text-emerald-400">
              Sent {draft.approved_at ? formatDate(draft.approved_at) : ""}
            </p>
            <div className="flex items-center gap-1">
              <PromptInspector draftId={draft.id} />
              <button onClick={copyOnly} disabled={pending} className="btn-ghost h-8 text-xs">
                Copy again
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button onClick={approve} disabled={pending} className="btn-primary h-9">
              {pending ? "Working…" : "Copy & mark sent"}
            </button>

            {editing ? (
              <>
                <button
                  onClick={save}
                  disabled={pending || !dirty}
                  className="btn-secondary h-9"
                >
                  Save edits
                </button>
                <button
                  onClick={() => {
                    setSubject(draft.subject);
                    setBody(draft.body);
                    setEditing(false);
                  }}
                  className="btn-ghost h-9"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="btn-secondary h-9">
                Edit
              </button>
            )}

            <button onClick={copyOnly} disabled={pending} className="btn-ghost h-9">
              Copy only
            </button>
            <PromptInspector draftId={draft.id} />
            <button
              onClick={discard}
              disabled={pending}
              className="btn-danger ml-auto h-9"
            >
              Discard
            </button>
          </div>
        )}

        {draft.context_quality === "thin" && !sent && (
          <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
            Written without company data — check it reads true before sending.
          </p>
        )}
      </div>

      <Toast state={toast} />
    </>
  );
}
