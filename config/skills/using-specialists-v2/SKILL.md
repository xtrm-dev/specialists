---
name: using-specialists-v2
description: >
  Use this skill to orchestrate substantial work through project specialists with
  a bead-first workflow. It covers when to delegate, how to write complete bead
  task contracts, how to run explorer/executor/reviewer/test chains, how to use
  --worktree/--job/--epic/--context-depth, and how to merge or recover specialist
  work without drift. Trigger for code review, debugging, implementation,
  planning, test generation, doc sync, multi-chain epics, and any question about
  specialist orchestration.
version: 1.4
---

# Specialists V2

You are the orchestrator. Your job is to specify the work, choose the right specialist, launch the right chain, monitor progress, and synthesize results. Do not turn orchestration into vague delegation: `--bead` is the prompt.

Use this skill for substantial work: codebase exploration, debugging, implementation, review, testing, documentation sync, planning, specialist authoring, and multi-chain orchestration. Do small deterministic edits directly when the scope is already clear and delegation would add ceremony.

For one-shot synchronous specialist invocations from services or scripts (template + variables, READ_ONLY, JSON out), use `using-script-specialists` instead. That runtime (`sp script` / `sp serve`) is unrelated to bead-first orchestration.

## Update Awareness On Skill Load

On first activation in a session, before substantial work, check whether the local specialists install is current:

```bash
LOCAL=$(node -p "require('./package.json').version" 2>/dev/null)
LATEST=$(git ls-remote --tags --refs origin 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+$' | sort -V | tail -1 | sed 's/^v//')
[ -n "$LATEST" ] && [ "$LOCAL" != "$LATEST" ] && echo "specialists v$LOCAL is local; v$LATEST published — consider /update-specialists before substantial work."
```

Skip the check entirely when `SPECIALISTS_OFFLINE=1` is set, when stdin is not a TTY (specialist-spawned subagent context), or when the previous turn already surfaced this notice. Surface at most one line — never block, never spam, never auto-update. The operator decides whether to run `/update-specialists`.

When the local version is behind, the latest CHANGELOG entry can be summarized via `head -50 CHANGELOG.md` to anchor what changed; cross-link to the `update-specialists` skill for the actual reconcile flow.

## Hard Rules

1. `--bead` is the prompt for tracked work.
2. Do not dispatch until the bead is a complete task contract.
3. Never use `--prompt` to supplement tracked work. Update bead notes instead.
4. Use explorer only when the implementation path is unknown.
5. Use executor only after scope, constraints, and validation are clear enough to act.
6. Edit-capable specialists with `--bead` auto-provision a worktree. `--worktree` is still accepted for clarity but not required (the deprecated `--no-worktree` flag is gone).
7. Reviewer gets its own bead and enters the executor workspace with `--job <exec-job>`. `--job` auto-resolves the bead if `--bead` is omitted.
8. `--context-depth` defaults to 3 (parent task + predecessor + own bead). Override only when the chain needs less or more upstream context.
9. Keep executor/debugger jobs alive through review so they can be resumed.
10. Merge specialist branches with `sp merge` or `sp epic merge`, never manual `git merge`.
11. Specialists must not perform destructive or irreversible actions.
12. If a specialist fails, inspect feed/result and either steer, resume, rerun with a better bead, or report the blocker.
13. Drive chains autonomously. Do not ask the operator to approve routine stage transitions. Escalate only on critical events (see Autonomous Drive section).
14. Stale-base guard: dispatch refuses to provision a worktree when sibling epic chains have unmerged substantive commits. Override only with explicit `--force-stale-base` and a reason. Merge-time rebase happens automatically.
15. Auto-checkpoint: executor and debugger commit substantive worktree changes on `waiting` by default (`auto_commit: checkpoint_on_waiting`). Noise paths (`.xtrm/`, `.wolf/`, `.specialists/jobs/`, `.beads/`) are filtered.
16. Per-turn output appends to the input bead notes for **all** specialists on every `run_complete`, with `[WAITING — more output may follow]` or `[DONE]` headers. `bd show <bead-id>` is a valid path to read intermediate output.
17. Specialist jobs do not orchestrate nested specialist chains. The top-level orchestrator dispatches specialists, collects results, and advances the workflow.
18. Treat test failures as evidence to classify against the bead scope. Validate whether failures are in-scope, pre-existing, or infrastructure-related before sending an executor into a fix loop.

## Canonical Runtime State

These are current operating facts, not migration notes:

- **Asset ownership:** Cat A runtime assets — specialists, mandatory-rules, catalog, and nodes — resolve live from the specialists package after project tiers. Cat B filesystem assets — skills and hooks — are owned by xtrm-tools under `.xtrm/skills/default` and `.xtrm/hooks/default`.
- **Resolution precedence:** project/user tiers win over managed defaults; package-live is the final fallback. Mandatory-rule indexes are not stacked across tiers; per-id mandatory-rule files may fall through to package canonical when absent locally.
- **Drift surface:** use `sp doctor --check-drift` to inspect stale managed defaults and `sp prune-stale-defaults --dry-run` to preview cleanup.
- **Source verification:** resolver/catalog changes in a worktree are verified with `sp config show <name> --resolved --from-source` so evidence comes from the checked-out source, not an installed dist.
- **Worktree publication:** edit-capable specialists produce worktree branches. Before review or merge, verify the branch diff and status from that worktree.
- **Epic publication:** epics are the merge-gated identity. Publish through `sp epic merge`; use `sp epic abandon` to deliberately close failed or cancelled epic bookkeeping.
- **CLI safety:** command help paths are side-effect free. New commands must parse `--help`/`-h` before action and have a no-write help test.
- **Release context:** changelog-keeper receives xt report context through the `releasing` skill's helper. Release-range logic supports annotated tags.

## Autonomous Drive

Once the operator has approved a plan or specified a task, push the chain to completion without pausing for per-stage confirmation. Dispatch, wait with `sleep`, read results, dispatch the next stage, review, and merge. Treat each stage transition as a mechanical step — not a decision point.

Escalate to the operator only for:

- Reviewer verdict `FAIL` (not `PARTIAL` — fix those autonomously via resume).
- Destructive/irreversible action required (history rewrite, force push, credential rotation, mass delete, prod-impacting op).
- Repeated specialist crashes on the same chain (2+ in a row with same failure mode).
- Context-exhaustion risk above 80% with no clean handoff available.
- Ambiguous requirements the bead cannot resolve (rare — fix by updating the bead contract first and retrying).
- Explicit user-facing question embedded in reviewer output that needs human judgment.

Anything else — stage transitions, routine reviewer `PARTIAL` with concrete findings, merge gates passing, test retries — proceed without asking.

### Sleep-Based Polling

Use `sleep` between dispatch and status check. Size the sleep to the observed median for the specialist and adjust by polling once and checking `sp ps <job-id>`:

| Specialist | First sleep | Poll interval after |
| --- | --- | --- |
| executor | `sleep 180` (3m) | 60-120s |
| reviewer | `sleep 120` (2m) | 60s |
| explorer | `sleep 180` (3m) | 60s |
| debugger | `sleep 480` (8m) | 120s |
| overthinker | `sleep 240` (4m) | 60s |
| planner | `sleep 300` (5m) | 60s |
| sync-docs | `sleep 180` (3m) | 60s |
| researcher | `sleep 120` (2m) | 60s |
| test-runner | `sleep 120` (2m) | 60s |

Medians are empirical (derived from run history). Adjust for observed run complexity. If `sp ps` shows `running` after the first sleep, poll once more before assuming stuck. If `waiting`, read `sp result` — reviewer verdicts and READ_ONLY outputs land in the bead notes automatically.

Do not busy-loop `sp ps` in tight intervals. One sleep + one confirmation poll is enough for routine runs.

### Drive Loop Pattern

```bash
# Dispatch
JOB=$(sp run <specialist> --bead <bead-id> --context-depth 3 --background 2>&1 | tail -1)

# Sleep for median
sleep 180

# Check
sp ps "$JOB"

# Still running? Short follow-up sleep, then re-check
# Waiting or done? Read result
sp result "$JOB"

# Advance to next stage based on output — no operator prompt
```

Launch sleeps in the background when other orchestration work can proceed in parallel; the harness will notify on completion. Return to `sp ps`/`sp result` after the median interval elapses.

## Bead Task Contract

Every specialist-bound bead must be a usable prompt. Title-only beads are not acceptable.

Required fields:

```text
PROBLEM: What is wrong or needed.
SUCCESS: Observable completion criteria.
SCOPE: Files, symbols, commands, docs, or discovery area.
NON_GOALS: Explicitly out of scope.
CONSTRAINTS: Compatibility, safety, style, permissions, sequencing.
VALIDATION: Checks/tests/review expected before closure.
OUTPUT: Expected handoff format.
```

Use `bd update <id> --notes "CONTRACT: ..."` when an existing bead is too vague.

### Contract By Bead Type

Task/epic bead:

```text
PROBLEM: User-facing or project-facing objective.
SUCCESS: End-state across all child beads.
SCOPE: Area of project affected.
NON_GOALS: Boundaries for the entire effort.
CONSTRAINTS: Sequencing, compatibility, branch/merge rules.
VALIDATION: Final checks before close.
OUTPUT: What the orchestrator reports back.
```

Explorer bead:

```text
PROBLEM: What is unknown.
SUCCESS: Questions answered with evidence.
SCOPE: Code areas, docs, commands, or symbols to inspect.
NON_GOALS: No implementation, no broad audit outside scope.
CONSTRAINTS: READ_ONLY, prefer GitNexus/code intelligence when available.
VALIDATION: Findings cite files/symbols/flows.
OUTPUT: Findings, risks, recommended implementation track, stop condition.
```

Executor bead:

```text
PROBLEM: Exact behavior or artifact to change.
SUCCESS: Observable acceptance criteria.
SCOPE: Target files/symbols; include "do not touch" boundaries.
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

## Choosing The Specialist

Run `specialists list` if you need the live registry. Choose by task, not by habit.

| Need | Specialist | Use when |
| --- | --- | --- |
| Architecture/code mapping | `explorer` | You need evidence and a scoped implementation track. |
| Root-cause analysis | `debugger` | There is a symptom, stack trace, failing test, or regression. |
| Planning/decomposition | `planner` | You need beads, dependencies, file scopes, or sequencing. |
| Design/tradeoffs | `overthinker` | The approach is risky, ambiguous, or needs critique. |
| Implementation | `executor` | The contract is clear enough to write code or docs. |
| Compliance/code review | `reviewer` | An executor/debugger produced changes that need the final PASS/PARTIAL/FAIL verdict. |
| Implementation sanity | `code-sanity` | You want a cheap READ_ONLY smell pass for simplicity, type safety, dead code, brittle async/error handling, or maintainability before reviewer. |
| Security/dependency audit | `security-auditor` | You need threat modeling, secure-code review, package advisory triage, or agent/config security scanning. LOW: scan/read/recommend only. |
| Multiple review perspectives | `parallel-review` | A critical diff needs independent review passes. |
| Test execution | `test-runner` | You need suites run and failures interpreted. |
| Docs audit/sync | `sync-docs` | Docs may be stale or need targeted synchronization. |
| External/live research | `researcher` | Current non-security library/docs/media lookup is needed. |
| Specialist config | `specialists-creator` | Creating or changing specialist JSON/config. |
| Release publication (end-to-end) | `changelog-keeper` | A new tag is being cut. MEDIUM specialist: drafts CHANGELOG section from xt reports, bumps package.json, rebuilds dist, commits, tags, pushes. Use the `releasing` skill to dispatch. |

Selection rules:

- Explorer is READ_ONLY and should answer specific questions.
- Debugger is better than explorer for failures because it traces causes and remediation.
- Executor does not own full test validation; use reviewer/test-runner for that phase.
- Code-sanity is optional and non-blocking by default: use it when a diff smells overcomplicated or type-risky, then resume executor with concrete findings. It is not a merge gate.
- Security-auditor may run safe local audit commands and web/source research, but must not edit files, update dependencies, exfiltrate secrets, or run destructive/live-target exploit tests. Executor applies any recommended fixes in a separate bead.
- Reviewer always uses its own bead plus `--job <executor-job>` and remains the final merge gate.
- Sync-docs is for audit/sync; executor is for heavy doc rewrites.
- Specialists-creator should precede specialist config/schema edits.

## Command Surface

Daily commands:

```bash
specialists list
specialists list-rules                          # rule × specialist matrix
specialists doctor
specialists doctor --check-drift                 # inspect stale .specialists/default snapshots
sp prune-stale-defaults --dry-run                # preview redundant default snapshots
specialists run <name> --bead <id> --background
specialists run executor --bead <impl-bead> --background       # worktree auto-provisioned
specialists run code-sanity --bead <sanity-bead> --job <exec-job> --keep-alive --background
specialists run security-auditor --bead <security-bead> --job <exec-job> --keep-alive --background
specialists run reviewer --bead <review-bead> --job <exec-job> --keep-alive --background
specialists ps
specialists ps <job-id>
specialists feed <job-id>
specialists feed -f
specialists result <job-id>                     # works on done/error/waiting
specialists result <job-id> --wait --timeout 600
specialists steer <job-id> "new direction"
specialists resume <job-id> "next task"
specialists stop <job-id>
```

Publication commands:

```bash
sp merge <chain-root-bead>
sp epic status <epic-id>
sp epic sync <epic-id> --apply
sp epic merge <epic-id>
sp epic abandon <epic-id> --reason "..."
sp end
```

`sp result <job-id>` returns the most recent completed turn for `waiting` jobs with a `Session is waiting for your input` footer — use it to inspect a keep-alive job before deciding whether to resume. For `running` jobs, `sp feed <job-id>` is the right tool. Avoid `specialists status --job` for normal monitoring; prefer `sp ps <job-id>`.

## Flag Semantics

`--bead <id>` is the task prompt and tracked work identity.

`--context-depth N` controls parent/ancestor bead context. Default is **3** (own bead + predecessor + parent task). Lower it when the chain is shallow or the parent context is noisy.

`--worktree` provisions a new isolated workspace and branch for edit-capable work. Optional when `--bead` is provided to an edit-capable specialist — a worktree is auto-provisioned. Pass `--worktree` explicitly only when you want it without a bead, or for emphasis. The deprecated `--no-worktree` flag is removed and now errors out.

`--job <id>` reuses an existing job's workspace. Use it for reviewer and fix passes. If `--bead` is omitted, bead_id is inferred from the target job's status; explicit `--bead` always wins.

`--force-job` overrides the concurrency lock that blocks edit-capable specialists from entering an owner workspace while it is `starting`/`running`. Use only when you accept the write race; prefer `sp stop` on dead jobs first.

`--force-stale-base` bypasses the dispatch-time stale-base guard that blocks `--worktree` provisioning when sibling epic chains have unmerged substantive commits. Use only with a clear reason; the guard prevents merge-conflict cascades.

`--epic <id>` explicitly associates a job with an epic. Use it for prep jobs whose parent is not the epic but should appear in epic status/readiness.

`--keep-alive` keeps interactive specialists waiting after a turn. Use for reviewer, overthinker, researcher, sync-docs, and any job expected to receive follow-up.

`--worktree` and `--job` are mutually exclusive.

## Golden Path: Single Implementation Chain

Use this when one implementation branch can solve the task.

Create a root task bead:

```bash
bd create --title "Fix token refresh retry on 401" --type bug --priority 2 \
  --description "PROBLEM: API clients fail permanently when token refresh receives a transient 401.
SUCCESS: Refresh retries are bounded, observable, and callers receive the same public error shape after exhaustion.
SCOPE: src/auth/refresh.ts, src/auth/client.ts, related auth tests.
NON_GOALS: Do not redesign auth storage or change public client API.
CONSTRAINTS: Preserve existing telemetry names and backward compatibility.
VALIDATION: lint, tsc, auth refresh tests or documented targeted equivalent.
OUTPUT: Changed files, validation results, residual risk."
```

Create explorer only if the implementation path is unclear:

```bash
bd create --title "Explore token refresh retry path" --type task --priority 2 \
  --description "PROBLEM: Need exact refresh call graph and retry insertion point.
SUCCESS: Identify caller/callee path, current retry behavior, and safest files to modify.
SCOPE: auth refresh/client modules and tests only.
NON_GOALS: No implementation.
CONSTRAINTS: READ_ONLY; cite files/symbols.
VALIDATION: Findings include recommended executor scope and risks.
OUTPUT: Evidence-backed implementation plan."
bd dep add <explore> <task>
specialists run explorer --bead <explore> --context-depth 3 --background
specialists result <explore-job>
```

Create implementation bead:

```bash
bd create --title "Implement bounded token refresh retry" --type task --priority 2 \
  --description "PROBLEM: Implement the retry behavior identified by exploration.
SUCCESS: 401 refresh retry is bounded and preserves public errors after exhaustion.
SCOPE: src/auth/refresh.ts, src/auth/client.ts, auth refresh tests.
NON_GOALS: No storage redesign, no public API change.
CONSTRAINTS: Keep telemetry names stable; avoid broad refactor.
VALIDATION: npm run lint, npx tsc --noEmit, targeted auth tests if available.
OUTPUT: Diff summary, checks run, follow-up risks."
bd dep add <impl> <explore-or-task>
specialists run executor --worktree --bead <impl> --context-depth 3 --background
specialists result <exec-job>
```

Optional code-sanity pass for implementation smell checks (use when the diff is non-trivial or likely to accumulate agent-code complexity):

```bash
bd create --title "Code sanity check token refresh retry" --type task --priority 3 \
  --description "PROBLEM: Cheap READ_ONLY sanity pass for executor implementation quality before final review.
SUCCESS: Identify concrete simplicity/type-safety/maintainability findings, or return OK.
SCOPE: executor job <exec-job>, implementation diff only.
NON_GOALS: No requirements verdict, no security audit, no test execution, no edits.
CONSTRAINTS: At most 5 concrete findings; cite files/symbols/lines where possible.
VALIDATION: Findings are suitable to paste into specialists resume <exec-job>.
OUTPUT: OK/FINDINGS/BLOCKED with handoff."
bd dep add <sanity> <impl>
specialists run code-sanity --bead <sanity> --job <exec-job> --context-depth 3 --keep-alive --background
specialists result <sanity-job>
```

If code-sanity returns `FINDINGS`, resume executor with those concrete instructions, then rerun code-sanity only if the fixes were substantive. Do not treat code-sanity `OK` as reviewer PASS.

Optional security pass when the task touches auth, secrets, input handling, dependency updates, package advisories, agent config, hooks, or exposed endpoints:

```bash
bd create --title "Security audit token refresh retry" --type task --priority 2 \
  --description "PROBLEM: Scoped security/dependency/config audit for executor changes.
SUCCESS: Identify evidence-backed security findings or return no findings.
SCOPE: executor job <exec-job>, changed files, relevant manifests/config only.
NON_GOALS: No edits, no package updates, no destructive scans, no live exploit testing.
CONSTRAINTS: LOW permission; recommendations only. HN/social signals are not authoritative proof.
VALIDATION: Findings cite local evidence or OSV/GHSA/NVD/vendor/package-audit sources.
OUTPUT: Security audit summary, findings, dependency triage, residual risk."
bd dep add <security> <impl>
specialists run security-auditor --bead <security> --job <exec-job> --context-depth 3 --keep-alive --background
specialists result <security-job>
```

If security-auditor recommends code or dependency changes, create/resume an executor fix bead. Do not let security-auditor apply updates.

Create review bead:

```bash
bd create --title "Review token refresh retry implementation" --type task --priority 2 \
  --description "PROBLEM: Verify executor changes satisfy token refresh retry contract.
SUCCESS: PASS only if behavior, scope, constraints, and validation are satisfied.
SCOPE: executor job <exec-job>, implementation bead, root task contract.
NON_GOALS: Do not request unrelated auth redesign.
CONSTRAINTS: Findings first with file/line references.
VALIDATION: Inspect diff and available checks.
OUTPUT: PASS/PARTIAL/FAIL verdict with required fixes."
bd dep add <review> <impl>
specialists run reviewer --bead <review> --job <exec-job> --context-depth 3 --keep-alive --background
specialists result <review-job>
```

If reviewer returns `PARTIAL`, prefer resuming the same executor:

```bash
specialists resume <exec-job> "Reviewer PARTIAL. Fix only these findings: ..."
```

Then create a new re-review bead and run reviewer again with the same `--job <exec-job>`.

After reviewer `PASS`, publish:

```bash
sp merge <impl>
bd close <task> --reason "Fixed token refresh retry. Reviewer PASS. Merged."
```

## Golden Path: Multi-Chain Epic

Use this when multiple independent implementation chains must publish together.

Create a top-level epic with the complete contract:

```bash
bd create --title "Add specialist bead contract enforcement" --type epic --priority 1 \
  --description "PROBLEM: Specialists drift when --bead issues are under-specified.
SUCCESS: Docs and runtime guidance require complete bead contracts before dispatch.
SCOPE: docs/workflow guidance, skill docs, optional validation entry point.
NON_GOALS: No database migration, no breaking CLI changes.
CONSTRAINTS: Keep examples canonical and avoid title-only beads.
VALIDATION: docs review, lint/typecheck for runtime changes, reviewer PASS per chain.
OUTPUT: Merged epic with documented contract and verification."
```

Create a shared prep bead:

```bash
bd create --title "Plan bead contract enforcement tracks" --type task --priority 2 \
  --description "PROBLEM: Need file-disjoint implementation tracks for the epic.
SUCCESS: Identify independent chains, dependencies, risks, and validation per chain.
SCOPE: workflow docs, CLI/run validation surfaces, tests.
NON_GOALS: No implementation.
CONSTRAINTS: READ_ONLY; produce dependency plan.
VALIDATION: Plan names file scopes and merge order.
OUTPUT: Parallel track plan."
bd dep add <plan> <epic>
specialists run planner --bead <plan> --epic <epic> --context-depth 3 --background
```

Create independent implementation beads only when write scopes are disjoint:

```bash
bd create --title "Implement CLI bead contract warning" --type task --priority 2 \
  --description "PROBLEM: CLI allows specialist dispatch from vague beads.
SUCCESS: Dispatch warns or blocks according to agreed contract policy.
SCOPE: src/cli/run.ts, src/specialist/beads.ts, related tests.
NON_GOALS: No schema migration.
CONSTRAINTS: Preserve --prompt behavior for explicit ad-hoc runs.
VALIDATION: lint, tsc, targeted run/beads tests.
OUTPUT: Diff summary and verification."
bd dep add <impl-cli> <plan>

bd create --title "Update workflow docs for bead contract" --type task --priority 2 \
  --description "PROBLEM: Docs teach title-only specialist beads.
SUCCESS: Canonical examples use complete task contracts.
SCOPE: config/skills/using-specialists/SKILL.md, CLAUDE.md, docs/features.md.
NON_GOALS: No runtime code.
CONSTRAINTS: Keep docs concise and current.
VALIDATION: Review examples for contract fields and stale commands.
OUTPUT: Updated docs summary."
bd dep add <impl-docs> <plan>
```

Run parallel executors only if scopes are disjoint:

```bash
specialists run executor --worktree --bead <impl-cli> --context-depth 3 --background
specialists run executor --worktree --bead <impl-docs> --context-depth 3 --background
```

Review each chain with its own review bead and `--job`.

After every chain has reviewer `PASS`:

```bash
sp epic status <epic>
sp epic merge <epic>
bd close <epic> --reason "All chains reviewer PASS. Epic merged."
```

## Review And Fix Loop

A chain stays alive until merge or abandonment.

Standard loop:

```text
executor --worktree --bead impl
  -> waiting after turn
optional code-sanity --bead sanity --job exec-job
  -> OK: continue
  -> FINDINGS: resume executor with exact sanity findings
optional security-auditor --bead security --job exec-job
  -> no findings: continue
  -> findings: create/resume executor fix bead; auditor never edits
reviewer --bead review --job exec-job
  -> PASS: verify commit, publish, stop members if needed
  -> PARTIAL: resume executor with exact findings
  -> FAIL: decide whether to resume, replace, or abandon
```

Prefer `sp resume <exec-job>` over a new fix executor when the original job is waiting and context is healthy. Use a new fix bead with `--job <exec-job>` only when the original executor is dead, context exhausted, or a separate audit trail is required.

Code-sanity and security-auditor outputs are advisory inputs to the chain; reviewer output must still be consumed before publishing. Do not treat job completion, code-sanity OK, or security no-findings as equivalent to reviewer acceptance.

## Dependency Mapping

The bead graph should mirror execution order.

Simple chain:

```text
task -> explore -> impl -> review
```

Fix loop:

```text
task -> explore -> impl -> review -> re-review
                      ^        |
                      |        v
                    resume executor with findings
```

Epic:

```text
epic -> shared prep -> impl-a -> review-a
                   -> impl-b -> review-b
                   -> test-batch
                   -> epic merge
```

Use `bd dep add <issue> <depends-on>` so downstream beads are blocked until upstream context exists. Test beads can depend on multiple implementation beads.

## Monitoring

Use `sp ps` instead of ad-hoc polling.

```bash
sp ps
sp ps <job-id>
sp ps --follow
sp ps --running                       # only starting/running/waiting jobs
sp ps --bead <bead-id>                # only jobs linked to one bead
sp ps --since 30m                     # only jobs started in the last 30 minutes
sp ps --mine                          # only jobs whose bead is assigned to you
sp ps --include-terminal              # include merged/abandoned epics (hidden by default)
sp feed <job-id>
sp result <job-id>
```

Filter flags compose: `sp ps --running --bead <id>` is the canonical way to inspect "what's actively working on this issue right now". By default `sp ps` hides epics in `merged` or `abandoned` state to keep the snapshot focused; use `--include-terminal` (or `--all`) to bring them back.

When dead epics pile up in `failed` state (sibling-chain conflicts, manual stops), recover with `sp epic abandon <epic-id> --reason "<text>"`. The `failed -> abandoned` transition is allowed specifically for cleanup; live members still require `--force`.

Read results at every stage. Every specialist (not just READ_ONLY) auto-appends per-turn output to the input bead notes on each `run_complete`, with `[WAITING]` or `[DONE]` headers — `bd show <bead-id>` shows the full handoff trail. `sp result <job-id>` works on `waiting` jobs and returns the most recent turn plus a "Session is waiting for your input" footer; use it to decide whether to resume. If result is empty, inspect feed and rerun or switch specialists before relying on it.

Context percentage in `sp ps`/feed is an action signal:

- 0-40%: healthy.
- 40-65%: monitor.
- 65-80%: steer toward conclusion.
- Above 80%: finish, summarize, or replace the job.

Do not confuse raw token totals with context percentage. `sp ps` may show raw token counts around 50k-100k for large-context models; that alone is not a stop signal. Use the context percentage when available, plus stalls, repeated edit failures, or scope drift.

## Steering And Resume

Use `steer` for running jobs:

```bash
sp steer <job-id> "Stop broad audit. Answer only the three questions in the bead."
```

Use `resume` for waiting keep-alive jobs:

```bash
sp resume <job-id> "Reviewer PARTIAL. Fix only findings 1 and 2; do not refactor."
```

Do not use `resume` as a substitute for a missing bead contract on a new tracked task. Create or update the bead first.

## Merge Rules

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

- Merge only after reviewer `PASS`.
- Use `sp epic merge` for unresolved epic chains.
- Do not merge within a chain between executor and reviewer.
- Merge between stages only when later stages need the code on the main line.
- Run or confirm required gates before closing the root bead or epic.

## Release Publication

Tagged releases go through the `releasing` skill, which dispatches the
`changelog-keeper` MEDIUM specialist. The specialist reads xt session
reports via the releasing skill's `xt-reports.ts` helper, drafts the new
section into `CHANGELOG.md`, bumps `package.json`, rebuilds `dist/`, commits
with `release: vX.Y.Z`, tags, and pushes `--follow-tags`. Optional
`gh release create` if the bead requests it.

Operator gate: a single `git diff --stat HEAD~1 HEAD` after the specialist
finishes. Must show only `CHANGELOG.md`, `package.json`, `dist/`. Anything
else means scope was violated — revert and refile.

The `changelog-keeper-scope` mandatory rule enforces the edit whitelist at
the specialist level. See `config/skills/releasing/SKILL.md` for the bead
template, dispatch command, and recovery commands.

Release helper contract:

- Report extraction is provided by the `releasing` skill, so consumer repos do not need repo-local release helper scripts.
- Release ranges support annotated tags and should be validated through the same path used by tagged releases.

## Epic Lifecycle

Epics are merge-gated identities with a persisted state machine:

```text
open -> resolving -> merge_ready -> merged
                  -> failed
                  -> abandoned
```

| State | Meaning | Chains mergeable? |
| --- | --- | --- |
| `open` | Epic created, chains not yet running. | No |
| `resolving` | Chains actively running. | No |
| `merge_ready` | All chains terminal, reviewer PASS, tsc gate passes. | Yes via `sp epic merge` |
| `merged` | Publication complete. | — |
| `failed` | One or more chains failed. | Resolve or abandon. |
| `abandoned` | Cancelled without merge. | — |

Operator transitions:

```bash
sp epic resolve <epic-id>              # open -> resolving (marks epic as merge-ready target)
sp epic merge <epic-id>                # merge_ready -> merged (canonical publication)
sp epic merge <epic-id> --pr           # PR mode (publish via pull request)
sp epic sync <epic-id> --apply         # reconcile DB vs live job state when stuck
sp epic abandon <epic-id> --reason <t> # terminal close for unrecoverable epic
sp epic abandon <epic-id> --reason <t> --force  # force when active pointers still exist
```

`sp merge <chain>` refuses if the chain belongs to an unresolved epic. Use
`sp epic merge` for epic-owned chains.

## Concurrency And Force Flags

Edit-capable specialists (MEDIUM/HIGH permission) are blocked from entering a
workspace while the owner job is `starting` or `running`. This prevents
concurrent file corruption. READ_ONLY specialists (explorer, etc.) are always
allowed.

Override with `--force-job` only when the caller explicitly accepts the write
race (e.g. emergency fix into a stalled-but-not-terminal executor):

```bash
sp run executor --bead <fix-bead> --job <stalled-exec-job> --force-job --context-depth 3 --background
```

Do not use `--force-job` as a routine unblock. Inspect `sp ps <job-id>` and
prefer `sp stop <job-id>` on truly dead jobs first.

## Terminology Bridge

Historical conversations and docs use "waves" for dispatch batches (e.g. "Wave
1" / "Wave 2"). "Waves" are human shorthand only — not persisted. The
merge-gated identity is the epic. Map mental models as follows:

| Legacy speech | Canonical concept |
| --- | --- |
| "Wave 1" / prep wave | Stage 1 / shared prep job, `--epic` for membership |
| "Wave 2" | Implementation chains under one epic |
| "Between waves merge" | `sp epic merge <epic-id>` |
| "Parallel in wave" | Parallel chains under the same epic (disjoint scopes) |

Treat "wave" as speech, "epic" as truth.

## Failure Handling

If a job fails or stalls:

```bash
sp ps <job-id>
sp feed <job-id>
sp result <job-id>
sp doctor
```

Then choose one action:

- Steer a running job back to scope.
- Resume a waiting job with exact next instruction.
- Stop a dead or obsolete job.
- Rerun with a better bead contract.
- Switch specialist if the selected role was wrong.
- Report blocker if destructive/high-risk/manual action is required.

Do not silently fall back to doing substantial specialist work yourself unless the user agrees or the work is genuinely small and deterministic.

## Recovery Cheatsheet

Dead or zombie process:

```bash
sp stop <job-id>                                # explicit single-job stop
sp clean --processes --dry-run                  # preview stale non-terminal cancellations (PID-dead OR > --stale-after, default 24h)
sp clean --processes                            # apply: cancel stale rows in observability.db
```

`sp clean --processes` reads from `observability.db` (DB-first) and uses PID liveness as the primary gate — alive PIDs are never cancelled regardless of age. The `--stale-after <hours>` fallback applies only when a row has no recorded PID. `sp clean` with no flags purges terminal rows older than `SPECIALISTS_JOB_TTL_DAYS` (7d default); `--all` purges all terminals; `--keep <n>` retains the N most recent.

Epic state unclear:

```bash
sp epic status <epic-id>
sp epic sync <epic-id> --apply
```

Specialist missing, config skipped, or stale default snapshots:

```bash
specialists list
specialists doctor
specialists doctor --check-drift
sp prune-stale-defaults --dry-run
```

`sp prune-stale-defaults` is intentionally operator-facing. Always run `--dry-run` first unless the bead explicitly asks to apply cleanup.

Worktree already exists:

```text
Rerun with the same bead if it is safe; worktree is reused rather than recreated.
```

Reviewer cannot enter job workspace:

```text
Check target job status with sp ps. MEDIUM/HIGH jobs are blocked from entering a running write-capable workspace unless forced.
```

When resolver/catalog changes are under review inside a worktree, run `sp config show <name> --resolved --from-source` so reviewer sees local source behavior, not installed dist.

Explorer produced empty output:

```text
Inspect feed. If no usable final summary exists, rerun with a clearer explorer bead or switch to debugger/planner as appropriate.
```

## What Not To Put In This Skill

Do not add historical migration notes, stale model names, exhaustive command references, internal token counts, long stuck-state postmortems, or title-only examples. Put long reference material in docs and keep this skill focused on current canonical orchestration.
