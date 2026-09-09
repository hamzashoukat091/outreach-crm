"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { updateProspectAction } from "@/app/prospect-actions";
import type { Prospect } from "@/lib/prospect-types";
import { Toast, useToast } from "@/components/toast";

type Field = {
  name: keyof Prospect;
  label: string;
  type?: "email" | "url";
  textarea?: boolean;
  hint?: string;
  wide?: boolean;
};

/** Grouped the way the record is read, not the way the table is ordered:
 *  who they are, then where they work. */
const GROUPS: { title: string; fields: Field[] }[] = [
  {
    title: "Person",
    fields: [
      { name: "first_name", label: "First name" },
      { name: "last_name", label: "Last name" },
      {
        name: "email",
        label: "Email",
        type: "email",
        wide: true,
        hint: "Used to match replies to this prospect.",
      },
      { name: "job_title", label: "Job title", wide: true },
      { name: "job_department", label: "Department" },
      { name: "seniority", label: "Seniority" },
      { name: "linkedin", label: "LinkedIn", type: "url", wide: true },
      { name: "prospect_city", label: "City" },
      { name: "prospect_country", label: "Country" },
    ],
  },
  {
    title: "Company",
    fields: [
      { name: "company_name", label: "Company name", wide: true },
      { name: "industry", label: "Industry" },
      { name: "employee_range", label: "Employees", hint: "e.g. 51-200" },
      { name: "company_website", label: "Website", type: "url", wide: true },
      { name: "company_city", label: "City" },
      { name: "company_country", label: "Country" },
      {
        name: "company_description",
        label: "What the company does",
        textarea: true,
        wide: true,
        hint: "The single biggest lever on how well the AI writes for them.",
      },
    ],
  },
];

export function ProspectEdit({
  prospect,
  hasSentMail,
}: {
  prospect: Prospect;
  hasSentMail: boolean;
}) {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { toast, show } = useToast();

  const save = updateProspectAction.bind(null, prospect.id);
  const [state, action, pending] = useActionState(save, null);

  useEffect(() => {
    if (!state) return;
    show(state);
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state, show, router]);

  if (!open) {
    return (
      <>
        <button onClick={() => setOpen(true)} className="btn-secondary">
          Edit details
        </button>
        <Toast state={toast} />
      </>
    );
  }

  return (
    <>
      <form action={action} className="card mt-3 space-y-5 p-4">
        {GROUPS.map((group) => (
          <fieldset key={group.title} className="min-w-0">
            <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
              {group.title}
            </legend>
            <div className="grid gap-3 sm:grid-cols-2">
              {group.fields.map((field) => {
                const value = (prospect[field.name] as string | null) ?? "";
                return (
                  <div
                    key={field.name}
                    className={field.wide ? "sm:col-span-2" : undefined}
                  >
                    <label
                      htmlFor={`edit-${field.name}`}
                      className="label text-xs"
                    >
                      {field.label}
                    </label>
                    {field.textarea ? (
                      <textarea
                        id={`edit-${field.name}`}
                        name={field.name}
                        defaultValue={value}
                        rows={4}
                        className="input"
                      />
                    ) : (
                      <input
                        id={`edit-${field.name}`}
                        name={field.name}
                        type={field.type ?? "text"}
                        defaultValue={value}
                        className="input"
                      />
                    )}
                    {field.hint && (
                      <p className="mt-1 text-[11px] text-muted">{field.hint}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </fieldset>
        ))}

        {/* The address is the join between a prospect and their replies:
            inbound mail is matched on it, and so is the suppression list.
            Changing it after mail has gone out leaves the sent thread
            pointing at the old address, so say that rather than let it be
            discovered later. */}
        {hasSentMail && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
            Email has already been sent to this prospect. Changing the address
            here will not move that thread — replies to the old address stop
            being matched to them.
          </p>
        )}

        <div className="flex items-center gap-2">
          <button type="submit" disabled={pending} className="btn-primary">
            {pending ? "Saving…" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            disabled={pending}
            className="btn-ghost"
          >
            Cancel
          </button>
        </div>
      </form>
      <Toast state={toast} />
    </>
  );
}
