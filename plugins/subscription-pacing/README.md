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
| `mode` | `dry-run` | `off`, `dry-run` (estimate and report; never pauses, but still resumes agents the plugin paused once their reasons end), or `enforce` (pause and resume). `off` stops the job entirely, so agents the plugin paused stay paused until the Board resumes them. |
| `companyId` | unset | Company to pace. Unset means the job does nothing. |
| `opusPctPerMillion` | unset | Percent of the weekly plan allowance per million Opus tokens. |
| `sonnetPctPerMillion` | unset | Same for Sonnet and every other non-Opus model. |
| `digestIssueId` | unset | Board issue that receives the digest. Unset logs the digest only. |
| `sessionHours` | 5 | Rolling session window. |
| `sessionAllowancePctOfWeek` | 15 | Percent of the weekly allowance one session may use. |
| `sessionPauseAtPct` | 80 | Rule 1 threshold. |
| `weeklyPaceLeadPts` | 10 | Rule 2 threshold. |
| `agentWeeklySharePct` | 100 / agent count | Rule 3 threshold. |
| `maxOpusSharePct` | unset | Rule 4 threshold on the plan's Opus share. Unset turns rule 4 off. Six of the 12 seats run on Opus, so pick a limit above the department's normal mix, using the plan totals line in the digest. |
| `opusRuleMinWeekPct` | 5 | Rule 4 applies only once the plan's weekly estimate is at least this percent. |
| `cancelledRunAllowanceTokens` | 100000 | See the usage gap below. |
| `maxPausesPerRun` | 2 | Cap on pauses in one run. |
| `exemptAgentIds` | none | Agents never paused. |
| `weekResetAnchor` | Monday 00:00 UTC | Any past instant at which the plan week reset. |
| `digestIntervalHours` | 6 | A digest posts at least this often, and at once when the job paused or resumed an agent. |

The worker applies these defaults itself. It does not rely on the SDK to apply schema defaults.

## Rules

Session estimate = tokens in the session window, converted with the ratios, divided by `sessionAllowancePctOfWeek`. Weekly estimate = tokens since the week reset, converted with the ratios. Tokens are `input_tokens + output_tokens` from `cost_events`.

Rules 1, 2 and 4 measure the whole plan: the job sums the estimate over every agent. When one fires, the job pauses the non-exempt agents that use the most of that measure (session, week, or Opus), highest first, at most `maxPausesPerRun`. The next run checks again. Only rule 3 judges one agent on its own.

1. Plan session estimate reaches `sessionPauseAtPct`.
2. Plan weekly estimate is more than `weeklyPaceLeadPts` ahead of the share of the week that has elapsed.
3. An agent's weekly estimate is above its weekly share.
4. Opus is more than `maxOpusSharePct` of the plan's weekly estimate (applies once the plan estimate is at least `opusRuleMinWeekPct`).

Tokens of paused agents still count toward the plan, so a plan rule stays fired after the pauses. While the plugin holds an agent paused for a plan rule (session, pace or Opus) and that rule's reason is still in force, that rule orders no new pauses. A reason that has ended is dropped from the stored pause, so a later breach is handled as a new one. One breach pauses one batch of at most `maxPausesPerRun` agents. Rule 3 is per agent and is unaffected. Put reviewers and other agents you never want paused in `exemptAgentIds`. The Network and Observability Engineer must be there (`model-roles.md`: never paused by pacing).

## Resume

The plugin resumes an agent only when it paused that agent and the windows of the rules that paused it have reset. A session pause ends `sessionHours` after the pause. A rule 3 pause ends when the next plan week starts. A pace pause ends when the plan's lead is back at or under `weeklyPaceLeadPts`. An Opus pause ends when the plan's Opus share is at or under `maxOpusSharePct`, the plan's weekly estimate is under `opusRuleMinWeekPct`, or the limit is unset. A pause with several reasons ends when every reason has ended. A pause is the plugin's own only while the agent is paused with the same `pausedAt` that `agents.pause` returned. If the Board resumes and pauses the agent again, `pausedAt` changes and the plugin lets go of it. If the Board resumes an agent that is still over its weekly share, rule 3 pauses it again on the next run. To keep it running, add its ID to `exemptAgentIds`.

## Safety

- An unset, zero, negative, or non-numeric ratio disables every rule. No estimate means no pause.
- The default mode is `dry-run`. Pausing needs `mode: enforce`.
- A run pauses at most `maxPausesPerRun` agents, highest weekly estimate first. The rest show as `deferred` in the digest.
- The plugin keeps `agentId -> pausedAt, violations` in plugin state and resumes only those entries.
- If `agents.pause` succeeds but the state write fails, the agent stays paused and the plugin will not resume it. The Board resumes it by hand.
- If the pause response has no `pausedAt`, the plugin does not record the pause and never resumes that agent.

## Token source and the cancelled-run gap

Usage comes from `cost_events` through `ctx.db.query` (`database.namespace.read`). The table carries the model, so Opus and Sonnet are separated. The costs REST API would need `http.outbound` and a token that a worker may not have.

A run that is cancelled (for example `issue_reassigned`) has no `usage_json` and no `cost_events` rows, so its tokens are invisible. The plugin counts `cancelled` runs in `heartbeat_runs` that started (`started_at` is set) and have no usage record and no cost events. Runs cancelled before they started, such as a queue cleared by a pause, are not charged, and charges each `cancelledRunAllowanceTokens` at the Sonnet ratio. The digest reports the count. The allowance is a guess until the Board calibrates it.

## Capabilities

`agents.read`, `agents.pause`, `agents.resume`, `jobs.schedule`, `issue.comments.create`, `plugin.state.read`, `plugin.state.write`, `database.namespace.read`, `database.namespace.migrate`.

The database declaration forces the migrate capability and `migrationsDir`. `migrations/` holds only `.gitkeep`. The host rejects a `SELECT 1` migration at install, and its loader reads only `*.sql` files, so the empty directory satisfies `migrationsDir`; the plugin owns no tables. The digest and the worker log record every action.

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
