import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";
import { JOB_KEY } from "./manifest.js";
import { postDigest, runPacing } from "./pacing.js";

const plugin = definePlugin({
  async setup(ctx) {
    ctx.jobs.register(JOB_KEY, async () => {
      const result = await runPacing(ctx, new Date());
      if (result !== null) await postDigest(ctx, result);
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
