"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { DraftPrompt } from "@/lib/prospect-types";
import { ContextBadge } from "@/components/prospect-ui";
import { Toast, useToast } from "@/components/toast";

/**
 * Splits the assembled user message back into the blocks it was built from.
 *
 * Only the prospect-context block varies per draft -- the strategy and the
 * guardrails are byte-identical across every generation. That asymmetry drives
 * the layout: the unique part is shown first and expanded, the shared boilerplate
 * is collapsed behind a toggle.
 */
function splitUserPrompt(text: string) {
  const strategyStart = text.indexOf("YOUR STRATEGY AND INSTRUCTIONS:");
  const contextStart = text.indexOf("PROSPECT CONTEXT");
  const guardStart = text.indexOf("Hard rules, which override any other instruction:");

  if (strategyStart === -1 || contextStart === -1) {
    return { context: text, task: "", strategy: "", guardrails: "" };
  }

  return {
    task: text.slice(0, strategyStart).trim(),
    strategy: text.slice(strategyStart, contextStart).trim(),
    context: text
      .slice(contextStart, guardStart === -1 ? text.length : guardStart)
      .trim(),
    guardrails: guardStart === -1 ? "" : text.slice(guardStart).trim(),
  };
}

/**
 * Highlights the prospect-context block so the ingested values stand out from
 * their field labels -- this is the part you actually scan when checking what
 * the model was told.
 */
function ContextLines({ text }: { text: string }) {
  return (
    <div className="space-y-0.5 font-mono text-xs leading-relaxed">
      {text.split("\n").map((line, i) => {
        const trimmed = line.trim();

        if (!trimmed) return <div key={i} className="h-2" />;

        // Section headers: PERSON / COMPANY
        if (/^[A-Z][A-Z ]+$/.test(trimmed)) {
          return (
            <div
              key={i}
              className="pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted"
            >
              {trimmed}
            </div>
          );
        }

        // The limited-context warning the generator injects.
        if (trimmed.startsWith("CONTEXT IS LIMITED")) {
          return (
            <div
              key={i}
              className="mt-2 rounded border border-amber-300 bg-amber-50 px-2 py-1.5 text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300"
            >
              {trimmed}
            </div>
          );
        }

        const field = trimmed.match(/^-\s*([^:]+):\s*([\s\S]*)$/);
        if (field) {
          return (
            <div key={i} className="flex gap-2">
              <span className="w-36 shrink-0 text-muted">{field[1]}</span>
              <span className="min-w-0 flex-1 break-words text-ink">{field[2]}</span>
            </div>
          );
        }

        return (
          <div key={i} className="pl-2 text-muted">
            {trimmed}
          </div>
        );
      })}
    </div>
  );
}

function Collapsible({
  title,
  note,
  body,
  accent,
}: {
  title: string;
  note: string;
  body: string;
  accent: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-line">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${open ? "Hide" : "Show"} ${title}`}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-surface-2"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${accent}`} />
          <span className="text-xs font-semibold text-ink">{title}</span>
          <span className="truncate text-xs text-muted">{note}</span>
        </span>
        <span className="shrink-0 text-xs text-muted">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <pre className="overflow-x-auto whitespace-pre-wrap break-words border-t border-line px-3 py-2.5 font-mono text-xs leading-relaxed text-muted">
          {body}
        </pre>
      )}
    </div>
  );
}

export function PromptInspector({ draftId }: { draftId: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DraftPrompt | null>(null);
  const [loading, setLoading] = useState(false);
  const { toast, show } = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);

  const close = useCallback(() => setOpen(false), []);

  // Escape closes, and the page behind must not scroll while the modal is up.
  useEffect(() => {
    if (!open) return;

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") close();
    }
    document.addEventListener("keydown", onKey);

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  async function openInspector() {
    if (data) {
      setOpen(true);
      return;
    }

    setLoading(true);
    try {
      setData(await api.draftPrompt(draftId));
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
      show({ ok: false, message: "Copy failed." });
    }
  }

  const parts = data?.user_prompt ? splitUserPrompt(data.user_prompt) : null;

  return (
    <>
      <button
        onClick={openInspector}
        disabled={loading}
        className="btn-ghost h-9"
        title="See the exact API call that produced this draft"
      >
        {loading ? "Loading…" : "View prompt"}
      </button>

      {open && data && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Prompt used for this draft"
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
        >
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
            onClick={close}
          />

          <div className="relative flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-line bg-surface shadow-pop">
            <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-ink">
                  What the model was sent
                </h2>
                <p className="mt-0.5 truncate text-xs text-muted">
                  {data.prospect_email}
                </p>
              </div>
              <button
                ref={closeRef}
                onClick={close}
                aria-label="Close"
                className="btn-ghost h-8 shrink-0 px-2 text-lg leading-none"
              >
                ×
              </button>
            </header>

            {!data.available ? (
              <div className="px-5 py-8 text-center text-sm text-muted">
                This draft predates prompt logging, so the original call
                wasn&apos;t recorded. New drafts will show it here.
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line bg-surface-2/50 px-5 py-2.5 text-xs text-muted">
                  <code className="rounded bg-surface px-1.5 py-0.5">{data.model}</code>
                  <span>{data.strategy_name}</span>
                  <span>
                    {data.input_tokens?.toLocaleString()} in /{" "}
                    {data.output_tokens?.toLocaleString()} out
                  </span>
                  <ContextBadge quality={data.context_quality} />
                </div>

                <div className="flex-1 overflow-y-auto px-5 py-4">
                  {/* The only part that differs between drafts, so it leads. */}
                  <div className="mb-4">
                    <div className="mb-2 flex items-baseline justify-between gap-2">
                      <h3 className="text-xs font-semibold text-ink">
                        This prospect&apos;s data
                      </h3>
                      <span className="text-xs text-muted">
                        the only part unique to this draft
                      </span>
                    </div>
                    {/* Capped so the shared-boilerplate toggles below stay
                        reachable without scrolling past a long skills list. */}
                    <div className="max-h-72 overflow-y-auto rounded-lg border border-line bg-surface-2/40 px-3 py-3">
                      <ContextLines text={parts?.context ?? ""} />
                    </div>
                  </div>

                  <p className="mb-2 text-xs text-muted">
                    Identical across every draft using this strategy:
                  </p>
                  <div className="space-y-2">
                    <Collapsible
                      title="System prompt"
                      note="who the model is"
                      body={data.system_prompt ?? "(empty)"}
                      accent="bg-slate-400"
                    />
                    {parts?.strategy && (
                      <Collapsible
                        title="Your strategy"
                        note="edit on the Strategies page"
                        body={`${parts.task}\n\n${parts.strategy}`.trim()}
                        accent="bg-violet-500"
                      />
                    )}
                    {parts?.guardrails && (
                      <Collapsible
                        title="Guardrails"
                        note="always appended; a strategy can't override these"
                        body={parts.guardrails}
                        accent="bg-amber-500"
                      />
                    )}
                    {data.raw_response && (
                      <Collapsible
                        title="Raw response"
                        note="before parsing into subject and body"
                        body={data.raw_response}
                        accent="bg-emerald-500"
                      />
                    )}
                  </div>
                </div>

                <footer className="flex items-center justify-between gap-3 border-t border-line px-5 py-3">
                  <button onClick={copyAll} className="btn-secondary h-9">
                    Copy full call
                  </button>
                  <button onClick={close} className="btn-ghost h-9">
                    Close
                  </button>
                </footer>
              </>
            )}
          </div>
        </div>
      )}

      <Toast state={toast} />
    </>
  );
}
