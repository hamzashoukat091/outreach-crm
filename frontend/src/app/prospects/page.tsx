import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { ProspectToolbar } from "@/components/prospect-toolbar";
import { ProspectsTable } from "@/components/prospects-table";
import { PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function ProspectsPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    seniority?: string;
    category?: string;
    completeness?: string;
    view?: string;
    page?: string;
  }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;
  const archivedView = params.view === "archived";

  let data;
  let strategies;
  let analytics;
  let categories;
  try {
    [data, strategies, analytics, categories] = await Promise.all([
      api.listProspects({
        q: params.q,
        status: params.status,
        seniority: params.seniority,
        category: params.category,
        completeness: params.completeness,
        archived: archivedView,
        page,
        page_size: PAGE_SIZE,
      }),
      api.listStrategies(),
      api.analytics().catch(() => null),
      api.listProspectCategories().catch(() => []),
    ]);
  } catch {
    return (
      <ApiError what="Prospects" />
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  // Reply strategies belong to the automation engine, not manual generation.
  const activeStrategies = strategies.filter((s) => s.is_active && s.kind !== "reply");
  const seniorities = analytics?.by_seniority.map((s) => s.label) ?? [];
  const incomplete = analytics?.incomplete ?? 0;

  function pageHref(target: number) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v && k !== "page") qs.set(k, String(v));
    });
    qs.set("page", String(target));
    return `/prospects?${qs}`;
  }

  return (
    <>
      <PageHeader
        title="Prospects"
        description={
          archivedView
            ? `${data.total} archived. Hidden from your active list and analytics.`
            : `${data.total} prospect${data.total === 1 ? "" : "s"}. Select rows to generate emails.`
        }
      />

      <div className="mb-4 flex gap-2">
        <Link href="/prospects" className={archivedView ? "btn-secondary" : "btn-primary"}>
          Active
        </Link>
        <Link
          href="/prospects?view=archived"
          className={archivedView ? "btn-primary" : "btn-secondary"}
        >
          Archived
        </Link>
      </div>

      {incomplete > 0 && !params.completeness && !archivedView && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="text-amber-900 dark:text-amber-200">
            <strong>{incomplete}</strong> prospect{incomplete === 1 ? " has" : "s have"} no
            company info. Emails for them are written from the job title alone.
          </p>
          <Link
            href="/prospects?completeness=incomplete"
            className="shrink-0 font-medium text-amber-900 underline dark:text-amber-200"
          >
            Review them
          </Link>
        </div>
      )}

      {strategies.length === 0 && !archivedView && (
        <div className="mb-4 rounded-lg border border-line bg-surface-2 px-4 py-3 text-sm">
          No strategies yet.{" "}
          <Link href="/strategies" className="text-accent hover:underline">
            Create one
          </Link>{" "}
          to start generating emails.
        </div>
      )}

      {!archivedView && (
        <Suspense fallback={null}>
          <ProspectToolbar seniorities={seniorities} categories={categories} />
        </Suspense>
      )}

      <ProspectsTable
        prospects={data.items}
        strategies={activeStrategies}
        archivedView={archivedView}
      />

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <span className="text-muted">
            Page {page} of {totalPages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link href={pageHref(page - 1)} className="btn-secondary">
                Previous
              </Link>
            )}
            {page < totalPages && (
              <Link href={pageHref(page + 1)} className="btn-secondary">
                Next
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
