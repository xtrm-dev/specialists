---
name: using-specialists-v3
description: >
  Canonical specialist orchestration skill. Use proactively for substantial work
  that should be delegated, tracked, reviewed, fixed, tested, or merged through
  specialists: code review, debugging, implementation, planning, doc sync,
  security checks, multi-step chains, and questions about specialist workflow.
version: 3.2
---

# Using Specialists v3

You are the orchestrator. Turn user intent into a strong bead contract, choose right specialist from live registry, launch chain, monitor it, consume results, drive fixes, and publish through specialist merge path.

Keep skill practical. Core behavior belongs here; volatile detail stays in live commands.

## When To Delegate

Use specialists for substantial work: codebase exploration, debugging, implementation, review, test execution, planning, documentation sync, security/config audit, release publication, and multi-chain epics.

Do small deterministic edits directly when scope is already obvious and delegation would add ceremony. Do not self-investigate or self-implement a substantial task just because you can read files faster; audit trail and specialist review are part of workflow.

## Non-Negotiable Rules

1. `--bead` is prompt for tracked work.
2. Do not dispatch until bead is usable task contract.
3. Never use `--prompt` to supplement tracked work. Update bead instead.
4. Choose by task shape, not habit. Check `specialists list --full` when roles may have changed.
5. Explorer/debugger answer uncertainty before executor writes code.
6. Executor starts only when scope, constraints, and validation are clear.
7. Reviewer uses its own bead and executor workspace via `--job <exec-job>`.
8. Keep executor/debugger jobs alive through review so they can be resumed.
9. Merge specialist-owned work with `sp merge` or `sp epic merge`, not manual `git merge`.
10. Specialists must not perform destructive or irreversible operations.
11. Treat tests as evidence: classify failures as in-scope, pre-existing, or infrastructure before starting fix loop.
12. Drive routine stages autonomously once task is clear. Escalate only for human judgment, destructive actions, repeated crashes, or reviewer `FAIL`.

## Live Registry And Help

Use live registry for role details, permissions, current models, and skills:

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

## Writing Bead Contracts Well

Bead quality controls specialist quality. A title-only bead produces wandering output because specialist has no contract to optimize against. Write contract before dispatch. Tighten vague scope before launch.

Bad bead:

```text
TITLE: Fix bug
PROBLEM: Something is broken.
SUCCESS: It works.
SCOPE: src/
NON_GOALS: N/A
CONSTRAINTS: Be careful.
VALIDATION: Tests pass.
OUTPUT: Done.
```

Good bead:

```text
TITLE: Fix feed cursor regression in sp result
PROBLEM: specialists feed follow skips events after restart because cursor tracks count, not last seq.
SUCCESS: feed follow resumes from last seen seq; result still reads terminal output.
SCOPE: src/cli/feed.ts, src/cli/result.ts, tests/unit/cli/feed.test.ts
NON_GOALS: No new runtime format, no DB schema change, no unrelated poll changes.
CONSTRAINTS: Preserve existing job IDs, keep backwards-compatible CLI output, avoid file-based fallback drift.
VALIDATION: Add regression test for restart resume; run targeted CLI tests.
OUTPUT: Changed files, test evidence, residual risks.
```

Fix three bad smells fast:

- Title-only bead. Add problem, scope, validation, output.
- Vague SCOPE like `src/`. Name files, symbols, or bounded docs.
- Missing VALIDATION. Say what proves done, not just that work is “finished.”

What differs: orchestrator writes contract before dispatch, so specialist does less guessing and more useful work.

## Dependency Linking

Link beads with correct edge shape. The edge tells orchestrator what blocks what, what is only related, and what should auto-nest.

- `bd dep add <issue> <depends-on>`: issue depends on depends-on; depends-on blocks issue. Use this for hard sequencing. [source: bd dep --help]
- `bd dep <blocker> --blocks <blocked>`: reverse phrasing of same edge; blocker-first reads better when thinking in blockers. [source: bd dep --help; CLAUDE.md lines 62-64]
- `bd dep relate <a> <b>`: non-blocking `relates_to` link. Use for context, not order. [source: bd dep --help; CLAUDE.md lines 64, 200-204]
- `bd create --parent <epic-id>`: epic-child edge; auto-names child `.1`, `.2`, … and adds parent edge. Use for chain members that must live under epic. [source: CLAUDE.md lines 49-50, 154-156; bd create --help]
- `bd create --deps discovered-from:<id>`: follow-up work discovered from source bead. Use when one bead reveals new tracked work. [source: CLAUDE.md lines 50, 62-65; bd create --help]

Use each form for a different reason:

- `add` / `--blocks` for must-happen-before dependency.
- `relate` for soft linkage with no schedule effect.
- `--parent` for epic ownership and child naming.
- `discovered-from:` for spawned follow-up beads.

What differs: orchestrator chooses edge type deliberately, so graph stays correct for chain execution, epic publish, and follow-up traceability.

## Bead Contract By Bead Type

Use shape that fits specialist.

Task/epic bead:

```text
PROBLEM: User-facing or project-facing objective.
SUCCESS: End-state across all child beads.
SCOPE: Area of project affected.
NON_GOALS: Boundaries for entire effort.
CONSTRAINTS: Sequencing, compatibility, branch/merge rules.
VALIDATION: Final checks before close.
OUTPUT: What orchestrator reports back.
```

Explorer bead:

```text
PROBLEM: What is unknown.
SUCCESS: Questions answered with evidence.
SCOPE: Code areas, docs, commands, or symbols to inspect.
NON_GOALS: No implementation, no broad audit outside scope.
CONSTRAINTS: READ_ONLY, cite files/symbols/flows.
VALIDATION: Findings cite evidence.
OUTPUT: Findings, risks, recommended implementation track, stop condition.
```

Debugger bead:

```text
PROBLEM: Symptom, regression, or failing test.
SUCCESS: Root cause plus minimal fix path.
SCOPE: Logs, reproduction, code paths, and related tests.
NON_GOALS: No broad refactor.
CONSTRAINTS: Preserve behavior outside fault line.
VALIDATION: Repro steps and diagnosis.
OUTPUT: Root cause, fix options, confidence, remaining unknowns.
```

Executor bead:

```text
PROBLEM: Exact behavior or artifact to change.
SUCCESS: Observable acceptance criteria.
SCOPE: Target files/symbols; include do-not-touch boundaries.
NON_GOALS: Related improvements explicitly excluded.
CONSTRAINTS: API compatibility, style, migrations, safety.
VALIDATION: Lint/typecheck/tests or manual checks.
OUTPUT: Changed files, verification, residual risks.
```

Reviewer bead:

```text
PROBLEM: Verify executor output against requirements.
SUCCESS: PASS only if requirements and validation are satisfied.
SCOPE: Executor job, diff, task bead, acceptance criteria.
NON_GOALS: Do not rewrite unless explicitly asked.
CONSTRAINTS: Code-review mindset; findings first.
VALIDATION: Run or inspect required checks where feasible.
OUTPUT: PASS/PARTIAL/FAIL with file/line findings.
```

Test bead:

```text
PROBLEM: Validate one or more implementation chains.
SUCCESS: Relevant tests/checks pass or failures are diagnosed.
SCOPE: Commands and implementation beads covered.
NON_GOALS: No broad unrelated suite expansion unless requested.
CONSTRAINTS: Avoid destructive cleanup; report flaky/infra failures separately.
VALIDATION: Command output and failure interpretation.
OUTPUT: Pass/fail summary, failing tests, likely owner.
```

Sync-docs bead:

```text
PROBLEM: Exactly one doc drifted from source truth.
SUCCESS: One doc updated and drift checked clean.
SCOPE: One doc only.
NON_GOALS: No source-code rewrite.
CONSTRAINTS: Keep doc and source aligned.
VALIDATION: Drift scan or bounded source cross-check.
OUTPUT: Updated doc, drift evidence, remaining doc gaps.
```

What differs: orchestrator gives each specialist a contract shape that matches job, so role stays narrow and reviewable.

## Choosing The Specialist

Run `specialists list` if you need live registry. Choose by task, not habit.

| Need | Specialist | Use when |
| --- | --- | --- |
| Architecture/code mapping | `explorer` | Need evidence and scoped implementation track |
| Root-cause analysis | `debugger` | Symptom, stack trace, failing test, or regression |
| Planning/decomposition | `planner` | Need beads, dependencies, file scopes, sequencing |
| Design/tradeoffs | `overthinker` | Approach is risky, ambiguous, or needs critique |
| Implementation | `executor` | Contract is clear enough to write code or docs |
| Compliance/code review | `reviewer` | Executor/debugger produced changes that need final PASS/PARTIAL/FAIL |
| Implementation sanity | `code-sanity` | Diff smells overcomplicated, brittle, or type-risky |
| Security/dependency audit | `security-auditor` | Need threat modeling, secure-code review, or agent/config security scan |
| Multiple review perspectives | `parallel-review` | Critical diff needs independent review passes |
| Test execution | `test-runner` | Need suites run and failures interpreted |
| Docs audit/sync | `sync-docs` | Docs may be stale or need targeted synchronization |
| External/live research | `researcher` | Current non-security library/docs/media lookup is needed |
| Specialist config | `specialists-creator` | Creating or changing specialist JSON/config |
| Release publication | `changelog-keeper` | New tag is being cut |

Selection rules:

- Explorer is READ_ONLY and should answer specific questions.
- Debugger beats explorer for failures because it traces causes and remediation.
- Planner shapes epic/task graph before executor starts.
- Overthinker defends risky design before code locks in.
- Executor does not own full test validation; use reviewer/test-runner for that phase.
- Code-sanity is optional and non-blocking. Use it when diff smells overcomplicated or type-risky, then resume executor with concrete findings. It is not a merge gate.
- Security-auditor may run safe local audit commands and source research, but must not edit files, update dependencies, exfiltrate secrets, or run destructive/live-target exploit tests. Executor applies recommended fixes in separate bead.
- Reviewer always uses its own bead plus `--job <executor-job>` and remains final merge gate.
- Sync-docs is for audit/sync; executor is for heavy doc rewrites.
- Researcher is for current external info, not repo archaeology.
- Specialists-creator should precede specialist config/schema edits.

## Dependency Graph Shapes

Draw graph before dispatch.

Simple chain:

```text
task -> explore -> impl -> review
```

Fix loop:

```text
debug -> exec -> code-sanity? -> security-auditor? -> reviewer
                ^                                     |
                |------ resume PARTIAL --------------|
```

Epic:

```text
epic
├─ prep/planner
├─ impl-a
├─ impl-b
├─ test-batch
└─ merge/review chain(s)
```

What differs: orchestrator sees edge shape up front, so can pick sequential chain, fix loop, or multi-chain epic without graph drift.

## Canonical Single-Chain Flow

Use for one implementation branch.

```bash
# 1. Create or claim root task bead with complete contract
bd create --title "..." --type task --priority 2 --description "PROBLEM: ... SUCCESS: ... SCOPE: ... NON_GOALS: ... CONSTRAINTS: ... VALIDATION: ... OUTPUT: ..."
bd update <task> --claim

# 2. Optional discovery when path is unknown
bd create --title "Explore ..." --type task --priority 2 --description "PROBLEM: unknown path. SUCCESS: evidence-backed plan. SCOPE: ... OUTPUT: evidence-backed plan."
bd dep add <explore> <task>
specialists run explorer --bead <explore> --context-depth 3
specialists result <explore-job>

# 3. Implementation
bd create --title "Implement ..." --type task --priority 2 --description "PROBLEM: ... SUCCESS: ... SCOPE: ... VALIDATION: ... OUTPUT: ..."
bd dep add <impl> <explore-or-task>
specialists run executor --bead <impl> --context-depth 3
specialists result <exec-job>

# 4. Advisory passes when diff smells risky
bd create --title "Sanity check ..." --type task --priority 2 --description "PROBLEM: smell pass. SUCCESS: findings or clean bill. SCOPE: executor diff. NON_GOALS: no edits. CONSTRAINTS: READ_ONLY. VALIDATION: line findings. OUTPUT: recommendations."
specialists run code-sanity --bead <sanity-bead> --job <exec-job> --context-depth 3

bd create --title "Security scan ..." --type task --priority 2 --description "PROBLEM: audit auth/secrets/input/dep/agent-config touches. SUCCESS: recommendations only. SCOPE: executor diff. NON_GOALS: no edits, no exploit tests. CONSTRAINTS: LOW permissions, scan-only. VALIDATION: findings cite risk surface. OUTPUT: recommendations."
specialists run security-auditor --bead <security-bead> --job <exec-job> --context-depth 3

# 5. Final review
bd create --title "Review ..." --type task --priority 2 --description "PROBLEM: verify executor output. SUCCESS: PASS/PARTIAL/FAIL. SCOPE: executor job, diff, acceptance criteria. OUTPUT: verdict with findings."
bd dep add <review> <impl>
specialists run reviewer --bead <review> --job <exec-job> --context-depth 3
specialists result <review-job>

# 6. Publish after reviewer PASS
sp merge <impl>
bd close <task> --reason "Reviewer PASS; merged."
```

Edit-capable specialists with `--bead` auto-provision a worktree. `--worktree` is accepted for clarity but usually unnecessary. Use `--job <exec-job>` for reviewer/fix passes that must enter existing executor workspace.

What differs: orchestrator carries full bead contract inline, so downstream specialists inherit the actual job shape, not a title.

## Multi-Chain Epic Flow

Use epic when multiple implementation chains publish together.

```bash
# Epic bead
bd create --title "Epic: ..." --type epic --priority 2 --description "PROBLEM: ... SUCCESS: ... SCOPE: ... NON_GOALS: ... CONSTRAINTS: ... VALIDATION: ... OUTPUT: ..."

# Planner bead
bd create --title "Plan epic split" --type task --priority 2 --description "PROBLEM: split epic into disjoint chains. SUCCESS: child beads, dependencies, file scopes. SCOPE: epic area. OUTPUT: parallel-ready plan."
bd dep add <plan> <epic>
specialists run planner --bead <plan> --context-depth 3

# Parallel impl beads
bd create --parent <epic> --title "Impl A" --type task --priority 2 --description "PROBLEM: ... SUCCESS: ... SCOPE: files A. VALIDATION: ... OUTPUT: ..."
bd create --parent <epic> --title "Impl B" --type task --priority 2 --description "PROBLEM: ... SUCCESS: ... SCOPE: files B. VALIDATION: ... OUTPUT: ..."

specialists run executor --bead <impl-a> --context-depth 3
specialists run executor --bead <impl-b> --context-depth 3

# Per-chain review
specialists run reviewer --bead <review-a> --job <exec-a-job> --context-depth 3
specialists run reviewer --bead <review-b> --job <exec-b-job> --context-depth 3

# Publish
sp epic status <epic>
sp epic merge <epic>
```

Use `--epic <id>` when job belongs to epic but bead is not direct child. Avoid parallel executors on same file; sequence them or consolidate work.

What differs: orchestrator splits graph first, then launches parallel work only when file scopes are provably disjoint.

## Review And Fix Loop

A chain stays alive until merged or abandoned.

```text
executor/debugger -> waiting
optional code-sanity/security-auditor -> advisory findings
reviewer -> PASS | PARTIAL | FAIL
```

- `PASS`: verify expected commit/diff, then publish.
- `PARTIAL`: resume same executor/debugger with exact findings, then re-review.
- `FAIL`: stop and decide whether to replace chain, re-scope bead, or ask operator if judgment is required.

Prefer resume over new fix executor when original job is waiting and context is healthy:

```bash
sp resume <exec-job> "Reviewer PARTIAL. Fix only these findings: ..."
```

Do not treat job completion, code-sanity OK, security no-findings, or test-runner pass as equivalent to reviewer PASS.

What differs: orchestrator uses PASS/PARTIAL/FAIL as real control flow, not just status labels.

## Mini-Flows For Under-Promoted Specialists

Planner:
- Use when epic needs bead split, dependency graph, or file ownership before code starts.
- Bead shape: task/epic contract with clear success criteria, child beads, and edge plan.
- Chain position: first or pre-impl.

Debugger:
- Use when symptom exists and root cause is unclear.
- Bead shape: reproduction, logs, expected vs actual, scope to investigate.
- Chain position: before executor, or after a failing review when cause is unclear.

Overthinker:
- Use for risky design, cross-cutting tradeoffs, or premortem before lock-in.
- Bead shape: options, risks, constraint conflicts, decision asked for.
- Chain position: before planner/executor when design uncertainty is high.

Researcher:
- Use for current external docs, package behavior, or ecosystem facts that repo cannot answer.
- Bead shape: source list, question set, required citations.
- Chain position: before executor when outside facts matter.

Test-runner:
- Use when commands need to run and failures need classification, not fixes.
- Bead shape: exact command list, suites, and expected failure taxonomy.
- Chain position: after executor or between fix loops.

Sync-docs:
- Use when one doc drifts and must be synced to source truth.
- Bead shape: one-doc scope, source cross-check, drift checks.
- Chain position: parallel to code only when doc scope is isolated; otherwise after code settles.

What differs: orchestrator uses specialists beyond the common trio, so planning, diagnosis, research, tests, and docs do not collapse into executor work.

## Monitoring And Steering

Use `sp ps` for state and `sp result` for completed turns.

```bash
sp ps
sp ps <job-id>
sp ps --bead <bead-id>
sp feed <job-id>
sp result <job-id>
```

If job is running, use `sp feed`. If it is waiting, use `sp result` and decide whether to resume, review, merge, or stop. Avoid tight polling; sleep based on task size, then check once.

Use `steer` for running jobs and `resume` for waiting jobs:

```bash
sp steer <job-id> "Stop broad audit. Answer only the three bead questions."
sp resume <job-id> "Continue with the next scoped fix. Do not refactor."
```

Context usage is an action signal when available:

- 0-40%: healthy.
- 40-65%: monitor.
- 65-80%: steer toward conclusion.
- Above 80%: finish, summarize, or replace job.

Raw token totals are not context percentages.

## What Stays Out

- `memory-processor`: deferred to memory/documenting skill; this skill stays focused on orchestration, not memory synthesis.
- `xt-merge`: deferred to xt-merge skill; this skill names specialist flow, not merge-wrapper internals.

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

- Merge only after reviewer PASS unless operator explicitly accepts draft for follow-up work.
- Use `sp epic merge` for unresolved epic chains; `sp merge` refuses those by design.
- Do not manually `git merge` specialist branches.
- If merge refuses because chain job is still `waiting`, consume result and either resume/stop/finalize that job deliberately.
- If merge reports dirty worktree, inspect that worktree. Revert generated noise only when clearly unrelated; otherwise ask or re-dispatch.
- Run or confirm required gates before closing root bead or epic.

## Failure Recovery

When something fails:

```bash
sp ps <job-id>
sp feed <job-id>
sp result <job-id>
sp doctor
```

Then choose one action:

- Resume waiting executor/debugger with exact findings.
- Re-run with better bead if contract was weak.
- Re-scope bead if scope was wrong.
- Escalate if human decision is needed.
- Replace specialist only if failure mode repeats.

## What Orchestrator Does Differently Because Of This Skill

- Writes bead contract before dispatch.
- Chooses edge type before creating chain.
- Uses specialist role by job shape, not by habit.
- Keeps fix loops alive with resume, not re-spawn.
- Treats reviewer PASS as only publish gate.
- Keeps memory-processor and xt-merge out of this skill on purpose.
