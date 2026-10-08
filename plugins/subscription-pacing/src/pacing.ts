import type { PluginContext } from "@paperclipai/plugin-sdk";
import { decide, estimate, fairSharePct, weekElapsedPct, weekStart, type AgentUsage, type Decision, type Estimate, type Violation } from "./rules.js";
import { resolveSettings, type Settings } from "./settings.js";
import { loadUsage } from "./usage.js";

interface PausedEntry {
  pausedAt: string;
  violations: Violation[];
}

type PausedSet = Record<string, PausedEntry>;

const PAUSED_KEY = { scopeKind: "instance", stateKey: "paused-agents" } as const;
const DIGEST_KEY = { scopeKind: "instance", stateKey: "last-digest-at" } as const;
const OTHER_PAUSE_REASONS = new Set(["budget", "company_archived", "import"]);
const HOUR_MS = 60 * 60 * 1000;

export interface AgentReport {
  agentId: string;
  name: string;
  status: string;
  estimate: Estimate | null;
  cancelledRuns: number;
  decision: Decision;
  outcome: "paused" | "resumed" | "would-pause" | "would-resume" | "deferred" | "failed" | "none";
}

export interface PacingResult {
  settings: Settings;
  now: Date;
  weekElapsedPct: number;
  fairSharePct: number;
  agents: AgentReport[];
  released: string[];
}

function emptyUsage(agentId: string): AgentUsage {
  return { agentId, session: { opus: 0, sonnet: 0 }, week: { opus: 0, sonnet: 0 }, sessionCancelledRuns: 0, weekCancelledRuns: 0 };
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
  const start = weekStart(now, settings);
  const usage = await loadUsage(ctx, companyId, start, sessionStart);

  const stored = ((await ctx.state.get(PAUSED_KEY)) as PausedSet | null) ?? {};
  const pausedSet: PausedSet = {};
  const released: string[] = [];
  for (const agent of agents) {
    const entry = stored[agent.id];
    if (!entry) continue;
    const stillOurs = agent.status === "paused" && !OTHER_PAUSE_REASONS.has(agent.pauseReason ?? "");
    if (stillOurs) pausedSet[agent.id] = entry;
    else released.push(agent.id);
  }

  const elapsed = weekElapsedPct(now, settings);
  const ctxPacing = { weekElapsedPct: elapsed, fairSharePct: fairSharePct(agents.length, settings) };
  const exempt = new Set(settings.exemptAgentIds);

  const reports: AgentReport[] = agents.map((agent) => {
    const agentUsage = usage.get(agent.id) ?? emptyUsage(agent.id);
    const est = estimate(agentUsage, settings);
    const decision = decide(
      est,
      {
        paused: agent.status === "paused",
        pausedByPlugin: agent.id in pausedSet,
        pausedByOther: agent.status === "paused" && OTHER_PAUSE_REASONS.has(agent.pauseReason ?? ""),
        exempt: exempt.has(agent.id),
      },
      ctxPacing,
      settings,
    );
    return { agentId: agent.id, name: agent.name, status: agent.status, estimate: est, cancelledRuns: agentUsage.weekCancelledRuns, decision, outcome: "none" };
  });

  const enforce = settings.mode === "enforce";
  const resumes = reports.filter((r) => r.decision.kind === "resume");
  const pauses = reports
    .filter((r) => r.decision.kind === "pause")
    .sort((a, b) => (b.estimate?.weekPct ?? 0) - (a.estimate?.weekPct ?? 0));

  for (const report of resumes) {
    if (!enforce) {
      report.outcome = "would-resume";
      continue;
    }
    try {
      await ctx.agents.resume(report.agentId, companyId);
      delete pausedSet[report.agentId];
      report.outcome = "resumed";
      await recordEvent(ctx, report, "resume");
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
    const reasons = report.decision.kind === "pause" ? report.decision.violations : [];
    pausedSet[report.agentId] = { pausedAt: now.toISOString(), violations: reasons };
    await ctx.state.set(PAUSED_KEY, pausedSet);
    try {
      await ctx.agents.pause(report.agentId, companyId);
      pausedThisRun += 1;
      report.outcome = "paused";
      await recordEvent(ctx, report, "pause");
    } catch (error) {
      delete pausedSet[report.agentId];
      ctx.logger.error("Pause failed", { agentId: report.agentId, error: String(error) });
      report.outcome = "failed";
    }
  }

  await ctx.state.set(PAUSED_KEY, pausedSet);
  return { settings, now, weekElapsedPct: elapsed, fairSharePct: ctxPacing.fairSharePct, agents: reports, released };
}

async function recordEvent(ctx: PluginContext, report: AgentReport, action: "pause" | "resume"): Promise<void> {
  const reasons = report.decision.kind === "pause" ? report.decision.violations.join(",") : "";
  await ctx.db.execute(
    `INSERT INTO ${ctx.db.namespace}.pacing_events (agent_id, action, reasons, week_pct, session_pct) VALUES ($1::uuid, $2, $3, $4, $5)`,
    [report.agentId, action, reasons, report.estimate?.weekPct ?? 0, report.estimate?.sessionPct ?? 0],
  );
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
  if (result.released.length > 0) lines.push(``, `Stopped tracking ${result.released.length} agent(s) that someone else resumed or paused for another reason.`);
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
