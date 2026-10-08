import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { onCostEvent, onRunStarted, onRunTerminal } from "./watchdog.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.events.on("agent.run.started", (event) => onRunStarted(ctx, event));
    ctx.events.on("agent.run.finished", (event) => onRunTerminal(ctx, event));
    ctx.events.on("agent.run.failed", (event) => onRunTerminal(ctx, event));
    ctx.events.on("cost_event.created", (event) => onCostEvent(ctx, event));
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
