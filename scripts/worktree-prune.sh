#!/usr/bin/env bash
# List git worktrees whose branch is merged into origin/main, and optionally remove them.
# Dry run by default. Never touches a dirty worktree.
#
# Usage:
#   scripts/worktree-prune.sh [options] [repo-path]
#
# Options:
#   --apply              remove the worktrees listed as "prune" (default: dry run, change nothing)
#   --base <ref>         merge target to test against (default: origin/main)
#   --no-fetch           do not fetch the base before testing
#   --min-age-hours <n>  keep worktrees touched in the last n hours, as possibly in use (default: 24)
#   --include-squash     also count a branch as merged when GitHub (`gh`) reports a merged PR whose
#                        head commit is exactly the worktree's HEAD (squash merges are not ancestors)
#
# A worktree is pruned only when every one of these holds:
#   - it is not the main worktree, not the worktree you run this from, not bare, not locked
#   - it has a branch checked out (not a detached HEAD)
#   - `git status --porcelain` is empty (no staged, unstaged, or untracked changes)
#   - no merge, rebase, cherry-pick, revert, or bisect is in progress
#   - its HEAD is an ancestor of the base (or, with --include-squash, the head of a merged PR)
#   - neither its HEAD commit nor its index changed in the last --min-age-hours
#
# Removal uses `git worktree remove` without --force, so git itself refuses a dirty tree.
# Branches are never deleted.
set -uo pipefail

APPLY=0
BASE="origin/main"
FETCH=1
MIN_AGE_HOURS=24
INCLUDE_SQUASH=0
REPO=""

die() { printf 'worktree-prune: %s\n' "$*" >&2; exit 2; }

while [ "$#" -gt 0 ]; do
	case "$1" in
		--apply) APPLY=1 ;;
		--base) shift; [ "$#" -gt 0 ] || die "--base needs a ref"; BASE="$1" ;;
		--no-fetch) FETCH=0 ;;
		--min-age-hours) shift; [ "$#" -gt 0 ] || die "--min-age-hours needs a number"; MIN_AGE_HOURS="$1" ;;
		--include-squash) INCLUDE_SQUASH=1 ;;
		-h|--help) sed -n '2,29p' "$0"; exit 0 ;;
		-*) die "unknown option: $1" ;;
		*) REPO="$1" ;;
	esac
	shift
done
case "$MIN_AGE_HOURS" in ''|*[!0-9]*) die "--min-age-hours must be a whole number" ;; esac

if [ -z "$REPO" ]; then
	REPO="$(git rev-parse --show-toplevel 2>/dev/null)" || die "not inside a git repository; pass a repo path"
fi
git -C "$REPO" rev-parse --git-dir >/dev/null 2>&1 || die "not a git repository: $REPO"

main_wt="$(git -C "$REPO" worktree list --porcelain | awk '/^worktree /{ sub(/^worktree /, ""); print; exit }')"
here="$(git rev-parse --show-toplevel 2>/dev/null || true)"

if [ "$FETCH" = 1 ]; then
	case "$BASE" in
		*/*) remote="${BASE%%/*}"; branch="${BASE#*/}"
			git -C "$main_wt" fetch --quiet "$remote" "$branch" 2>/dev/null \
				|| printf 'worktree-prune: warning: could not fetch %s; merge results may be stale\n' "$BASE" >&2 ;;
	esac
fi
git -C "$main_wt" rev-parse --verify --quiet "$BASE^{commit}" >/dev/null || die "base ref not found: $BASE"

if [ "$INCLUDE_SQUASH" = 1 ] && ! command -v gh >/dev/null 2>&1; then
	die "--include-squash needs the GitHub CLI (gh)"
fi

mtime() { stat -c %Y "$1" 2>/dev/null || stat -f %m "$1" 2>/dev/null || echo 0; }
now="$(date +%s)"
min_age_s=$((MIN_AGE_HOURS * 3600))

pruned=0
kept=0
failed=0
report() { printf '%-8s %-40s %s\n' "$1" "$2" "$3"; }

printf 'worktree-prune: %s, base %s, keeping worktrees touched in the last %sh\n' \
	"$([ "$APPLY" = 1 ] && echo "APPLY" || echo "dry run")" "$BASE" "$MIN_AGE_HOURS"
report "ACTION" "BRANCH" "WORKTREE (REASON)"

consider() { # <path> <head> <branch-ref> <flags>
	local path="$1" head="$2" ref="$3" flags="$4" branch reason gitdir op touched idx pr_heads errf
	branch="${ref#refs/heads/}"
	[ -n "$ref" ] || branch="(detached)"

	if [ "$path" = "$main_wt" ]; then return; fi
	reason=""
	case " $flags " in *" bare "*) reason="bare repository" ;; esac
	[ -z "$reason" ] && case " $flags " in *" prunable "*) reason="directory missing; run 'git worktree prune'" ;; esac
	[ -z "$reason" ] && case " $flags " in *" locked "*) reason="locked" ;; esac
	[ -z "$reason" ] && [ -n "$here" ] && [ "$path" = "$here" ] && reason="you are running from this worktree"
	[ -z "$reason" ] && [ -z "$ref" ] && reason="detached HEAD, no branch"
	if [ -z "$reason" ] && [ -n "$(git -C "$path" status --porcelain --untracked-files=normal 2>/dev/null)" ]; then
		reason="dirty: $(git -C "$path" status --porcelain --untracked-files=normal | wc -l | tr -d ' ') change(s)"
	fi
	if [ -z "$reason" ]; then
		gitdir="$(git -C "$path" rev-parse --absolute-git-dir 2>/dev/null)"
		for op in MERGE_HEAD rebase-merge rebase-apply CHERRY_PICK_HEAD REVERT_HEAD BISECT_LOG; do
			if [ -e "$gitdir/$op" ]; then reason="operation in progress ($op)"; break; fi
		done
	fi
	if [ -z "$reason" ]; then
		touched="$(git -C "$path" log -1 --format=%ct HEAD 2>/dev/null || echo 0)"
		idx="$(mtime "$gitdir/index")"
		[ "$idx" -gt "$touched" ] && touched="$idx"
		[ $((now - touched)) -lt "$min_age_s" ] && reason="touched in the last ${MIN_AGE_HOURS}h, may be in use"
	fi
	if [ -z "$reason" ]; then
		if git -C "$main_wt" merge-base --is-ancestor "$head" "$BASE" 2>/dev/null; then
			reason=""
		elif [ "$INCLUDE_SQUASH" = 1 ]; then
			pr_heads="$(cd "$main_wt" && gh pr list --state merged --head "$branch" --json headRefOid --jq '.[].headRefOid' 2>/dev/null)"
			printf '%s\n' "$pr_heads" | grep -qx "$head" || reason="not merged into $BASE"
		else
			reason="not merged into $BASE"
		fi
	fi

	if [ -n "$reason" ]; then
		report "keep" "$branch" "$path ($reason)"
		kept=$((kept + 1))
		return
	fi
	if [ "$APPLY" = 1 ]; then
		errf="$(mktemp)"
		if git -C "$main_wt" worktree remove "$path" 2>"$errf"; then
			report "removed" "$branch" "$path"
			pruned=$((pruned + 1))
		else
			report "FAILED" "$branch" "$path ($(tr '\n' ' ' <"$errf"))"
			failed=$((failed + 1))
		fi
		rm -f "$errf"
	else
		report "prune" "$branch" "$path (merged, clean)"
		pruned=$((pruned + 1))
	fi
}

wt="" head="" ref="" flags=""
while IFS= read -r line; do
	case "$line" in
		"worktree "*) wt="${line#worktree }" ;;
		"HEAD "*) head="${line#HEAD }" ;;
		"branch "*) ref="${line#branch }" ;;
		bare) flags="$flags bare" ;;
		detached) ;;
		locked*) flags="$flags locked" ;;
		prunable*) flags="$flags prunable" ;;
		"")
			[ -n "$wt" ] && consider "$wt" "$head" "$ref" "$flags"
			wt="" head="" ref="" flags=""
			;;
	esac
done < <(git -C "$main_wt" worktree list --porcelain; echo)

if [ "$APPLY" = 1 ]; then
	printf 'worktree-prune: removed %d, kept %d, failed %d. Branches were not deleted.\n' "$pruned" "$kept" "$failed"
	[ "$failed" -eq 0 ] || exit 1
else
	printf 'worktree-prune: %d would be removed, %d kept. Re-run with --apply to remove them.\n' "$pruned" "$kept"
fi
