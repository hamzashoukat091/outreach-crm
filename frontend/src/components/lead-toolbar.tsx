"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useActionState, useEffect, useRef, useState } from "react";
import { createLeadAction, importCsvAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";
import type { LeadStatus } from "@/lib/types";

const STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "replied",
  "qualified",
  "won",
  "lost",
  "unsubscribed",
];

export function LeadToolbar() {
  const router = useRouter();
  const params = useSearchParams();
  const [showAdd, setShowAdd] = useState(false);
  const { toast, show } = useToast();

  const [addState, addAction, addPending] = useActionState(createLeadAction, null);
  const [importState, importAction, importPending] = useActionState(importCsvAction, null);
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
    router.push(`/leads?${next.toString()}`);
  }

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search name, email, or company…"
          defaultValue={params.get("q") ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            // Debounce so we don't push a route per keystroke.
            clearTimeout((window as any).__leadSearch);
            (window as any).__leadSearch = setTimeout(() => setParam("q", value), 350);
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
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>

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
            {showAdd ? "Cancel" : "Add lead"}
          </button>
        </div>
      </div>

      {showAdd && (
        <form ref={formRef} action={addAction} className="card mb-4 grid gap-4 p-5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label" htmlFor="email">
              Email <span className="text-rose-500">*</span>
            </label>
            <input id="email" name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label" htmlFor="first_name">First name</label>
            <input id="first_name" name="first_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="last_name">Last name</label>
            <input id="last_name" name="last_name" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="company">Company</label>
            <input id="company" name="company" className="input" />
          </div>
          <div>
            <label className="label" htmlFor="title">Title</label>
            <input id="title" name="title" className="input" />
          </div>
          <div className="sm:col-span-2">
            <label className="label" htmlFor="tags">Tags</label>
            <input id="tags" name="tags" placeholder="saas, warm" className="input" />
          </div>
          <div className="sm:col-span-2">
            <button type="submit" disabled={addPending} className="btn-primary">
              {addPending ? "Saving…" : "Save lead"}
            </button>
          </div>
        </form>
      )}

      <Toast state={toast} />
    </>
  );
}
