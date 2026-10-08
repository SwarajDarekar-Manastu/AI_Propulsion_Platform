import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import manifest, { JOB_KEY } from "../src/manifest.js";
import plugin from "../src/worker.js";
import { formatDigest, runPacing } from "../src/pacing.js";
import { resolveSettings } from "../src/settings.js";

type Agent = NonNullable<Awaited<ReturnType<PluginContext["agents"]["get"]>>>;
type Issue = NonNullable<Awaited<ReturnType<PluginContext["issues"]["get"]>>>;

const COMPANY = "11111111-1111-1111-1111-111111111111";
const DIGEST_ISSUE = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-10-08T12:00:00Z");

function agent(id: string, status: Agent["status"], pauseReason: Agent["pauseReason"] = null, pausedAt: Date | null = null): Agent {
  return { id, companyId: COMPANY, name: `Agent ${id}`, status, pauseReason, pausedAt } as Agent;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

interface Row {
  agent_id: string;
  model: string;
  week_tokens: number;
  session_tokens: number;
}

async function setup(config: Record<string, unknown>, agents: Agent[], rows: Row[], cancelled: unknown[] = []) {
  const harness = createTestHarness({ manifest, config, capabilities: [...manifest.capabilities, "issue.comments.read"] });
  harness.seed({ agents, issues: [{ id: DIGEST_ISSUE, companyId: COMPANY, title: "Digest" } as Issue] });
  harness.ctx.db.query = (async (sql: string) => (sql.includes("heartbeat_runs") ? cancelled : rows)) as typeof harness.ctx.db.query;
  const pause = harness.ctx.agents.pause.bind(harness.ctx.agents);
  harness.ctx.agents.pause = async (agentId, companyId) => {
    const paused = { ...(await pause(agentId, companyId)), pausedAt: new Date() };
    harness.seed({ agents: [paused] });
    return paused;
  };
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const calibrated = { companyId: COMPANY, digestIssueId: DIGEST_ISSUE, opusPctPerMillion: 1, sonnetPctPerMillion: 0.5 };
const hot: Row = { agent_id: "a1", model: "claude-sonnet-5-5", week_tokens: 24_000_000, session_tokens: 24_000_000 };

async function statusOf(harness: Awaited<ReturnType<typeof setup>>, id: string) {
  return (await harness.ctx.agents.get(id, COMPANY))?.status;
}

describe("manifest", () => {
  it("schedules the job every 15 minutes", () => {
    expect(manifest.jobs).toEqual([
      { jobKey: "pace-agents", displayName: "Pace agents", description: "Estimate usage, pause and resume agents, post the digest.", schedule: "*/15 * * * *" },
    ]);
  });

  it("declares exactly the capabilities the worker uses", () => {
    expect([...manifest.capabilities].sort()).toEqual([
      "agents.pause",
      "agents.read",
      "agents.resume",
      "database.namespace.migrate",
      "database.namespace.read",
      "issue.comments.create",
      "jobs.schedule",
      "plugin.state.read",
      "plugin.state.write",
    ]);
  });
});

describe("pace-agents job", () => {
  it("does nothing when no company is configured", async () => {
    const harness = await setup({ mode: "enforce", opusPctPerMillion: 1, sonnetPctPerMillion: 0.5 }, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("idle");
    expect(harness.dbQueries).toEqual([]);
  });

  it("does not pause anyone when settings are unset, even in enforce mode", async () => {
    const agents = ["a1", "a2", "a3"].map((id) => agent(id, "idle"));
    const rows = agents.map((a) => ({ ...hot, agent_id: a.id }));
    const harness = await setup({ companyId: COMPANY, mode: "enforce" }, agents, rows);
    await harness.runJob(JOB_KEY);
    expect(await Promise.all(agents.map((a) => statusOf(harness, a.id)))).toEqual(["idle", "idle", "idle"]);
  });

  it("only reports in the default dry-run mode", async () => {
    const harness = await setup(calibrated, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("idle");
    const comments = await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY);
    expect(comments).toHaveLength(1);
    expect(comments[0]?.body).toContain("| Agent a1 | idle | 80.0 | 12.0 | 0.0 | 0 | would-pause (session) |");
  });

  it("pauses an agent over the session limit and posts the digest in enforce mode", async () => {
    const harness = await setup({ ...calibrated, mode: "enforce" }, [agent("a1", "idle"), agent("a2", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    expect(await statusOf(harness, "a2")).toBe("idle");
    const comments = await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY);
    expect(comments[0]?.body).toContain("| Agent a1 | idle | 80.0 | 12.0 | 0.0 | 0 | paused (session) |");
  });

  it("pauses at most maxPausesPerRun agents and defers the rest", async () => {
    const agents = ["a1", "a2", "a3"].map((id) => agent(id, "idle"));
    const rows = agents.map((a) => ({ ...hot, agent_id: a.id }));
    const harness = await setup({ ...calibrated, mode: "enforce", maxPausesPerRun: 2 }, agents, rows);
    await harness.runJob(JOB_KEY);
    expect(await Promise.all(agents.map((a) => statusOf(harness, a.id)))).toEqual(["paused", "paused", "idle"]);
  });

  it("resumes an agent it paused once the session window has passed", async () => {
    const harness = await setup({ ...calibrated, mode: "enforce" }, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");

    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await runPacing(harness.ctx, new Date("2026-10-08T16:59:00Z"));
    expect(await statusOf(harness, "a1")).toBe("paused");
    await runPacing(harness.ctx, new Date("2026-10-08T17:00:00Z"));
    expect(await statusOf(harness, "a1")).toBe("idle");
  });

  it("does not resume an agent the Board paused", async () => {
    const harness = await setup({ ...calibrated, mode: "enforce" }, [agent("a2", "paused", "manual", new Date("2026-10-08T01:00:00Z"))], []);
    await runPacing(harness.ctx, new Date("2026-10-08T23:00:00Z"));
    expect(await statusOf(harness, "a2")).toBe("paused");
  });

  it("does not resume an agent the Board resumed and paused again after the plugin paused it", async () => {
    const harness = await setup({ ...calibrated, mode: "enforce" }, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");

    harness.seed({ agents: [agent("a1", "paused", "manual", new Date("2026-10-08T12:10:00Z"))] });
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await runPacing(harness.ctx, new Date("2026-10-08T18:00:00Z"));
    expect(await statusOf(harness, "a1")).toBe("paused");
  });

  it("checks the weekly pace again after a two-reason pause outlives its pace reason", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i + 1}`);
    const usage = (a1: number, rest: number): Row[] =>
      ids.map((id, i) => ({ agent_id: id, model: "claude-sonnet-5-5", week_tokens: i === 0 ? a1 : rest, session_tokens: 0 }));
    const harness = await setup({ ...calibrated, mode: "enforce" }, ids.map((id) => agent(id, "idle")), usage(30_000_000, 1_000_000));
    const paused = async () => ids.filter((_, i) => statuses[i] === "paused");
    let statuses: Array<string | undefined> = [];
    const snapshot = async () => {
      statuses = await Promise.all(ids.map((id) => statusOf(harness, id)));
      return paused();
    };

    await runPacing(harness.ctx, new Date("2026-10-05T06:00:00Z"));
    expect(await snapshot()).toEqual(["a1", "a2"]);

    await runPacing(harness.ctx, new Date("2026-10-06T00:00:00Z"));
    expect(await snapshot()).toEqual(["a1"]);

    harness.ctx.db.query = (async (sql: string) => (sql.includes("heartbeat_runs") ? [] : usage(30_000_000, 4_000_000))) as typeof harness.ctx.db.query;
    await runPacing(harness.ctx, new Date("2026-10-06T12:00:00Z"));
    expect(await snapshot()).toEqual(["a1", "a2", "a3"]);
  });

  it("pauses one batch per pace breach and resumes it when the plan is back on pace", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i + 1}`);
    const rows = ids.map((id, i) => ({ agent_id: id, model: "claude-sonnet-5-5", week_tokens: (12 - i) * 1_000_000, session_tokens: 0 }));
    const harness = await setup({ ...calibrated, mode: "enforce" }, ids.map((id) => agent(id, "idle")), rows);
    for (const at of ["06:00", "06:15", "06:30", "06:45"]) await runPacing(harness.ctx, new Date(`2026-10-05T${at}:00Z`));
    const statuses = await Promise.all(ids.map((id) => statusOf(harness, id)));
    expect(ids.filter((_, i) => statuses[i] === "paused")).toEqual(["a1", "a2"]);

    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await runPacing(harness.ctx, new Date("2026-10-05T07:00:00Z"));
    expect(await Promise.all(["a1", "a2"].map((id) => statusOf(harness, id)))).toEqual(["idle", "idle"]);
  });

  it("charges cancelled runs without usage and reports them", async () => {
    const harness = await setup(calibrated, [agent("a1", "idle")], [], [{ agent_id: "a1", week_runs: 4, session_runs: 4 }]);
    await harness.runJob(JOB_KEY);
    const body = (await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY))[0]?.body ?? "";
    expect(body).toContain("| Agent a1 | idle | 1.3 | 0.2 | 0.0 | 4 | none |");
    expect(body).toContain("Cancelled runs with no usage record this week: 4. Each is charged 100000 tokens at the Sonnet ratio.");
  });

  it("says estimates are off when ratios are unset", () => {
    const text = formatDigest({
      settings: resolveSettings({}),
      now: NOW,
      weekElapsedPct: 0,
      fairSharePct: 100,
      plan: { sessionPct: 0, weekPct: 0, opusWeekPct: 0 },
      agents: [],
      released: [],
    });
    expect(text).toContain("**Estimates are off.**");
  });
});
