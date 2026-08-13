"use client";

import { useState } from "react";
import { api } from "@/lib/api";
import type { DraftPrompt } from "@/lib/prospect-types";
import { ContextBadge } from "@/components/prospect-ui";
import { Toast, useToast } from "@/components/toast";

/**
 * The user-facing prompt is assembled from labeled blocks. Splitting on those
 * markers lets the inspector show which part of the call came from the
 * strategy, which was the prospect's own data, and which are the fixed rules --
 * rather than one undifferentiated wall of text.
 */
function splitUserPrompt(text: string) {
  const sections: { title: string; body: string; kind: string }[] = [];

  const strategyStart = text.indexOf("YOUR STRATEGY AND INSTRUCTIONS:");
  const contextStart = text.indexOf("PROSPECT CONTEXT");
  const guardStart = text.indexOf("Hard rules, which override any other instruction:");

  if (strategyStart === -1 || contextStart === -1) {
    return [{ title: "Full message", body: text, kind: "raw" }];
  }

  const intro = text.slice(0, strategyStart).trim();
  if (intro) sections.push({ title: "Task", body: intro, kind: "task" });

  sections.push({
    title: "Your strategy",
    body: text.slice(strategyStart, contextStart).trim(),
    kind: "strategy",
  });

  const contextEnd = guardStart === -1 ? text.length : guardStart;
  sections.push({
    title: "Prospect context",
    body: text.slice(contextStart, contextEnd).trim(),
    kind: "context",
  });

  if (guardStart !== -1) {
    sections.push({
      title: "Fixed guardrails",
      body: text.slice(guardStart).trim(),
      kind: "guardrails",
    });
  }

  return sections;
}

const KIND_ACCENT: Record<string, string> = {
  task: "border-l-slate-400",
  strategy: "border-l-violet-500",
  context: "border-l-blue-500",
  guardrails: "border-l-amber-500",
  raw: "border-l-slate-400",
};

const KIND_NOTE: Record<string, string> = {
  strategy: "From the strategy you wrote — edit it on the Strategies page.",
  context: "Built from this prospect's imported fields. Blank fields are omitted.",
  guardrails: "Always appended. A strategy cannot override these.",
};

export function PromptInspector({ draftId }: { draftId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DraftPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast, show } = useToast();

  async function toggle() {
    if (open) {
      setOpen(false);
      return;
    }

    if (data) {
      setOpen(true);
      return;
    }

    setLoading(true);
    try {
      const result = await api.draftPrompt(draftId);
      setData(result);
      setOpen(true);
    } catch {
      show({ ok: false, message: "Couldn't load the prompt for this draft." });
    } finally {
      setLoading(false);
    }
  }

  async function copyAll() {
    if (!data?.user_prompt) return;
    const text = `=== SYSTEM ===\n${data.system_prompt ?? ""}\n\n=== USER ===\n${data.user_prompt}\n\n=== RESPONSE ===\n${data.raw_response ?? ""}`;
    try {
      await navigator.clipboard.writeText(text);
      show({ ok: true, message: "Full API call copied." });
    } catch {
      show({ ok: false, message: "Copy failed — select the text manually." });
    }
  }

  return (
    <>
      <button
        onClick={toggle}
        disabled={loading}
        className="btn-ghost h-9 text-xs"
        aria-expanded={open}
      >
        {loading ? "Loading…" : open ? "Hide prompt" : "View prompt"}
      </button>

      {open && data && (
        <div className="mt-3 w-full rounded-lg border border-line bg-surface-2/50 p-4">
          {!data.available ? (
            <p className="text-xs text-muted">
              This draft was generated before prompt logging was added, so the
              original call wasn&apos;t recorded. New drafts will show it here.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-3">
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                  <code className="rounded bg-surface px-1.5 py-0.5">{data.model}</code>
                  <span>·</span>
                  <span>{data.strategy_name}</span>
                  <span>·</span>
                  <span>
                    {data.input_tokens?.toLocaleString()} in /{" "}
                    {data.output_tokens?.toLocaleString()} out
                  </span>
                  <ContextBadge quality={data.context_quality} />
                </div>
                <button onClick={copyAll} className="btn-ghost h-7 text-xs">
                  Copy all
                </button>
              </div>

              <div className="space-y-3">
                <PromptSection
                  title="System prompt"
                  body={data.system_prompt ?? "(empty)"}
                  kind="task"
                  note="Sets who the model is."
                />

                {splitUserPrompt(data.user_prompt ?? "").map((section) => (
                  <PromptSection
                    key={section.title}
                    title={section.title}
                    body={section.body}
                    kind={section.kind}
                    note={KIND_NOTE[section.kind]}
                  />
                ))}

                {data.raw_response && (
                  <PromptSection
                    title="Raw model response"
                    body={data.raw_response}
                    kind="task"
                    note="Before parsing into subject and body."
                  />
                )}
              </div>
            </>
          )}
        </div>
      )}

      <Toast state={toast} />
    </>
  );
}

function PromptSection({
  title,
  body,
  kind,
  note,
}: {
  title: string;
  body: string;
  kind: string;
  note?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = body.split("\n").length;
  const long = lines > 14;

  return (
    <div className={`border-l-2 pl-3 ${KIND_ACCENT[kind] ?? "border-l-slate-400"}`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-xs font-semibold text-ink">{title}</p>
        {long && (
          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-accent hover:underline"
          >
            {expanded ? "Collapse" : `Show all ${lines} lines`}
          </button>
        )}
      </div>
      {note && <p className="mt-0.5 text-xs text-muted">{note}</p>}
      <pre
        className={`mt-1.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-surface p-3 text-xs leading-relaxed text-muted ${
          long && !expanded ? "max-h-48 overflow-y-hidden" : ""
        }`}
      >
        {body}
      </pre>
    </div>
  );
}
