import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { instanceConfigSchema } from "./settings.js";

export const JOB_KEY = "pace-agents";

const manifest: PaperclipPluginManifestV1 = {
  id: "subscription-pacing",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Subscription Pacing",
  description: "Estimates each agent's share of the subscription plan from token usage, pauses agents that run ahead of pace, and resumes them when their window resets.",
  author: "Manastu Space",
  categories: ["automation"],
  capabilities: [
    "agents.read",
    "agents.pause",
    "agents.resume",
    "jobs.schedule",
    "database.namespace.migrate",
    "database.namespace.read",
    "issue.comments.create",
    "plugin.state.read",
    "plugin.state.write",
  ],
  entrypoints: {
    worker: "./dist/worker.js",
  },
  database: {
    migrationsDir: "migrations",
    coreReadTables: ["cost_events", "heartbeat_runs"],
  },
  jobs: [
    {
      jobKey: JOB_KEY,
      displayName: "Pace agents",
      description: "Estimate usage, pause and resume agents, post the digest.",
      schedule: "*/15 * * * *",
    },
  ],
  instanceConfigSchema,
};

export default manifest;
