import type { PluginContext } from "@paperclipai/plugin-sdk";
import { choosePauses, emptyUsage, estimate, fairSharePct, planEstimate, reasonEnded, weekElapsedPct, weekStart, windowReset, type Decision, type Estimate, type PausedEntry } from "./rules.js";
import { resolveSettings, type Settings } from "./settings.js";
import { loadUsage } from "./usage.js";

type PausedSet = Record<string, PausedEntry>;

const PAUSED_KEY = { scopeKind: "instance", stateKey: "paused-agents" } as const;
const DIGEST_KEY = { scopeKind: "instance", stateKey: "last-digest-at" } as const;
const HOUR_MS = 60 * 60 * 1000;

export interface AgentReport {
  agentId: string;
  name: string;
  status: string;
  estimate: Estimate | null;
  cancelledRuns: number;
  decision: Decision;
  outcome: "paused" | "resumed" | "would-pause" | "deferred" | "failed" | "none";
}

export interface PacingResult {
  settings: Settings;
  now: Date;
  weekElapsedPct: number;
  fairSharePct: number;
  plan: Estimate;
  agents: AgentReport[];
  released: string[];
}

function isoOrNull(value: Date | string | null | undefined): string | null {
  return value === null || value === undefined ? null : new Date(value).toISOString();
}

export async function runPacing(ctx: PluginContext, now: Date): Promise<PacingResult | null> {
  const settings = resolveSettings(await ctx.config.get());
  if (settings.mode === "off" || settings.companyId === null) {
    ctx.logger.info("Pacing skipped", { mode: settings.mode, companyConfigured: settings.companyId !== null });
    return null;
  }
  const companyId = settings.companyId;

  const agents = (await ctx.agents.list({ companyId, limit: 500 })).filter((a) => a.status !== "terminated");
  const sessionStart = new Date(now.getTime() - settings.sessionHours * HOUR_MS);
  const usage = await loadUsage(ctx, companyId, weekStart(now, settings), sessionStart);

  const stored = ((await ctx.state.get(PAUSED_KEY)) as PausedSet | null) ?? {};
  const pausedSet: PausedSet = {};
  const released: string[] = [];
  for (const agent of agents) {
    const entry = stored[agent.id];
    if (!entry) continue;
    const stillOurs = agent.status === "paused" && isoOrNull(agent.pausedAt) === entry.pausedAt;
    if (stillOurs) pausedSet[agent.id] = entry;
    else released.push(agent.id);
  }

  const elapsed = weekElapsedPct(now, settings);
  const ctxPacing = { weekElapsedPct: elapsed, fairSharePct: fairSharePct(agents.length, settings) };
  const exempt = new Set(settings.exemptAgentIds);

  const estimates = new Map(agents.map((a) => [a.id, estimate(usage.get(a.id) ?? emptyUsage(a.id), settings)]));
  const candidates = agents.flatMap((a) => {
    const est = estimates.get(a.id) ?? null;
    return est === null ? [] : [{ agentId: a.id, estimate: est, exempt: exempt.has(a.id), paused: a.status === "paused" }];
  });
  const plan = planEstimate(candidates.map((c) => c.estimate));
  const planState = { plan, weekElapsedPct: elapsed };
  for (const [id, entry] of Object.entries(pausedSet)) {
    const inForce = entry.violations.filter((v) => !reasonEnded(v, entry, now, settings, planState));
    if (inForce.length > 0) pausedSet[id] = { ...entry, violations: inForce };
  }
  const held = new Set(Object.values(pausedSet).flatMap((e) => e.violations.filter((v) => !reasonEnded(v, e, now, settings, planState))));
  const pauseOrders = new Map(choosePauses(candidates, ctxPacing, settings, held).map((o) => [o.agentId, o.violations]));

  const reports: AgentReport[] = agents.map((agent) => {
    const entry = pausedSet[agent.id];
    const violations = pauseOrders.get(agent.id);
    let decision: Decision = { kind: "none" };
    if (entry && windowReset(entry, now, settings, planState)) decision = { kind: "resume" };
    else if (!entry && agent.status !== "paused" && violations) decision = { kind: "pause", violations };
    return {
      agentId: agent.id,
      name: agent.name,
      status: agent.status,
      estimate: estimates.get(agent.id) ?? null,
      cancelledRuns: (usage.get(agent.id) ?? emptyUsage(agent.id)).weekCancelledRuns,
      decision,
      outcome: "none",
    };
  });

  const enforce = settings.mode === "enforce";
  const resumes = reports.filter((r) => r.decision.kind === "resume");
  const pauses = reports
    .filter((r) => r.decision.kind === "pause")
    .sort((a, b) => (b.estimate?.weekPct ?? 0) - (a.estimate?.weekPct ?? 0));

  for (const report of resumes) {
    try {
      await ctx.agents.resume(report.agentId, companyId);
      delete pausedSet[report.agentId];
      report.outcome = "resumed";
    } catch (error) {
      ctx.logger.error("Resume failed", { agentId: report.agentId, error: String(error) });
      report.outcome = "failed";
    }
  }

  let pausedThisRun = 0;
  for (const report of pauses) {
    if (!enforce) {
      report.outcome = "would-pause";
      continue;
    }
    if (pausedThisRun >= settings.maxPausesPerRun) {
      report.outcome = "deferred";
      continue;
    }
    try {
      const paused = await ctx.agents.pause(report.agentId, companyId);
      pausedThisRun += 1;
      report.outcome = "paused";
      const pausedAt = isoOrNull(paused.pausedAt);
      if (pausedAt === null) {
        ctx.logger.warn("Pause returned no pausedAt; the plugin will not resume this agent", { agentId: report.agentId });
        continue;
      }
      pausedSet[report.agentId] = { pausedAt, violations: report.decision.kind === "pause" ? report.decision.violations : [] };
      await ctx.state.set(PAUSED_KEY, pausedSet);
    } catch (error) {
      ctx.logger.error("Pause failed", { agentId: report.agentId, error: String(error) });
      report.outcome = "failed";
    }
  }

  await ctx.state.set(PAUSED_KEY, pausedSet);
  return { settings, now, weekElapsedPct: elapsed, fairSharePct: ctxPacing.fairSharePct, plan, agents: reports, released };
}

function fmt(n: number): string {
  return n.toFixed(1);
}

export function formatDigest(result: PacingResult): string {
  const { settings } = result;
  const lines = [
    `## Subscription pacing digest`,
    ``,
    `Mode: \`${settings.mode}\`. Week elapsed: ${fmt(result.weekElapsedPct)}%. Fair share per agent: ${fmt(result.fairSharePct)}%.`,
  ];
  const opusShare = result.plan.weekPct > 0 ? (result.plan.opusWeekPct / result.plan.weekPct) * 100 : 0;
  lines.push(``, `Plan totals: session ${fmt(result.plan.sessionPct)}%, week ${fmt(result.plan.weekPct)}%, Opus share ${fmt(opusShare)}%.${settings.maxOpusSharePct === null ? " The Opus rule is off until maxOpusSharePct is set." : ""}`);
  if (settings.opusPctPerMillion === null || settings.sonnetPctPerMillion === null) {
    lines.push(``, `**Estimates are off.** Set \`opusPctPerMillion\` and \`sonnetPctPerMillion\` in the plugin settings. No agent is paused until both are set.`);
  }
  if (settings.mode === "dry-run") {
    lines.push(``, `Dry run. Nothing is paused or resumed. Set \`mode\` to \`enforce\` to act on these decisions.`);
  }
  lines.push(``, `| Agent | Status | Session % | Week % | Opus % | Cancelled runs | Decision |`, `| --- | --- | --- | --- | --- | --- | --- |`);
  for (const r of result.agents) {
    const e = r.estimate;
    const why = r.decision.kind === "pause" ? ` (${r.decision.violations.join(", ")})` : "";
    lines.push(`| ${r.name} | ${r.status} | ${e ? fmt(e.sessionPct) : "n/a"} | ${e ? fmt(e.weekPct) : "n/a"} | ${e ? fmt(e.opusWeekPct) : "n/a"} | ${r.cancelledRuns} | ${r.outcome}${why} |`);
  }
  const gap = result.agents.reduce((sum, r) => sum + r.cancelledRuns, 0);
  lines.push(``, `Cancelled runs with no usage record this week: ${gap}. Each is charged ${settings.cancelledRunAllowanceTokens} tokens at the Sonnet ratio.`);
  if (result.released.length > 0) lines.push(``, `Stopped tracking ${result.released.length} agent(s) that someone else resumed or paused again.`);
  return lines.join("\n");
}

export function digestDue(result: PacingResult, lastDigestAt: string | null): boolean {
  const acted = result.agents.some((r) => r.outcome === "paused" || r.outcome === "resumed" || r.outcome === "failed" || r.outcome === "deferred");
  if (acted || lastDigestAt === null) return true;
  return result.now.getTime() - Date.parse(lastDigestAt) >= result.settings.digestIntervalHours * HOUR_MS;
}

export async function postDigest(ctx: PluginContext, result: PacingResult): Promise<void> {
  const body = formatDigest(result);
  const last = (await ctx.state.get(DIGEST_KEY)) as string | null;
  if (!digestDue(result, last)) return;
  const { digestIssueId, companyId } = result.settings;
  if (digestIssueId === null || companyId === null) {
    ctx.logger.info("Digest (no digestIssueId set)", { body });
  } else {
    try {
      await ctx.issues.createComment(digestIssueId, body, companyId);
    } catch (error) {
      ctx.logger.error("Digest comment failed", { digestIssueId, error: String(error) });
      return;
    }
  }
  await ctx.state.set(DIGEST_KEY, result.now.toISOString());
}
