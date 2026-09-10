import { PageHeader } from "@/components/ui";
import { PromptCard } from "@/components/prompt-card";
import { LEAD_PROMPTS } from "@/lib/lead-prompts";

export const dynamic = "force-dynamic";

/* The sourcing prompts, in the app rather than in a file on one machine.
 *
 * They belong here because they are the step before every other page: a run
 * produces the CSV that Prospects imports, and the notes about what a run
 * costs are what stop the next one from spending 600 credits by accident. */
export default function PromptsPage() {
  return (
    <>
      <PageHeader
        title="Lead sourcing prompts"
        description={`${LEAD_PROMPTS.length} verticals. Copy a block, paste it into a new Claude session, get a CSV.`}
      />

      <div className="card mb-4 p-5 text-sm text-muted">
        <p>
          The first three lines of each block are{" "}
          <code className="text-ink">ROWS</code>,{" "}
          <code className="text-ink">COUNTRIES</code> and{" "}
          <code className="text-ink">BALANCE</code> — set BALANCE to whatever the
          connector last told you, then leave everything else alone.
        </p>
        <p className="mt-2">
          Cost is <strong className="text-ink">rows × (enrichments + the fetch)</strong>,
          billed once at export. These use two enrichments — email at 2
          credits/row, firmographics at 1 — and the fetch adds 2 more, so a run
          costs about <strong className="text-ink">5 credits per row</strong>. At
          ROWS = 25 that is ~125 credits. If the balance cannot cover ROWS, the
          session cuts the row count to fit and still delivers a CSV. It never
          stops to ask.
        </p>
      </div>

      {/* Jump list. Eleven cards is more than fits on a screen, and the whole
          point of arriving here is to reach one particular vertical. */}
      <nav aria-label="Prompts" className="mb-4 flex flex-wrap gap-2">
        {LEAD_PROMPTS.map((p) => (
          <a
            key={p.id}
            href={`#${p.id}`}
            className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted
              transition-colors hover:bg-surface-2 hover:text-ink"
          >
            {p.n}. {p.title}
          </a>
        ))}
      </nav>

      <div className="space-y-4">
        {LEAD_PROMPTS.map((prompt) => (
          <PromptCard key={prompt.id} prompt={prompt} />
        ))}
      </div>

      <section className="card mt-6 p-5">
        <h2 className="text-sm font-semibold text-ink">How the credits work</h2>
        <p className="mt-2 text-sm text-muted">
          Cost = rows in the exported table × (2 per enrichment + 2 for the
          fetch), billed once at export. Autocomplete, statistics and
          show-sample are free, and a fetched table you never export costs
          nothing at all — but a table you do export is charged for the fetch as
          well as the enrichments.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[28rem] text-sm">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-[0.07em] text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">Run</th>
                <th className="px-3 py-2 font-medium">Table</th>
                <th className="px-3 py-2 font-medium">Enrichments</th>
                <th className="px-3 py-2 font-medium">Charged</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line-soft text-muted">
              {[
                ["E-commerce, 2026-08-17", "10", "3", "30"],
                ["Law firms, 2026-08-17", "10", "4", "40"],
                ["Dental, 2026-09-10", "~30", "4", "120"],
                ["Real estate, 2026-09-10", "150", "4", "600"],
              ].map((row) => (
                <tr key={row[0]}>
                  {row.map((cell, i) => (
                    <td key={i} className={`px-3 py-2 ${i ? "tabular" : "text-ink"}`}>
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-3 text-sm text-muted">
          The real-estate run asked for 50 and delivered 46. It enriched a
          150-row table and exported without a{" "}
          <code className="text-ink">limit</code>, so it paid for all 150 four
          times over and ran out mid-export. That is the failure the limit
          parameter prevents — it caps the billed rows regardless of how big the
          table is.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-ink">
          Check the pool before fetching
        </h3>
        <p className="mt-1.5 text-sm text-muted">
          <code className="text-ink">fetch-entities-statistics</code> takes the
          same filters as a fetch, costs nothing, and returns the pool size plus
          its industry and job breakdown. A filter that is too broad, too narrow
          or pointed at the wrong kind of company shows up there — one call
          earlier than the sample, and long before anything is billable. A pool
          under ~3× ROWS is too narrow to screen from; over ~5000 is broad
          enough that the sample is noise.
        </p>

        <h3 className="mt-5 text-sm font-semibold text-ink">Known limitations</h3>
        <ul className="mt-1.5 space-y-1.5 text-sm text-muted">
          <li>
            <strong className="text-ink">No column renaming on export.</strong>{" "}
            The CSV always arrives with prospect_* / firmo_* / contact_* names.
            Converting locally afterwards is the only route to CRM headers, and
            it is free.
          </li>
          <li>
            <strong className="text-ink">
              Enrichments do not accumulate on one table.
            </strong>{" "}
            Each enrich call returns a new table_name. Export the last one;
            exporting the original fetch table gives a CSV with none of the
            enrichment you paid for.
          </li>
          <li>
            <strong className="text-ink">Previews mask values, exports don&apos;t.</strong>{" "}
            email_status and friends read [masked] during exploration, but
            get-dataset loads a finished export back with every field readable.
          </li>
          <li>
            <strong className="text-ink">Balance is only reported after a charge.</strong>{" "}
            Set BALANCE from whatever the connector last told you.
          </li>
        </ul>

        <h3 className="mt-5 text-sm font-semibold text-ink">
          Prompts 9–11 are unverified
        </h3>
        <p className="mt-1.5 text-sm text-muted">
          Accounting, Insurance and Logistics have never been through a real
          run. Their categories and job titles are a starting point, not a
          result — unlike Real Estate, whose filters came out of a run that went
          from 5/5 wrong-buyer to 0/5. Read the statistics distribution before
          spending, and fold whatever worked back into the prompt.
        </p>
      </section>
    </>
  );
}
