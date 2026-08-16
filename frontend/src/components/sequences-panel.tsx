"use client";

import Link from "next/link";
import { useState } from "react";
import type { AutomationSequence } from "@/lib/types";
import { SequenceList } from "@/components/sequence-list";
import { TemplatePicker } from "@/components/template-picker";

/** Tabs and the create button share one row.
 *
 *  "New sequence" previously sat alone on its own right-aligned row between
 *  the tabs and the first card, spending a full row of vertical space to
 *  hold one button. It belongs with the other navigation. */
export function SequencesPanel({ sequences }: { sequences: AutomationSequence[] }) {
  // Templates first, blank second: assembling steps by hand is the rarer
  // case, and it is one click away from here.
  const [mode, setMode] = useState<"idle" | "templates" | "blank">("idle");

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
          onClick={() => setMode(mode === "idle" ? "templates" : "idle")}
          className="btn-secondary ml-auto h-9"
        >
          {mode === "idle" ? "New sequence" : "Cancel"}
        </button>
      </div>

      {mode === "templates" && (
        <div className="mb-3">
          <TemplatePicker
            onBlank={() => setMode("blank")}
            onClose={() => setMode("idle")}
          />
        </div>
      )}

      <SequenceList
        sequences={sequences}
        creating={mode === "blank"}
        onCreatingChange={(value) => setMode(value ? "blank" : "idle")}
      />
    </>
  );
}
