# Asking a colleague

Read this when a step needs a skill you do not hold, or work that another employee owns. Every employee has the same copy of this file next to its `AGENTS.md`.

## What you hold

Every employee has the shared skills in the product repository's `.claude/skills/`: `department-mode`, `how`, `why`, `recall`, `technical-writing`, `unslop`, `show-me-your-work`, `no-comments`, every `principle-*` skill, and the project's `verify-<app>`.

Your other skills are the ones listed at the top of your `AGENTS.md`. Paperclip attaches them to you and to nobody else. A skill another employee holds is that employee's work: ask for the result, never run the skill yourself, and never rebuild its steps from memory.

When `department-mode` or a playbook tells you to run a skill you do not hold (for example `arena` in the Feature playbook, or `interrogate` for a contested design), read that step as "ask its holder", using this file. When the step is mandatory, the holder's answer completes it. Question cards are a way to ask, not a hand-off: work still moves between employees only by task assignment or review stage, as `department-mode` says.

## How to ask

1. **You need a verdict or an artifact.** Create a request task assigned to the holder. Then set `blockedByIssueIds` on your own task to that request. Paperclip wakes you when the holder marks it done.
2. **You need only an answer.** Post a question card on your own task: an `ask_user_questions` interaction with `addresseeAgentId` set to the holder, `continuationPolicy: "wake_assignee"`, and no `resolverPolicy`. Leave your task `in_progress`; do not move it to `in_review`, because on a task with review stages that starts the first review. End the run. Paperclip wakes you when the card is answered.
3. **It is a review stage in your task's execution policy.** Do not ask for it. Paperclip hands the task to the stage's reviewer, and only that reviewer can record the verdict.
4. **Never ask with an @-mention.** An @-mention is context only and wakes no one.
5. **The holder is protected.** The Aerospace Domain Engineer, the Release Manager and the CEO take work only from the CTO, the CEO and the Board. Paperclip refuses a task assigned to them by anyone else. Send your request to the CTO, who decides and routes it.
6. **Ask a person only through a person-only card.** For a decision only the Board can make, use `ask_user_questions` with `resolverPolicy: "human_only"`.

## Rules

- **Make the request stand alone.** The holder may not be able to read your task or its documents.
- **Send one request per need.** Combine related questions. Do not re-ask while a request is open, and do not poll it.
- **You still own your task.** An answer is evidence, not an order. You decide what to do with it and you record why.
- **Every request costs.** It uses at least one run of the holder's daily run cap, against the Claude limits the whole department shares. Ask when the answer changes what you do.

Request task description:

```
Request: <one falsifiable sentence>   e.g. "Reproduce the cart-total rounding bug on main"
For: <your task link>   Asked by: <your role>
Inputs: <branch or PR and commit SHA, feature ID and entry point, steps, data, commands>
Done when: <the verdict or artifact you need back>
Reply: post on THIS request and mark it done. Do not write on my task.
```

Question card prompt: the same Request, For, Inputs and Done when lines, without the Reply line. The holder answers on the card.

## When you are the one asked

- **A request task** arrives as an ordinary assignment. Check it out, do the work your "Ask me for" table promises, post the result on the request task, and mark it done. Never write on the asker's task.
- **A question card** wakes you with reason `interaction_pending` on the asker's task. Answer it with `POST /api/issues/{issueId}/interactions/{interactionId}/respond`, then end the run. Do not check out the asker's task.
- **A request outside your "Ask me for" table:** answer that it is not yours and name the holder from the table below.
- **If you are protected**, answer any card from anyone except the CTO, the CEO or the Board with "Send this to the CTO", and end the run.

## Who holds what

| You need | Ask | Channel | You get back |
|---|---|---|---|
| Triage, a split, a stuck task, or a call between two gates that disagree | CTO | request task | sub-tasks with owners and stages, or a decision |
| A code change outside your task | CTO, who assigns a Developer | request task | a PR through the normal stages |
| A physics, units or flight-constraint answer | CTO, who routes it to the Aerospace Domain Engineer | request task with the question in physical terms, the code or data, and the Parameter Ledger entries | sound, sound with stated assumptions, or not sound, with the scripts behind every number |
| A plan for a large migration or multi-part change (`figure-it-out`) | CTO | request task | a playbook and its decision log |
| A design opinion: where code should live, the smallest change, whether a plan has the right shape (`architect` review) | Senior Developer | question card | an answer. The formal verdict stays at plan review. |
| A design bakeoff between real candidates (`arena`) | Senior Developer | request task | an arena comparison document; you implement the winner |
| A reproduction before a fix, or proof that a fix works on the real UI or CLI | UI and CLI Verification Engineer | request task with the feature ID and entry point from the feature map, the branch or PR and SHA, and the claim | VERIFIED, NOT VERIFIED or INCONCLUSIVE, with an evidence pack |
| A baseline before a performance change | QA Engineer | request task with the benchmark command and the machine | baseline numbers, with what limits them |
| A check of a performance number you measured (`benchmark-checklist`) | QA Engineer | question card with the number, the command and the raw output | whether the number holds, and what limits it |
| An adversarial review of a risky change before its validation stage (`interrogate`) | Validation Engineer, asked by the CTO or the Senior Developer. A Developer asks the CTO. | request task with the PR, the SHA and the specific worry | an `interrogate` verdict document |
| What "done" means for your task's type | Nobody. Read the rubric yourself. | company skill reads are open: `GET /api/companies/{companyId}/skills`, then `GET /api/companies/{companyId}/skills/{skillId}/files?path=SKILL.md` | the rubric the Validation Engineer will judge against |
| A feature-map entry for a new feature, or a fix for map drift | Verification Harness Associate | request task with the feature, its routes and states, and what the map says against what the app does | a PR, reviewed by the Validation Engineer |
| What production shows: errors, first-seen time against the last deploy, affected paths | Network and Observability Engineer | question card, or a request task for a long investigation | GlitchTip issue links, trace IDs and grouping, or a bug ticket |
| A fix to a broken or misleading skill, or a check for a mistake agents keep repeating | Developer Experience Associate | request task naming the skill, the step, what went wrong, and the run | a proposed change, which the Board approves before it lands |
| A merge to `main` | Nobody. The Release Manager wakes on GitHub events once the Board approves. | none | none |
| A priority call between goals | CEO, asked by the CTO | request task with the options and trade-offs | a priority decision |
| A product or preference decision only a person can make | The Board | `ask_user_questions` with `resolverPolicy: "human_only"` | an answer in the task thread |
