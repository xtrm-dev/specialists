---
name: using-specialists-v3
description: >
  Canonical specialist orchestration skill. Use proactively for substantial work
  that should be delegated, tracked, reviewed, fixed, tested, or merged through
  specialists: code review, debugging, implementation, planning, doc sync,
  security checks, multi-step chains, and questions about specialist workflow.
version: 3.1
---

# Using Specialists v3

You are the orchestrator. Your job is to turn user intent into a clear bead contract, choose the right specialist from the live registry, launch the chain, monitor it, consume results, drive fixes, and publish through the specialist merge path.

Keep this skill practical. It should contain the core behavior needed to orchestrate well; use live commands for volatile details instead of embedding a static catalog.

## When To Delegate

Use specialists for substantial work: codebase exploration, debugging, implementation, review, test execution, planning, documentation sync, security/config audit, release publication, and multi-chain epics.

Do small deterministic edits directly when the scope is already obvious and delegation would add ceremony. Do not self-investigate or self-implement a substantial task just because you can read files faster; the audit trail and specialist review are part of the workflow.

## Non-Negotiable Rules

1. `--bead` is the prompt for tracked work.
2. Do not dispatch until the bead is a usable task contract.
3. Never use `--prompt` to supplement tracked work. Update the bead instead.
4. Choose by task shape, not by habit. Check `specialists list --full` when roles may have changed.
5. Explorer/debugger answer uncertainty before executor writes code.
6. Executor starts only when scope, constraints, and validation are clear.
7. Reviewer uses its own bead and the executor workspace via `--job <exec-job>`.
8. Keep executor/debugger jobs alive through review so they can be resumed.
9. Merge specialist-owned work with `sp merge` or `sp epic merge`, not manual `git merge`.
10. Specialists must not perform destructive or irreversible operations.
11. Treat tests as evidence: classify failures as in-scope, pre-existing, or infrastructure before starting a fix loop.
12. Drive routine stages autonomously once the task is clear. Escalate only for human judgment, destructive actions, repeated crashes, or reviewer `FAIL`.

## Live Registry And Help

Use the live registry for role details, permissions, current models, and skills:

```bash
specialists list --full
```

Use help for command flags and subcommands:

```bash
sp help
sp run --help
sp ps --help
sp feed --help
sp result --help
sp resume --help
sp merge --help
sp epic --help
```

Do not rely on stale remembered flags when help is available.

## Role Selection

Common routing:

| Need | Specialist |
| --- | --- |
| Unknown architecture, call flow, dependencies, implementation options | `explorer` |
| Symptom, stack trace, regression, flaky/failing test, root cause | `debugger` |
| Broad feature decomposition, bead board, dependencies, sequencing | `planner` |
| Risky design choice, tradeoff, premortem, critique | `overthinker` |
| Clear implementation or scoped doc edit | `executor` |
| Cheap implementation-quality smell pass before final review | `code-sanity` |
| Security/config/dependency audit with recommendations only | `security-auditor` |
| Final compliance verdict on executor/debugger diff | `reviewer` |
| Run checks and interpret failures without fixing | `test-runner` |
| Exactly one doc needs drift-aware sync | `sync-docs` |
| Current external docs/API/ecosystem research | `researcher` |
| Create or fix specialist config/schema | `specialists-creator` |
| Release changelog/package/dist/tag publication | `changelog-keeper` through the `releasing` skill |

Selection rules:

- Use `explorer` when you need evidence before deciding what to change.
- Use `debugger` instead of explorer when there is a failure symptom.
- Use `executor` only after the task can name target files/symbols or a bounded discovery result.
- Use `reviewer` as the merge gate; code-sanity and security-auditor are advisory.
- Use `test-runner` for running/classifying tests; it does not implement fixes.
- Use `specialists-creator` before changing specialist definitions.

## Bead Contract

Every specialist-bound bead must be a usable prompt. Title-only beads are not acceptable.

Required structure:

```text
PROBLEM: What is wrong or needed.
SUCCESS: Observable completion criteria.
SCOPE: Files, symbols, commands, docs, or discovery area.
NON_GOALS: Explicitly out of scope.
CONSTRAINTS: Safety, compatibility, style, permissions, sequencing.
VALIDATION: Checks/tests/review expected before closure.
OUTPUT: Expected handoff format.
```

If the existing issue is vague, update it before dispatch:

```bash
bd update <id> --notes "CONTRACT: ..."
```

Contract tuning by role:

- Explorer: ask specific questions; require citations to files/symbols/flows; forbid implementation.
- Debugger: include symptom, reproduction, expected/actual behavior, logs/tests; ask for root cause and minimal fix path.
- Executor: name target files/symbols and do-not-touch boundaries; require verification evidence.
- Reviewer: reference the executor job, diff, acceptance criteria, constraints, and required verdict format.
- Test-runner: name exact commands/suites and expected classification of failures.
- Sync-docs: exactly one doc in scope.

## Canonical Single-Chain Flow

Use this for one implementation branch.

```bash
# 1. Create or claim root task bead with complete contract
bd create --title "..." --type task --priority 2 --description "PROBLEM: ..."
bd update <task> --claim

# 2. Optional discovery when path is unknown
bd create --title "Explore ..." --type task --priority 2 --description "PROBLEM: ... OUTPUT: evidence-backed plan."
bd dep add <explore> <task>
specialists run explorer --bead <explore> --context-depth 3
specialists result <explore-job>

# 3. Implementation
bd create --title "Implement ..." --type task --priority 2 --description "PROBLEM: ... VALIDATION: ..."
bd dep add <impl> <explore-or-task>
specialists run executor --bead <impl> --context-depth 3
specialists result <exec-job>

# 4. Optional advisory passes
specialists run code-sanity --bead <sanity-bead> --job <exec-job> --context-depth 3
specialists run security-auditor --bead <security-bead> --job <exec-job> --context-depth 3

# 5. Final review
bd create --title "Review ..." --type task --priority 2 --description "PROBLEM: Verify executor output ... OUTPUT: PASS/PARTIAL/FAIL."
bd dep add <review> <impl>
specialists run reviewer --bead <review> --job <exec-job> --context-depth 3
specialists result <review-job>

# 6. Publish after reviewer PASS
sp merge <impl>
bd close <task> --reason "Reviewer PASS; merged."
```

Edit-capable specialists with `--bead` auto-provision a worktree. `--worktree` is accepted for clarity but is usually unnecessary. Use `--job <exec-job>` for reviewer/fix passes that must enter the existing executor workspace.

## Review And Fix Loop

A chain stays alive until it is merged or abandoned.

```text
executor/debugger -> waiting
optional code-sanity/security-auditor -> advisory findings
reviewer -> PASS | PARTIAL | FAIL
```

- `PASS`: verify expected commit/diff, then publish.
- `PARTIAL`: resume the same executor/debugger with exact findings, then re-review.
- `FAIL`: stop and decide whether to replace the chain, re-scope the bead, or ask the operator if judgment is required.

Prefer resume over spawning a new fix executor when the original job is waiting and context is healthy:

```bash
sp resume <exec-job> "Reviewer PARTIAL. Fix only these findings: ..."
```

Do not treat job completion, code-sanity OK, or security no-findings as equivalent to reviewer PASS.

## Monitoring And Steering

Use `sp ps` for state and `sp result` for completed turns.

```bash
sp ps
sp ps <job-id>
sp ps --bead <bead-id>
sp feed <job-id>          # live/running output
sp result <job-id>        # done/error/waiting result
```

If a job is running, use `sp feed`. If it is waiting, use `sp result` and decide whether to resume, review, merge, or stop. Avoid tight polling; sleep based on task size, then check once.

Use `steer` for running jobs and `resume` for waiting jobs:

```bash
sp steer <job-id> "Stop broad audit. Answer only the three bead questions."
sp resume <job-id> "Continue with the next scoped fix. Do not refactor."
```

Context usage is an action signal when available:

- 0-40%: healthy.
- 40-65%: monitor.
- 65-80%: steer toward conclusion.
- Above 80%: finish, summarize, or replace the job.

Raw token totals are not context percentages.

## Merge And Publication

Standalone chain:

```bash
sp merge <chain-root-bead>
```

Epic-owned chains:

```bash
sp epic status <epic-id>
sp epic merge <epic-id>
```

Rules:

- Merge only after reviewer PASS unless the operator explicitly accepts a draft for follow-up work.
- Use `sp epic merge` for unresolved epic chains; `sp merge` refuses those by design.
- Do not manually `git merge` specialist branches.
- If merge refuses because a chain job is still `waiting`, consume the result and either resume/stop/finalize that job deliberately.
- If merge reports a dirty worktree, inspect that worktree. Revert generated noise only when it is clearly unrelated; otherwise ask or re-dispatch.
- Run or confirm required gates before closing the root bead or epic.

## Multi-Chain Epic Flow

Use an epic when multiple implementation chains publish together.

1. Create an epic bead with complete contract.
2. Use planner/explorer for shared prep if needed.
3. Create independent implementation beads with disjoint file scopes.
4. Dispatch executors in parallel only when scopes are provably disjoint.
5. Review each chain with its own review bead and `--job`.
6. After every chain has reviewer PASS, publish with `sp epic merge <epic-id>`.

Use `--epic <id>` when a job belongs to an epic but its bead is not a direct child. Avoid parallel executors on the same file; sequence them or consolidate the work.

## Failure Recovery

When something fails:

```bash
sp ps <job-id>
sp feed <job-id>
sp result <job-id>
sp doctor
```

Then choose one action:

- Steer a running job back to scope.
- Resume a waiting job with exact next instructions.
- Stop a dead or obsolete job.
- Rerun with a better bead contract.
- Switch specialist if the selected role was wrong.
- Report blocker if destructive/high-risk/manual action is required.

Common recovery commands:

```bash
sp stop <job-id>
sp clean --processes --dry-run
sp epic status <epic-id>
sp epic sync <epic-id> --apply
sp epic abandon <epic-id> --reason "..."
specialists doctor --check-drift
sp prune-stale-defaults --dry-run
```

Do not silently take over substantial specialist work yourself unless the operator agrees or the remaining change is genuinely small and deterministic.

## What Stays Out Of This Skill

Do not embed the full specialist catalog, all CLI help, release mechanics, stale incident reports, or historical gotchas. Keep volatile detail in `specialists list --full`, `sp help`, bead notes, and focused skills such as `releasing`, `using-nodes`, or `specialists-creator`.
