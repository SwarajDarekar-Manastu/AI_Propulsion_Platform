### Opening a PR

Invoked at the end of every other playbook. Opening a PR is the top-level agent's job, never a delegate's, because `/no-comments` spawns a subagent and delegates cannot.

**Worktree.** Paperclip already runs you in a git worktree. Branch from main inside it. Subagents inherit it. Several subagents writing to the same branch each get their own worktree (the `swarm-worker` subagent runs with `isolation: worktree`), or run `git fetch && git reset --hard origin/<branch>` between them. Dirty branch with unrelated work: patch out, fresh worktree, apply. Snarled worktree: reset from main, redo minimally.

**Commits.** Commit liberally. Rebase into small, ordered commits before opening PRs. Each commit is a future PR: landable, ordered to tell the story. Amend when the fix belongs in a just-made commit. New commit when separable.

**PRs.** Run `/unslop` over the prose in the diff and `/no-comments` over its comments before commit. Run `/no-comments` again before review if the diff changed. Write every PR title, PR description, and commit body with `/technical-writing`, then apply `/unslop`. Apply every technical-writing layer except Diátaxis. Use one word for each action, keep articles, and avoid `-ing` when a plain verb works.

**Titles.** Use Conventional Commits in the form `type(scope): subject`. Use `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, or `perf` as the type. Use the changed area, such as `api` or `department-mode`, as the scope. Keep the subject short and imperative. Name a real symbol when one carries the change. For example, `fix(api): reject empty thrust table in parseRun`. Do not add a trailing period.

**Descriptions.** The PR body is a briefing, not the lab notebook. A reviewer who has the diff should learn why the change exists, what it leaves out, what it could break, and how you proved it works, in under a minute. Write short, simple sentences with few identifiers. Do not write walls of text. The squash commit body is the PR body. If the body would make the squash commit longer than about 40 lines, cut the body.

Put each section under a `##` heading, not a bold lead-in, so the sections stand apart. Use these sections in order. Drop a section when it has nothing to say.

- `## Why` gives the problem and the approach in one to three short sentences. Do not list SHAs or rebase genealogy. Do not add a "based on main" preamble.
- `## What changed` has one to three short bullets. Name a real symbol or path only when it carries the change. Name both sides of a rename or retarget.
- `## Scope` always names what the PR covers and what it deliberately leaves out, for example a related follow-up or a known gap. Use one to three short items. Do not list symbols or paths, and do not write a file-by-file essay.
- `## Tradeoffs` names only rejected alternatives that a reviewer would otherwise ask about. Skip this section when there was no real choice.
- `## Blast Radius` gives one or two sentences on who or what the change touches and why that is safe or risky. If main is red, state the cost of leaving it red.
- `## Verification` has one to three bullets. Each bullet names a real run path and its outcome. For a performance change, report one primary number with its unit in `before → after` form. Link the arena or swarm directory for the remaining evidence. Do not include sample-size methodology, swarm recitals, or metric tables.

After these sections, attach videos or screenshots when they prove a claim. Do not paste full SHAs, swarm or arena lane recitals, lever-correction essays, file-by-file checklists, or "CLEAN" verdicts. Put these details in a linked artifact. A commit body does not restate its subject.

**Forge.** Use the GitHub CLI (`gh`) for create, edit, view, and checks. Do not require Graphite (`gt`). Never run `gh pr merge`. Merging belongs to the Release Manager.

**Built-in PR tool.** When the run provides a built-in PR tool, create, edit, retarget, and mark ready through it, never through a forge CLI. Its own instructions say how. A PR made with the CLI misses what the tool tracks, such as a description later runs can edit. Use `gh` for everything the tool does not cover, and for every PR operation when the run has no such tool.

**Size and stacks.** Prefer five narrow PRs to one large PR. A stack is a base-branch chain. The root PR targets trunk. Each child branch rebases onto its parent's exact tip and its PR targets the parent branch. Without a built-in PR tool, create a child with `gh pr create --base <parent-branch>`, and retarget an existing child with `gh pr edit <pr> --base <parent-branch>`. Only the CTO changes the topology of a shared stack (rebases and retargets of branches other agents build on). You push only your own branch. Branch from trunk only for independent work. Rebase on trunk before substantial stack work.

**Readiness.** Open every PR ready, never as a draft. A built-in PR tool can default to draft, so set `draft: false` on every creation call through it. With `gh`, omit `--draft`. If a PR still opens as a draft, mark it ready through the PR tool or run `gh pr ready <number>`. Run `gh pr view <number>` before you refer to PR status.

**After opening.** Opening a PR does not start a babysit, and you never merge it. Post the URL on the task, then move the task to its next review stage per its execution policy (Senior Developer code review, then Validation Engineer, QA Engineer, and UI and CLI Verification Engineer as the policy names). Keep building the rest of the phase or stack meanwhile. CI failures, review comments, and conflicts that arrive later wake the Release Manager, who routes fixes back to the owning branch. Push back when feedback drifts from intent.

A delegate subagent that finishes code returns to its parent with the branch and its evidence. The parent runs `/unslop` and `/no-comments`, opens the PR, and posts the URL. Adversarial review with `interrogate` runs at the Validation Engineer's review stage, not before the PR opens, unless the design is contested (Feature step 7).
