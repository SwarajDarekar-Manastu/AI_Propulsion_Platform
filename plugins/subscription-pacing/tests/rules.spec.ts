import { describe, expect, it } from "vitest";
import { decide, estimate, fairSharePct, weekElapsedPct, weekStart, type AgentPacingState, type AgentUsage, type PacingContext } from "../src/rules.js";
import { resolveSettings } from "../src/settings.js";

const settings = resolveSettings({ opusPctPerMillion: 1, sonnetPctPerMillion: 0.5 });

const idle: AgentUsage = {
  agentId: "a1",
  session: { opus: 0, sonnet: 0 },
  week: { opus: 0, sonnet: 0 },
  sessionCancelledRuns: 0,
  weekCancelledRuns: 0,
};

const running: AgentPacingState = { paused: false, pausedByPlugin: false, pausedManually: false, exempt: false };
const pausedByPlugin: AgentPacingState = { paused: true, pausedByPlugin: true, pausedManually: false, exempt: false };
const halfWeek: PacingContext = { weekElapsedPct: 50, fairSharePct: 20 };

function run(usage: Partial<AgentUsage>, state: AgentPacingState, ctx: PacingContext) {
  return decide(estimate({ ...idle, ...usage }, settings), state, ctx, settings);
}

describe("pause rules", () => {
  it("pauses at 80% of the session allowance", () => {
    const usage = { session: { opus: 0, sonnet: 24_000_000 }, week: { opus: 0, sonnet: 24_000_000 } };
    expect(estimate({ ...idle, ...usage }, settings)).toEqual({ sessionPct: 80, weekPct: 12, opusWeekPct: 0 });
    expect(run(usage, running, halfWeek)).toEqual({ kind: "pause", violations: ["session"] });
  });

  it("does not pause just under 80% of the session allowance", () => {
    const usage = { session: { opus: 0, sonnet: 23_000_000 }, week: { opus: 0, sonnet: 23_000_000 } };
    expect(run(usage, running, halfWeek)).toEqual({ kind: "none" });
  });

  it("pauses when the weekly estimate is more than 10 points ahead of the elapsed share", () => {
    const usage = { week: { opus: 0, sonnet: 42_000_000 } };
    expect(run(usage, running, { weekElapsedPct: 10, fairSharePct: 100 })).toEqual({ kind: "pause", violations: ["weekly-pace"] });
  });

  it("does not pause when the weekly lead is exactly 10 points", () => {
    const usage = { week: { opus: 0, sonnet: 40_000_000 } };
    expect(run(usage, running, { weekElapsedPct: 10, fairSharePct: 100 })).toEqual({ kind: "none" });
  });

  it("pauses when the agent is above its weekly share", () => {
    const usage = { week: { opus: 0, sonnet: 42_000_000 } };
    expect(run(usage, running, halfWeek)).toEqual({ kind: "pause", violations: ["weekly-share"] });
  });

  it("pauses when Opus is more than 60% of the weekly estimate", () => {
    const usage = { week: { opus: 7_000_000, sonnet: 2_000_000 } };
    expect(estimate({ ...idle, ...usage }, settings)).toEqual({ sessionPct: 0, weekPct: 8, opusWeekPct: 7 });
    expect(run(usage, running, halfWeek)).toEqual({ kind: "pause", violations: ["opus-share"] });
  });

  it("ignores the Opus share below the minimum weekly estimate", () => {
    const usage = { week: { opus: 3_000_000, sonnet: 0 } };
    expect(run(usage, running, halfWeek)).toEqual({ kind: "none" });
  });

  it("never pauses an exempt agent", () => {
    const usage = { session: { opus: 0, sonnet: 24_000_000 }, week: { opus: 0, sonnet: 24_000_000 } };
    expect(run(usage, { ...running, exempt: true }, halfWeek)).toEqual({ kind: "none" });
  });

  it("charges each cancelled run the allowance at the Sonnet ratio", () => {
    const usage = { sessionCancelledRuns: 2, weekCancelledRuns: 2 };
    expect(estimate({ ...idle, ...usage }, settings)).toEqual({ sessionPct: (0.1 / 15) * 100, weekPct: 0.1, opusWeekPct: 0 });
  });
});

describe("resume rule", () => {
  it("resumes an agent the plugin paused once no rule fires", () => {
    expect(run({}, pausedByPlugin, halfWeek)).toEqual({ kind: "resume" });
  });

  it("keeps an agent paused while a rule still fires", () => {
    const usage = { session: { opus: 0, sonnet: 24_000_000 }, week: { opus: 0, sonnet: 24_000_000 } };
    expect(run(usage, pausedByPlugin, halfWeek)).toEqual({ kind: "none" });
  });

  it("does not resume an agent the plugin did not pause", () => {
    expect(run({}, { ...pausedByPlugin, pausedByPlugin: false }, halfWeek)).toEqual({ kind: "none" });
  });

  it("does not resume an agent the Board paused manually", () => {
    expect(run({}, { ...pausedByPlugin, pausedManually: true }, halfWeek)).toEqual({ kind: "none" });
  });
});

describe("unset settings", () => {
  const unset = resolveSettings({});
  const heavy: AgentUsage = { ...idle, session: { opus: 900_000_000, sonnet: 900_000_000 }, week: { opus: 900_000_000, sonnet: 900_000_000 } };

  it("produce no estimate", () => {
    expect(estimate(heavy, unset)).toBeNull();
  });

  it("treat zero, negative, and non-numeric ratios as unset", () => {
    const placeholder = resolveSettings({ opusPctPerMillion: 0, sonnetPctPerMillion: "TODO" });
    expect(estimate(heavy, placeholder)).toBeNull();
  });

  it("pause nobody, whatever the usage", () => {
    const agents = Array.from({ length: 6 }, (_, i) => ({ ...heavy, agentId: `a${i}` }));
    const decisions = agents.map((a) => decide(estimate(a, unset), running, halfWeek, unset));
    expect(decisions).toEqual(Array(6).fill({ kind: "none" }));
  });

  it("estimate nothing when only one ratio is set", () => {
    expect(estimate(heavy, resolveSettings({ opusPctPerMillion: 1 }))).toBeNull();
  });
});

describe("week window", () => {
  it("starts Monday 00:00 UTC by default", () => {
    expect(weekStart(new Date("2026-10-08T12:00:00Z"), settings).toISOString()).toBe("2026-10-05T00:00:00.000Z");
    expect(weekElapsedPct(new Date("2026-10-08T12:00:00Z"), settings)).toBeCloseTo(((3.5 * 24) / 168) * 100, 6);
  });

  it("follows a configured reset anchor", () => {
    const anchored = resolveSettings({ weekResetAnchor: "2026-10-01T09:00:00Z" });
    expect(weekStart(new Date("2026-10-08T12:00:00Z"), anchored).toISOString()).toBe("2026-10-08T09:00:00.000Z");
  });

  it("splits the plan evenly unless a share is configured", () => {
    expect(fairSharePct(5, settings)).toBe(20);
    expect(fairSharePct(5, resolveSettings({ agentWeeklySharePct: 30 }))).toBe(30);
  });
});
