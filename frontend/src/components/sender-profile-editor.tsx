"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { saveSenderAction } from "@/app/prospect-actions";
import type { SenderProfile } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

/**
 * The sender half of every prompt.
 *
 * Prospect data alone tells the model who it is writing TO but nothing about
 * what is being offered, which is where generic "we help teams" filler comes
 * from. These fields are injected into every generation.
 */
export function SenderProfileEditor({ profile }: { profile: SenderProfile }) {
  const [open, setOpen] = useState(!profile.is_configured);
  const [form, setForm] = useState({
    name: profile.name ?? "",
    headline: profile.headline ?? "",
    offer: profile.offer ?? "",
    proof: profile.proof ?? "",
    call_to_action: profile.call_to_action ?? "",
    signature: profile.signature ?? "",
  });
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  function patch(key: keyof typeof form, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  function save() {
    startTransition(async () => {
      const result = await saveSenderAction(form);
      show(result);
      if (result.ok) {
        setOpen(false);
        router.refresh();
      }
    });
  }

  if (!open) {
    return (
      <>
        <div className="card flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink">
              You — what every email offers
            </h2>
            <p className="mt-0.5 truncate text-sm text-muted">
              {profile.headline || profile.name || "Profile set"}
              {profile.offer ? ` · ${profile.offer.slice(0, 80)}…` : ""}
            </p>
          </div>
          <button onClick={() => setOpen(true)} className="btn-secondary shrink-0">
            Edit
          </button>
        </div>
        <Toast state={toast} />
      </>
    );
  }

  return (
    <>
      <div className="card space-y-4 p-5">
        <div>
          <h2 className="text-sm font-semibold text-ink">
            You — what every email offers
          </h2>
          <p className="mt-1 text-xs text-muted">
            Injected into every prompt. Without it the model knows who it&apos;s
            writing to but not what you do, and falls back on vague filler. The
            guardrails forbid claiming anything you don&apos;t list here.
          </p>
        </div>

        {!profile.is_configured && (
          <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Not filled in yet — emails will stay vague about your services until
            you describe them.
          </p>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sp-name">Your name</label>
            <input
              id="sp-name"
              value={form.name}
              onChange={(e) => patch("name", e.target.value)}
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="sp-headline">What you are</label>
            <input
              id="sp-headline"
              value={form.headline}
              onChange={(e) => patch("headline", e.target.value)}
              placeholder="Python AI Engineer"
              className="input"
            />
          </div>
        </div>

        <div>
          <label className="label" htmlFor="sp-offer">
            What you offer <span className="text-rose-500">*</span>
          </label>
          <textarea
            id="sp-offer"
            value={form.offer}
            onChange={(e) => patch("offer", e.target.value)}
            rows={4}
            placeholder="The skills and services you sell, and the problems they solve."
            className="input resize-y"
          />
          <p className="mt-1 text-xs text-muted">
            The most important field. Be concrete about what you build and fix.
          </p>
        </div>

        <div>
          <label className="label" htmlFor="sp-proof">
            Experience the model may cite
          </label>
          <textarea
            id="sp-proof"
            value={form.proof}
            onChange={(e) => patch("proof", e.target.value)}
            rows={3}
            placeholder="Years of experience, notable systems you've built, your stack."
            className="input resize-y"
          />
          <p className="mt-1 text-xs text-muted">
            Only what you write here can be referenced — nothing beyond it will
            be invented.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="sp-cta">Preferred ask</label>
            <input
              id="sp-cta"
              value={form.call_to_action}
              onChange={(e) => patch("call_to_action", e.target.value)}
              placeholder="A short call this week"
              className="input"
            />
          </div>
          <div>
            <label className="label" htmlFor="sp-sig">Sign off as</label>
            <input
              id="sp-sig"
              value={form.signature}
              onChange={(e) => patch("signature", e.target.value)}
              placeholder="Hamza"
              className="input"
            />
          </div>
        </div>

        <div className="flex gap-2 border-t border-line pt-4">
          <button onClick={save} disabled={pending} className="btn-primary">
            {pending ? "Saving…" : "Save profile"}
          </button>
          {profile.is_configured && (
            <button onClick={() => setOpen(false)} className="btn-ghost">
              Cancel
            </button>
          )}
        </div>
      </div>

      <Toast state={toast} />
    </>
  );
}
