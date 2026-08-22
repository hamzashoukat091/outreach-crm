"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createProspectAction, importProspectsAction } from "@/app/prospect-actions";
import type { CategoryCount } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

// 'archived' is deliberately absent: archiving is a separate flag with its own
// tab, so offering it as a status filter would match nothing.
const STATUSES = [
  "new",
  "drafted",
  "approved",
  "replied",
  "bounced",
  "not_interested",
  "won",
];

const STATUS_LABEL: Record<string, string> = {
  approved: "Sent",
  not_interested: "Not interested",
};

export function ProspectToolbar({
  seniorities,
  categories = [],
}: {
  seniorities: string[];
  categories?: CategoryCount[];
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const { toast, show } = useToast();

  const [addState, addAction, addPending] = useActionState(createProspectAction, null);
  const [importState, importAction, importPending] = useActionState(
    importProspectsAction,
    null,
  );
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (addState) {
      show(addState);
      if (addState.ok) {
        formRef.current?.reset();
        setShowAdd(false);
        router.refresh();
      }
    }
  }, [addState, show, router]);

  useEffect(() => {
    if (importState) {
      show(importState);
      if (importState.ok) {
        setPendingFile(null);
        router.refresh();
      }
    }
  }, [importState, show, router]);

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params.toString());
    value ? next.set(key, value) : next.delete(key);
    next.delete("page");
    router.push(`/prospects?${next.toString()}`);
  }

  return (
    <>
      {/* One row: search takes the slack, filters stay as narrow as their
          content, and the actions ride along instead of claiming a second
          row of vertical space. */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <input
          type="search"
          placeholder="Search name, email, company, or title…"
          defaultValue={params.get("q") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            clearTimeout((window as any).__prospectSearch);
            (window as any).__prospectSearch = setTimeout(() => setParam("q", value), 350);
          }}
          className="input col-span-2 min-h-11 w-full min-w-0 flex-1 sm:h-9 sm:max-w-xs sm:w-auto sm:py-0"
        />

        <select
          defaultValue={params.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className="input min-h-11 w-full text-sm sm:h-9 sm:w-auto sm:py-0"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        {/* A toggle, not a third select: "show me the thin ones" is the only
            question anyone actually asks of this field, and the 3-option
            version cost 172px to say it. */}
        <button
          onClick={() =>
            setParam(
              "completeness",
              params.get("completeness") === "incomplete" ? "" : "incomplete",
            )
          }
          className={`h-9 shrink-0 rounded-lg border px-3 text-sm transition-colors ${
            params.get("completeness") === "incomplete"
              ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
              : "border-line text-muted hover:bg-surface-2 hover:text-ink"
          }`}
          title="Show only prospects missing company info"
        >
          Needs info
        </button>

        {categories.length > 0 && (
          <select
            defaultValue={params.get("category") ?? ""}
            onChange={(e) => setParam("category", e.target.value)}
            className="input min-h-11 w-full text-sm sm:h-9 sm:w-auto sm:py-0"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.category ?? "none"} value={c.category ?? "none"}>
                {(c.category ?? "Uncategorised") + ` (${c.count})`}
              </option>
            ))}
          </select>
        )}

        {seniorities.length > 0 && (
          <select
            defaultValue={params.get("seniority") ?? ""}
            onChange={(e) => setParam("seniority", e.target.value)}
            className="input min-h-11 w-full text-sm sm:h-9 sm:w-auto sm:py-0"
          >
            <option value="">All seniority</option>
            {seniorities.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-2">
          <label className="btn-secondary h-9 cursor-pointer">
            Import CSV
            <input
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                if (file) setPendingFile(file);
                e.currentTarget.value = ""; // re-picking the same file re-fires
              }}
            />
          </label>
          <button
            onClick={() => setShowAdd((v) => !v)}
            className="btn-primary h-9"
          >
            {showAdd ? "Cancel" : "Add prospect"}
          </button>
        </div>
      </div>

      {/* Each export is one vertical, and the CSV carries no column saying
          which. Asking here is the only moment that knowledge exists. */}
      {pendingFile && (
        <form action={importAction} className="card mb-4 p-5">
          <p className="text-sm font-medium text-ink">
            Import {pendingFile.name}
          </p>
          <p className="mt-0.5 text-xs text-muted">
            Label this batch so you can filter by it and compare reply rates
            between verticals later.
          </p>

          <input
            ref={(node) => {
              if (!node || !pendingFile) return;
              // FileList is not constructible; DataTransfer is the only way to
              // hand a File to an <input type="file"> so the form submits it.
              const dt = new DataTransfer();
              dt.items.add(pendingFile);
              node.files = dt.files;
            }}
            type="file"
            name="file"
            className="hidden"
          />
          <label className="label mt-3" htmlFor="import-category">
            Category
          </label>
          <input
            id="import-category"
            name="category"
            list="known-categories"
            maxLength={60}
            autoFocus
            defaultValue={categories[0]?.category ?? ""}
            placeholder="Dental practices"
            className="input"
          />
          <datalist id="known-categories">
            {categories
              .filter((c) => c.category)
              .map((c) => (
                <option key={c.category} value={c.category!} />
              ))}
          </datalist>

          <div className="mt-3 flex items-center gap-2">
            <button type="submit" disabled={importPending} className="btn-primary h-9">
              {importPending ? "Importing…" : "Import"}
            </button>
            <button
              type="button"
              onClick={() => setPendingFile(null)}
              disabled={importPending}
              className="btn-ghost h-9"
            >
              Cancel
            </button>
            <span className="text-xs text-muted">
              Leave blank to import without a category.
            </span>
          </div>
        </form>
      )}

      {showAdd && (
        <form ref={formRef} action={addAction} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="p-email">
              Email <span className="text-rose-500">*</span>
            </label>
            <input id="p-email" name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-first">First name</label>
            <input id="p-first" name="first_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-last">Last name</label>
            <input id="p-last" name="last_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-title">Job title</label>
            <input id="p-title" name="job_title" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-company">Company</label>
            <input id="p-company" name="company_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-industry">Industry</label>
            <input id="p-industry" name="industry" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="p-size">Employees</label>
            <input id="p-size" name="employee_range" placeholder="51-200" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="p-desc">What the company does</label>
            <textarea id="p-desc" name="company_description" rows={3} className="input resize-y" />
            <p className="mt-1 text-xs text-muted">
              The most useful field for generation — a sentence or two is enough.
            </p>
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={addPending} className="btn-primary">
              {addPending ? "Saving…" : "Save prospect"}
            </button>
          </div>
        </form>
      )}

      <Toast state={toast} />
    </>
  );
}
