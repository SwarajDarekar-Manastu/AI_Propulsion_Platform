import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import { JOB_KEY } from "./manifest.js";
import { postDigest, runPacing } from "./pacing.js";
import { resolveSettings } from "./settings.js";

async function storedConfig(ctx: PluginContext, companyId: string): Promise<Record<string, unknown> | null> {
  try {
    return await ctx.config.get(companyId);
  } catch (error) {
    ctx.logger.info("No stored pacing config for company; skipped", { companyId, error: String(error) });
    return null;
  }
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.jobs.register(JOB_KEY, async () => {
      const now = new Date();
      for (const company of await ctx.companies.list()) {
        const config = await storedConfig(ctx, company.id);
        if (config === null) continue;
        const result = await runPacing(ctx, company.id, resolveSettings(config), now);
        if (result !== null) await postDigest(ctx, result);
      }
    });
  },

  async onHealth() {
    return { status: "ok", message: "Plugin worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
