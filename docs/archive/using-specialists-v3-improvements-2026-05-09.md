# Proposed improvements to `using-specialists-v3` skill

> **Status: DONE (2026-05-13)** — merged into `using-specialists-v3` SKILL.md v3.3 + `using-specialists-auto` SKILL.md v2.0 (commits `0b4487c0` + `0b1d8220`).
>
> - **~80% of Part C workarounds obsoleted by code fixes** earlier in session 2026-05-13a/b/c: `unitAI-lqsha` (reviewer injected-diff noise filter), `unitAI-pqe96` (sp merge .beads/+.xtrm/skills/active/ ignore), `unitAI-a6e60` (sp merge --target-branch), `unitAI-wq0mw` (dead-toolchain reaper), `unitAI-xbofm` (background-dispatch stderr surfacing), `unitAI-6fsxp` (reviewer blast-radius gate relaxation), `unitAI-889dv` (sp feed DB-backed full event replay — the root-cause fix for the reviewer false-PARTIAL pattern).
> - **Doctrine sections A0–A9 + Part B targeted edits merged into v3.3** with one exception (A9 session-close report — referenced via `/session-close-report` skill instead of duplicating the template, since session-close is its own skill).
> - **Auto-mode overlay (`using-specialists-auto`) trimmed to v2.0** to delegate shared content (sleep cadence, rebuttal pattern, escalation matrix, memory-gate batch close) to v3 — auto skill is now a minimal discipline overlay (~137 lines) instead of duplicating v3 content.
> - **Remaining residual** (filed but not yet shipped): one ~5-min `sp edit executor` patch to add a generic "don't edit generated files" CONSTRAINT to executor system prompt (proposal L588). Tracked as backlog.
> - **Two bd/Dolt-internal workarounds (Part C #6 and #7) retained as Failure Recovery patterns in v3.3** — these are bd-side and out of specialists' scope to fix.
>
> Kept below for historical reference. Do not action items from this doc directly; the canonical sources are now v3 SKILL.md v3.3 and auto SKILL.md v2.0.

---

**Source:** lessons from the 2026-05-09 xtrm-tools full-auto orchestration session (~75 specialist dispatches, 22 chains landed, 6 friction beads filed), with a 2026-05-11 addendum from a follow-up cli-test-suite epic (11 dispatches across 5 disjoint clusters, 34→0 fails, captured in `.xtrm/reports/2026-05-11-1f573e2.md`). Addendum additions are tagged inline as **(2026-05-11)**.
**Target:** `specialists/config/skills/using-specialists-v3/SKILL.md` (current version: 3.2).
**Owner:** specialists repo.
**Bead:** xtrm-clzv (+ xtrm-wa45 for the 2026-05-11 addendum).

The skill is solid for **dispatch + chain + reviewer**. The gaps surfaced by this session live around **integration-phase reconciliation, post-merge smoke validation, conversation-style overthinker use, autonomous long-running orchestration, and explicit workarounds for known harness bugs that won't be fixed before the next release**. This document proposes additive sections + targeted edits.

---

## Part A — Net-new sections to add

### A0. Advisory passes are part of every chain (REINFORCEMENT — 2026-05-12)

The current SKILL.md has a doctrine section "Security-Auditor and Code-Sanity Are Part of the Chain" (line ~95) saying both are not optional for substantive diffs. The integration patterns introduced below (A1 cherry-pick playbook, A2 debugger-restitch, A3 E2E smoke) and the escalation matrix (A4) must explicitly route through this doctrine — otherwise an agent following the new sections will skip advisory passes by omission. Observed reality 2026-05-09 → 2026-05-11: code-sanity is under-used; reviewers absorb its responsibilities and produce noisier PARTIAL verdicts.

**Add this section before "Canonical Single-Chain Flow" or fold into the existing "Security-Auditor and Code-Sanity Are Part of the Chain" section to strengthen it:**

````markdown
## Advisory Passes Are Part Of Every Chain

For any substantive diff, the chain shape is:

```
executor → code-sanity (if smell) → security-auditor (if risk surface) → reviewer → merge
```

Triggers:

- **code-sanity**: diff has control-flow complexity, duplication, type-risky changes, or unusual brittleness shape. Cheap. Output is advisory; executor applies findings or reviewer arbitrates.
- **security-auditor**: diff touches auth, secrets, input handling (user/network/file), dependency lockfiles, agent/MCP/config surfaces, or token-storage paths. Output is advisory; executor applies findings.

Routing patterns (cross-referenced from A1–A4, A6):

- Cherry-pick integration (A1): advisory passes run on the last executor job in each chain BEFORE the squash-commit step.
- Debugger-restitch (A2): advisory passes run on the debugger's job AFTER the restitch turn, BEFORE reviewer.
- E2E smoke (A3): security-auditor runs on the cumulative integrated diff if any landed chain touched a sensitive surface, BEFORE smoke completes.
- Reviewer rebuttal (A6): code-sanity / security-auditor findings count as legitimate evidence to support or rebut a reviewer verdict.

Skipping an advisory pass on a substantive diff is an escalation event (A4).

When the diff is purely additive (new files only, no existing-symbol modifications), advisory passes are optional — note the new-file scope explicitly in the chain's handoff. Test-only diffs that touch no production code path skip security-auditor by default but should still get code-sanity if the test logic is non-trivial.
````

### A1. Integration phase / cherry-pick playbook

The skill currently assumes `sp merge` and `sp epic merge` are the only publish path. In practice when chains forked from a non-`main` working branch (e.g. `fix/foo-baseline`), `sp merge` fails because it hardcodes `main` as the rebase target (filed as xtrm-nr05). The orchestrator falls back to manual cherry-pick + debugger restitch — a multi-step pattern that the skill should teach explicitly.

**Add this section after "Merge And Publication":**

````markdown
## Integration Phase — Cherry-Pick Playbook

Use this when:
- `sp merge` refuses (e.g., chains forked from a non-main working branch)
- The operator wants visibility before publish
- Multiple chains must land into a single integration branch before main

### Step-by-step

1. Stash uncommitted state on working branch: `git stash push -u -m "pre-integration"`.
2. Create integration branch off the working branch: `git checkout -b integration/<date>-orchestrator`.
3. For each non-overlapping chain (security/critical first, then test-baseline, then features):
   - `git merge --squash <chain-branch>`
   - Restore noise files (see "Chain noise filter checklist" below)
   - **Advisory passes per A0** before commit: if the staged diff smells overcomplicated/duplicative/type-risky, dispatch `code-sanity --job <last-exec-job-of-chain>`; if it touches auth/secrets/input/agent-config, dispatch `security-auditor --job <last-exec-job-of-chain>`. Apply findings or document why skipped. Skipping on a substantive diff is an escalation event (A4).
   - `git commit -m "<type>(<scope>): <summary> (<bead-id>)"` — one squash commit per chain
4. For each overlapping chain, switch to the **debugger-restitch** pattern (see A2).
5. After all chains land, run E2E smoke phase (see A3) before declaring done.
6. Operator FF-merges integration → main when satisfied.

### Chain noise filter checklist

Before committing each squashed chain, unstage:

- `.pi/npm` — accidentally created by xt commands inside worktrees
- `cli/pnpm-lock.yaml` and `cli/pnpm-workspace.yaml` — pnpm side-effects
- `AGENTS.md` and `CLAUDE.md` — gitnexus stat-refresh hook noise
- `.beads/issues.jsonl` and `.beads/interactions.jsonl` — bd state changes from your own bd close calls
- Any `.beads/*` symlink-vs-dir conflicts (worktree bd setup leaks)
- `.specialists/executor-result.md` — last specialist's transient output

```bash
git restore --staged .beads .pi AGENTS.md CLAUDE.md
git checkout HEAD -- .beads AGENTS.md CLAUDE.md
rm -f .pi/npm
```

If a chain commits its own `.beads` symlink (older bd-in-worktree behavior), `rm -f .beads` then `git checkout HEAD -- .beads` to restore the real directory.
````

### A2. Debugger-restitch pattern (NEW)

When a chain conflicts with already-landed work, raw `git cherry-pick` will revert the landed work. The debugger-restitch pattern preserves both — but only when the debugger is given an explicit "preserve already-landed work" contract. This pattern saved the 2026-05-09 session.

````markdown
## Debugger-Restitch Pattern

When chain X conflicts with already-landed chain Y on shared files:

1. **Reopen X**: `bd reopen <X> --reason="integration stitch onto post-Y state"`.
2. **Strengthen the bead contract** with these fields:
   - `## CRITICAL CONSTRAINTS:` heading at the top
   - "Fork off integration/<date>-orchestrator. Verify with `git log integration/...$..HEAD` empty before any commits."
   - List the symbols/lines from Y that MUST be preserved verbatim (with file paths).
   - "ADD X's intent ON TOP" with a numbered list of the additions.
   - "Reference original feature/<X>-executor for symbol shapes only — do NOT cherry-pick or merge. Re-implement on integration's current state."
   - `## VALIDATION:` includes both Y's tests passing AND X's new tests passing.
   - `## OUTPUT:` mandates a 5-line code excerpt showing both Y and X features coexisting.
3. **Dispatch debugger** with `--force-stale-base` if X is an epic child:
   ```bash
   sp run debugger --bead <X> --force-stale-base --keep-alive --background
   ```
4. **Sanity check the result**: when the debugger reports back, run:
   ```bash
   git log integration/<date>..feature/<X>-debugger --oneline
   git diff integration/<date>...feature/<X>-debugger -- <key-files>
   ```
   Confirm the debugger's diff is **additive** — no reverts of Y's lines.
5. **Advisory passes per A0**: before landing the restitch, dispatch `code-sanity --job <debugger-job>` if the restitch added control-flow complexity, and `security-auditor --job <debugger-job>` if the restitch touched a sensitive surface. Restitched diffs are higher-risk than fresh executor diffs because the debugger had to thread around already-landed work — they should never skip advisory passes.
6. **Land via FF or cherry-pick the named commit** (NOT the checkpoint commit). Look for the commit with the proper `<type>(<scope>):` message; ignore `checkpoint(debugger):` commits above it.
7. **Verify tests** before marking done.

### Failure mode to watch for

If the debugger forks off the OLD baseline (pre-Y) instead of integration, its commit will revert Y. Symptom: `git diff integration..feature/<X>-debugger -- <Y's-file>` shows DELETIONS of Y's symbols. Fix: resume the debugger with explicit `cd to a fresh worktree forked from integration/<date>-orchestrator` instruction. Re-verify with `git log integration..HEAD` empty.
````

### A3. E2E smoke phase before close (MANDATORY at end of integration)

This session discovered a missed chain (xtrm-qtq9) only via post-integration smoke testing. The skill should mandate this step.

````markdown
## E2E Smoke Phase (MANDATORY before declaring integration done)

After all chains land, run **every** npm script + entry point that any chain added or modified. The smoke phase is the only way to catch:

- Missed chains (you forgot to cherry-pick one)
- False-positive CI gates (script flags itself)
- Missing intermediate files (e.g., a verifier that needs a file the vendor script creates)
- Runtime regressions invisible to unit tests

### Procedure

```bash
# Build sanity
npm run build --workspace cli   # or equivalent

# Test sanity — record PRE-baseline first
git checkout <baseline-branch>
npm test --workspace cli 2>&1 | tail -5   # record N failed / M passed

# Switch back and re-run
git checkout integration/<date>-orchestrator
npm test --workspace cli 2>&1 | tail -5   # MUST be ≥ baseline. Net regression is a stop-the-line.

# Run every check:* script the integration added
for s in $(jq -r '.scripts | keys[] | select(startswith("check:"))' package.json); do
  echo "=== $s ==="
  npm run "$s" 2>&1 | tail -10
done

# Targeted unit tests for chains touching the same files
npx vitest run <chain-test-files>
python3 -m pytest <chain-python-tests>
```

For each smoke that fails, **decide before continuing**:
- False positive (script flags itself, etc.) → file follow-up bead, document, continue
- Missing dependency (vendor not run, etc.) → expected gate, document
- Real regression → stop, dispatch debugger to fix, re-smoke

### Cross-cutting security-auditor pass (per A0)

If ANY landed chain in this integration touched auth, secrets, input handling, dependency lockfiles, or agent/MCP/config surfaces, dispatch one `security-auditor` on the cumulative integration diff BEFORE declaring smoke done:

```bash
git diff <baseline>..integration/<date>-orchestrator > /tmp/integration-diff.patch
# file a sanity bead pointing at /tmp/integration-diff.patch + the touched-surface list
sp run security-auditor --bead <sec-bead> --context-depth 3 --background
```

Per-chain security-auditor passes in A1/A2 catch chain-local risks; this cross-cutting pass catches interaction risks that only appear once all chains coexist (e.g. one chain weakens an input validator that another chain newly relies on). Skipping this on a sensitive-surface integration is an escalation event (A4).

Record all smoke results in the session-close-report under a `## Smoke test results` table.
````

### A4. Operator escalation matrix

The skill talks about destructive operations but doesn't enumerate. Add a clear "what to escalate" table.

````markdown
## Operator Escalation Matrix

Action | Default | Always escalate to operator
---|---|---
Code edit | Specialist only | (never orchestrator-direct)
Cherry-pick onto integration branch | Auto if non-overlapping | Conflict resolution that requires manual edits
Manual conflict resolution | Never | Always
Force push | Never | Always
Branch delete | Never | Always
Stash pop where conflict expected | Auto | Stash conflict that destroys session-start state
`bd dolt fsck --revive-journal-with-data-loss` | Never | Always — has explicit data-loss warning
`sp epic merge` | Auto if all children PASSed | Skip if any child reviewer-FAILed
Skip `code-sanity` on a substantive diff | Auto-skip only on test-only or new-file-only diffs | Always escalate before skipping on a multi-file production diff
Skip `security-auditor` on diff touching auth/secrets/input/agent-config | Never | Always — sensitive-surface diffs always get the pass per A0
`sp stop <job>` | Auto when job is done/stale | Never on actively-running unless context blown
`git push origin <branch>` | Auto for chain branches (read-only push) | Force-push or delete-remote always
`npm publish` | Never | Always
Dependency bump | Auto for patch-bumps in security work | Major/minor bumps escalate
Config file edit (.beads/config.yaml) | Auto for shared-server flag re-add | Schema-changing edits escalate
````

### A5. Conflict cluster identification (PRE-DISPATCH)

The orchestrator should map overlap surface BEFORE dispatching parallel waves, not discover conflicts at integration time. Add to "Dependency Linking" or as a new section.

````markdown
## Pre-Dispatch: Conflict Cluster Identification

Before dispatching N parallel chains, build the file-overlap matrix:

```bash
# For each candidate chain, list what files it'll touch (from bead SCOPE)
# Then group by file overlap:
```

| Chain | Touches | Overlap with |
|-------|---------|--------------|
| sm1t | cli/src/commands/update.ts | 42in, 19e5 |
| 42in | cli/src/commands/update.ts, install.ts, registry-scaffold.ts | sm1t, 19e5, u3t |
| 19e5 | cli/src/commands/update.ts, install.ts, doctor.ts | sm1t, 42in |

For each cluster of overlapping chains, choose **one** of:

1. **Serial dispatch** — execute chains in dependency order, each waits for previous to land. Slowest but cleanest.
2. **Unified bead** — collapse all chains into one bead/executor pass. Larger reviewer scope but no merge conflicts.
3. **Parallel dispatch + debugger restitch at integration** — dispatch in parallel, plan for ~50% conflict rate, budget debugger-restitch passes during integration phase.

Empirical conflict rates from 2026-05-09:
- 8 of 20 chains conflicted on shared files (~40%)
- Each conflict cost ~1 debugger restitch (~5–10 min wall time)
- Net: serial order on the 3 worst clusters would have saved ~30 min vs parallel + restitch

Default heuristic: if 3+ chains touch the same file, **serial-dispatch them**.
````

### A5b. Pre-epic test-failure-map pattern **(2026-05-11)**

When a test suite has many failures and the operator wants them all fixed, do NOT dispatch parallel fix chains blind. Land one read-only mapping bead first.

````markdown
## Pre-Epic: Test-Failure-Map Pattern

Use when:
- A test suite shows ≥ ~5 failures and the operator says "fix all"
- The failures span multiple files / subsystems
- Root causes are not yet attributed per failure

### Step-by-step

1. **Run the suite once**, save the full log to `/tmp/<suite>-fails.log`. Do not interpret yet.
2. **File one mapping bead** (e.g., `test-runner: refresh <epic> CLI failure map`) with this contract shape:
   - `PROBLEM:` the exact command run, its exit status, the raw failure count.
   - `SUCCESS:` cluster table grouping every failure by **likely shared root cause and file scope**, plus a recommended fix-chain order.
   - `SCOPE:` the log file path + the bounded set of test files involved.
   - `CONSTRAINTS:` READ_ONLY, no source/test edits, no fix attempts. The mapping bead's only job is to think.
3. **Optionally dispatch test-runner / explorer / debugger** for this bead (READ_ONLY), OR fill the map inline by orchestrator reading the log.
4. **Build the cluster table** with at minimum: cluster name | files (counts) | representative error | root-cause hypothesis | likely-owner area | targeted validation command. Save in bead notes.
5. **Plan fix chains** off the cluster table:
   - One chain per cluster, file scopes disjoint between chains where possible.
   - Order by leverage (largest cluster first), then by simplicity.
   - Decide debugger-or-executor per cluster: debugger when root cause unclear, executor when bead constraint is concrete.
6. **Save the topology insight as a memory** (`bd remember`) — patterns about where this codebase's test fragility concentrates are reusable across future regressions.

### Why this beats dispatch-blind

Empirically (2026-05-11 xtrm-tools, 34 fails → 5 clusters):
- 56 % of fails collapsed under ONE cluster's single root cause (`findRepoRoot` vs `findProjectRoot` in docs CLI). A blind parallel dispatch would have over-dispatched 19 fixes instead of 1.
- 30 % collapsed under another single shared harness drift. Same logic.
- The remaining 14 % were 3 small unrelated clusters — each got a tight focused bead.
- Total: 5 fix chains vs ~10 had we dispatched per file. Net specialist spend ~$0.50 vs ~$1.50+.

### Failure modes to watch for

- **Clusters that look shared but aren't**: if the same error string appears in unrelated tests, the root causes may differ. Don't merge clusters by error text alone — confirm by reading the stack traces.
- **One cluster's fix introduces another's regression**: each cluster's bead must include "no regressions in other clusters" as VALIDATION, with the test command spanning all known-failing areas.
- **Pre-existing failures vs new regressions**: name pre-existing failures explicitly in each chain's NON_GOALS so reviewers don't FAIL on them.
````

### A6. Specialist rebuttal as routine (PATTERN UPDATE — generalized from overthinker 2026-05-09 / reviewer 2026-05-11)

Current skill mentions overthinker for "risky design, tradeoffs, premortem". The 2026-05-09 session showed a different pattern: **conversation**. Send overthinker to evaluate a strategy, then resume with pushback when its first answer feels too cautious. Got 3 retracted recommendations after challenge.

**Generalized 2026-05-11**: the same pattern works on **reviewer** too. 3 of 5 reviews this session returned PARTIAL on a non-applicable gate (gitnexus_impact on a test-only diff). One-line rebuttal flipped all 3 to PASS. Treat overcautious specialist verdicts as the first turn of a conversation, not a final decision.

````markdown
## Specialist Rebuttal as Routine

Several specialists default to over-cautious verdicts when an evidence gate looks unsatisfied. The orchestrator's job is to challenge that verdict with cited evidence, not to accept it. Common rebuttal-worthy patterns:

### Overthinker
- "Hold for operator decision" without specifying what decision is needed → push: "Cite file/line evidence for why this is a product decision rather than a mechanical resolution."
- "Close as superseded by X" without verification → push: "Read the current state of <file> and check whether feature Y from this bead is actually present."
- "Run separate small beads" or "run one big bead" without rationale → push: "Pick one and explain operationally — cost difference, conflict expectations, reviewer scope."

### Reviewer **(2026-05-11)**
- "PARTIAL — missing gitnexus_impact evidence" on a test-only diff → rebut: "gitnexus_impact analyzes runtime call graphs; test fixture mocks have no callers in the production graph; the bead's impact-gate constraint is conditional on modifying a runtime entrypoint, which did not happen here."
- "FAIL — full suite shows N+1 fails" where one of the fails is a known flake from concurrent runs → rebut: re-run the suspect test in isolation, paste the clean output, then resume reviewer with "The flake was from concurrent vitest runs during parallel review; isolated rerun: P/P. Re-evaluate."
- "FAIL — injected diff doesn't match claimed change" when the injected diff is a known-buggy reviewer context (xtrm-axwq) → rebut with cumulative-diff commands from the bead SCOPE (see B1).

### General rule

Resume with explicit ammunition: file/line refs, exact rerun output, link to the bead memory that documents the rebuttal pattern. Don't argue from authority; argue from new evidence. **Findings from code-sanity / security-auditor are legitimate rebuttal evidence** — a clean code-sanity OK or a security-auditor "no findings" is concrete proof against a reviewer's "looks too complex" or "may have security risk" gate. Cite the advisory job id when rebutting on this axis. After a successful rebuttal, save the rebuttal text as a `bd remember` so the next session inherits it.

When done, capture rebuttals in the session-close-report under the relevant specialist's "Problems" sub-table — they're durable handoff context and pattern-of-pattern fuel for future training.
````

### A7. Sleep timer + cron pattern for autonomous runs

For long autonomous runs (hours of orchestration without operator), the orchestrator must monitor specialists. Two complementary mechanisms emerged this session:

````markdown
## Long Autonomous Runs — Monitoring Pattern

For sessions where the operator is offline (overnight, async windows), use both:

1. **Bash sleep timers per dispatch**, sized to specialist role expectations:
   - sync-docs / changelog-keeper: `sleep 60`
   - code-sanity / security-auditor: `sleep 60`
   - reviewer: `sleep 90`
   - explorer / debugger / planner / overthinker: `sleep 120` initial, `sleep 90` follow-up
   - executor: `sleep 180` initial, `sleep 120` follow-up
   - test-runner: `sleep 120` initial, scale with suite size
2. **External cron loop** (Claude Code: `/loop 180s sp ps`) to refresh specialist state at fixed cadence regardless of orchestrator's bash sleeps. The cron acts as a heartbeat that catches specialists that finished while the orchestrator was busy reading other results.

The two complement: bash sleep waits for an expected completion; cron catches unexpected completions and stalls.

After every dispatch:
```bash
sleep 10 && sp ps   # confirm started, not stuck queued
sleep <role-typical-duration> && sp ps   # check state
sp result <job-id>  # consume immediately when done
```

If a job exceeds 2× its typical duration, inspect with `sp feed <job-id>` before assuming hang.
````

### A8. Memory-gate batch-close workflow

Closing many beads at once requires per-id memory acks. The skill should document the loop pattern.

````markdown
## Batch-Close Workflow (Memory Gate Compliance)

`bd close` is blocked until `memory-acked:<id>` exists. For batch-closing many orchestrator-internal beads (sanity beads, reviewer beads, etc.), use:

```bash
for id in xtrm-aaa xtrm-bbb xtrm-ccc; do
  bd kv set "memory-acked:$id" "nothing novel — orchestrator-internal sanity/reviewer bead"
  bd close $id --force --reason="chain complete"
done
```

`--force` is safe here because the parent chain's bead has already captured the substantive insight. If the parent itself has novel insight, save via `bd remember "..."` BEFORE closing the parent (set `memory-acked:<parent>` to `saved:<key>`).

Common orchestrator-internal beads that don't need novel memory:
- Sanity beads (xtrm-aaaa) created to dispatch code-sanity on a parent
- Reviewer beads (xtrm-bbbb) created to dispatch reviewer on a parent
- Re-review beads after fix turns
- Decomposition tracker beads created by planners (memory captured in children)

### Parallel-chain commit ordering **(2026-05-11)**

The bd commit-gate is **project-wide**, not per-worktree. While **any** bead in the project is `in_progress`, **no** worktree can commit. Practical consequence for parallel-chain epics:

- You CAN dispatch two executors in parallel — they work in separate worktrees, no commit-time collision.
- But once executor A returns and executor B is still running, you CANNOT commit A's worktree until B's bead is closed (or vice versa).
- Workflow: close the finished chain's executor bead FIRST (memory-ack + `bd close`), THEN commit that chain's worktree, THEN wait on the other chain.
- This forces a serial-tail on the commit step. Plan for it: parallel-dispatch saves time on the *thinking* step, not the commit step.

If the commit-gate blocks unexpectedly mid-orchestration, `bd query "status=in_progress"` reveals which claim is holding it open.
````

### A9. Session-close-report integration (MANDATORY at session end)

The skill currently doesn't reference the session-close-report skill. Add a closing reference.

````markdown
## At Session End — Mandatory Handoff

Before declaring the session done:

1. Run `/session-close-report` (or the `session-close-report` skill).
2. Fill every `<!-- FILL -->` marker in the generated skeleton. Don't leave them.
3. Sync `CHANGELOG.md` for user-facing changes (see the report skill's Step 6).
4. Re-run the cleanup checks (worktree list, sp ps, ps -ef for stale serena/gitnexus, tmux ls for sp-*).
5. Commit the report (and CHANGELOG if updated) before push.

A session that lands code but skips the close-report leaves the next agent cold-starting blind. That cost compounds across sessions.
````

---

## Part B — Targeted edits to existing sections

### B1. "Monitoring And Steering"

**Add subsection: "Reviewer cumulative-diff workaround (until xtrm-axwq is fixed)"**

```markdown
### Reviewer cumulative-diff workaround

The reviewer's "injected diff context" frequently shows only the latest checkpoint commit (or AGENTS/CLAUDE refresh noise) instead of the cumulative branch diff. Until this is fixed upstream, EVERY reviewer dispatch should include explicit cumulative-diff commands in its bead's SCOPE field:

```text
SCOPE: Cumulative diff in feature/<bead>-executor (job <id>). Use:
  cd /path/to/.worktrees/<bead>/<bead>-executor
  git log <fork-base>..HEAD --oneline
  git diff <fork-base>...HEAD --stat
  git diff <fork-base>...HEAD -- <key-files>
  npm test ...
IGNORE injected docs-only diff. Issue PASS/PARTIAL/FAIL based on cumulative output.
```

If the reviewer FAILs on first turn with "docs-only diff contradicts claimed", resume with the same cumulative-diff command. Most second-turn verdicts come back PASS.
```

### B2. "What Stays Out"

**Add:** mention `session-close-report` and `releasing` skills explicitly (orchestrator should know they exist and when to invoke them).

### B3. "Hard Rules"

**Add rule 12:**

```markdown
12. The orchestrator NEVER edits code directly. Conflict resolution, even mechanical, goes through a debugger or executor specialist. Manual conflict resolution is the only escalation that must always go to the operator.
```

### B4. "Failure Recovery"

**Add to "When something fails":**

```markdown
- If a chain's reviewer keeps FAILing on injected-diff, switch to cumulative-diff workaround (see B1).
- If `sp run` returns silently with `Warning: job started but ID not yet available`, check `sp ps --bead <id>` after 30s. If still empty, the dispatch was likely refused (epic guard, base-staleness). Retry with `--force-stale-base`. If still empty, run `sp run` in foreground to see the error message.
- If bd commands fail with `database "jaggers_agent_tools" not found`, the per-project Dolt has spawned. Kill it (`ps aux | grep "<repo>.beads/dolt" | awk '{print $2}' | xargs kill -9`), re-add `dolt.shared-server: true` to `.beads/config.yaml` (it sometimes gets stripped after branch switches), and retry. This is documented friction (xtrm-hhiu).
- If Dolt journal corrupts mid-session (`possible data loss detected at offset N`), DO NOT auto-recover. Operator-only. The `dolt fsck --revive-journal-with-data-loss` flag has explicit data-loss warning.
```

### B5. "What Orchestrator Does Differently Because Of This Skill"

**Add to the bullet list:**

- Maps file-overlap surface BEFORE dispatching parallel waves.
- Uses overthinker as a conversation, not a one-shot oracle.
- Smokes every npm script and entry point before declaring integration done.
- Files friction beads as encountered, not retrospectively at session end.
- Commits debugger-restitch results via FF or cherry-pick of the named commit, not the checkpoint commit above it.

---

## Part C — Active workarounds (until upstream fixes)

These belong in a new appendix `## Known Workarounds (filed for upstream fix)`:

````markdown
## Known Workarounds

Until the listed friction beads are fixed in their upstream repos, the orchestrator must apply these workarounds.

### Reviewer injected-diff bug (xtrm-axwq)
**Workaround:** explicit `git diff <base>...HEAD` command in every reviewer bead SCOPE. See B1.

### sp merge hardcoded to main (xtrm-nr05)
**Workaround:** manual cherry-pick + debugger-restitch pattern (A1+A2). Don't use `sp merge` for chains forked from non-main branches.

### bd-in-worktree fails (xtrm-hhiu)
**Workaround:** orchestrator owns bead lifecycle from main repo. Specialists never run `bd close` from inside their worktree (their attempts will fail with `database not found`; that's expected and documented).

### Chain noise pollution (xtrm-ombq)
**Workaround:** filter checklist at every cherry-pick (see A1 "Chain noise filter checklist"). Until idempotent AGENTS/CLAUDE generation lands (xtrm-i4uu/9xg2.*), every commit will pull in the gitnexus stat refresh — filter at squash time.

### Epic guard refuses sub-bead dispatches (xtrm-5sz2)
**Workaround:** `--force-stale-base` flag for initial dispatches on epic children. Subsequent reviewer/sanity dispatches under the same chain may fail silently — retry with `--force-stale-base` again, or dispatch in foreground to see the refusal reason.

### Per-project Dolt respawns after branch switch (related to xtrm-hhiu)
**Workaround:**
```bash
ps aux | grep "<repo>/.beads/dolt" | grep -v grep | awk '{print $2}' | xargs -r kill -9
echo "" >> .beads/config.yaml
echo "dolt.shared-server: true" >> .beads/config.yaml
sleep 2
bd ready  # should now route to ~/.beads/shared-server/
```
Repeat as needed; the flag gets stripped on some bd auto-init paths.

### Dolt journal corruption (xtrm-yb0u)
**Recovery:** operator-only. Stop further bd writes. Snapshot `~/.beads/shared-server/dolt`. Run `dolt fsck` (read-only) first to assess. Decide on `--revive-journal-with-data-loss` only after reviewing the warning.

### Worktree `.beads/` directory-to-symlink swap pollutes checkpoint commits **(2026-05-11)** (xtrm-nsca)

`xt claude` / specialist worktree provisioning (per commit `63d2bb1` in xtrm-tools) replaces the tracked `.beads/` directory with a symlink to the parent repo's `.beads/`, so bd hooks inside the worktree resolve to the shared dolt server. Side effect: when the executor/debugger commits a checkpoint, git stages the directory→symlink change as **1.7k lines of phantom `.beads/` deletions** alongside the real fix, polluting the chain diff. Reviewer then either FAILs on out-of-scope deletions or sees a stale/limited diff and FAILs on missing source change.

**Bead-time prevention:** put this CONSTRAINT in every edit-capable specialist's bead:
> "When committing, do NOT include any `.beads/*` paths. Use `git add` with explicit source/test paths (NOT `git add -A` or `git add .`). If `git status` shows `.beads/*` deletions, ignore them — they are a known provisioning artifact."

This works when specialists follow it (~40 % did, 2026-05-11). When they don't, recover before reviewer:

**Per-chain recovery sequence** (run inside the executor/debugger worktree):

```bash
git reset --mixed HEAD~1                               # uncommit the polluted checkpoint
rm <worktree>/.beads                                   # drop the provisioning symlink
git checkout HEAD -- .beads/                           # restore .beads as a directory from HEAD
git restore --staged .beads/                           # drop any newly-staged .beads/* paths
git checkout -- .beads/issues.jsonl                    # revert any bd auto-export churn
git add <source/test files only>                       # stage real changes explicitly
git commit -m "<conventional message> (<bead-id>)"     # clean commit
```

If bd auto-export re-stages `.beads/issues.jsonl` between `bd close` and `git commit`, `git reset HEAD~1 -- .beads/issues.jsonl && git checkout -- .beads/issues.jsonl && git commit --amend --no-edit` cleans it.

**Pre-merge cleanup:** `sp merge` refuses if the worktree (or main repo) has uncommitted `.beads/issues.jsonl`. Always:

```bash
git -C <worktree> restore --staged .beads/issues.jsonl
git -C <worktree> checkout -- .beads/issues.jsonl
git -C <main-repo> restore --staged .beads/issues.jsonl
git -C <main-repo> stash push -m "pre-merge" -- .beads/issues.jsonl
sp merge <chain-root-bead>
```

Filed for systemic fix at `xtrm-nsca` (xtrm-tools-side) — candidate solutions: write `.beads` to `.git/worktrees/<name>/info/exclude` during provisioning, `git update-index --skip-worktree` on `.beads/*`, or a chain-internal pathspec filter on checkpoint commits.

### Reviewer reflexive PARTIAL on test-only diffs **(2026-05-11)**

The reviewer specialist (`gpt-5.3-codex thinking:low`) reflexively flags missing `gitnexus_impact` evidence even when the diff is entirely under `test/` or `tests/` paths. Three of five reviews this session PARTIAL'd on this gate. Durable rebuttal (works every time):

> "Re-evaluate. The diff is entirely under `<test-path>` (N files, M lines, no runtime symbol touched). `gitnexus_impact` analyzes runtime call graphs — test fixture mocks have no callers in the production graph. The bead's impact-gate constraint is conditional on modifying a runtime entrypoint, which did not happen here. Issue final verdict PASS."

Each rebuttal cost ~1 specialist turn (~$0.05). Bake a preempt into the bead CONSTRAINT:
> "`gitnexus_impact` requirement does NOT apply if the diff is entirely under `test/` or `tests/` paths. Reviewer should issue PASS without that evidence when the diff is test-only."

Reviewer then PASSes on the first turn.

### `sp merge` refuses on dirty main worktree even when unrelated **(2026-05-11)**

`sp merge` validates main is clean before rebasing. Between every chain merge, bd auto-export re-touches `.beads/issues.jsonl` on the main repo (and the worktree). `sp merge` then refuses with "cannot rebase: You have unstaged changes" or "Your index contains uncommitted changes".

**Workaround**, run before every `sp merge`:

```bash
git -C <main-repo>  restore --staged .beads/issues.jsonl 2>/dev/null
git -C <main-repo>  stash push -m "pre-merge" -- .beads/issues.jsonl 2>&1 | tail -1
git -C <worktree>   restore --staged .beads/issues.jsonl 2>/dev/null
git -C <worktree>   checkout -- .beads/issues.jsonl 2>/dev/null
sp merge <bead-id>
# after merge:
git -C <main-repo> stash drop 2>/dev/null
```

For epic merges, repeat the cleanup BEFORE each `sp epic merge` even when the previous one succeeded — bd activity between merges re-dirties the tree.
````

---

## Part D — Editing instructions

To apply this proposal:

1. Read the current `specialists/config/skills/using-specialists-v3/SKILL.md` (734 lines, version 3.2).
2. Add Part A sections in this order: A1 (after "Merge And Publication"), A2 (right after A1), A3 (right after A2), A4 (after "Hard Rules"), A5 (after "Dependency Graph Shapes"), A6 (in "Mini-Flows For Under-Promoted Specialists"), A7 (after "Monitoring And Steering"), A8 (in "What Stays Out" or as separate "Bead Lifecycle Workflow"), A9 (last section before "What Orchestrator Does Differently").
3. Apply Part B targeted edits inline to existing sections.
4. Append Part C as the final appendix.
5. Bump version to `3.3` in frontmatter.
6. Update SKILL.md description to mention "integration phase" and "debugger-restitch pattern" so the skill triggers on those keywords too.

The session that produced this proposal is captured in `xtrm-tools/.xtrm/reports/2026-05-09-31d59db.md` with full context (75 dispatches, 22 chains, 6 friction beads, debugger-restitch deployments, overthinker conversation).

The 2026-05-11 addendum draws from `xtrm-tools/.xtrm/reports/2026-05-11-1f573e2.md` (11 dispatches, 5-cluster epic, 34→0 cli test fails) and the durable memories:

- `xtrm-tools-cli-test-failure-topology-post-pr` — empirical concentration of test fragility (see A5b).
- `specialist-worktree-provisioning-in-xtrm-tools-replaces-trac` — workaround recipe (see Part C).
- `reviewer-specialist-gpt-5-3-codex-thinking-low` — gitnexus_impact rebuttal (see Part C + A6).
- `xtrm-tools-xtrm-config-hooks-json-is-generated` — project-specific but exemplifies the "don't edit generated files" lesson worth surfacing as a generic CONSTRAINT in executor beads that touch any compiled artifact.
