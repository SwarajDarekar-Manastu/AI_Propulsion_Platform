#!/usr/bin/env bash
# Validate the department kit. Exits non-zero when any check fails.
#
# Usage: scripts/check-kit.sh [kit-or-repo-root]   (default: the directory above this script)
#
# Checks:
#   1. Every .claude/skills/*/SKILL.md has YAML frontmatter with name and description,
#      and the name matches its folder.
#   2. No `disable-model-invocation` anywhere under .claude/ (unattended agents must see every skill).
#   3. No Cursor-only leftovers in .claude/, agents/, on-hold/, or model-roles.md. README.md and scripts/
#      are not scanned, because they document the port and these very patterns.
#      A line naming cursor-team-kit passes only when it also says "ported from".
#   4. Every skill a role lists under "## Skills" exists, unless the line marks it as a
#      (project skill), (company skill), or (Anthropic skill). Every **principle-*** reference
#      under .claude/ names an existing skill.
#   5. Every references/, playbooks/, or scripts/ path a skill mentions resolves.
#   6. Every "`<seat>` row" a skill or role mentions has a row in model-roles.md.
#   7. Subagent files: name matches the file, description present, model is opus, sonnet,
#      haiku, or inherit, read-only agents carry no write tools, swarm-worker is isolated.
#   8. Employee templates (agents/<slug>/): AGENTS.md, HEARTBEAT.md and COLLABORATION.md, SOUL.md
#      exactly where the design puts one; every AGENTS.md carries the department rules and an
#      "## Ask me for" section; every COLLABORATION.md is a copy of templates/collaboration.md;
#      developer-2 differs from developer-1 only by its name. Skipped when agents/ is absent, so the
#      script also runs over a product repo that carries only the shared skills.
#   9. Skill tiers (kit only, needs skills-shared.txt and agents/): every shared skill exists; a
#      (shared) bullet names a shared skill and an unmarked bullet names a held one; every held
#      skill has at least one holder.
#  10. Import metadata (kit only): each AGENTS.md frontmatter has name, title, reportsTo and a
#      skills list equal to its unmarked kit-skill bullets; reportsTo names another template or
#      null; .paperclip.yaml has an entry per template with type claude_local, engine cli, a model
#      and effort matching model-roles.md, and maxDailyRuns.
#  11. Import package (kit only): scripts/build-import-package.sh builds into a temporary folder,
#      and the package holds exactly the held skills, all as .md files.
set -uo pipefail

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ROOT="$(cd "$ROOT" && pwd)" || { echo "check-kit: no such directory: $1" >&2; exit 2; }
SKILLS="$ROOT/.claude/skills"
AGENTS="$ROOT/.claude/agents"
ROLES="$ROOT/agents"
ONHOLD="$ROOT/on-hold"
MODEL_ROLES="$ROOT/model-roles.md"

failures=0
fail() { printf 'FAIL %s\n' "$*"; failures=$((failures + 1)); }

frontmatter() { # prints the frontmatter body; exit 1 when missing or unclosed
	awk 'NR == 1 { if ($0 !~ /^---[ \t]*$/) { bad = 1; exit } next }
	     /^---[ \t]*$/ { closed = 1; exit }
	     { print }
	     END { if (bad || !closed) exit 1 }' "$1"
}
field() { # <file> <key>
	frontmatter "$1" 2>/dev/null | sed -n "s/^$2:[[:space:]]*//p" | head -n 1 | sed 's/^"\(.*\)"$/\1/'
}

[ -d "$SKILLS" ] || { echo "check-kit: no .claude/skills under $ROOT" >&2; exit 2; }

# 1. Skill frontmatter.
skill_count=0
for dir in "$SKILLS"/*/; do
	dir="${dir%/}"
	name="$(basename "$dir")"
	f="$dir/SKILL.md"
	skill_count=$((skill_count + 1))
	if [ ! -f "$f" ]; then fail "skill $name has no SKILL.md"; continue; fi
	if ! frontmatter "$f" >/dev/null; then fail "$f: missing or unclosed YAML frontmatter"; continue; fi
	n="$(field "$f" name)"
	d="$(field "$f" description)"
	[ -n "$n" ] || fail "$f: frontmatter has no name"
	[ -n "$d" ] || fail "$f: frontmatter has no description"
	[ -z "$n" ] || [ "$n" = "$name" ] || fail "$f: name '$n' does not match folder '$name'"
	[ -z "$n" ] || printf '%s' "$n" | grep -Eq '^[a-z0-9-]+$' || fail "$f: name '$n' is not lowercase-hyphenated"
done

# 2. disable-model-invocation.
if [ -d "$ROOT/.claude" ]; then
	while IFS= read -r hit; do fail "hidden from agents: $hit"; done < <(grep -rn 'disable-model-invocation' "$ROOT/.claude" 2>/dev/null)
fi

# 3. Cursor-only leftovers.
scan=()
[ -d "$ROOT/.claude" ] && scan+=("$ROOT/.claude")
[ -d "$ROLES" ] && scan+=("$ROLES")
[ -d "$ONHOLD" ] && scan+=("$ONHOLD")
[ -f "$MODEL_ROLES" ] && scan+=("$MODEL_ROLES")
forbidden=(
	'.cursor/'
	'pstack-models.mdc'
	'grok-'
	'gpt-5'
	'claude-opus-5-5-max'
	'subagent_type: "poteto-agent"'
	'poteto-agent'
	'poteto-mode'
	'environment: "cloud"'
	'readonly: true'
	'AskQuestion'
	'setup-pstack'
	'create-skill'
	'deslop'
)
for pat in "${forbidden[@]}"; do
	while IFS= read -r hit; do fail "Cursor leftover '$pat': $hit"; done < <(grep -rnF -- "$pat" "${scan[@]}" 2>/dev/null)
done
while IFS= read -r hit; do
	printf '%s' "$hit" | grep -qi 'ported from' || fail "unexplained cursor-team-kit mention: $hit"
done < <(grep -rnF 'cursor-team-kit' "${scan[@]}" 2>/dev/null)

# 4. Skill references.
role_count=0
if [ -d "$ROLES" ]; then
		for agents_md in "$ROLES"/*/AGENTS.md; do
			[ -f "$agents_md" ] || continue
			role_count=$((role_count + 1))
			while IFS= read -r line; do
				ref="$(printf '%s' "$line" | sed -n 's/^- `\([^`]*\)`.*/\1/p')"
				[ -n "$ref" ] || continue
				if printf '%s' "$line" | grep -Eq '\((project|company|Anthropic) skill'; then continue; fi
				[ "$ref" = "verify-<app>" ] && continue
				[ -f "$SKILLS/$ref/SKILL.md" ] || fail "$agents_md lists skill '$ref', which is not in .claude/skills"
			done < <(awk '/^## Skills/ { on = 1; next } /^## / { on = 0 } on' "$agents_md")
		done
	fi
	while IFS= read -r ref; do
		[ -f "$SKILLS/$ref/SKILL.md" ] || fail "reference to missing principle skill '$ref'"
	done < <(grep -rhoE '\*\*principle-[a-z-]+\*\*' "$ROOT/.claude" 2>/dev/null | tr -d '*' | sort -u)

	# 5. Relative paths inside skills.
	while IFS= read -r -d '' f; do
		skill_root="$SKILLS/$(printf '%s' "${f#"$SKILLS"/}" | cut -d/ -f1)"
		file_dir="$(dirname "$f")"
		while IFS= read -r p; do
			case "$p" in *'<'*|*'*'*) continue ;; esac
			[ -e "$file_dir/$p" ] || [ -e "$skill_root/$p" ] || [ -e "$ROOT/$p" ] || fail "$f mentions $p, which does not exist"
		done < <(grep -oE '(`|\()(\.\./)*(references|playbooks|scripts)/[A-Za-z0-9._/-]+' "$f" | sed 's/^[`(]//' | sort -u)
	done < <(find "$SKILLS" -type f -name '*.md' -print0)

	# 6. model-roles.md rows.
	if [ -f "$MODEL_ROLES" ]; then
		while IFS= read -r seat; do
			grep -qF "| $seat" "$MODEL_ROLES" || fail "a skill or role names the '$seat' row, which model-roles.md lacks"
		done < <(grep -rhoE 'the `[a-z][a-z ,-]*` rows?\b' "$ROOT/.claude" "$ROLES" 2>/dev/null | sed 's/^the `\([^`]*\)`.*/\1/' | sort -u)
else
	fail "model-roles.md is missing"
fi

# 7. Subagents.
agent_count=0
for required in opus-reviewer sonnet-reviewer comment-sicko how-explorer swarm-worker department-agent; do
	[ -f "$AGENTS/$required.md" ] || fail "missing subagent .claude/agents/$required.md"
done
for f in "$AGENTS"/*.md; do
	[ -f "$f" ] || continue
	agent_count=$((agent_count + 1))
	stem="$(basename "$f" .md)"
	if ! frontmatter "$f" >/dev/null; then fail "$f: missing or unclosed YAML frontmatter"; continue; fi
	[ "$(field "$f" name)" = "$stem" ] || fail "$f: name does not match file name '$stem'"
	[ -n "$(field "$f" description)" ] || fail "$f: no description"
	model="$(field "$f" model)"
	case "$model" in opus|sonnet|haiku|inherit|'') ;; *) fail "$f: model '$model' is not opus, sonnet, haiku, or inherit" ;; esac
done
for ro in opus-reviewer sonnet-reviewer comment-sicko how-explorer; do
	f="$AGENTS/$ro.md"
	[ -f "$f" ] || continue
	tools="$(field "$f" tools)"
	[ -n "$tools" ] || fail "$f: read-only agent must list its tools"
	printf '%s' "$tools" | grep -Eq '(^|[ ,])(Edit|Write|MultiEdit|NotebookEdit)([ ,]|$)' && fail "$f: read-only agent lists a write tool"
done
if [ -f "$AGENTS/swarm-worker.md" ]; then
	[ "$(field "$AGENTS/swarm-worker.md" isolation)" = "worktree" ] || fail "swarm-worker must set isolation: worktree"
	[ "$(field "$AGENTS/swarm-worker.md" background)" = "true" ] || fail "swarm-worker must set background: true"
fi

# 8. Employee templates. Skipped when the root has no agents/ (a product repo carrying only .claude/).
if [ -d "$ROLES" ]; then
	expected_roles=(ceo cto senior-developer developer-1 developer-2 validation-engineer qa-engineer
		ui-and-cli-verification-engineer verification-harness-associate developer-experience-associate
		release-manager network-and-observability-engineer aerospace-domain-engineer)
	soul_roles=" cto senior-developer validation-engineer aerospace-domain-engineer "
	for r in "${expected_roles[@]}"; do
		d="$ROLES/$r"
		[ -f "$d/AGENTS.md" ] || { fail "role $r has no AGENTS.md"; continue; }
		[ -f "$d/HEARTBEAT.md" ] || fail "role $r has no HEARTBEAT.md"
		case "$soul_roles" in
			*" $r "*) [ -f "$d/SOUL.md" ] || fail "role $r should have SOUL.md" ;;
			*) [ ! -f "$d/SOUL.md" ] || fail "role $r should not have SOUL.md" ;;
		esac
		grep -q '^## Department rules' "$d/AGENTS.md" || fail "role $r AGENTS.md lacks the department rules"
		grep -q 'Never merge to main' "$d/AGENTS.md" || fail "role $r AGENTS.md lacks the never-merge rule"
		grep -q 'Never retry a 409' "$d/HEARTBEAT.md" 2>/dev/null || fail "role $r HEARTBEAT.md lacks the never-retry-409 rule"
		grep -q '^## Ask me for' "$d/AGENTS.md" || fail "role $r AGENTS.md lacks an '## Ask me for' section"
		cmp -s "$d/COLLABORATION.md" "$ROOT/templates/collaboration.md" || fail "role $r COLLABORATION.md is not a copy of templates/collaboration.md (cp templates/collaboration.md $d/)"
	done
	for extra in "$ROLES"/*/; do
		case " ${expected_roles[*]} " in *" $(basename "$extra") "*) ;; *) fail "unexpected employee template $(basename "$extra"): add it to check-kit.sh and .paperclip.yaml" ;; esac
	done
	diff <(sed '/^name: /d' "$ROLES/developer-1/AGENTS.md") <(sed '/^name: /d' "$ROLES/developer-2/AGENTS.md") >/dev/null \
		|| fail "developer-2/AGENTS.md must match developer-1 apart from its name line"
	cmp -s "$ROLES/developer-1/HEARTBEAT.md" "$ROLES/developer-2/HEARTBEAT.md" || fail "developer-2/HEARTBEAT.md must match developer-1"
	grep -q 'ON HOLD' "$ONHOLD/adversarial-reviewer/ROLE.md" 2>/dev/null || fail "on-hold/adversarial-reviewer/ROLE.md must be marked ON HOLD"
	[ ! -e "$ONHOLD/adversarial-reviewer/AGENTS.md" ] || fail "an on-hold role must not have AGENTS.md, or a company import would create it"
else
	printf 'check-kit: no agents/ under %s, template checks skipped\n' "$ROOT"
fi

# 9. Skill tiers.
SHARED_LIST="$ROOT/skills-shared.txt"
if [ -f "$SHARED_LIST" ] && [ -d "$ROLES" ]; then
	shared=" $(grep -v '^#' "$SHARED_LIST" | tr '\n' ' ') "
	for s in $shared; do
		[ -f "$SKILLS/$s/SKILL.md" ] || fail "skills-shared.txt names '$s', which is not in .claude/skills"
	done
	holders=" "
	for agents_md in "$ROLES"/*/AGENTS.md; do
		while IFS= read -r line; do
			ref="$(printf '%s' "$line" | sed -n 's/^- `\([^`]*\)`.*/\1/p')"
			[ -n "$ref" ] || continue
			case "$line" in
				*'(shared)'*)
					[ "$ref" = "verify-<app>" ] || case "$shared" in *" $ref "*) ;; *) fail "$agents_md marks '$ref' (shared), but skills-shared.txt does not list it" ;; esac ;;
				*)
					case "$shared" in *" $ref "*) fail "$agents_md lists shared skill '$ref' without the (shared) marker" ;; esac
					holders="$holders$ref " ;;
			esac
		done < <(awk '/^## Skills/ { on = 1; next } /^## / { on = 0 } on' "$agents_md")
	done
	for dir in "$SKILLS"/*/; do
		s="$(basename "$dir")"
		case "$shared" in *" $s "*) continue ;; esac
		case "$holders" in *" $s "*) ;; *) fail "held skill '$s' has no holder: no role lists it" ;; esac
	done
fi

# 10. Import metadata.
if [ -f "$SHARED_LIST" ] && [ -d "$ROLES" ]; then
	while IFS= read -r msg; do fail "$msg"; done < <(python3 - "$ROOT" <<'PY'
import pathlib, re, sys
root = pathlib.Path(sys.argv[1])
alias = {"opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5"}
bullet = re.compile(r"^- `([^`]+)`(.*)$")
def fm(text):
    m = re.match(r"---\n(.*?)\n---\n", text, re.S)
    return m.group(1) if m else None
slugs = sorted(p.parent.name for p in (root / "agents").glob("*/AGENTS.md"))
yaml = (root / ".paperclip.yaml").read_text() if (root / ".paperclip.yaml").is_file() else None
if yaml is None:
    print(".paperclip.yaml is missing")
blocks = {}
if yaml:
    for m in re.finditer(r"^  ([a-z0-9-]+):\n((?:    .*\n|\n)*)", yaml, re.M):
        blocks[m.group(1)] = m.group(2)
model_rows = {}
for line in (root / "model-roles.md").read_text().splitlines():
    cells = [c.strip() for c in line.strip("|").split("|")]
    if len(cells) > 4 and cells[1] == "Paperclip agent":
        model_rows[cells[4]] = cells
for slug in slugs:
    text = (root / "agents" / slug / "AGENTS.md").read_text()
    head = fm(text)
    if head is None:
        print(f"agents/{slug}/AGENTS.md has no frontmatter"); continue
    for key in ("name", "title", "reportsTo"):
        if not re.search(rf"^{key}: \S", head, re.M):
            print(f"agents/{slug}/AGENTS.md frontmatter lacks {key}")
    rt = re.search(r"^reportsTo: (\S+)", head, re.M)
    if rt and rt.group(1) != "null" and rt.group(1) not in slugs:
        print(f"agents/{slug} reports to '{rt.group(1)}', which is not a template")
    listed = re.findall(r"^  - (\S+)$", head.split("skills:", 1)[1], re.M) if "skills:" in head else None
    if listed is None:
        print(f"agents/{slug}/AGENTS.md frontmatter lacks skills")
    sec = re.search(r"^## Skills\n(.*?)(?=^## |\Z)", text, re.S | re.M)
    want = []
    for line in (sec.group(1) if sec else "").splitlines():
        b = bullet.match(line)
        if b and "(shared)" not in b.group(2) and not re.search(r"\((company|Anthropic|project) skill", b.group(2)):
            want.append(b.group(1))
    if listed is not None and sorted(listed) != sorted(want):
        print(f"agents/{slug}: frontmatter skills {sorted(listed)} differ from the unmarked ## Skills bullets {sorted(want)}")
    blk = blocks.get(slug)
    if blk is None:
        print(f".paperclip.yaml has no entry for {slug}"); continue
    for needed in ("type: claude_local", "engine: cli", "maxDailyRuns:", "canCreateAgents: false"):
        if needed not in blk:
            print(f".paperclip.yaml entry {slug} lacks '{needed}'")
    row = next((r for k, r in model_rows.items() if f"agents/{slug}" in k), None)
    if row is None:
        print(f"model-roles.md has no row that runs as agents/{slug}")
    else:
        model = re.search(r"model: (\S+)", blk); effort = re.search(r"effort: (\S+)", blk)
        first_model = re.findall(r"`(opus|sonnet|haiku)`", row[2])[:1]
        first_effort = re.findall(r"`(low|medium|high|xhigh|max)`", row[3])[:1]
        if first_model and (not model or model.group(1) != alias.get(first_model[0])):
            print(f".paperclip.yaml {slug} model differs from model-roles.md ({first_model[0]})")
        if first_effort and (not effort or effort.group(1) != first_effort[0]):
            print(f".paperclip.yaml {slug} effort differs from model-roles.md ({first_effort[0]})")
for slug in blocks:
    if slug not in slugs:
        print(f".paperclip.yaml has an entry for {slug}, which has no template")
PY
)
fi

# 11. Import package.
if [ -f "$SHARED_LIST" ] && [ -d "$ROLES" ]; then
	pkg_tmp="$(mktemp -d)"
	if pkg_out="$(bash "$ROOT/scripts/build-import-package.sh" "$pkg_tmp/import" 2>&1)"; then
		pkg_n="$(find "$pkg_tmp/import/.claude/skills" -mindepth 1 -maxdepth 1 -type d | wc -l)"
		held_n="$(python3 "$ROOT/scripts/skill-plan.py" held | wc -l)"
		[ "$pkg_n" -eq "$held_n" ] || fail "import package has $pkg_n skills; expected the $held_n held skills"
	else
		while IFS= read -r msg; do fail "import package: $msg"; done <<<"$pkg_out"
	fi
	rm -rf "$pkg_tmp"
fi

if [ "$failures" -gt 0 ]; then
	printf 'check-kit: %d failure(s)\n' "$failures"
	exit 1
fi
printf 'check-kit: OK (%d skills, %d subagents, %d employee templates)\n' "$skill_count" "$agent_count" "$role_count"
