import { describe, expect, it } from "vitest";
import { choosePauses, estimate, fairSharePct, planEstimate, weekElapsedPct, weekStart, windowReset, type AgentUsage, type Candidate, type PacingContext, type PlanState, type Violation, type PausedEntry } from "../src/rules.js";
import { resolveSettings } from "../src/settings.js";

const settings = resolveSettings({ opusPctPerMillion: 1, sonnetPctPerMillion: 0.5 });

const idle: AgentUsage = {
  agentId: "",
  session: { opus: 0, sonnet: 0 },
  week: { opus: 0, sonnet: 0 },
  sessionCancelledRuns: 0,
  weekCancelledRuns: 0,
};

const halfWeek: PacingContext = { weekElapsedPct: 50, fairSharePct: 20 };
const earlyWeek: PacingContext = { weekElapsedPct: 10, fairSharePct: 100 };
const lateWeek: PacingContext = { weekElapsedPct: 50, fairSharePct: 100 };

interface Spec {
  id: string;
  session?: Partial<AgentUsage["session"]>;
  week?: Partial<AgentUsage["week"]>;
  exempt?: boolean;
  paused?: boolean;
}

function candidate(spec: Spec): Candidate {
  const usage: AgentUsage = {
    ...idle,
    agentId: spec.id,
    session: { ...idle.session, ...spec.session },
    week: { ...idle.week, ...spec.week },
  };
  const est = estimate(usage, settings);
  if (est === null) throw new Error("settings must be calibrated");
  return { agentId: spec.id, estimate: est, exempt: spec.exempt ?? false, paused: spec.paused ?? false };
}

function pauses(specs: Spec[], ctx: PacingContext, overrides: Record<string, unknown> = {}, held: Violation[] = []) {
  return choosePauses(specs.map(candidate), ctx, resolveSettings({ opusPctPerMillion: 1, sonnetPctPerMillion: 0.5, ...overrides }), new Set(held));
}

describe("rule 1: plan session estimate reaches 80%", () => {
  it("pauses the agents using the most of the session, highest first, up to the cap", () => {
    const sonnet = (m: number) => ({ session: { sonnet: m * 1_000_000 }, week: { sonnet: m * 1_000_000 } });
    expect(
      pauses([{ id: "a1", ...sonnet(12) }, { id: "a2", ...sonnet(9) }, { id: "a3", ...sonnet(6) }, { id: "a4" }], halfWeek),
    ).toEqual([
      { agentId: "a1", violations: ["session"] },
      { agentId: "a2", violations: ["session"] },
    ]);
  });

  it("does not pause when the plan session estimate is under 80%", () => {
    const sonnet = (m: number) => ({ session: { sonnet: m * 1_000_000 }, week: { sonnet: m * 1_000_000 } });
    expect(pauses([{ id: "a1", ...sonnet(9) }, { id: "a2", ...sonnet(9) }, { id: "a3", ...sonnet(5) }], halfWeek)).toEqual([]);
  });
});

describe("rule 2: plan weekly estimate is more than 10 points ahead of the elapsed share", () => {
  const sonnet = (m: number) => ({ week: { sonnet: m * 1_000_000 } });

  it("pauses the agents using the most of the week, highest first, up to the cap", () => {
    expect(pauses([{ id: "a1", ...sonnet(30) }, { id: "a2", ...sonnet(20) }, { id: "a3", ...sonnet(10) }, { id: "a4" }], earlyWeek)).toEqual([
      { agentId: "a1", violations: ["weekly-pace"] },
      { agentId: "a2", violations: ["weekly-pace"] },
    ]);
  });

  it("does not pause when the lead is exactly 10 points", () => {
    expect(pauses([{ id: "a1", ...sonnet(20) }, { id: "a2", ...sonnet(20) }], earlyWeek)).toEqual([]);
  });
});

describe("rule 3: an agent is above its weekly share", () => {
  it("pauses only the agent above the share", () => {
    expect(pauses([{ id: "a1", week: { sonnet: 42_000_000 } }, { id: "a2", week: { sonnet: 10_000_000 } }], halfWeek)).toEqual([
      { agentId: "a1", violations: ["weekly-share"] },
    ]);
  });

  it("does not pause an agent exactly at its share", () => {
    expect(pauses([{ id: "a1", week: { sonnet: 40_000_000 } }], halfWeek)).toEqual([]);
  });
});

describe("rule 4: plan Opus share is above the limit", () => {
  const limit = { maxOpusSharePct: 60 };

  it("pauses the agents using the most Opus, highest first, up to the cap", () => {
    expect(
      pauses(
        [
          { id: "a1", week: { opus: 6_000_000 } },
          { id: "a2", week: { opus: 1_000_000, sonnet: 4_000_000 } },
          { id: "a3", week: { sonnet: 4_000_000 } },
        ],
        lateWeek,
        limit,
      ),
    ).toEqual([
      { agentId: "a1", violations: ["opus-share"] },
      { agentId: "a2", violations: ["opus-share"] },
    ]);
  });

  it("does not pause an Opus-only agent while the plan Opus share is at or under the limit", () => {
    expect(pauses([{ id: "ceo", week: { opus: 6_000_000 } }, { id: "dev", week: { sonnet: 8_000_000 } }], lateWeek, limit)).toEqual([]);
  });

  it("ignores the Opus share while the plan estimate is under the minimum", () => {
    expect(pauses([{ id: "a1", week: { opus: 3_000_000 } }], lateWeek, limit)).toEqual([]);
  });

  it("is off when maxOpusSharePct is unset, even for a plan made entirely of Opus", () => {
    expect(pauses([{ id: "ceo", week: { opus: 6_000_000 } }, { id: "cto", week: { opus: 6_000_000 } }], lateWeek)).toEqual([]);
  });
});

describe("a plan rule the plugin still holds orders no new pauses", () => {
  const sonnet = (m: number) => ({ week: { sonnet: m * 1_000_000 } });
  const crowd = [{ id: "a1", ...sonnet(30) }, { id: "a2", ...sonnet(20) }, { id: "a3", ...sonnet(10) }];

  it("pace", () => {
    expect(pauses(crowd, earlyWeek, {}, ["weekly-pace"])).toEqual([]);
  });

  it("session", () => {
    const hotSession = [{ id: "a1", session: { sonnet: 24_000_000 }, week: { sonnet: 24_000_000 } }];
    expect(pauses(hotSession, halfWeek, {}, ["session"])).toEqual([]);
  });

  it("opus share", () => {
    expect(pauses([{ id: "a1", week: { opus: 6_000_000 } }], lateWeek, { maxOpusSharePct: 60 }, ["opus-share"])).toEqual([]);
  });

  it("still pauses for rule 3", () => {
    expect(pauses([{ id: "a1", week: { sonnet: 42_000_000 } }], halfWeek, {}, ["weekly-pace"])).toEqual([
      { agentId: "a1", violations: ["weekly-share"] },
    ]);
  });
});

describe("who is eligible", () => {
  it("never pauses an exempt agent", () => {
    expect(pauses([{ id: "a1", week: { sonnet: 42_000_000 }, exempt: true }], halfWeek)).toEqual([]);
  });

  it("does not order a second pause for an agent that is already paused", () => {
    expect(pauses([{ id: "a1", week: { sonnet: 42_000_000 }, paused: true }], halfWeek)).toEqual([]);
  });

  it("merges the rules that name the same agent", () => {
    expect(pauses([{ id: "a1", session: { sonnet: 24_000_000 }, week: { sonnet: 42_000_000 } }], halfWeek)).toEqual([
      { agentId: "a1", violations: ["session", "weekly-share"] },
    ]);
  });
});

describe("estimates", () => {
  it("convert tokens with the two ratios", () => {
    const usage: AgentUsage = { ...idle, session: { opus: 0, sonnet: 24_000_000 }, week: { opus: 4_000_000, sonnet: 24_000_000 } };
    expect(estimate(usage, settings)).toEqual({ sessionPct: 80, weekPct: 16, opusWeekPct: 4 });
  });

  it("charge each cancelled run the allowance at the Sonnet ratio", () => {
    const est = estimate({ ...idle, sessionCancelledRuns: 2, weekCancelledRuns: 2 }, settings);
    expect(est).toEqual({ sessionPct: (0.1 / 15) * 100, weekPct: 0.1, opusWeekPct: 0 });
  });
});

describe("resume rule", () => {
  const paused = (violations: PausedEntry["violations"], pausedAt: string): PausedEntry => ({ pausedAt, violations });
  const opusSettings = resolveSettings({ opusPctPerMillion: 1, sonnetPctPerMillion: 0.5, maxOpusSharePct: 60 });
  const planOf = (specs: Spec[]) => planEstimate(specs.map((s) => candidate(s).estimate));
  const calm: PlanState = { plan: { sessionPct: 0, weekPct: 0, opusWeekPct: 0 }, weekElapsedPct: 50 };

  it("ends a session pause exactly sessionHours after it began", () => {
    const entry = paused(["session"], "2026-10-08T07:00:00.000Z");
    expect(windowReset(entry, new Date("2026-10-08T11:59:59.999Z"), settings, calm)).toBe(false);
    expect(windowReset(entry, new Date("2026-10-08T12:00:00.000Z"), settings, calm)).toBe(true);
  });

  it("ends a weekly-share pause when the next week starts", () => {
    const entry = paused(["weekly-share"], "2026-10-07T12:00:00.000Z");
    expect(windowReset(entry, new Date("2026-10-11T23:59:59.999Z"), settings, calm)).toBe(false);
    expect(windowReset(entry, new Date("2026-10-12T00:00:00.000Z"), settings, calm)).toBe(true);
  });

  it("ends a pace pause when the plan lead is at or under the limit", () => {
    const entry = paused(["weekly-pace"], "2026-10-06T06:00:00.000Z");
    const at = (weekPct: number): PlanState => ({ plan: { sessionPct: 0, weekPct, opusWeekPct: 0 }, weekElapsedPct: 10 });
    const now = new Date("2026-10-06T07:00:00.000Z");
    expect(windowReset(entry, now, settings, at(20.1))).toBe(false);
    expect(windowReset(entry, now, settings, at(20))).toBe(true);
  });

  it("ends an Opus pause when the plan Opus share is at or under the limit, or the plan week is under the minimum", () => {
    const entry = paused(["opus-share"], "2026-10-06T09:00:00.000Z");
    const now = new Date("2026-10-06T10:00:00.000Z");
    const over = planOf([{ id: "a", week: { opus: 6_000_000 } }, { id: "b", week: { sonnet: 7_000_000 } }]);
    const atLimit = planOf([{ id: "a", week: { opus: 6_000_000 } }, { id: "b", week: { sonnet: 8_000_000 } }]);
    const tiny = planOf([{ id: "a", week: { opus: 4_000_000 } }]);
    expect(windowReset(entry, now, opusSettings, { plan: over, weekElapsedPct: 50 })).toBe(false);
    expect(windowReset(entry, now, opusSettings, { plan: atLimit, weekElapsedPct: 50 })).toBe(true);
    expect(windowReset(entry, now, opusSettings, { plan: tiny, weekElapsedPct: 50 })).toBe(true);
  });

  it("ends an Opus pause when the limit has been unset", () => {
    const over = planOf([{ id: "a", week: { opus: 6_000_000 } }]);
    expect(windowReset(paused(["opus-share"], "2026-10-06T09:00:00.000Z"), new Date("2026-10-06T10:00:00.000Z"), settings, { plan: over, weekElapsedPct: 50 })).toBe(true);
  });

  it("waits for every recorded window", () => {
    const entry = paused(["session", "weekly-share"], "2026-10-07T12:00:00.000Z");
    expect(windowReset(entry, new Date("2026-10-11T12:00:00.000Z"), settings, calm)).toBe(false);
    expect(windowReset(entry, new Date("2026-10-12T00:00:00.000Z"), settings, calm)).toBe(true);
  });
});

describe("unset settings", () => {
  const heavy: AgentUsage = { ...idle, session: { opus: 900_000_000, sonnet: 900_000_000 }, week: { opus: 900_000_000, sonnet: 900_000_000 } };

  it("produce no estimate", () => {
    expect(estimate(heavy, resolveSettings({}))).toBeNull();
  });

  it("treat zero, negative, and non-numeric ratios as unset", () => {
    expect(estimate(heavy, resolveSettings({ opusPctPerMillion: 0, sonnetPctPerMillion: "TODO" }))).toBeNull();
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
