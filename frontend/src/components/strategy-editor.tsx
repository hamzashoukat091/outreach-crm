"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  deleteStrategyAction,
  previewPromptAction,
  saveStrategyAction,
} from "@/app/prospect-actions";
import type { Strategy } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

const BLANK = {
  name: "",
  description: "",
  system_prompt:
    "You are an experienced B2B cold-outreach writer. You write short, specific, " +
    "plain-spoken emails. You never use marketing filler and you never claim " +
    "knowledge you were not given.",
  instructions: "",
  tone: "",
  max_words: 150,
  subject_hint: "",
  is_default: false,
};

export function StrategyEditor({
  strategy,
  onDone,
}: {
  strategy?: Strategy;
  onDone?: () => void;
}) {
  const [form, setForm] = useState(
    strategy
      ? {
          name: strategy.name,
          description: strategy.description ?? "",
          system_prompt: strategy.system_prompt,
          instructions: strategy.instructions,
          tone: strategy.tone ?? "",
          max_words: strategy.max_words,
          subject_hint: strategy.subject_hint ?? "",
          is_default: strategy.is_default,
        }
      : BLANK,
  );
  const [preview, setPreview] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function patch(key: keyof typeof form, value: unknown) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await saveStrategyAction(strategy?.id ?? null, form);
      show(result);
      if (result.ok) {
        router.refresh();
        onDone?.();
      }
    });
  }

  function showPrompt() {
    if (!strategy) {
      show({ ok: false, message: "Save the strategy first, then preview." });
      return;
    }
    startTransition(async () => {
      const result = await previewPromptAction(strategy.id);
      if (result.ok && result.prompt) {
        setPreview(
          `# Previewing against: ${result.prospect} (${result.quality} context)\n\n${result.prompt}`,
        );
      } else {
        show(result);
      }
    });
  }

  return (
    <>
      <div className="card space-y-4 p-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="s-name">
              Name <span className="text-rose-500">*</span>
            </label>
            <input
              id="s-name"
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              placeholder="Problem-first"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="s-desc">When to use it</label>
            <input
              id="s-desc"
              value={form.description}
              onChange={(e) => patch("description", e.target.value)}
              placeholder="Good all-rounder for cold first touches"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="s-system">System prompt</label>
          <textarea
            id="s-system"
            value={form.system_prompt}
            onChange={(e) => patch("system_prompt", e.target.value)}
            rows={3}
            className="input resize-y font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted">
            Who the model is. Sets voice and standards.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="s-instructions">
            Instructions <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="s-instructions"
            value={form.instructions}
            onChange={(e) => patch("instructions", e.target.value)}
            rows={10}
            placeholder={
              "Write a first-touch cold email.\n\n1. Open with why you're writing to THIS person.\n2. Name one problem their role owns.\n3. One sentence on how it gets solved.\n4. Close with a 15-minute ask.\n\nSign off as 'Hamza'."
            }
            className="input resize-y font-mono text-xs"
          />
          <p className="mt-1 text-xs text-muted">
            Your strategy — the structure and angle to follow. Prospect data is
            appended automatically, along with rules that forbid inventing facts.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className="label" htmlFor="s-tone">Tone</label>
            <input
              id="s-tone"
              value={form.tone}
              onChange={(e) => patch("tone", e.target.value)}
              placeholder="Direct, peer-to-peer"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="s-words">Max words</label>
            <input
              id="s-words"
              type="number"
              min={30}
              max={600}
              value={form.max_words}
              onChange={(e) => patch("max_words", Number(e.target.value))}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="s-subject">Subject guidance</label>
            <input
              id="s-subject"
              value={form.subject_hint}
              onChange={(e) => patch("subject_hint", e.target.value)}
              placeholder="Under 8 words, lowercase"
              className="input"
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={form.is_default}
            onChange={(e) => patch("is_default", e.target.checked)}
            className="h-4 w-4 rounded border-line accent-[rgb(var(--accent))]"
          />
          Use as the default strategy
        </label>

        <div className="flex flex-wrap gap-2 border-t border-line pt-4">
          <button onClick={save} disabled={pending} className="btn-primary">
            {pending ? "Saving…" : strategy ? "Save changes" : "Create strategy"}
          </button>
          {strategy && (
            <button onClick={showPrompt} disabled={pending} className="btn-secondary">
              Preview full prompt
            </button>
          )}
          {onDone && (
            <button onClick={onDone} className="btn-ghost ml-auto">
              Close
            </button>
          )}
        </div>

        {preview && (
          <div className="border-t border-line pt-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold text-ink">
                Exact prompt sent to the model
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="text-xs text-muted hover:text-ink"
              >
                Hide
              </button>
            </div>
            <pre className="max-h-96 overflow-auto rounded-lg bg-surface-2 p-4 text-xs text-muted">
              {preview}
            </pre>
          </div>
        )}
      </div>

      <Toast state={toast} />
    </>
  );
}

export function StrategyCard({ strategy }: { strategy: Strategy }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function remove() {
    if (!window.confirm(`Delete "${strategy.name}"? Past drafts keep their history.`)) return;
    startTransition(async () => {
      const result = await deleteStrategyAction(strategy.id);
      show(result);
      if (result.ok) router.refresh();
    });
  }

  if (editing) {
    return <StrategyEditor strategy={strategy} onDone={() => setEditing(false)} />;
  }

  return (
    <>
      <div className="card p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="font-medium text-ink">{strategy.name}</h3>
              {strategy.is_default && (
                <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent">
                  default
                </span>
              )}
            </div>
            {strategy.description && (
              <p className="mt-0.5 text-sm text-muted">{strategy.description}</p>
            )}
            <p className="mt-2 text-xs text-muted">
              {strategy.max_words} words max · used {strategy.usage_count} time
              {strategy.usage_count === 1 ? "" : "s"}
              {strategy.tone && ` · ${strategy.tone}`}
            </p>
          </div>
          <div className="flex shrink-0 gap-2">
            <button onClick={() => setEditing(true)} className="btn-secondary h-9">
              Edit
            </button>
            <button
              onClick={remove}
              disabled={pending}
              className="btn-ghost h-9 text-rose-600"
            >
              Delete
            </button>
          </div>
        </div>

        <pre className="prose-email mt-4 max-h-32 overflow-hidden rounded-lg bg-surface-2 p-3 text-xs text-muted">
          {strategy.instructions}
        </pre>
      </div>

      <Toast state={toast} />
    </>
  );
}

export function NewStrategyButton() {
  const [open, setOpen] = useState(false);

  if (open) return <StrategyEditor onDone={() => setOpen(false)} />;

  return (
    <button onClick={() => setOpen(true)} className="btn-primary">
      New strategy
    </button>
  );
}
