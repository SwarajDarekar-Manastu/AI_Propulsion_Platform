import esbuild from "esbuild";
import { createPluginBundlerPresets } from "@paperclipai/plugin-sdk/bundlers";

const presets = createPluginBundlerPresets();

for (const options of [presets.esbuild.worker, presets.esbuild.manifest]) {
  await esbuild.build(options);
}
