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

export type Decision =
  | { kind: "pause"; violations: Violation[] }
  | { kind: "resume" }
  | { kind: "none" };

export interface AgentPacingState {
  paused: boolean;
  pausedByPlugin: boolean;
  pausedManually: boolean;
  exempt: boolean;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MONDAY_EPOCH_MS = Date.UTC(1970, 0, 5);

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

export function violations(est: Estimate, ctx: PacingContext, settings: Settings): Violation[] {
  const found: Violation[] = [];
  if (est.sessionPct >= settings.sessionPauseAtPct) found.push("session");
  if (est.weekPct - ctx.weekElapsedPct > settings.weeklyPaceLeadPts) found.push("weekly-pace");
  if (est.weekPct > ctx.fairSharePct) found.push("weekly-share");
  if (est.weekPct >= settings.opusRuleMinWeekPct && (est.opusWeekPct / est.weekPct) * 100 > settings.maxOpusSharePct) found.push("opus-share");
  return found;
}

export function decide(est: Estimate | null, state: AgentPacingState, ctx: PacingContext, settings: Settings): Decision {
  if (est === null) return { kind: "none" };
  const found = violations(est, ctx, settings);
  if (!state.paused) {
    return found.length > 0 && !state.exempt ? { kind: "pause", violations: found } : { kind: "none" };
  }
  if (state.pausedByPlugin && !state.pausedManually && found.length === 0) return { kind: "resume" };
  return { kind: "none" };
}
