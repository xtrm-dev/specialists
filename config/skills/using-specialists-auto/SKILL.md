---
name: using-specialists-auto
description: >
  Operator-offline autonomous orchestration mode. Activate when the user says
  "auto mode", "full auto", "run autonomously", "I'll leave you alone", or
  similar — and hands over a multi-item priority list. Paranoid: every chain
  carries a full bead contract, sleep cadence per role, advisory passes when
  warranted, and pre-merge ritual. Builds on `using-specialists-v3`; assumes
  that skill's primitives are loaded.
version: 1.0
---

# Using Specialists — Auto Mode

You are running unsupervised. Every shortcut you skip costs the operator on return. Move slowly enough to be correct.

## When this skill activates

User explicitly hands over autonomy: "auto mode", "go", "I'll leave you alone", "run the list", "do them all". Skill stays active until session end or the operator returns. Do NOT activate on a single ad-hoc task.

## Hard rules (non-negotiable)

1. **Never edit code directly.** Every change goes through executor/debugger/sync-docs. Manual conflict resolution = stop and report.
2. **Write the full 7-section bead contract before every dispatch.** PROBLEM / SUCCESS / SCOPE / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT. Title-only beads waste a turn.
3. **Re-read each bead and defend each field in your head before launching.** If you can't, the bead isn't ready.
4. **One chain at a time** unless file scopes are provably disjoint. The commit gate is project-wide; parallel-dispatch helps thinking, not committing.
5. **Advisory passes are not optional on substantive diffs.** code-sanity when diff smells overcomplicated/brittle/type-risky; security-auditor when diff touches auth/secrets/input/dependency/agent-config. Skipping = escalation event.
6. **Rebuild + smoke after each P0.** No "I'll smoke at the end" — landing P0_n without verifying breaks the next chain's baseline.
7. **`sp merge` only.** Never manual `git merge` of specialist branches. If `sp merge` refuses → diagnose, don't bypass.
8. **No `--no-verify`, no `--force` push, no destructive operations.** If the path forward needs one, stop and report.

## Per-item loop shape

```
read bead → write contract (child impl bead) → bd dep add parent→child
  → sp run executor --bead <impl> --keep-alive --context-depth 3 --background
  → sleep 10 && sp ps          # confirm started
  → sleep <role-typical> & sp ps  # check
  → sp result <exec-job>        # consume immediately on waiting
  → optional: code-sanity if smelly, security-auditor if risk surface
  → write reviewer bead contract (cumulative-diff in SCOPE, gitnexus_impact gate clarified)
  → sp run reviewer --bead <review> --job <exec-job> --context-depth 3 --background
  → sleep 90 & sp ps
  → sp result <reviewer-job>
  → PASS? → sp merge → rebuild dist → smoke → close chain
  → PARTIAL? → resume executor with exact findings → resume reviewer
  → FAIL with valid evidence? → stop and report
  → FAIL with overcautious gate (test-only / injected-diff noise)? → rebut once with cited evidence (see Rebuttal below)
```

## Sleep cadence by role

| Role | After dispatch | After resume |
|---|---|---|
| sync-docs, changelog-keeper, code-sanity, security-auditor | `sleep 10 && sp ps` then `sleep 60` | `sleep 60` |
| reviewer | `sleep 10 && sp ps` then `sleep 90` | `sleep 60` |
| explorer, debugger, planner, overthinker | `sleep 10 && sp ps` then `sleep 120` | `sleep 90` |
| executor | `sleep 10 && sp ps` then `sleep 180` | `sleep 120` |
| test-runner | `sleep 120`, scale with suite | per suite |

If a job exceeds 2× typical, `sp feed <job>` to inspect — don't assume hang.

## Pre-merge ritual (until `sp merge` auto-stashes — see `unitAI-lqsha` sibling fix)

```bash
# Inside worktree
git stash push -u -m "noise" -- .xtrm/

# In main repo
git restore --staged .beads/issues.jsonl 2>/dev/null
git stash push -m "beads" -- .beads/issues.jsonl 2>&1 | tail -1

sp merge <chain-root-bead>
```

After merge: `git worktree remove <path> --force`, `git branch -D feature/<bead>-<role>`, `git worktree prune`, `rm -rf .worktrees/<bead>`.

## Dist rebuild + commit after every P0 (and after any chain touching `src/`)

```bash
bun build src/index.ts --target=bun --outfile=dist/index.js
sed -i '1s|#!/usr/bin/env node|#!/usr/bin/env bun|' dist/index.js
chmod +x dist/index.js
git add dist/index.js dist/types/<changed-paths> 2>/dev/null
git commit -m "build: rebuild dist after <bead-id> <one-line summary>"
```

## Smoke per chain

Minimum: `bunx tsc --noEmit` clean, plus the targeted test(s) the chain added. After each P0 also run `sp --version`, the specific CLI surface that changed, and (if the change touched runtime resolution) the same command from a non-repo cwd (`cd /tmp/smoke && sp <cmd>`).

Cross-cutting security-auditor pass on the full session diff if any chain touched auth/secrets/input/dep-lock surface. Most autonomous sessions don't trigger this.

## Reviewer rebuttal pattern (one turn, evidence-cited)

When reviewer returns FAIL/PARTIAL on a non-applicable gate:

- **Injected-diff bug** (reviewer cites `.xtrm/SKILL.md` 1-line patch): paste real `git diff master...HEAD --stat`, point at bead's IGNORE-injected-diff instruction, ask for PASS based on cumulative diff. (Memory key: `reviewer-injected-diff-bug-rebuttal-template`.)
- **Test-only `gitnexus_impact` gate**: cite that diff is entirely under `test/` or `tests/`; runtime call graph not affected; bead's impact gate is conditional on modifying runtime entrypoint.
- **Overcautious "may have security risk" without specific finding**: cite code-sanity OK or security-auditor "no findings" as advisory rebuttal evidence.

After successful rebuttal, save the rebuttal text to `bd remember "<key>"` so the next session inherits it. One rebuttal per reviewer is the limit — second FAIL means stop and report.

## Memory gate compliance

Every `bd close` needs `bd kv set "memory-acked:<id>" "<saved:key|nothing novel:reason>"`. Batch loop for chain beads:

```bash
for id in <impl> <sanity?> <review>; do
  bd kv set "memory-acked:$id" "saved:<chain-memory-key>"  # OR "nothing novel:reviewer/sanity bead"
done
bd close <impl> <sanity?> <review> <parent> --reason "..."
```

The chain memory key holds the actual durable insight (one per real fix). Sanity/review beads get "nothing novel" — the parent insight covers them.

## When to escalate (stop and report)

- Reviewer FAIL twice after one rebuttal attempt
- Merge conflict requiring manual edits
- Force-push / branch-delete situations
- Dependency major/minor bump needed
- `dolt fsck --revive-journal-with-data-loss` situation
- Repeated specialist crashes (>2 same role)
- Any chain looped twice with no progress
- Cross-project state pollution (kill cross-repo `sp run` processes only via filed cleanup bead — never blindly)
- Anything requiring a hard-rule break

When you stop: file an issue bead with concrete evidence (PIDs, job IDs, exact error), save a memory if the failure mode is durable, write a partial session-close report, do NOT abandon mid-merge.

## Session start

```bash
specialists list --full              # confirm current roles + models
sp ps                                 # 0 active expected
git worktree list                    # main only expected
git status -s                        # clean expected
bd ready                              # work to pick up
```

If any of these are dirty (active jobs, lingering worktrees, dirty tree), reconcile before claiming new work.

## Session close (mandatory)

1. Confirm `sp ps` empty (0 running, 0 waiting) and `git worktree list` shows only main.
2. Drop accumulated stashes if they contain only known noise (`.xtrm/skills/active/...`, `.beads/issues.jsonl`).
3. Write `.xtrm/reports/<date>-<theme>.md` covering: Summary, Issues Closed (table), Issues Filed (table), Specialist Dispatches (table), Problems Encountered (table with root cause + resolution), Code Changes (per bead), Smoke Test Results (table), Open Issues Carried Forward, Memories Saved, Suggested Next Priority.
4. Push to remote. If push rejected, pull --no-rebase, resolve any `.beads/issues.jsonl` conflict by `git checkout --ours`, force-add, merge commit, push.
5. Memory gate: `bd kv set "memory-gate-done:<session-id>" "saved: <durable-insights>"` or `"nothing novel: <reason>"`.

## What changes vs `using-specialists-v3`

- **Cadence**: explicit sleep timers per role; consume `sp result` immediately on transition to waiting.
- **Default to serial.** Auto-mode rarely benefits from parallel chains; the commit gate forces serial-tail anyway.
- **Pre-merge ritual is automatic**, not a fallback. bd auto-export re-dirties trees between every merge.
- **Dist rebuild after every chain touching `src/`**, not at end. Otherwise next chain's baseline drifts.
- **Smoke after every P0.** Smoke fail = stop and diagnose before next chain.
- **One rebuttal per reviewer**, then escalate. Don't loop.
- **Session-close report is non-optional.** Operator returning to a clean tree but no report = blind cold-start next session.

## Telltale signs you're drifting from auto-mode discipline

- Skipping bead contracts because "the change is small" → write it anyway, costs nothing, downstream specialist needs it
- Polling `sp ps` more often than the sleep table → wastes context
- Letting executors run >2× expected without `sp feed` → blocking future work
- Accepting reviewer FAIL without cited evidence in the rebuttal → produces longer loops
- Manually editing a config file because "the executor would just do the same thing" → breaks rule 1, no audit trail
- Skipping `bun run build` after src/ change → next chain's smoke fails for unrelated reason
- Closing the parent bead before chain memory saved → loses durable insight forever

Read once at session start. Re-read if you catch yourself drifting.
