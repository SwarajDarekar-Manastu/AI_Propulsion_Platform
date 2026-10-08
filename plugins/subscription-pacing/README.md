# subscription-pacing

A Paperclip plugin that keeps agents inside the subscription plan. Every 15 minutes it estimates each agent's share of the plan from token usage, pauses agents that run ahead of pace, resumes the ones it paused when their window resets, and posts a digest to a Board issue.

## Install

The Board installs this plugin. Build it first.

```bash
pnpm install --frozen-lockfile
pnpm build
paperclipai plugin install <path to this directory>
```

## Settings

Set these in the plugin settings. Only `companyId` and the two ratios are required before the plugin acts.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode` | `dry-run` | `off`, `dry-run` (estimate and report only), or `enforce` (pause and resume). |
| `companyId` | unset | Company to pace. Unset means the job does nothing. |
| `opusPctPerMillion` | unset | Percent of the weekly plan allowance per million Opus tokens. |
| `sonnetPctPerMillion` | unset | Same for Sonnet and every other non-Opus model. |
| `digestIssueId` | unset | Board issue that receives the digest. Unset logs the digest only. |
| `sessionHours` | 5 | Rolling session window. |
| `sessionAllowancePctOfWeek` | 15 | Percent of the weekly allowance one session may use. |
| `sessionPauseAtPct` | 80 | Rule 1 threshold. |
| `weeklyPaceLeadPts` | 10 | Rule 2 threshold. |
| `agentWeeklySharePct` | 100 / agent count | Rule 3 threshold. |
| `maxOpusSharePct` | 60 | Rule 4 threshold. |
| `opusRuleMinWeekPct` | 5 | Rule 4 applies only above this weekly estimate. |
| `cancelledRunAllowanceTokens` | 100000 | See the usage gap below. |
| `maxPausesPerRun` | 2 | Cap on pauses in one run. |
| `exemptAgentIds` | none | Agents never paused. |
| `weekResetAnchor` | Monday 00:00 UTC | Any past instant at which the plan week reset. |
| `digestIntervalHours` | 6 | A digest posts at least this often, and at once when the job paused or resumed an agent. |

The worker applies these defaults itself. It does not rely on the SDK to apply schema defaults.

## Rules

Session estimate = tokens in the session window, converted with the ratios, divided by `sessionAllowancePctOfWeek`. Weekly estimate = tokens since the week reset, converted with the ratios. Tokens are `input_tokens + output_tokens` from `cost_events`.

1. Pause when the session estimate reaches `sessionPauseAtPct`.
2. Pause when the weekly estimate is more than `weeklyPaceLeadPts` ahead of the share of the week that has elapsed.
3. Pause when the weekly estimate is above the agent's weekly share.
4. Pause when Opus is more than `maxOpusSharePct` of the agent's weekly estimate.

Resume an agent when it is paused, the plugin paused it, and no rule fires any more.

## Safety

- An unset, zero, negative, or non-numeric ratio disables every rule. No estimate means no pause.
- The default mode is `dry-run`. Pausing needs `mode: enforce`.
- A run pauses at most `maxPausesPerRun` agents, highest weekly estimate first. The rest show as `deferred` in the digest.
- The plugin keeps the agents it paused in plugin state and resumes only those. It drops an entry when the agent is no longer paused or its pause reason is `budget`, `company_archived`, or `import`.
- Unverified: the plugin cannot tell its own pause from a Board pause with reason `manual` after it has paused the same agent. It treats `manual`, `system`, and empty reasons as its own.

## Token source and the cancelled-run gap

Usage comes from `cost_events` through `ctx.db.query` (`database.namespace.read`). The table carries the model, so Opus and Sonnet are separated. The costs REST API would need `http.outbound` and a token that a worker may not have.

A run that is cancelled (for example `issue_reassigned`) has no `usage_json` and no `cost_events` rows, so its tokens are invisible. The plugin counts `cancelled` runs in `heartbeat_runs` that have no usage record and no cost events, and charges each `cancelledRunAllowanceTokens` at the Sonnet ratio. The digest reports the count. The allowance is a guess until the Board calibrates it.

## Capabilities

`agents.read`, `agents.pause`, `agents.resume`, `jobs.schedule`, `issue.comments.create`, `plugin.state.read`, `plugin.state.write`, `database.namespace.read`, `database.namespace.write`, `database.namespace.migrate`.

The database declaration forces the migrate capability and `migrationsDir`. The migration creates `pacing_events`, an audit row for each pause and resume.

## Develop

```bash
pnpm typecheck
pnpm lint
pnpm test
```

Scaffolded with:

```bash
paperclipai plugin init subscription-pacing --template default --output ./plugins --sdk-path <unpacked sdk repo layout>/packages/plugins/sdk
```
