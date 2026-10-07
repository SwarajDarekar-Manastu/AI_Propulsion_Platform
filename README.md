# AI Propulsion Platform

This repository holds the engineering work for the AI Propulsion Platform. Agents and people change it through reviewed pull requests. Only the Release Manager merges to `main`, after the Board approves.

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
