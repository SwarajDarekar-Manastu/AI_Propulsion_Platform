import type { Settings } from "./settings.js";

export interface TokenCounts {
  opus: number;
  sonnet: number;
}

export interface AgentUsage {
  agentId: string;
  session: TokenCounts;
  week: TokenCounts;
  sessionCancelledRuns: number;
  weekCancelledRuns: number;
}

export interface Estimate {
  sessionPct: number;
  weekPct: number;
  opusWeekPct: number;
}

export type Violation = "session" | "weekly-pace" | "weekly-share" | "opus-share";

export interface PacingContext {
  weekElapsedPct: number;
  fairSharePct: number;
}

export interface PausedEntry {
  pausedAt: string;
  violations: Violation[];
}

export interface Candidate {
  agentId: string;
  estimate: Estimate;
  exempt: boolean;
  paused: boolean;
}

export interface PauseOrder {
  agentId: string;
  violations: Violation[];
}

export type Decision =
  | { kind: "pause"; violations: Violation[] }
  | { kind: "resume" }
  | { kind: "none" };

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

export function emptyUsage(agentId: string): AgentUsage {
  return { agentId, session: { opus: 0, sonnet: 0 }, week: { opus: 0, sonnet: 0 }, sessionCancelledRuns: 0, weekCancelledRuns: 0 };
}

export function weekStart(now: Date, settings: Pick<Settings, "weekResetAnchor">): Date {
  const anchor = settings.weekResetAnchor === null ? MONDAY_EPOCH_MS : Date.parse(settings.weekResetAnchor);
  const offset = (((now.getTime() - anchor) % WEEK_MS) + WEEK_MS) % WEEK_MS;
  return new Date(now.getTime() - offset);
}

export function weekElapsedPct(now: Date, settings: Pick<Settings, "weekResetAnchor">): number {
  return ((now.getTime() - weekStart(now, settings).getTime()) / WEEK_MS) * 100;
}

export function fairSharePct(agentCount: number, settings: Pick<Settings, "agentWeeklySharePct">): number {
  return settings.agentWeeklySharePct ?? 100 / Math.max(agentCount, 1);
}

function weekPctOf(tokens: TokenCounts, cancelledRuns: number, opusRatio: number, sonnetRatio: number, allowanceTokens: number): { total: number; opus: number } {
  const opus = (tokens.opus / 1_000_000) * opusRatio;
  const sonnet = (tokens.sonnet / 1_000_000) * sonnetRatio;
  const cancelled = ((cancelledRuns * allowanceTokens) / 1_000_000) * sonnetRatio;
  return { total: opus + sonnet + cancelled, opus };
}

export function estimate(usage: AgentUsage, settings: Settings): Estimate | null {
  const { opusPctPerMillion: opusRatio, sonnetPctPerMillion: sonnetRatio } = settings;
  if (opusRatio === null || sonnetRatio === null) return null;
  const week = weekPctOf(usage.week, usage.weekCancelledRuns, opusRatio, sonnetRatio, settings.cancelledRunAllowanceTokens);
  const session = weekPctOf(usage.session, usage.sessionCancelledRuns, opusRatio, sonnetRatio, settings.cancelledRunAllowanceTokens);
  return {
    sessionPct: (session.total / settings.sessionAllowancePctOfWeek) * 100,
    weekPct: week.total,
    opusWeekPct: week.opus,
  };
}

export function planEstimate(estimates: Estimate[]): Estimate {
  const sum = (pick: (e: Estimate) => number) => estimates.reduce((total, e) => total + pick(e), 0);
  return { sessionPct: sum((e) => e.sessionPct), weekPct: sum((e) => e.weekPct), opusWeekPct: sum((e) => e.opusWeekPct) };
}

function topBy(candidates: Candidate[], measure: (e: Estimate) => number, limit: number): string[] {
  return candidates
    .filter((c) => !c.exempt && !c.paused && measure(c.estimate) > 0)
    .sort((a, b) => measure(b.estimate) - measure(a.estimate))
    .slice(0, limit)
    .map((c) => c.agentId);
}

export function paceBreached(plan: Estimate, ctx: Pick<PacingContext, "weekElapsedPct">, settings: Pick<Settings, "weeklyPaceLeadPts">): boolean {
  return plan.weekPct - ctx.weekElapsedPct > settings.weeklyPaceLeadPts;
}

export function opusShareBreached(plan: Estimate, settings: Pick<Settings, "maxOpusSharePct" | "opusRuleMinWeekPct">): boolean {
  if (settings.maxOpusSharePct === null || plan.weekPct < settings.opusRuleMinWeekPct || plan.weekPct <= 0) return false;
  return (plan.opusWeekPct / plan.weekPct) * 100 > settings.maxOpusSharePct;
}

export function choosePauses(candidates: Candidate[], ctx: PacingContext, settings: Settings, held: ReadonlySet<Violation> = new Set()): PauseOrder[] {
  const plan = planEstimate(candidates.map((c) => c.estimate));
  const flagged = new Map<string, Violation[]>();
  const flag = (ids: string[], violation: Violation) => {
    for (const id of ids) flagged.set(id, [...(flagged.get(id) ?? []), violation]);
  };
  const limit = settings.maxPausesPerRun;

  if (!held.has("session") && plan.sessionPct >= settings.sessionPauseAtPct) flag(topBy(candidates, (e) => e.sessionPct, limit), "session");
  if (!held.has("weekly-pace") && paceBreached(plan, ctx, settings)) flag(topBy(candidates, (e) => e.weekPct, limit), "weekly-pace");
  flag(
    candidates.filter((c) => !c.exempt && !c.paused && c.estimate.weekPct > ctx.fairSharePct).map((c) => c.agentId),
    "weekly-share",
  );
  if (!held.has("opus-share") && opusShareBreached(plan, settings)) flag(topBy(candidates, (e) => e.opusWeekPct, limit), "opus-share");

  const weekPctOfAgent = new Map(candidates.map((c) => [c.agentId, c.estimate.weekPct]));
  return [...flagged.entries()]
    .map(([agentId, violations]) => ({ agentId, violations }))
    .sort((a, b) => (weekPctOfAgent.get(b.agentId) ?? 0) - (weekPctOfAgent.get(a.agentId) ?? 0));
}

export interface PlanState {
  plan: Estimate;
  weekElapsedPct: number;
}

export function windowReset(entry: PausedEntry, now: Date, settings: Settings, state: PlanState): boolean {
  const pausedAt = Date.parse(entry.pausedAt);
  return entry.violations.every((violation) => {
    switch (violation) {
      case "session":
        return now.getTime() >= pausedAt + settings.sessionHours * HOUR_MS;
      case "weekly-share":
        return weekStart(now, settings).getTime() > pausedAt;
      case "weekly-pace":
        return !paceBreached(state.plan, state, settings);
      case "opus-share":
        return !opusShareBreached(state.plan, settings);
    }
  });
}
