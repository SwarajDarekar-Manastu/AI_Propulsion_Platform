# Subscription Pacing

A Paperclip plugin

## Development

```bash
pnpm install
pnpm dev            # watch builds
pnpm dev:ui         # local dev server with hot-reload events
pnpm test
```

`pnpm dev` rebuilds the worker, manifest, and UI bundles into `dist/`.
When this package is installed from a local path, Paperclip watches that rebuilt
output and reloads the plugin worker. Local installs run trusted code from this
folder on your machine.

This scaffold snapshots `@paperclipai/plugin-sdk` and `@paperclipai/shared` from a local Paperclip checkout at:

`/tmp/paperclip-run-sdea-5-d8a68159-0e9-NR7GlL/fake/packages/plugins/sdk`

The packed tarballs live in `.paperclip-sdk/` for local development. Before publishing this plugin, switch those dependencies to published package versions once they are available on npm.



## Install Into Paperclip

```bash
paperclipai plugin install /home/paperclip/.paperclip/instances/default/projects/9d954aa9-9027-469a-8bd1-3aa1b4b96a10/ae31c168-bc57-4305-9eae-9b004ce204f4/AI_Propulsion_Platform/.paperclip/worktrees/SDEA-4-build-the-subscription-pacing-plugin-and-typescript-ci/plugins/subscription-pacing
```

## Build Options

- `pnpm build` uses esbuild presets from `@paperclipai/plugin-sdk/bundlers`.
- `pnpm build:rollup` uses rollup presets from the same SDK.
