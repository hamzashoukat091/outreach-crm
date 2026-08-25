"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { api } from "@/lib/api";
import type { GmailStatus, MailDetail, MailFilter, MailListItem } from "@/lib/types";
import { formatDate } from "@/components/ui";

const FILTERS: { key: MailFilter; label: string }[] = [
  { key: "prospects", label: "Prospects" },
  { key: "all", label: "All mail" },
  { key: "unread", label: "Unread" },
  { key: "sent", label: "Sent" },
];

function senderLabel(item: MailListItem): string {
  if (item.is_sent) {
    const to = item.to_addresses[0] ?? "";
    return `To: ${item.prospect_name ?? to}`;
  }
  return item.prospect_name ?? item.from_name ?? item.from_address ?? "Unknown";
}

/** The reading pane. Renders server-sanitised HTML, falling back to text. */
function MailReader({ id, onClose }: { id: string; onClose: () => void }) {
  const [detail, setDetail] = useState<MailDetail | null>(null);
  const [images, setImages] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    api
      .mailDetail(id, images)
      .then((d) => !cancelled && setDetail(d))
      .catch(() => !cancelled && setError("Could not load this email."));
    return () => {
      cancelled = true;
    };
  }, [id, images]);

  if (error) {
    return (
      <div className="card p-6">
        <p className="text-sm text-muted">{error}</p>
        <button onClick={onClose} className="btn-secondary mt-3">
          Back
        </button>
      </div>
    );
  }

  if (!detail) {
    return (
      <div className="card p-6">
        <p className="text-sm text-muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="border-b border-line p-4">
        <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
          <h2 className="text-base font-semibold">{detail.subject || "(no subject)"}</h2>
          <button onClick={onClose} className="btn-secondary shrink-0 text-xs">
            Close
          </button>
        </div>
        <p className="text-sm text-muted">
          <span className="font-medium text-fg">
            {detail.from_name || detail.from_address}
          </span>
          {detail.from_name && detail.from_address ? ` <${detail.from_address}>` : ""}
        </p>
        <p className="text-xs text-muted">
          To: {detail.to_addresses.join(", ") || "—"}
          {detail.cc_addresses.length > 0 && ` · Cc: ${detail.cc_addresses.join(", ")}`}
        </p>
        <p className="mt-1 text-xs text-muted">{formatDate(detail.internal_date)}</p>

        <div className="mt-2 flex flex-wrap gap-2">
          {detail.prospect_name && (
            <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
              {detail.prospect_name}
            </span>
          )}
          {detail.in_pipeline && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              In pipeline
            </span>
          )}
          {detail.attachments.length > 0 && (
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
              {detail.attachments.length} attachment
              {detail.attachments.length === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>

      {detail.blocked_images > 0 && !images && (
        // Remote images in email are mostly tracking pixels: loading one tells
        // the sender the mail was opened, and when.
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface-2 px-4 py-2">
          <p className="text-xs text-muted">
            {detail.blocked_images} remote image
            {detail.blocked_images === 1 ? "" : "s"} blocked — they can track when
            you open this.
          </p>
          <button onClick={() => setImages(true)} className="btn-secondary text-xs">
            Show images
          </button>
        </div>
      )}

      <div className="p-4">
        {detail.body_html_safe ? (
          // Sanitised server-side by html_sanitize.py: no script, no event
          // handlers, no javascript:/data: URLs. Never render body_html raw.
          <div
            className="email-html text-sm"
            dangerouslySetInnerHTML={{ __html: detail.body_html_safe }}
          />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm">
            {detail.body_text || detail.snippet || "(empty message)"}
          </pre>
        )}
      </div>
    </div>
  );
}

export function MailboxView({
  initialItems,
  initialStatus,
}: {
  initialItems: MailListItem[];
  initialStatus: GmailStatus | null;
}) {
  const [filter, setFilter] = useState<MailFilter>("prospects");
  const [items, setItems] = useState(initialItems);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [status, setStatus] = useState(initialStatus);
  const [loading, setLoading] = useState(false);
  const [syncing, startSync] = useTransition();

  const load = useCallback(
    async (nextFilter: MailFilter, nextSearch: string) => {
      setLoading(true);
      try {
        setItems(await api.mail(nextFilter, nextSearch || undefined));
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  // Debounced so typing does not fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => void load(filter, search), search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [filter, search, load]);

  function sync() {
    startSync(async () => {
      try {
        await api.syncMail();
        const [next, nextStatus] = await Promise.all([
          api.mail(filter, search || undefined),
          api.mailStatus(),
        ]);
        setItems(next);
        setStatus(nextStatus);
      } catch {
        // The status row surfaces the reason on the next poll.
      }
    });
  }

  return (
    <div className="space-y-4">
      {status?.last_error && (
        <div className="rounded-xl border border-amber-300 bg-amber-50/50 p-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            Gmail sync problem
          </p>
          <p className="mt-0.5 text-xs text-amber-800 dark:text-amber-300">
            {status.last_error}
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={
                filter === f.key
                  ? "rounded-lg bg-accent px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:bg-surface-2"
              }
            >
              {f.label}
              {f.key === "unread" && status?.unread_count
                ? ` (${status.unread_count})`
                : ""}
            </button>
          ))}
        </div>

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search mail…"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />

        <button onClick={sync} disabled={syncing} className="btn-secondary text-sm">
          {syncing ? "Syncing…" : "Sync now"}
        </button>
      </div>

      {status && (
        <p className="text-xs text-muted">
          {status.email_address ?? "Not connected"}
          {status.last_synced_at && ` · last synced ${formatDate(status.last_synced_at)}`}
          {` · ${status.total_emails} stored`}
        </p>
      )}

      {selected && (
        <MailReader id={selected} onClose={() => setSelected(null)} />
      )}

      <div className="card divide-y divide-line">
        {loading && items.length === 0 ? (
          <p className="p-6 text-sm text-muted">Loading…</p>
        ) : items.length === 0 ? (
          <p className="p-6 text-sm text-muted">
            {filter === "prospects"
              ? "No mail from prospects yet. Switch to All mail to see everything in the mailbox."
              : "Nothing here."}
          </p>
        ) : (
          items.map((item) => (
            <button
              key={item.id}
              onClick={() => setSelected(item.id)}
              className={`flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-surface-2 ${
                selected === item.id ? "bg-surface-2" : ""
              }`}
            >
              <div className="flex items-baseline justify-between gap-3">
                <span
                  className={`truncate text-sm ${
                    item.is_unread && !item.is_sent ? "font-semibold" : "font-medium"
                  }`}
                >
                  {senderLabel(item)}
                </span>
                <span className="shrink-0 text-xs text-muted">
                  {formatDate(item.internal_date)}
                </span>
              </div>
              <span className="truncate text-sm">
                {item.subject || "(no subject)"}
              </span>
              <span className="truncate text-xs text-muted">{item.snippet}</span>
              {(item.prospect_name || item.in_pipeline) && (
                <span className="mt-0.5 flex gap-1.5">
                  {item.prospect_name && (
                    <span className="rounded-full bg-accent-soft px-2 py-0.5 text-xs text-accent">
                      {item.prospect_name}
                    </span>
                  )}
                  {item.in_pipeline && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                      In pipeline
                    </span>
                  )}
                </span>
              )}
            </button>
          ))
        )}
      </div>
    </div>
  );
}
