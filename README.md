# AI Propulsion Platform

This repository holds the engineering work for the AI Propulsion Platform. Agents and people change it through reviewed pull requests. Only the Release Manager merges to `main`, after the Board approves.

## How code reaches main

Work reaches `main` in four steps:

1. Each task gets its own branch from `release` and one draft PR against `release`.
2. Reviews follow the task's risk tier: Light goes to the Senior Developer; Standard adds the Validation Engineer; Heavy adds QA and specialists. The Board then approves in Paperclip.
3. After the Board approves, the Release Manager lands the PR into `release` with a squash merge.
4. Only the Board merges `release` into `main`.

## `.claude/`

`.claude/` holds the department's shared tooling:

- `.claude/skills/`: shared skills. Each skill is a folder with a `SKILL.md`.
- `.claude/agents/`: subagent definitions.

## Check the kit

Run the kit check from the repository root:

```bash
scripts/check-kit.sh [kit-or-repo-root]
```

The argument is optional. The default is the directory above the script.

The script checks skill frontmatter, subagent files, and the references that skills and roles make to each other. The header of `scripts/check-kit.sh` lists every check.

It exits non-zero when any check fails.
