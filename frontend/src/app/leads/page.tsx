import { Suspense } from "react";
import Link from "next/link";
import { api } from "@/lib/api";
import { LeadToolbar } from "@/components/lead-toolbar";
import { LeadsTable } from "@/components/leads-table";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

export default async function LeadsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; page?: string }>;
}) {
  const params = await searchParams;
  const page = Number(params.page ?? "1") || 1;

  let data;
  let sequences;
  try {
    [data, sequences] = await Promise.all([
      api.listLeads({
        q: params.q,
        status: params.status,
        page,
        page_size: PAGE_SIZE,
      }),
      api.listSequences(),
    ]);
  } catch {
    return (
      <div className="card">
        <EmptyState
          title="Can't reach the API"
          description="The backend isn't responding. Check `docker compose ps`."
        />
      </div>
    );
  }

  const totalPages = Math.max(1, Math.ceil(data.total / PAGE_SIZE));
  const activeSequences = sequences.filter((s) => s.is_active && s.steps.length > 0);

  function pageHref(target: number) {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.status) qs.set("status", params.status);
    qs.set("page", String(target));
    return `/leads?${qs}`;
  }

  return (
    <>
      <PageHeader
        title="Leads"
        description={`${data.total} lead${data.total === 1 ? "" : "s"} in your list.`}
      />

      <Suspense fallback={null}>
        <LeadToolbar />
      </Suspense>

      <LeadsTable leads={data.items} sequences={activeSequences} />

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
