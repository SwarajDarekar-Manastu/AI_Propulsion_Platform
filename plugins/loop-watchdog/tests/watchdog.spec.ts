import { describe, expect, it, vi } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { PluginContext } from "@paperclipai/plugin-sdk";
import manifest from "../src/manifest.js";
import plugin from "../src/worker.js";

type Agent = NonNullable<Awaited<ReturnType<PluginContext["agents"]["get"]>>>;
type Issue = NonNullable<Awaited<ReturnType<PluginContext["issues"]["get"]>>>;

const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "44444444-4444-4444-4444-444444444444";
const DIGEST_ISSUE = "22222222-2222-2222-2222-222222222222";
const TASK = "33333333-3333-3333-3333-333333333333";
const T0 = Date.parse("2026-10-08T12:00:00Z");

function agent(id: string, status: Agent["status"] = "idle"): Agent {
  return { id, companyId: COMPANY, name: `Agent ${id}`, status, pauseReason: null, pausedAt: status === "paused" ? new Date(T0) : null } as Agent;
}

interface RunRow {
  id: string;
  agentId: string;
  companyId: string;
  usage: unknown;
}

async function setup(config: Record<string, unknown>, agents: Agent[], runs: RunRow[] = []) {
  const harness = createTestHarness({ manifest, config, capabilities: [...manifest.capabilities, "issue.comments.read"] });
  harness.seed({ agents, issues: [{ id: DIGEST_ISSUE, companyId: COMPANY, title: "Digest" } as Issue] });
  harness.ctx.db.query = (async (sql: string, params: unknown[] = []) => {
    const [companyId, second, third, fourth] = params;
    const scoped = runs.filter((run) => run.companyId === companyId && run.usage !== null);
    if (sql.includes("id <> ")) {
      return scoped
        .filter((run) => run.agentId === second && run.id !== third)
        .slice(0, Number(fourth))
        .map((run) => ({ id: run.id, usage_json: run.usage }));
    }
    return scoped.filter((run) => run.id === second).map((run) => ({ id: run.id, usage_json: run.usage }));
  }) as typeof harness.ctx.db.query;
  harness.ctx.agents.pause = async (agentId) => {
    const paused = agent(agentId, "paused");
    harness.seed({ agents: [paused] });
    return paused;
  };
  await plugin.definition.setup(harness.ctx);
  return harness;
}

async function start(h: Awaited<ReturnType<typeof setup>>, runId: string, agentId: string, issueId: string | null, minutes = 0, companyId = COMPANY) {
  await h.emit(
    "agent.run.started",
    { runId, agentId, issueId, status: "running" },
    { companyId, occurredAt: new Date(T0 + minutes * 60_000).toISOString() },
  );
}

async function terminal(h: Awaited<ReturnType<typeof setup>>, type: "agent.run.finished" | "agent.run.failed", runId: string, agentId: string) {
  await h.emit(type, { runId, agentId, issueId: TASK, status: type === "agent.run.finished" ? "succeeded" : "failed" }, { companyId: COMPANY, occurredAt: new Date(T0).toISOString() });
}

async function statusOf(h: Awaited<ReturnType<typeof setup>>, id: string) {
  return (await h.ctx.agents.get(id, COMPANY))?.status;
}

async function digests(h: Awaited<ReturnType<typeof setup>>) {
  return (await h.ctx.issues.listComments(DIGEST_ISSUE, COMPANY)).map((comment) => comment.body);
}

const enforce = { mode: "enforce", digestIssueId: DIGEST_ISSUE };
const dryRun = { mode: "dry-run", digestIssueId: DIGEST_ISSUE };

function history(agentId: string, count: number, usage: unknown): RunRow[] {
  return Array.from({ length: count }, (_, i) => ({ id: `h-${agentId}-${i}`, agentId, companyId: COMPANY, usage }));
}

const TOKENS_1000 = { inputTokens: 500, cachedInputTokens: 300, outputTokens: 200 };

describe("Rule W: wakes on one task", () => {
  it("does not pause at 12 runs started on one task in an hour", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 12; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("pauses the 13th run started on one task in an hour", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("paused");
    expect((await digests(h))[0]).toContain("Rule W: 13 runs started on one task in the last 60 minutes, limit 12");
  });

  it("counts runs that never finish, such as cancelled or failed loops", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, i);
    expect(await statusOf(h, "a1")).toBe("paused");
  });

  it("does not count a 13-run loop spread over more than an hour", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, i * 6);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("posts one dry-run digest for a 20-start loop, not one per start", async () => {
    const h = await setup(dryRun, [agent("a1")]);
    for (let i = 0; i < 20; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await digests(h)).toHaveLength(1);
  });

  it("does not pause again on the next start after the Board resumes", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("paused");
    h.seed({ agents: [agent("a1")] });
    await start(h, "after-resume", "a1", TASK, 10);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("pauses again only after 13 more starts following a Board resume", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    h.seed({ agents: [agent("a1")] });
    for (let i = 0; i < 12; i += 1) await start(h, `after-${i}`, "a1", TASK, 10);
    expect(await statusOf(h, "a1")).toBe("idle");
    await start(h, "after-12", "a1", TASK, 10);
    expect(await statusOf(h, "a1")).toBe("paused");
  });

  it("does not count runs with no task", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", null, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("counts a redelivered start event once", async () => {
    const h = await setup(enforce, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, "same-run", "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("only reports at 13 in dry-run mode", async () => {
    const h = await setup(dryRun, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
    expect((await digests(h))[0]).toContain("would pause (dry-run)");
  });

  it("does nothing in off mode", async () => {
    const h = await setup({ ...enforce, mode: "off" }, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("never pauses an exempt agent", async () => {
    const h = await setup({ ...enforce, exemptAgentIds: ["a1"] }, [agent("a1")]);
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
  });
});

describe("Rule T: tokens against the agent's own median", () => {
  const current = (tokens: number) => ({ id: "cur", agentId: "a1", companyId: COMPANY, usage: { inputTokens: tokens, cachedInputTokens: 0, outputTokens: 0 } });

  it("does not pause at exactly six times the median", async () => {
    const h = await setup(enforce, [agent("a1")], [...history("a1", 10, TOKENS_1000), current(6000)]);
    await terminal(h, "agent.run.finished", "cur", "a1");
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("pauses one token over six times the median", async () => {
    const h = await setup(enforce, [agent("a1")], [...history("a1", 10, TOKENS_1000), current(6001)]);
    await terminal(h, "agent.run.finished", "cur", "a1");
    expect(await statusOf(h, "a1")).toBe("paused");
    expect((await digests(h))[0]).toContain("Rule T: run used 6001 tokens, more than 6 times the median of 1000");
  });

  it("checks a failed run as well as a finished run", async () => {
    const h = await setup(enforce, [agent("a1")], [...history("a1", 10, TOKENS_1000), current(9000)]);
    await terminal(h, "agent.run.failed", "cur", "a1");
    expect(await statusOf(h, "a1")).toBe("paused");
  });

  it("does not pause without a baseline of five runs", async () => {
    const h = await setup(enforce, [agent("a1")], [...history("a1", 4, TOKENS_1000), current(1_000_000)]);
    await terminal(h, "agent.run.finished", "cur", "a1");
    expect(await statusOf(h, "a1")).toBe("idle");
  });

  it("only reports at 6001 tokens in dry-run mode", async () => {
    const h = await setup(dryRun, [agent("a1")], [...history("a1", 10, TOKENS_1000), current(6001)]);
    await terminal(h, "agent.run.finished", "cur", "a1");
    expect(await statusOf(h, "a1")).toBe("idle");
    expect((await digests(h))[0]).toContain("would pause (dry-run)");
  });

  it("reads the settings of the company that the finished run belongs to", async () => {
    const h = await setup(enforce, [{ ...agent("a1"), companyId: OTHER_COMPANY }], [...history("a1", 10, TOKENS_1000), current(6001)]);
    const getConfig = vi.spyOn(h.ctx.config, "get");
    await h.emit("agent.run.finished", { runId: "cur", agentId: "a1", issueId: TASK, status: "succeeded" }, { companyId: OTHER_COMPANY, occurredAt: new Date(T0).toISOString() });
    expect(getConfig).toHaveBeenCalledWith(OTHER_COMPANY);
  });
});

describe("pausing and resuming", () => {
  it("never resumes an agent it paused", async () => {
    const h = await setup(enforce, [agent("a1")]);
    const resume = vi.spyOn(h.ctx.agents, "resume");
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("paused");
    await start(h, "later", "a1", TASK, 120);
    expect(resume).not.toHaveBeenCalled();
  });

  it("does not resume or pause an agent the Board paused", async () => {
    const h = await setup(enforce, [agent("a1", "paused")]);
    const pause = vi.spyOn(h.ctx.agents, "pause");
    const resume = vi.spyOn(h.ctx.agents, "resume");
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(pause).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(await statusOf(h, "a1")).toBe("paused");
  });

  it("reports a failed pause and keeps the agent running", async () => {
    const h = await setup(enforce, [agent("a1")]);
    h.ctx.agents.pause = async () => {
      throw new Error("boom");
    };
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0);
    expect(await statusOf(h, "a1")).toBe("idle");
    expect((await digests(h))[0]).toContain("pause failed");
  });
});

describe("company context", () => {
  it("passes the event's companyId to config.get and to the pause", async () => {
    const h = await setup(enforce, [{ ...agent("a1"), companyId: OTHER_COMPANY }]);
    const getConfig = vi.spyOn(h.ctx.config, "get");
    const pause = vi.spyOn(h.ctx.agents, "pause");
    for (let i = 0; i < 13; i += 1) await start(h, `r${i}`, "a1", TASK, 0, OTHER_COMPANY);
    expect(getConfig).toHaveBeenCalledWith(OTHER_COMPANY);
    expect(pause).toHaveBeenCalledWith("a1", OTHER_COMPANY);
  });
});
