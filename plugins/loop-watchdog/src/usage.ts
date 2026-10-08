import type { PluginContext } from "@paperclipai/plugin-sdk";

interface UsageRow {
  id: string;
  usage_json: unknown;
}

const RUN_SQL = `
SELECT id, usage_json
FROM public.heartbeat_runs
WHERE company_id = $1::uuid AND id = $2::uuid AND usage_json IS NOT NULL`;

const BASELINE_SQL = `
SELECT id, usage_json
FROM public.heartbeat_runs
WHERE company_id = $1::uuid AND agent_id = $2::uuid AND id <> $3::uuid AND usage_json IS NOT NULL
ORDER BY started_at DESC NULLS LAST
LIMIT $4`;

export async function loadRunUsage(ctx: PluginContext, companyId: string, runId: string): Promise<unknown> {
  const rows = await ctx.db.query<UsageRow>(RUN_SQL, [companyId, runId]);
  return rows[0]?.usage_json ?? null;
}

export async function loadBaselineUsage(
  ctx: PluginContext,
  companyId: string,
  agentId: string,
  excludeRunId: string,
  limit: number,
): Promise<unknown[]> {
  const rows = await ctx.db.query<UsageRow>(BASELINE_SQL, [companyId, agentId, excludeRunId, limit]);
  return rows.map((row) => row.usage_json);
}
