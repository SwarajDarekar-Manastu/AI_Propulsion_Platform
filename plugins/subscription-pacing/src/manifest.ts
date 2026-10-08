import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const manifest: PaperclipPluginManifestV1 = {
  id: "subscription-pacing",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Subscription Pacing",
  description: "A Paperclip plugin",
  author: "Plugin Author",
  categories: ["connector"],
  capabilities: [
    "events.subscribe",
    "plugin.state.read",
    "plugin.state.write"
  ],
  entrypoints: {
    worker: "./dist/worker.js"
  }
};

export default manifest;
