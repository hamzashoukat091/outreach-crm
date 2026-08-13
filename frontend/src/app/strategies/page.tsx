import { api } from "@/lib/api";
import { NewStrategyButton, StrategyCard } from "@/components/strategy-editor";
import { EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function StrategiesPage() {
  let strategies;
  let health;
  try {
    [strategies, health] = await Promise.all([
      api.listStrategies(),
      api.health().catch(() => ({ ai_configured: false, status: "", model: "" })),
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

  return (
    <>
      <PageHeader
        title="Strategies"
        description="Your prompts. Each one defines how an email gets written."
        action={strategies.length > 0 ? <NewStrategyButton /> : undefined}
      />

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

      {strategies.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No strategies yet"
            description="A strategy holds the prompt and structure for a type of email. Create one to start generating."
            action={<NewStrategyButton />}
          />
        </div>
      ) : (
        <div className="space-y-4">
          {strategies.map((strategy) => (
            <StrategyCard key={strategy.id} strategy={strategy} />
          ))}
        </div>
      )}
    </>
  );
}
