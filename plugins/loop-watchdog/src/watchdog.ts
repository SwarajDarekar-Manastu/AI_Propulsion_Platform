import type { PluginContext, PluginEvent } from "@paperclipai/plugin-sdk";
import { countWakes, pruneWakes, tokenBreach, tokensOf, type TokenBreach, type WakeEntry } from "./rules.js";
import { resolveSettings, type Settings } from "./settings.js";
import { loadBaselineUsage, loadRunUsage } from "./usage.js";

function wakesKey(agentId: string) {
  return { scopeKind: "agent", scopeId: agentId, stateKey: "wakes" } as const;
}

interface RunRef {
  runId: string;
  agentId: string;
  issueId: string | null;
}

type Breach = { rule: "wakes"; count: number; limit: number } | { rule: "tokens"; breach: TokenBreach };

function textField(payload: object, key: string): string | null {
  const entry = Object.entries(payload).find(([name]) => name === key);
  return entry !== undefined && typeof entry[1] === "string" && entry[1] !== "" ? entry[1] : null;
}

function runRef(payload: unknown): RunRef | null {
  if (typeof payload !== "object" || payload === null) return null;
  const runId = textField(payload, "runId");
  const agentId = textField(payload, "agentId");
  if (runId === null || agentId === null) return null;
  return { runId, agentId, issueId: textField(payload, "issueId") };
}

function isWakeEntry(value: unknown): value is WakeEntry {
  return (
    typeof value === "object" &&
    value !== null &&
    "runId" in value &&
    typeof value.runId === "string" &&
    "issueId" in value &&
    typeof value.issueId === "string" &&
    "at" in value &&
    typeof value.at === "string"
  );
}

async function readWakes(ctx: PluginContext, agentId: string, now: Date): Promise<WakeEntry[]> {
  const value = await ctx.state.get(wakesKey(agentId));
  return Array.isArray(value) ? pruneWakes(value.filter(isWakeEntry), now) : [];
}

function describe(breach: Breach): string {
  if (breach.rule === "wakes") {
    return `Rule W: ${breach.count} runs started on one task in the last 60 minutes, limit ${breach.limit}`;
  }
  const { tokens, median, multiple } = breach.breach;
  return `Rule T: run used ${tokens} tokens, more than ${multiple} times the median of ${median} over its recent runs`;
}

async function postDigest(ctx: PluginContext, companyId: string, digestIssueId: string | null, body: string): Promise<void> {
  ctx.logger.info("Loop watchdog digest", { companyId, body });
  if (digestIssueId === null) return;
  try {
    await ctx.issues.createComment(digestIssueId, body, companyId);
  } catch (error) {
    ctx.logger.error("Loop watchdog digest failed", { digestIssueId, error: String(error) });
  }
}

async function act(
  ctx: PluginContext,
  companyId: string,
  settings: Settings,
  target: { agentId: string; issueId: string | null; breach: Breach },
): Promise<void> {
  if (settings.exemptAgentIds.includes(target.agentId)) return;
  const agent = await ctx.agents.get(target.agentId, companyId);
  if (agent === null || agent.status === "paused" || agent.status === "terminated") return;

  const task = target.issueId ?? "no task";
  let outcome: string;
  if (settings.mode === "dry-run") {
    outcome = "would pause (dry-run)";
  } else {
    try {
      await ctx.agents.pause(target.agentId, companyId);
      outcome = "paused";
    } catch (error) {
      ctx.logger.error("Loop watchdog pause failed", { agentId: target.agentId, error: String(error) });
      outcome = `pause failed: ${String(error)}`;
    }
  }

  const body = [
    `## Loop watchdog: ${outcome}`,
    ``,
    `Agent ${agent.name} (\`${target.agentId}\`). Task \`${task}\`. ${describe(target.breach)}.`,
    ``,
    `The plugin never resumes an agent. The Board resumes it.`,
  ].join("\n");
  await postDigest(ctx, companyId, settings.digestIssueId, body);
}

export async function onRunStarted(ctx: PluginContext, event: PluginEvent): Promise<void> {
  const settings = resolveSettings(await ctx.config.get(event.companyId));
  if (settings.mode === "off") return;
  const run = runRef(event.payload);
  if (run === null || run.issueId === null) return;

  const now = new Date(event.occurredAt);
  const own = await readWakes(ctx, run.agentId, now);
  if (own.some((entry) => entry.runId === run.runId)) return;

  const entry: WakeEntry = { runId: run.runId, issueId: run.issueId, at: now.toISOString() };
  const wakes = [...own, entry];
  const count = countWakes(wakes, run.issueId, now);
  if (count <= settings.maxWakesPerTask) {
    await ctx.state.set(wakesKey(run.agentId), wakes);
    return;
  }
  await ctx.state.set(
    wakesKey(run.agentId),
    wakes.filter((existing) => existing.issueId !== run.issueId),
  );
  await act(ctx, event.companyId, settings, {
    agentId: run.agentId,
    issueId: run.issueId,
    breach: { rule: "wakes", count, limit: settings.maxWakesPerTask },
  });
}

async function checkTokens(ctx: PluginContext, companyId: string, settings: Settings, run: RunRef): Promise<void> {
  const tokens = tokensOf(await loadRunUsage(ctx, companyId, run.runId));
  if (tokens === null) return;
  const baseline = (await loadBaselineUsage(ctx, companyId, run.agentId, run.runId, settings.tokenHistoryRuns))
    .map(tokensOf)
    .filter((value): value is number => value !== null);
  const breach = tokenBreach(tokens, baseline, settings);
  if (breach === null) return;
  await act(ctx, companyId, settings, {
    agentId: run.agentId,
    issueId: run.issueId,
    breach: { rule: "tokens", breach },
  });
}

export async function onRunTerminal(ctx: PluginContext, event: PluginEvent): Promise<void> {
  const settings = resolveSettings(await ctx.config.get(event.companyId));
  if (settings.mode === "off") return;
  const run = runRef(event.payload);
  if (run === null) return;
  await checkTokens(ctx, event.companyId, settings, run);
}

export async function onCostEvent(ctx: PluginContext, event: PluginEvent): Promise<void> {
  const settings = resolveSettings(await ctx.config.get(event.companyId));
  if (settings.mode === "off") return;
  const payload = event.payload;
  if (typeof payload !== "object" || payload === null) return;
  const agentId = textField(payload, "agentId");
  const runId = textField(payload, "heartbeatRunId");
  if (agentId === null || runId === null) return;
  await checkTokens(ctx, event.companyId, settings, { runId, agentId, issueId: textField(payload, "issueId") });
}
