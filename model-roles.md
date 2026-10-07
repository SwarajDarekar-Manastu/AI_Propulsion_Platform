# Model roles

This table replaces the per-role model rule that pstack wrote into Cursor. Skills in `.claude/skills/` refer to its rows by name, for example "the `how explorer` row". Only Claude models are available: `opus`, `sonnet`, `haiku`, or `inherit` (the caller's own model). Effort is the Claude Code effort level: `low`, `medium`, `high`, `xhigh`, or `max`.

To change a model, edit the row here and the matching `model:` or `effort:` line in the subagent file named in "Runs as". Keep the two in step. `scripts/check-kit.sh` checks that every subagent file names an allowed model.

| Seat or role | Kind | Model | Effort | Runs as | Notes |
|---|---|---|---|---|---|
| CEO | Paperclip agent | `opus` | `high` | `agents/ceo` | Added last (Phase 3). Never writes code. |
| CTO | Paperclip agent | `opus` | `high` | `agents/cto` | Gate. Triage, task split, execution policy, 3-round retry cap. |
| Senior Developer | Paperclip agent | `opus` | `high` | `agents/senior-developer` | Gate. Plan and code review stages. |
| Developer (x2 to 3) | Paperclip agent | `sonnet` | `medium` | `agents/developer-1`, `agents/developer-2` | Code and tests in an isolated worktree. Opens PRs. |
| Validation Engineer | Paperclip agent | `opus` | `high` | `agents/validation-engineer` | Gate. Lead judge for `interrogate`. |
| QA Engineer | Paperclip agent | `sonnet` | `medium` | `agents/qa-engineer` | Gate. Benchmarks against the last accepted baseline. |
| UI and CLI Verification Engineer | Paperclip agent | `sonnet`, `opus` for hard repros | `medium` (`high` on `opus`) | `agents/ui-and-cli-verification-engineer` | Gate. VERIFIED / NOT VERIFIED / INCONCLUSIVE. |
| Verification Harness Associate | Paperclip agent | `sonnet` | `medium` | `agents/verification-harness-associate` | Weekly routine. Edits only the verify skill folder. |
| Developer Experience Associate | Paperclip agent | `opus` | `high` | `agents/developer-experience-associate` | Fortnightly routine. Board approves every skill edit. |
| Release Manager | Paperclip agent | `sonnet` | `medium` | `agents/release-manager` | The only agent with merge rights. |
| Network and Observability Engineer | Paperclip agent | `sonnet` | `medium` | `agents/network-and-observability-engineer` | GlitchTip alert and post-deploy routines. Never paused by pacing. |
| Aerospace Domain Engineer | Paperclip agent | `opus` | `high` | `agents/aerospace-domain-engineer` | Gate. On call to the CTO. Timer off. |
| Adversarial Reviewer | Paperclip agent | ON HOLD | n/a | `on-hold/adversarial-reviewer` | Needs a non-Claude adapter. Do not hire while the department is Claude-only. |
| judgment and prose | skill seat | `opus` | `high` | the agent itself, or `department-agent` with model `opus` | Prose, PR bodies, judgment calls. |
| hardest tasks | skill seat | `opus` | `high` | `department-agent` with model `opus` | Cross-cutting design, gnarly concurrency, subtle algorithms. |
| feature, refactoring | code delegate | `inherit` | `high` | `department-agent` | The Developer's code delegate. On a Developer this is `sonnet`. |
| bug-fix | code delegate | `inherit` | `high` | `department-agent` | Same as above. |
| perf-issue | code delegate | `inherit` | `high` | `department-agent` | Same as above. |
| mechanical edits | code delegate | `sonnet` | `low` | `department-agent` with model `sonnet` | Trivial, fully specified edits. |
| how explorer | skill seat | `sonnet` | `medium` | `how-explorer` | Read-only. 2 to 4 per complex question. |
| how explainer | skill seat | `opus` | `high` | `opus-reviewer` | Read-only. Writes the explanation. |
| why investigators | skill seat | `sonnet` | `medium` | built-in `general-purpose` with model `sonnet` | Needs MCP tools, so not a read-only subagent. One per evidence category. |
| why synthesizer | skill seat | `opus` | `high` | built-in `general-purpose` with model `opus` | Needs MCP tools to spot-check citations. |
| interrogate seat A, correctness and design | skill seat | `opus` | `high` | `opus-reviewer` | Read-only. Sees the diff and the whole repository. |
| interrogate seat B, tests and edge cases | skill seat | `sonnet` | `high` | `sonnet-reviewer` | Read-only. Sees the diff and the test files it touches only. |
| interrogate seat C, machine checks | skill seat | none | n/a | the lead's own shell | Type checker, linter, static analysis, mutation tests on changed lines, tests. |
| arena runners | skill seat | `opus`, `sonnet`, `sonnet` | `high` | `swarm-worker`, one per runner | Each runner in its own worktree. Run the `opus` runner with the model override below. |
| arena cross-judge pool | skill seat | `opus` or `sonnet` | `high` | `opus-reviewer` or `sonnet-reviewer` | Pick the model that differs from the parent's. |
| architect runners | skill seat | `opus`, `sonnet`, `sonnet` | `high` | `swarm-worker`, one per runner | Same rules as arena runners. |
| swarm workers | skill seat | `sonnet` | `medium` | `swarm-worker` | Own worktree, background. At most 20 at once per session. |
| reflect judgment | skill seat | `opus` | `high` | built-in `general-purpose` with model `opus` | Needs MCP tools. |
| reflect tooling | skill seat | `sonnet` | `high` | built-in `general-purpose` with model `sonnet` | The second seat. pstack ran this lens on a non-Claude model. |
| reflect divergent | skill seat | `opus` | `high` | built-in `general-purpose` with model `opus` | Needs MCP tools. |
| reflect synthesizer | skill seat | `opus` | `high` | built-in `general-purpose` with model `opus` | Needs MCP tools. |
| recall miners | skill seat | `haiku` | `low` | built-in `general-purpose` with model `haiku` | Cheap, parallel run-log mining. |
| trail reviewer | skill seat | the other model | `high` | `opus-reviewer` if the work ran on `sonnet`, `sonnet-reviewer` if it ran on `opus` | Cross-model review in `show-me-your-work`. |
| comment-sicko | skill seat | `sonnet` | `medium` | `comment-sicko` | Read-only. Spawned by `no-comments`. |
| verification source readers | skill seat | `sonnet` | `medium` | `how-explorer` | One per feature file in `maintain-verification-skill`. |
| department-agent default | subagent default | `inherit` | inherited | `department-agent` | Reads `department-mode` in full first. |

## Overriding a subagent's model

Each subagent file in `.claude/agents/` sets a default `model`. A seat that needs a different model on the same subagent (the `opus` arena runner on `swarm-worker`, the `opus` hardest-task delegate on `department-agent`) passes the model on the subagent call. If your Claude Code version does not accept a per-call model, add a copy of the subagent file under a new name with the other model (for example `swarm-worker-opus.md` with `name: swarm-worker-opus` and `model: opus`) and use that name.

## Effort for built-in subagents

The built-in `general-purpose` subagent has no file in this kit, so the Effort column is a target for it, not a setting. If a seat needs its effort enforced, add a project subagent file for it with the `effort` key set.

## Effort for Paperclip agents

The Effort column for Paperclip agents is set in `.paperclip.yaml` (`adapter.config.effort`), next to the model. Keep this table and that file in step; `scripts/check-kit.sh` compares them.

## Model diversity

pstack drew adversarial signal from three vendors (Claude, GPT, Grok). This department runs Claude only, so seats get diversity from different models (`opus` versus `sonnet`), different lenses, different views of the code, and deterministic machine checks. Treat agreement between two Claude seats as weaker evidence than pstack's cross-vendor agreement, which is why `interrogate` requires proof before acting on a finding.
