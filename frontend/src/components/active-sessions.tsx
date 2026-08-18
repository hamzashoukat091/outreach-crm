"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { AuthSessionInfo } from "@/lib/types";
import { formatDate } from "@/components/ui";
import { Toast, useToast } from "@/components/toast";

/** Rough browser/OS out of a user-agent string -- enough to recognise your
 *  own laptop, no more. */
function describeAgent(ua: string | null): string {
  if (!ua) return "Unknown device";
  if (ua.startsWith("curl")) return "Command line (curl)";
  const browser = ua.includes("Edg/")
    ? "Edge"
    : ua.includes("Chrome/")
      ? "Chrome"
      : ua.includes("Firefox/")
        ? "Firefox"
        : ua.includes("Safari/")
          ? "Safari"
          : "Browser";
  const os = ua.includes("Windows")
    ? "Windows"
    : ua.includes("Mac OS")
      ? "macOS"
      : ua.includes("Linux")
        ? "Linux"
        : ua.includes("Android")
          ? "Android"
          : ua.includes("iPhone") || ua.includes("iPad")
            ? "iOS"
            : "";
  return os ? `${browser} on ${os}` : browser;
}

export function ActiveSessions() {
  const [sessions, setSessions] = useState<AuthSessionInfo[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast, show } = useToast();

  const load = () =>
    api
      .listAuthSessions()
      .then(setSessions)
      .catch(() => setSessions([]));

  useEffect(() => {
    load();
  }, []);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api.revokeAuthSession(id);
      show({ ok: true, message: "Signed that device out." });
      await load();
    } catch {
      show({ ok: false, message: "Could not revoke the session." });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="card p-5">
      <h2 className="text-sm font-semibold text-ink">Active sessions</h2>
      <p className="mt-0.5 text-xs text-muted">
        Every device signed in to this CRM. Revoking one signs it out immediately.
      </p>

      {sessions === null ? (
        <p className="mt-4 text-sm text-muted">Loading…</p>
      ) : sessions.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No sessions — which is odd, since you are reading this. Refresh the page.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line-soft">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink">
                  {describeAgent(s.user_agent)}
                  {s.current && (
                    <span className="ml-2 inline-flex items-center rounded-full bg-accent-soft px-2 py-0.5 text-xs font-medium text-accent ring-1 ring-inset ring-accent/20">
                      this device
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Signed in {formatDate(s.created_at)} · last seen {formatDate(s.last_seen_at)}
                  {s.ip ? ` · ${s.ip}` : ""}
                </p>
              </div>
              {!s.current && (
                <button
                  onClick={() => revoke(s.id)}
                  disabled={busy === s.id}
                  className="btn-secondary h-8 text-xs"
                >
                  {busy === s.id ? "Revoking…" : "Sign out"}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <Toast state={toast} />
    </section>
  );
}
