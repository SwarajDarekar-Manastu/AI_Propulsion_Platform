# loop-watchdog

A Paperclip plugin that pauses an agent that loops. Paperclip has no mid-run circuit breaker, so this plugin watches run events and pauses the agent after the event that shows the loop. It never resumes an agent. The Board resumes it.

## Install

The Board installs this plugin. Build it first.

```bash
pnpm install --frozen-lockfile
pnpm build
paperclipai plugin install <path to this directory>
```

## Settings

Every setting has a safe default. The default `mode` is `dry-run`, so the plugin reports and never pauses until the Board sets `enforce`.

| Setting | Default | Meaning |
| --- | --- | --- |
| `mode` | `dry-run` | `off` ignores events. `dry-run` counts and reports, never pauses. `enforce` pauses. |
| `digestIssueId` | unset | Board issue that receives one comment per decision. Unset means the worker log only. |
| `maxWakesPerTask` | 12 | Rule W limit N. |
| `tokenMultiple` | 6 | Rule T limit K. |
| `tokenHistoryRuns` | 10 | Rule T window M. Recent runs with usage that form the median. |
| `minBaselineRuns` | 5 | Rule T needs this many runs with usage before it can pause. |
| `exemptAgentIds` | none | Agents never paused. |

The worker applies these defaults itself. It does not rely on the SDK to apply schema defaults.

## Rules

Both rules run on the event that ends or starts a run. Each pauses at most one agent per decision.

**Rule W, wakes on one task.** Each `agent.run.started` event with a task adds one wake for that agent and task. The rule fires when an agent has more than `maxWakesPerTask` wakes on one task in the last 60 minutes. The window is fixed at 60 minutes. Each agent's wakes live in its own state, under the `agent` scope. When Rule W reaches a decision, the agent's wakes for that task are cleared, so the count starts again from zero.

**Rule T, tokens against the agent's own median.** On `agent.run.finished` or `agent.run.failed`, the plugin reads the run's tokens, which are `inputTokens + cachedInputTokens + outputTokens` from `heartbeat_runs.usage_json`. It takes the median of the agent's last `tokenHistoryRuns` other runs with usage. The rule fires when the run's tokens are more than `tokenMultiple` times that median. It does not fire when the agent has fewer than `minBaselineRuns` runs with usage.

Every decision posts one comment to `digestIssueId` with the agent, the rule, the numbers, the task, and the outcome. A decision in `dry-run` says `would pause`.

## Defaults and why

- **N = 12 wakes per task per hour.** The busiest healthy pattern seen so far is 6 wakes by one Developer on one task in an hour (SDEA-5 review rounds). Reviewers reach 5. N = 12 is twice the busiest healthy count, so a healthy review round never pauses.
- **K = 6 times the median.** Tokens per run for one agent vary up to about 4.6 times the agent's median (Validation: median 0.73M, max 3.34M). K = 6 sits above that observed spread, so a normal heavy run does not pause.
- **M = 10 runs of history.** Ten runs give a median that one unusual run cannot move much.
- **Minimum 5 runs for a baseline.** The instance has 12 runs with usage in total. Five is the smallest count where a median means something. Until an agent has five, Rule T stays off for it.

## Decisions

**Which run events Rule W counts.** Rule W counts `agent.run.started`, one event for every run that begins, whatever its outcome. The alternatives miss loops. `agent.run.finished` fires only for succeeded runs, and on this instance 24 of 35 runs are `cancelled`. Counting the terminal events would miss every loop that cancels or fails, and it would count a run only after it ends, which is too late to stop the next wake. A run cancelled before it starts emits no event and uses no tokens, so the plugin does not see it. That is a known gap.

**Token source for Rule T.** The plugin reads `heartbeat_runs.usage_json` by run ID and the agent's recent runs, both through `ctx.db.query` on `heartbeat_runs`. The host emits `cost_event.created` but never sends it, so Rule T does not depend on it. The plugin subscribes to it anyway, and if it ever arrives with a `heartbeatRunId`, Rule T runs for that run. A run with no usage (cancelled, or not yet written when the event fires) is skipped. It is not in any baseline. If the usage row is not written yet when the terminal event fires, that run is skipped and the gap is silent.

**Whether the plugin resumes.** It never resumes. A loop resumed on a timer runs the same loop again with no one watching. The Board decides when the agent runs again. Because the plugin never resumes, an agent the Board paused stays paused, and the plugin never resumes an agent it did not pause.

**Where the digest goes.** Each decision posts a comment to `digestIssueId`. There is no periodic digest, so a quiet hour posts nothing. If the setting is unset, the decision goes to the worker log only.

**Company context.** Every host call passes the event's `companyId`: `ctx.config.get`, `ctx.agents.get`, `ctx.agents.pause`, `ctx.issues.createComment`, and the database queries.

**Clearing after a decision.** Clearing the wakes after a decision makes a Board resume hold. A loop that continues after a resume is paused again only after another `maxWakesPerTask + 1` starts. In `dry-run`, a loop of any length posts one digest per `maxWakesPerTask + 1` starts, not one per start. The clear also means a redelivered start for a run already counted before a decision counts once more. It cannot pause an agent by itself.

**Duplicate deliveries.** A redelivered `agent.run.started` with a run ID already in the agent's wake state counts once.

## Capabilities

`agents.read`, `agents.pause`, `events.subscribe`, `issue.comments.create`, `plugin.state.read`, `plugin.state.write`, `database.namespace.read`, `database.namespace.migrate`.

`database.namespace.read` reads `heartbeat_runs` through `coreReadTables`. The plugin owns no tables. `migrations/` holds only `.gitkeep`, so the host accepts an empty `migrationsDir`. The plugin has no scheduled job, because every decision comes from a run event.

## Develop

```bash
pnpm typecheck
pnpm lint
pnpm test
```
