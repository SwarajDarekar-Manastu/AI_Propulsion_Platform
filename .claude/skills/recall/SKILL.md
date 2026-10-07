---
name: recall
description: "Reconstruct recent working context from Paperclip run logs and task history, live git state, and the shared record (user reports, prior fixes, incidents), then hand back a tight current-state brief. Use for 'recall my work on X', 'catch me up', 'what has the team done on X', 'where did we leave off', before starting or resuming work."
---

# Recall

**Before you start or resume work, you rebuild the user's recent working context and hand back a tight capsule of where things stand now and what to do next.**

Keep it tight and on-topic. Read only what the in-scope threads need, then stop.

Your context lives in two records. The department's own history holds what agents did and decided: Paperclip tasks and their comments and documents, and the run logs of each agent run. The shared record holds everything that happened around the same code under other names: the symptoms users keep reporting, the fixes that shipped and got reverted, the errors still firing in prod. That second record is what the **why** skill searches, across source control, the issue tracker, chat and issue channels, long-form docs, and error tracking. A feature with a long bug tail keeps most of its story there, so don't reconstruct it from run logs alone.

Run logs come from the Paperclip run logs API. `GET /api/companies/{companyId}/heartbeat-runs` lists the company's runs. `GET /api/heartbeat-runs/{runId}/events` and `GET /api/heartbeat-runs/{runId}/log` return one run's events and log. Save each log you need to a scratch file and hand the paths to subagents, so raw logs stay out of the main thread.

1. Classify, then route. Resuming one specific task is the session-pickup rule in **department-mode** (Pickup and pause), not this. Turning habits into a durable skill is the Developer Experience Associate's job through the **reflect** skill. A human-readable summary of your work is a different task. Recall loads working context across recent runs before you act. If the task already gives you a full state capsule (paths, branch, the change), use it and skip the mining.
2. Lock the scope before searching. Pin the window ("recent" is a real range, default the last 7 days), the topic if named, and the project (default the current company and repository. Never read another company's runs without being asked). State the scope back. Never quietly turn "all" into "recent N".
3. Fan out across the run history. Spawn parallel `general-purpose` subagents on the `recall miners` row of `model-roles.md` (`haiku`), each taking a slice of the runs, from your top-level session. Tell every subagent to order candidates by real run time, newest first, grep the topic first and then read only the matching runs and only their relevant regions, and skip the current run plus obvious noise (eval and test runs). Each returns the same schema, one block per run: topic, the task's goal, decisions, open threads, struggles and corrections, and artifacts (PRs, tasks, branches), each citing the run id. For one or two runs, skip the fan-out and search directly. The raw logs stay in the subagents. The main thread gets only their findings.
4. Sweep the shared record whenever the topic names a feature, file, subsystem, area, or bug. This is the default, not a judgment call, and "my work on X" does not exempt it. Hand it to the **why** skill's source investigators, but steer their question from "why was this built this way" to "what's the current state, what's been tried and didn't hold, and what are users still reporting". Reuse its per-source playbooks, run the investigators in parallel with the run-history mining, and inherit its posture: one investigator per source, null results are findings, skip an unavailable MCP and say so. Fold what comes back into the brief. Skip this step only for pure activity recall with no named target ("what did we do this week"), where the run history and live state are the entire answer.
5. Verify against live state. Take the PRs, branches, and tickets that the mining and the sweep surfaced and check them with `git` and `gh`. When the answer hinges on what an agent actually did (the tools it ran, files it read, errors it hit), read that run's full events and log through the API, not just a hand-off comment.
6. Write the brief to the contract below. Group by thread. Stay on the named topic.

## Output contract

Lead with the capsule, then the thread status, then the problems, then the next move. Deeper detail goes below or gets cut.

- **Capsule.** At most 5 bullets. What this work is and where it stands overall.
- **Threads.** One line each, prefixed with exactly one status tag: `[merged #N]`, `[open PR #N]`, `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or `[planned, not started]`. A thread with no tag is not done yet, so tag it.
- **Problems.** At most 5, the recurring ones. Include the symptoms users keep reporting and any fix that shipped and was reverted, so the next attempt starts where the last one failed.
- **Next move.** The single most useful next action, concrete.

An adjacent feature or ticket stays out unless it blocks this one. When the capsule and thread lines outgrow a screen, cut detail before you cut threads. Write the brief through the **unslop** skill, cite run-history findings by run id and shared-record findings by their source (PR #, ticket ID, chat permalink, error-tracker issue), and sanitize private context before any public output.

**Reply:** the brief, to the contract above.
