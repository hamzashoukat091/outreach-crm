"use client";

import { useState } from "react";
import { api } from "@/lib/api";

/** Lives at the sidebar's foot, under the live indicator. Quiet on purpose:
 *  signing out is the rarest action in a single-user tool. */
export function SignOutButton() {
  const [pending, setPending] = useState(false);

  async function signOut() {
    setPending(true);
    try {
      await api.logout();
    } finally {
      // Even if the call failed, go to the gate -- the middleware will sort
      // out whether the session actually survives.
      window.location.assign("/login");
    }
  }

  return (
    <div className="px-3 pb-4 lg:px-5">
      <button
        onClick={signOut}
        disabled={pending}
        className="btn-ghost h-8 w-full justify-start px-3 text-xs"
      >
        <svg
          viewBox="0 0 20 20"
          aria-hidden
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12.5 6.5v-2a1.5 1.5 0 00-1.5-1.5H4.5A1.5 1.5 0 003 4.5v11A1.5 1.5 0 004.5 17H11a1.5 1.5 0 001.5-1.5v-2M8 10h9m0 0l-2.5-2.5M17 10l-2.5 2.5" />
        </svg>
        {pending ? "Signing out…" : "Sign out"}
      </button>
    </div>
  );
}
