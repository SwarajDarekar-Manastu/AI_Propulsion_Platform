import { describe, expect, it } from "vitest";
import { countWakes, median, tokenBreach, tokensOf, type WakeEntry } from "../src/rules.js";

const NOW = new Date("2026-10-08T12:00:00Z");
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

function wakes(count: number, issueId: string, ageMinutes: number): WakeEntry[] {
  return Array.from({ length: count }, (_, i) => ({ runId: `run-${issueId}-${i}`, issueId, at: minutesBefore(ageMinutes) }));
}

describe("countWakes", () => {
  it("counts 12 wakes on one task in the window", () => {
    expect(countWakes(wakes(12, "TASK-1", 5), "TASK-1", NOW)).toBe(12);
  });

  it("counts 13 wakes on one task in the window", () => {
    expect(countWakes(wakes(13, "TASK-1", 5), "TASK-1", NOW)).toBe(13);
  });

  it("does not count a wake older than 60 minutes", () => {
    expect(countWakes(wakes(3, "TASK-1", 61), "TASK-1", NOW)).toBe(0);
  });

  it("counts only the task asked about", () => {
    const log = [...wakes(4, "TASK-1", 5), ...wakes(9, "TASK-2", 5)];
    expect(countWakes(log, "TASK-1", NOW)).toBe(4);
  });
});

describe("tokensOf", () => {
  it("sums input, cached input and output tokens", () => {
    expect(tokensOf({ inputTokens: 100, cachedInputTokens: 900, outputTokens: 50 })).toBe(1050);
  });

  it("treats a run without usage as no usage", () => {
    expect(tokensOf(null)).toBeNull();
    expect(tokensOf({})).toBeNull();
    expect(tokensOf({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 })).toBeNull();
  });
});

describe("median", () => {
  it("takes the middle value of an odd list", () => {
    expect(median([3, 1, 2])).toBe(2);
  });

  it("averages the two middle values of an even list", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe("tokenBreach", () => {
  const settings = { tokenMultiple: 6, minBaselineRuns: 5 };
  const baseline = Array.from({ length: 10 }, () => 1000);

  it("does not breach at exactly six times the median", () => {
    expect(tokenBreach(6000, baseline, settings)).toBeNull();
  });

  it("breaches one token over six times the median", () => {
    expect(tokenBreach(6001, baseline, settings)).toEqual({ tokens: 6001, median: 1000, multiple: 6 });
  });

  it("does not breach without a baseline of minBaselineRuns", () => {
    expect(tokenBreach(1_000_000, [1000, 1000, 1000, 1000], settings)).toBeNull();
  });
});
