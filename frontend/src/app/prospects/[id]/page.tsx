import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "@/lib/api";
import { AutomationConversation } from "@/components/automation-conversation";
import { PipelineModeBadge } from "@/components/automation-ui";
import { DraftCard } from "@/components/draft-card";
import { ProspectPanel } from "@/components/prospect-panel";
import {
  EmailStatusBadge,
  IncompleteWarning,
  ProspectStatusBadge,
} from "@/components/prospect-ui";
import { EmptyState, Tag, formatDate } from "@/components/ui";
import type { ProspectEventType } from "@/lib/prospect-types";

export const dynamic = "force-dynamic";

const EVENT_DOT: Record<ProspectEventType, string> = {
  imported: "bg-slate-400",
  updated: "bg-blue-500",
  generated: "bg-violet-500",
  approved: "bg-emerald-500",
  replied: "bg-emerald-600",
  bounced: "bg-rose-500",
  status_changed: "bg-blue-500",
  note: "bg-slate-400",
};

export default async function ProspectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let prospect;
  let drafts;
  let events;
  let strategies;
  let health;
  let automationMessages;
  try {
    [prospect, drafts, events, strategies, health, automationMessages] =
      await Promise.all([
        api.getProspect(id),
        api.prospectDrafts(id),
        api.prospectEvents(id),
        api.listStrategies(),
        api.health().catch(() => ({ ai_configured: false, status: "", model: "" })),
        api
          .listAutomationMessages({ prospect_id: id })
          .then((page) => page.items)
          .catch(() => []),
      ]);
  } catch {
    notFound();
  }

  const liveDrafts = drafts.filter((d) => d.status !== "discarded");

  const personLocation =
    [prospect.prospect_city, prospect.prospect_region].filter(Boolean).join(", ") || null;
  const companyLocation =
    [prospect.company_city, prospect.company_region].filter(Boolean).join(", ") || null;

  const details: [string, string | null][] = [
    ["Email", prospect.email],
    ["Job title", prospect.job_title],
    ["Department", prospect.job_department],
    ["Seniority", prospect.seniority?.toUpperCase() ?? null],
    ["Location", personLocation],
    ["Company", prospect.company_name],
    ["Industry", prospect.industry],
    ["Employees", prospect.employee_range],
    ["Revenue", prospect.revenue_range],
    // Only worth its own row when it differs from where the person sits.
    ["Company HQ", companyLocation === personLocation ? null : companyLocation],
    ["Website", prospect.company_website ?? prospect.company_domain],
  ];

  return (
    <>
      <Link href="/prospects" className="mb-4 inline-block text-sm text-muted hover:text-ink">
        ← Back to prospects
      </Link>

      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">
            {prospect.full_name}
          </h1>
          <ProspectStatusBadge status={prospect.status} />
          <PipelineModeBadge mode={prospect.pipeline_mode} />
        </div>
        <p className="mt-1 text-sm text-muted">
          {[prospect.job_title, prospect.display_company].filter(Boolean).join(" · ")}
        </p>
        {prospect.linkedin && (
          <a
            href={`https://${prospect.linkedin.replace(/^https?:\/\//, "")}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-1 inline-block text-xs text-accent hover:underline"
          >
            LinkedIn profile ↗
          </a>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {!prospect.is_complete && (
            <IncompleteWarning
              missing={prospect.missing_fields}
              inferred={prospect.company_inferred}
            />
          )}

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Details</h2>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {details
                .filter(([, value]) => value)
                .map(([label, value]) => (
                  <div key={label}>
                    <dt className="text-xs text-muted">{label}</dt>
                    <dd className="mt-0.5 break-words text-sm text-ink">
                      {value}
                      {/* Deliverability sits next to the address it describes. */}
                      {label === "Email" && (
                        <EmailStatusBadge status={prospect.email_status} />
                      )}
                    </dd>
                    {label === "Email" && prospect.other_emails.length > 0 && (
                      <p className="mt-1 text-xs text-muted">
                        Also: {prospect.other_emails.join(", ")}
                      </p>
                    )}
                  </div>
                ))}
            </dl>

            {prospect.company_description && (
              <div className="mt-4 border-t border-line pt-4">
                <dt className="text-xs text-muted">What they do</dt>
                <dd className="mt-1 text-sm text-ink">{prospect.company_description}</dd>
              </div>
            )}

            {prospect.intent_topics.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <dt className="mb-2 text-xs text-muted">
                  Research signals — topics this company is active on
                </dt>
                <div className="flex flex-wrap gap-2">
                  {[...prospect.intent_topics]
                    .sort((a, b) => b.score - a.score)
                    .slice(0, 6)
                    .map((topic) => (
                      <span
                        key={topic.topic}
                        className="inline-flex items-center gap-1.5 rounded-md bg-accent-soft px-2 py-1 text-xs text-accent"
                      >
                        {topic.topic.split(":").pop()?.trim()}
                        <span className="font-mono opacity-70">{topic.score}</span>
                      </span>
                    ))}
                </div>
              </div>
            )}

            {prospect.skills.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <dt className="mb-2 text-xs text-muted">Skills</dt>
                <div className="flex flex-wrap gap-1.5">
                  {prospect.skills.slice(0, 14).map((skill) => (
                    <Tag key={String(skill)}>{String(skill)}</Tag>
                  ))}
                </div>
                {/* Say so rather than silently hiding the rest. */}
                {prospect.skills.length > 14 && (
                  <p className="mt-2 text-xs text-muted">
                    +{prospect.skills.length - 14} more
                  </p>
                )}
              </div>
            )}

            {prospect.interests.length > 0 && (
              <div className="mt-4 border-t border-line pt-4">
                <dt className="mb-2 text-xs text-muted">Interests</dt>
                <div className="flex flex-wrap gap-1.5">
                  {prospect.interests.map((interest) => (
                    <Tag key={String(interest)}>{String(interest)}</Tag>
                  ))}
                </div>
              </div>
            )}

            {prospect.notes && (
              <div className="mt-4 border-t border-line pt-4">
                <dt className="text-xs text-muted">Notes</dt>
                <dd className="prose-email mt-1 text-sm text-ink">{prospect.notes}</dd>
              </div>
            )}
          </section>

          {automationMessages.length > 0 && (
            <AutomationConversation
              messages={automationMessages}
              prospectId={prospect.id}
            />
          )}

          <section>
            <h2 className="mb-3 text-sm font-semibold text-ink">
              Drafts {liveDrafts.length > 0 && `(${liveDrafts.length})`}
            </h2>
            {liveDrafts.length === 0 ? (
              <div className="card">
                <EmptyState
                  title="No drafts yet"
                  description="Generate an email with one of your strategies, then review it here before sending."
                />
              </div>
            ) : (
              <div className="space-y-4">
                {liveDrafts.map((draft) => (
                  <DraftCard key={draft.id} draft={draft} />
                ))}
              </div>
            )}
          </section>

          <section className="card p-5">
            <h2 className="mb-4 text-sm font-semibold text-ink">Timeline</h2>
            {events.length === 0 ? (
              <p className="text-sm text-muted">Nothing logged yet.</p>
            ) : (
              <ol className="space-y-4">
                {events.map((event) => (
                  <li key={event.id} className="flex gap-3">
                    <span
                      className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                        EVENT_DOT[event.type] ?? "bg-slate-400"
                      }`}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-ink">{event.summary}</p>
                        <time className="shrink-0 text-xs text-muted">
                          {formatDate(event.created_at)}
                        </time>
                      </div>
                      {typeof event.detail?.error === "string" && (
                        <p className="mt-1 text-xs text-rose-600">{event.detail.error}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <div className="lg:col-span-1">
          <ProspectPanel
            prospect={prospect}
            strategies={strategies.filter((s) => s.is_active && s.kind !== "reply")}
            aiConfigured={health.ai_configured}
          />
        </div>
      </div>
    </>
  );
}
