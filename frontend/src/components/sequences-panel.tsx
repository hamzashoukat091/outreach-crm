"use client";

import Link from "next/link";
import { useState } from "react";
import type { AutomationSequence } from "@/lib/types";
import { SequenceList } from "@/components/sequence-list";
import { TemplatePicker } from "@/components/template-picker";

/** Two ways to make a sequence, so two buttons.
 *
 *  Templates is the primary action -- picking a proven shape beats assembling
 *  four steps and remembering which strategy belongs where -- but it is a
 *  different intent from "give me an empty one", and burying the blank form
 *  inside the template picker made the rarer path invisible. */
export function SequencesPanel({ sequences }: { sequences: AutomationSequence[] }) {
  const [mode, setMode] = useState<"idle" | "templates" | "blank">("idle");

  return (
    <>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="flex gap-2">
          <Link href="/sequences" className="btn-primary h-9 flex-1 sm:flex-none">
            Sequences
          </Link>
          <Link href="/sequences/enrollments" className="btn-secondary h-9 flex-1 sm:flex-none">
            Enrollments
          </Link>
        </div>

        <div className="flex items-center gap-2 sm:ml-auto">
          <button
            onClick={() => setMode(mode === "blank" ? "idle" : "blank")}
            className="btn-secondary h-9 flex-1 sm:flex-none"
          >
            {mode === "blank" ? "Cancel" : "New sequence"}
          </button>
          <button
            onClick={() => setMode(mode === "templates" ? "idle" : "templates")}
            className="btn-primary h-9 flex-1 sm:flex-none"
          >
            {mode === "templates" ? "Close templates" : "Templates"}
          </button>
        </div>
      </div>

      {mode === "templates" && (
        <div className="mb-3">
          <TemplatePicker onClose={() => setMode("idle")} />
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
