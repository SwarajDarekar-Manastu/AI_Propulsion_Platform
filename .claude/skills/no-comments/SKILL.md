---
name: no-comments
description: "Spawn the read-only comment-sicko subagent over a diff, delete the comments it convicts, fix accepted findings, and offer encodings for claimed constraints. Use before commit and before review, or for /no-comments."
---

# No comments

Spawn Comment Sicko. Act on accepted findings.

Defer to Comment Sicko's fresh perspective. In this port Comment Sicko is read-only: it reports verdicts and you apply the deletions. Spawn it from your top-level session, because a subagent cannot spawn subagents. A delegate that reaches this step reports back so its parent runs it.

## Scope

Use the caller's files or diff. Otherwise use the current diff against the base branch, default `main`, including the working tree.

## Steps

1. Spawn a subagent with `subagent_type: "comment-sicko"`. Pass the scope. Do not restate its rules.
2. Inspect its report. Reject verdicts outside the scope, kills of exception-protected comments, misstated `MUST KILL` reasons, and flags that treat kept intentional code as guilty. Then delete every comment it convicted that you did not reject. Reshape flags on our-code surprises stay actionable. Delete those comments too. A keep survives only with proof it is about something we cannot change. Audit missed scoped lint and TypeScript suppressions. Correctness or safety suppressions stay actionable `MUST KILL`s. Keep a convicted comment only with an exact exception and scoped proof. Before accepting thin `IMPORTANT` or `do not remove` kills or keeps, run `/how` or `/why` on their symbol. If a kill is ambiguous, delete it. If a keep is refuted or still ambiguous, delete it. Rerun one rejected report with the failure named. Reject a second, report it open, and fail `/no-comments`.
3. Fix trivial accepted flags directly by deleting a dead path, dropping a parameter, or using the real API. If any fix needs a shape, run `/architect` once for the accepted set and surrounding code. Stop at the sketch. Architect shapes. Step 4 implements.
4. Implement the smallest root-cause fix in scope. Remove every named workaround. If the root cause is out of scope, land the smallest in-scope fix and report the rest open. The **principle-fix-root-causes** and **principle-redesign-from-first-principles** skills guide intent only. Neither authorizes widening the fence nor fixing instances outside it. Never bolt on symptom guards.
5. Constraint comments say `do not remove`, `do not change wording`, or `talk to X before changing`. Leave keeps about things we cannot change. Offer the cheapest in-scope type, runtime, test, or CI lint. Encoding needs approval, either written into the task (its description or execution policy) or given by the Senior Developer at code review. Never wait for it. If approved, encode then delete. Otherwise delete, report the constraint open in the hand-off comment, and sketch out-of-scope work.
6. Report the deletion count, convicted comments you kept and why, reruns, architect sketch, fixes, encoding offers, encodings, unenforced constraints, and other open work.
