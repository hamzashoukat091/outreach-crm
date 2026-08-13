"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { runNowAction } from "@/app/actions";
import { Toast, useToast } from "@/components/toast";

/**
 * Forces a worker tick. The worker polls on its own interval, but waiting for it
 * makes a demo feel broken -- this gives an immediate result.
 */
export function RunNowButton() {
  const [pending, startTransition] = useTransition();
  const { toast, show } = useToast();
  const router = useRouter();

  return (
    <>
      <button
        onClick={() =>
          startTransition(async () => {
            show(await runNowAction());
            router.refresh();
          })
        }
        disabled={pending}
        className="btn-secondary"
      >
        {pending ? "Running…" : "Run sender now"}
      </button>
      <Toast state={toast} />
    </>
  );
}
