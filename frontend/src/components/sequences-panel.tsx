"use client";

import Link from "next/link";
import { useState } from "react";
import type { AutomationSequence } from "@/lib/types";
import { SequenceList } from "@/components/sequence-list";

/** Tabs and the create button share one row.
 *
 *  "New sequence" previously sat alone on its own right-aligned row between
 *  the tabs and the first card, spending a full row of vertical space to
 *  hold one button. It belongs with the other navigation. */
export function SequencesPanel({ sequences }: { sequences: AutomationSequence[] }) {
  const [creating, setCreating] = useState(false);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href="/sequences" className="btn-primary h-9">
          Sequences
        </Link>
        <Link href="/sequences/enrollments" className="btn-secondary h-9">
          Enrollments
        </Link>

        <button
          onClick={() => setCreating((v) => !v)}
          className="btn-secondary ml-auto h-9"
        >
          {creating ? "Cancel" : "New sequence"}
        </button>
      </div>

      <SequenceList
        sequences={sequences}
        creating={creating}
        onCreatingChange={setCreating}
      />
    </>
  );
}
