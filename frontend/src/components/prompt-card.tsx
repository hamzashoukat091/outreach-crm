"use client";

import { useState } from "react";
import type { LeadPrompt } from "@/lib/lead-prompts";

/**
 * One sourcing prompt with a copy button.
 *
 * The body renders in a <textarea> rather than a <pre>: the content is a block
 * meant to be selected and pasted whole, textareas scroll and wrap without
 * needing their own scroll container, and the text is not HTML-parsed, so the
 * angle brackets and quotes inside the prompts need no escaping.
 */
export function PromptCard({ prompt }: { prompt: LeadPrompt }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(prompt.body);
      setState("copied");
    } catch {
      // Clipboard access can be refused outright (permissions, an insecure
      // origin). Saying so beats a button that silently does nothing --
      // the text is selectable by hand as a fallback.
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  }

  const lines = prompt.body.split("\n").length;

  return (
    <section id={prompt.id} className="card scroll-mt-4 p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="flex items-center gap-2.5 text-sm font-semibold text-ink">
          <span
            className="tabular inline-flex h-6 w-6 items-center justify-center rounded-full
              bg-accent-soft text-xs font-semibold text-accent"
          >
            {prompt.n}
          </span>
          {prompt.title}
        </h2>
        <button
          onClick={copy}
          className={`h-9 rounded-lg border px-3 text-sm font-medium transition-colors ${
            state === "copied"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
              : state === "failed"
                ? "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "border-line text-muted hover:bg-surface-2 hover:text-ink"
          }`}
        >
          {state === "copied"
            ? "Copied"
            : state === "failed"
              ? "Press Ctrl+C"
              : "Copy prompt"}
        </button>
      </div>

      <textarea
        readOnly
        value={prompt.body}
        spellCheck={false}
        aria-label={`${prompt.title} prompt`}
        onFocus={(e) => e.currentTarget.select()}
        className="h-64 w-full resize-y rounded-lg border border-line bg-surface-2 p-3
          font-mono text-xs leading-relaxed text-ink outline-none
          focus:border-accent/50"
      />

      <p className="mt-2 text-xs text-muted">
        {lines} lines · set <code className="text-ink">BALANCE</code> before
        pasting · ~<strong className="text-ink">125 credits</strong> at ROWS = 25
      </p>
    </section>
  );
}
