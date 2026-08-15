"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createProspectAction, importProspectsAction } from "@/app/prospect-actions";
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

export function ProspectToolbar({ seniorities }: { seniorities: string[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
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
      if (importState.ok) router.refresh();
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search name, email, company, or title…"
          defaultValue={params.get("q") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            clearTimeout((window as any).__prospectSearch);
            (window as any).__prospectSearch = setTimeout(() => setParam("q", value), 350);
          }}
          className="input max-w-xs"
        />

        <select
          defaultValue={params.get("status") ?? ""}
          onChange={(e) => setParam("status", e.target.value)}
          className="input h-[38px] w-auto py-0"
        >
          <option value="">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s] ?? s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

        <select
          defaultValue={params.get("completeness") ?? ""}
          onChange={(e) => setParam("completeness", e.target.value)}
          className="input h-[38px] w-auto py-0"
        >
          <option value="">All data</option>
          <option value="complete">Has company info</option>
          <option value="incomplete">Missing company info</option>
        </select>

        {seniorities.length > 0 && (
          <select
            defaultValue={params.get("seniority") ?? ""}
            onChange={(e) => setParam("seniority", e.target.value)}
            className="input h-[38px] w-auto py-0"
          >
            <option value="">All seniority</option>
            {seniorities.map((s) => (
              <option key={s} value={s}>
                {s.toUpperCase()}
              </option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <form action={importAction}>
            <label className="btn-secondary cursor-pointer">
              {importPending ? "Importing…" : "Import CSV"}
              <input
                type="file"
                name="file"
                accept=".csv"
                className="hidden"
                onChange={(e) => e.currentTarget.form?.requestSubmit()}
              />
            </label>
          </form>
          <button onClick={() => setShowAdd((v) => !v)} className="btn-primary">
            {showAdd ? "Cancel" : "Add prospect"}
          </button>
        </div>
      </div>

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
