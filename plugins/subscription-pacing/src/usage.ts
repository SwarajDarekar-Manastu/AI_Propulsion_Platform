import type { PluginContext } from "@paperclipai/plugin-sdk";
import { emptyUsage, type AgentUsage } from "./rules.js";

interface TokenRow {
  agent_id: string;
  model: string | null;
  week_tokens: string | number;
  session_tokens: string | number;
}

interface CancelledRow {
  agent_id: string;
  week_runs: string | number;
  session_runs: string | number;
}

const TOKENS_SQL = `
SELECT agent_id, model,
  COALESCE(SUM(input_tokens + output_tokens) FILTER (WHERE occurred_at >= $2::timestamptz), 0) AS week_tokens,
  COALESCE(SUM(input_tokens + output_tokens) FILTER (WHERE occurred_at >= $3::timestamptz), 0) AS session_tokens
FROM public.cost_events
WHERE company_id = $1::uuid AND occurred_at >= LEAST($2::timestamptz, $3::timestamptz)
GROUP BY agent_id, model`;

const CANCELLED_SQL = `
SELECT r.agent_id,
  COUNT(*) FILTER (WHERE r.started_at >= $2::timestamptz) AS week_runs,
  COUNT(*) FILTER (WHERE r.started_at >= $3::timestamptz) AS session_runs
FROM public.heartbeat_runs r
WHERE r.company_id = $1::uuid
  AND r.status = 'cancelled'
  AND r.started_at IS NOT NULL
  AND (r.usage_json IS NULL OR r.usage_json = 'null'::jsonb)
  AND r.started_at >= LEAST($2::timestamptz, $3::timestamptz)
  AND NOT EXISTS (SELECT 1 FROM public.cost_events c WHERE c.heartbeat_run_id = r.id)
GROUP BY r.agent_id`;

export async function loadUsage(
  ctx: PluginContext,
  companyId: string,
  weekStart: Date,
  sessionStart: Date,
): Promise<Map<string, AgentUsage>> {
  const params = [companyId, weekStart.toISOString(), sessionStart.toISOString()];
  const [tokenRows, cancelledRows] = await Promise.all([
    ctx.db.query<TokenRow>(TOKENS_SQL, params),
    ctx.db.query<CancelledRow>(CANCELLED_SQL, params),
  ]);
  const byAgent = new Map<string, AgentUsage>();
  const usageOf = (agentId: string): AgentUsage => {
    let usage = byAgent.get(agentId);
    if (!usage) {
      usage = emptyUsage(agentId);
      byAgent.set(agentId, usage);
    }
    return usage;
  };
  for (const row of tokenRows) {
    const family = row.model !== null && /opus/i.test(row.model) ? "opus" : "sonnet";
    const usage = usageOf(row.agent_id);
    usage.week[family] += Number(row.week_tokens);
    usage.session[family] += Number(row.session_tokens);
  }
  for (const row of cancelledRows) {
    const usage = usageOf(row.agent_id);
    usage.weekCancelledRuns += Number(row.week_runs);
    usage.sessionCancelledRuns += Number(row.session_runs);
  }
  return byAgent;
}
