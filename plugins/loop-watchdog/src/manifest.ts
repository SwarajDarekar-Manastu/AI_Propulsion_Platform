import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import { instanceConfigSchema } from "./settings.js";

const manifest: PaperclipPluginManifestV1 = {
  id: "loop-watchdog",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Loop Watchdog",
  description: "Pauses an agent that starts too many runs on one task, or whose run uses far more tokens than its own norm.",
  author: "Manastu Space",
  categories: ["automation"],
  capabilities: [
    "agents.read",
    "agents.pause",
    "events.subscribe",
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
    coreReadTables: ["heartbeat_runs"],
  },
  instanceConfigSchema,
};

export default manifest;
