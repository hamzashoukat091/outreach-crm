import Link from "next/link";
import { api } from "@/lib/api";
import { NewStrategyButton, StrategyCard } from "@/components/strategy-editor";
import { SenderProfileEditor } from "@/components/sender-profile-editor";
import { EmptyState, PageHeader } from "@/components/ui";
import { ApiError } from "@/components/api-error";

export const dynamic = "force-dynamic";

export default async function StrategiesPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const params = await searchParams;
  const replyView = params.kind === "reply";

  let strategies;
  let health;
  let sender;
  try {
    [strategies, health, sender] = await Promise.all([
      api.listStrategies(),
      api.health().catch(() => ({ ai_configured: false, status: "", model: "" })),
      api.getSender(),
    ]);
  } catch {
    return (
      <ApiError what="Strategies" />
    );
  }

  const visible = strategies.filter((s) =>
    replyView ? s.kind === "reply" : s.kind !== "reply",
  );

  return (
    <>
      <PageHeader
        title="Strategies"
        description={
          replyView
            ? "How automated replies get written, per situation."
            : "Your prompts. Each one defines how an email gets written."
        }
        action={
          visible.length > 0 ? (
            <NewStrategyButton kind={replyView ? "reply" : "opener"} />
          ) : undefined
        }
      />

      <div className="mb-4 flex gap-2">
        <Link href="/strategies" className={replyView ? "btn-secondary" : "btn-primary"}>
          Openers
        </Link>
        <Link
          href="/strategies?kind=reply"
          className={replyView ? "btn-primary" : "btn-secondary"}
        >
          Reply strategies
        </Link>
      </div>

      {!health.ai_configured && (
        <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950">
          <p className="font-medium text-amber-900 dark:text-amber-200">
            No API key configured
          </p>
          <p className="mt-1 text-amber-800 dark:text-amber-300">
            Add <code>ANTHROPIC_API_KEY</code> to <code>.env</code> and restart the api
            service. You can still write strategies now.
          </p>
        </div>
      )}

      {health.ai_configured && (
        <p className="mb-4 text-xs text-muted">
          Generating with <code className="rounded bg-surface-2 px-1.5 py-0.5">{health.model}</code>
        </p>
      )}

      {!replyView && (
        <div className="mb-6">
          <SenderProfileEditor profile={sender} />
        </div>
      )}

      {replyView && (
        <p className="mb-4 text-xs text-muted">
          When an inbound reply is classified as a situation, the matching
          strategy with the lowest priority number writes the response.
          Unsubscribes, auto-replies, and unclear messages are handled for you.
        </p>
      )}

      {visible.length === 0 ? (
        <div className="card">
          <EmptyState
            title={replyView ? "No reply strategies yet" : "No strategies yet"}
            description={
              replyView
                ? "A reply strategy tells the engine how to answer one kind of reply — interested, question, objection, and so on."
                : "A strategy holds the prompt and structure for a type of email. Create one to start generating."
            }
            action={<NewStrategyButton kind={replyView ? "reply" : "opener"} />}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      )}
    </>
  );
}
