import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import { JsonRpcCallError, PLUGIN_RPC_ERROR_CODES, type PluginContext } from "@paperclipai/plugin-sdk";
import manifest, { JOB_KEY } from "../src/manifest.js";
import plugin from "../src/worker.js";
import { formatDigest, runPacing } from "../src/pacing.js";
import { resolveSettings } from "../src/settings.js";

type Agent = NonNullable<Awaited<ReturnType<PluginContext["agents"]["get"]>>>;
type Issue = NonNullable<Awaited<ReturnType<PluginContext["issues"]["get"]>>>;
type Company = NonNullable<Awaited<ReturnType<PluginContext["companies"]["get"]>>>;

const COMPANY = "11111111-1111-1111-1111-111111111111";
const SECOND_COMPANY = "33333333-3333-3333-3333-333333333333";
const UNCONFIGURED_COMPANY = "44444444-4444-4444-4444-444444444444";
const DIGEST_ISSUE = "22222222-2222-2222-2222-222222222222";
const NOW = new Date("2026-10-08T12:00:00Z");

function agent(id: string, status: Agent["status"], pauseReason: Agent["pauseReason"] = null, pausedAt: Date | null = null, companyId = COMPANY): Agent {
  return { id, companyId, name: `Agent ${id}`, status, pauseReason, pausedAt } as Agent;
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

type ConfigGet = PluginContext["config"]["get"];

function hostWith(configs: Record<string, Record<string, unknown>>): ConfigGet {
  return async (companyId?: string) => {
    const config = companyId === undefined ? undefined : configs[companyId];
    if (config === undefined) {
      throw new JsonRpcCallError({ code: PLUGIN_RPC_ERROR_CODES.INVOCATION_SCOPE_DENIED, message: "company context is required" });
    }
    return { ...config };
  };
}

async function setup(config: Record<string, unknown> | null, agents: Agent[], rows: Row[], cancelled: unknown[] = []) {
  const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities, "issue.comments.read"] });
  harness.seed({
    companies: [{ id: COMPANY, name: "Manastu" } as Company],
    agents,
    issues: [{ id: DIGEST_ISSUE, companyId: COMPANY, title: "Digest" } as Issue],
  });
  harness.ctx.db.query = (async (sql: string) => (sql.includes("heartbeat_runs") ? cancelled : rows)) as typeof harness.ctx.db.query;
  harness.ctx.config.get = hostWith(config === null ? {} : { [COMPANY]: config });
  const pause = harness.ctx.agents.pause.bind(harness.ctx.agents);
  harness.ctx.agents.pause = async (agentId, companyId) => {
    const paused = { ...(await pause(agentId, companyId)), pausedAt: new Date() };
    harness.seed({ agents: [paused] });
    return paused;
  };
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const calibrated = { digestIssueId: DIGEST_ISSUE, opusPctPerMillion: 1, sonnetPctPerMillion: 0.5 };
const ENFORCE = { ...calibrated, mode: "enforce" };
const hot: Row = { agent_id: "a1", model: "claude-sonnet-5-5", week_tokens: 24_000_000, session_tokens: 24_000_000 };

function pace(ctx: PluginContext, at: Date, config: Record<string, unknown> = ENFORCE) {
  return runPacing(ctx, COMPANY, resolveSettings(config), at);
}

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
      "companies.read",
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
  it("does nothing for a company with no stored config", async () => {
    const harness = await setup(null, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("idle");
    expect(harness.dbQueries).toEqual([]);
  });

  it("does not pause anyone when settings are unset, even in enforce mode", async () => {
    const agents = ["a1", "a2", "a3"].map((id) => agent(id, "idle"));
    const rows = agents.map((a) => ({ ...hot, agent_id: a.id }));
    const harness = await setup({ mode: "enforce" }, agents, rows);
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
    const harness = await setup(ENFORCE, [agent("a1", "idle"), agent("a2", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    expect(await statusOf(harness, "a2")).toBe("idle");
    const comments = await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY);
    expect(comments[0]?.body).toContain("| Agent a1 | idle | 80.0 | 12.0 | 0.0 | 0 | paused (session) |");
  });

  it("pauses at most maxPausesPerRun agents and defers the rest", async () => {
    const agents = ["a1", "a2", "a3"].map((id) => agent(id, "idle"));
    const rows = agents.map((a) => ({ ...hot, agent_id: a.id }));
    const harness = await setup({ ...ENFORCE, maxPausesPerRun: 2 }, agents, rows);
    await harness.runJob(JOB_KEY);
    expect(await Promise.all(agents.map((a) => statusOf(harness, a.id)))).toEqual(["paused", "paused", "idle"]);
  });

  it("resumes an agent it paused once the session window has passed", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");

    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date("2026-10-08T16:59:00Z"));
    expect(await statusOf(harness, "a1")).toBe("paused");
    await pace(harness.ctx, new Date("2026-10-08T17:00:00Z"));
    expect(await statusOf(harness, "a1")).toBe("idle");
  });

  it("does not resume an agent the Board paused", async () => {
    const harness = await setup(ENFORCE, [agent("a2", "paused", "manual", new Date("2026-10-08T01:00:00Z"))], []);
    await pace(harness.ctx, new Date("2026-10-08T23:00:00Z"));
    expect(await statusOf(harness, "a2")).toBe("paused");
  });

  it("does not resume an agent the Board resumed and paused again after the plugin paused it", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");

    harness.seed({ agents: [agent("a1", "paused", "manual", new Date("2026-10-08T12:10:00Z"))] });
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date("2026-10-08T18:00:00Z"));
    expect(await statusOf(harness, "a1")).toBe("paused");
  });

  it("checks the weekly pace again after a two-reason pause outlives its pace reason", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i + 1}`);
    const usage = (a1: number, rest: number): Row[] =>
      ids.map((id, i) => ({ agent_id: id, model: "claude-sonnet-5-5", week_tokens: i === 0 ? a1 : rest, session_tokens: 0 }));
    const harness = await setup(ENFORCE, ids.map((id) => agent(id, "idle")), usage(30_000_000, 1_000_000));
    const paused = async () => ids.filter((_, i) => statuses[i] === "paused");
    let statuses: Array<string | undefined> = [];
    const snapshot = async () => {
      statuses = await Promise.all(ids.map((id) => statusOf(harness, id)));
      return paused();
    };

    await pace(harness.ctx, new Date("2026-10-05T06:00:00Z"));
    expect(await snapshot()).toEqual(["a1", "a2"]);

    await pace(harness.ctx, new Date("2026-10-06T00:00:00Z"));
    expect(await snapshot()).toEqual(["a1"]);

    harness.ctx.db.query = (async (sql: string) => (sql.includes("heartbeat_runs") ? [] : usage(30_000_000, 4_000_000))) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date("2026-10-06T12:00:00Z"));
    expect(await snapshot()).toEqual(["a1", "a2", "a3"]);
  });

  it("pauses one batch per pace breach and resumes it when the plan is back on pace", async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `a${i + 1}`);
    const rows = ids.map((id, i) => ({ agent_id: id, model: "claude-sonnet-5-5", week_tokens: (12 - i) * 1_000_000, session_tokens: 0 }));
    const harness = await setup(ENFORCE, ids.map((id) => agent(id, "idle")), rows);
    for (const at of ["06:00", "06:15", "06:30", "06:45"]) await pace(harness.ctx, new Date(`2026-10-05T${at}:00Z`));
    const statuses = await Promise.all(ids.map((id) => statusOf(harness, id)));
    expect(ids.filter((_, i) => statuses[i] === "paused")).toEqual(["a1", "a2"]);

    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date("2026-10-05T07:00:00Z"));
    expect(await Promise.all(["a1", "a2"].map((id) => statusOf(harness, id)))).toEqual(["idle", "idle"]);
  });

  it("skips exempt agents in plan rules and reads exemptAgentIds from settings", async () => {
    const agents = [agent("a1", "idle"), agent("a2", "idle")];
    const rows = agents.map((a) => ({ ...hot, agent_id: a.id }));
    const harness = await setup({ ...ENFORCE, exemptAgentIds: ["a1"] }, agents, rows);
    await harness.runJob(JOB_KEY);
    expect(await Promise.all(agents.map((a) => statusOf(harness, a.id)))).toEqual(["idle", "paused"]);
  });

  it("splits Opus from other models and parses string token counts", async () => {
    const rows = [
      { agent_id: "a1", model: "claude-opus-5-5", week_tokens: "20000000", session_tokens: "20000000" },
      { agent_id: "a1", model: null, week_tokens: "4000000", session_tokens: "4000000" },
    ] as unknown as Row[];
    const harness = await setup(ENFORCE, [agent("a1", "idle")], rows);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    const body = (await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY))[0]?.body ?? "";
    expect(body).toContain("| Agent a1 | idle | 146.7 | 22.0 | 20.0 | 0 | paused (session) |");
  });

  it("defers agents over the per-run cap and pauses the heaviest first", async () => {
    const ids = ["a1", "a2", "a3", "a4", "a5"];
    const rows = ids.map((id, i) => ({ agent_id: id, model: "claude-sonnet-5-5", week_tokens: (50 + i) * 1_000_000, session_tokens: 0 }));
    const harness = await setup({ ...ENFORCE, maxPausesPerRun: 2 }, ids.map((id) => agent(id, "idle")), rows);
    await harness.runJob(JOB_KEY);
    expect(await Promise.all(ids.map((id) => statusOf(harness, id)))).toEqual(["idle", "idle", "idle", "paused", "paused"]);
    const body = (await harness.ctx.issues.listComments(DIGEST_ISSUE, COMPANY))[0]?.body ?? "";
    const outcome = (id: string) => new RegExp(`\\| Agent ${id} \\|[^\\n]*\\| (paused|deferred) \\(`).exec(body)?.[1];
    expect(ids.map(outcome)).toEqual(["deferred", "deferred", "deferred", "paused", "paused"]);
  });

  it("still resumes its own pauses in dry-run mode after the window", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    const result = await pace(harness.ctx, new Date("2026-10-08T17:00:00Z"), { ...calibrated, mode: "dry-run" });
    expect(result?.agents.map((r) => r.outcome)).toEqual(["resumed"]);
    expect(await statusOf(harness, "a1")).toBe("idle");
    expect(formatDigest(result!)).toContain("Dry run. Nothing is paused. The plugin still resumes agents it paused earlier once their reasons end.");
  });

  async function pausedThenConfig(config: Record<string, unknown>, at: string) {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date(at), config);
    return harness;
  }

  it("does not resume in off mode after the window", async () => {
    const harness = await pausedThenConfig({ ...calibrated, mode: "off" }, "2026-10-08T17:00:00Z");
    expect(await statusOf(harness, "a1")).toBe("paused");
  });

  it("keeps a pace pause while a ratio is unset", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ agent_id: `a${i + 1}`, model: "claude-sonnet-5-5", week_tokens: (12 - i) * 1_000_000, session_tokens: 0 }));
    const harness = await setup(ENFORCE, rows.map((r) => agent(r.agent_id, "idle")), rows);
    await pace(harness.ctx, new Date("2026-10-05T06:00:00Z"));
    expect(await statusOf(harness, "a1")).toBe("paused");
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await pace(harness.ctx, new Date("2026-10-05T07:00:00Z"), { ...ENFORCE, sonnetPctPerMillion: undefined });
    expect(await statusOf(harness, "a1")).toBe("paused");
  });

  it("reports failed when pause throws and leaves the agent unrecorded", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    harness.ctx.agents.pause = async () => {
      throw new Error("boom");
    };
    const result = await pace(harness.ctx, NOW);
    expect(result?.agents.map((r) => r.outcome)).toEqual(["failed"]);
  });

  it("reports failed when resume throws and retries next run", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    await harness.runJob(JOB_KEY);
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    const resume = harness.ctx.agents.resume.bind(harness.ctx.agents);
    harness.ctx.agents.resume = async () => {
      throw new Error("boom");
    };
    const failed = await pace(harness.ctx, new Date("2026-10-08T17:00:00Z"));
    expect(failed?.agents.map((r) => r.outcome)).toEqual(["failed"]);
    harness.ctx.agents.resume = resume;
    const retried = await pace(harness.ctx, new Date("2026-10-08T17:15:00Z"));
    expect(retried?.agents.map((r) => r.outcome)).toEqual(["resumed"]);
  });

  it("keeps the state and does not throw when the digest comment fails", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    harness.ctx.issues.createComment = async () => {
      throw new Error("boom");
    };
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    expect(await harness.ctx.state.get({ scopeKind: "company", scopeId: COMPANY, stateKey: "last-digest-at" })).toBeNull();
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
      companyId: COMPANY,
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

describe("company context", () => {
  it("paces every company with a stored config and keeps each company's pauses", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    harness.seed({
      companies: [{ id: SECOND_COMPANY, name: "Second" } as Company],
      agents: [agent("b1", "idle", null, null, SECOND_COMPANY)],
    });
    harness.ctx.config.get = hostWith({ [COMPANY]: ENFORCE, [SECOND_COMPANY]: ENFORCE });
    harness.ctx.db.query = (async (sql: string, params: unknown[]) => {
      if (sql.includes("heartbeat_runs")) return [];
      return params[0] === SECOND_COMPANY ? [{ ...hot, agent_id: "b1" }] : [hot];
    }) as typeof harness.ctx.db.query;
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("paused");
    expect((await harness.ctx.agents.get("b1", SECOND_COMPANY))?.status).toBe("paused");

    vi.setSystemTime(new Date("2026-10-08T17:00:00Z"));
    harness.ctx.db.query = (async () => []) as typeof harness.ctx.db.query;
    await harness.runJob(JOB_KEY);
    expect(await statusOf(harness, "a1")).toBe("idle");
    expect((await harness.ctx.agents.get("b1", SECOND_COMPANY))?.status).toBe("idle");
  });

  it("skips a company with no stored config instead of failing the run", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    harness.seed({ companies: [{ id: UNCONFIGURED_COMPANY, name: "Unconfigured" } as Company] });
    await expect(harness.runJob(JOB_KEY)).resolves.toBeUndefined();
    expect(await statusOf(harness, "a1")).toBe("paused");
  });

  it("fails the run when reading a configured company's config fails for another reason", async () => {
    const harness = await setup(ENFORCE, [agent("a1", "idle")], [hot]);
    harness.ctx.config.get = async () => {
      throw new Error("connection terminated");
    };
    await expect(harness.runJob(JOB_KEY)).rejects.toThrow("connection terminated");
    expect(await statusOf(harness, "a1")).toBe("idle");
  });
});
