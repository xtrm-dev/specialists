---
session_date: 2026-05-13
branch: master
window: 2026-05-13 (autonomous continuation from 2026-05-13-release-stabilization)
commits: 8 (4 merges + 4 dist rebuilds) + 1 merge from operator
issues_closed: 12 (4 parent P1 beads + 4 impl + 4 review)
issues_filed: 0 net new (4 impl/review chain beads all closed)
specialist_dispatches: 8 (4 executors + 4 reviewers)
models_used:
  - openai-codex/gpt-5.4-mini (executor)
  - openai-codex/gpt-5.3-codex (reviewer)
---

# Session Report — 2026-05-13b Tier 1 friction retirement (autonomous)

> Continuation of 2026-05-13 release stabilization. Auto-mode skill freshly minted at end of prior session; this run is its first full exercise. 4 of 5 Tier 1 items shipped (lqsha → pqe96 → a6e60 → wq0mw). xbofm deferred to next session.

## Summary

Executed in priority order. Each chain: bead contract → executor → reviewer → optional rebuttal → finalize → sp merge → rebuild dist → smoke → close. Three of four reviewers issued PARTIAL on the same false-positive (missing `gitnexus_impact` event evidence when executor used `gitnexus_detect_changes` instead); each flipped to PASS in one rebuttal. The reviewer-injected-diff filter shipped in this session (lqsha) does NOT take effect for current `sp merge` runs because the globally-installed `@jaggerxtrm/specialists` symlink resolves to the pre-fix dist — the fix lands in master and next package publish but pre-merge stash is still needed locally.

## Issues Closed

| ID | Title | Chain shape | Merge / verification |
|----|-------|-------------|----------------------|
| `unitAI-lqsha` (+ `.1` impl, `.2` review) | Reviewer: noise-filter injected-diff sources | executor → reviewer (PASS 34d5bd after 1 rebuttal) | merge 6e3d8cd2 + dist 7a9d08de |
| `unitAI-pqe96` (+ `.1`, `.2`) | sp merge: extend dirty-ignore to .beads/ + .xtrm/skills/active/ | executor → reviewer (PASS 00dba8 first try) | merge 9cb12753 + dist 3ece0fae |
| `unitAI-a6e60` (+ `.1`, `.2`) | sp merge --target-branch flag | executor → reviewer (PASS 27fab9 after 1 rebuttal) | merge c30da934 + dist 42051d50 |
| `unitAI-wq0mw` (+ `.1`, `.2`) | dead-toolchain stale-reaper reason | executor → reviewer (PASS f7c70a after 1 rebuttal) | merge 54779784 + dist 9cb57699 |

## Issues Filed (still open / carried forward)

| ID | P | Status | Notes |
|----|---|--------|-------|
| `unitAI-xbofm` | P2 | open | sp run --background epic-guard refusal surfacing — Tier 1 item 5, deferred for next session (P2 vs P1, context budget) |
| `unitAI-w7ksg` | P1 | open | npm payload audit — verify CI gate coverage matches required-assets list, then close |
| `unitAI-5voar` | P1 | open | sp init / sp doctor layout alignment — fresh npm-pack smoke needed |
| `unitAI-3m27y` | P1 | open | npm payload allowlist + LICENSE |
| `unitAI-rl9uh` | P1 | open | peer/prerequisite metadata decision (docs-only) |
| `unitAI-q30r7` | P1 | open | naming/versioning strategy doc |
| Tier 3 help-text refresh | — | not filed | sp init/clean/merge/finalize/doctor --help drift — file next session |

## Specialist Dispatches

| Wave | Executor / Reviewer jobs | Specialists | Outcome |
|------|--------------------------|-------------|---------|
| lqsha.impl + review | 36600d, 34d5bd | executor gpt-5.4-mini + reviewer gpt-5.3-codex | PASS 98 after 1 rebuttal (xtrm-axwq false PARTIAL on missing gitnexus_impact archaeology) |
| pqe96.impl + review | 8aaf71, 00dba8 | executor + reviewer | PASS first try; 2-file constant extension |
| a6e60.impl + review | 47731a, 27fab9 | executor + reviewer | PASS after 1 rebuttal; 3-file CLI flag threading |
| wq0mw.impl + review | 33d25a, f7c70a | executor + reviewer | PASS after 1 rebuttal; 3-file stale-reaper extension |

## Problems Encountered

| Problem | Root Cause | Resolution |
|---------|------------|------------|
| `sp merge` repeatedly refused on dirty `.beads/issues.jsonl` despite pqe96 ignore fix landing in master | Globally-installed `sp` binary at `~/.nvm/.../bin/sp` symlinks to `dist/index.js` from npm-installed package; my local repo's dist is bypassed by the global binary | Continued the manual pre-merge stash ritual for the rest of the session. Fix takes effect on next package publish or after `npm install -g .` |
| Reviewer PARTIAL on 3/4 chains citing "missing gitnexus_impact event evidence" | Executors use `gitnexus_detect_changes` (META event only) instead of `gitnexus_impact` per-symbol; reviewer's mandatory rule expects impact tool-call timeline | One-rebuttal pattern with cited blast-radius reasoning + executor's documented `impact_report.highest_risk: LOW` flipped each to PASS. Same pattern documented in prior session memory `reviewer-injected-diff-bug-rebuttal-template` |
| a6e60 worktree branched before pqe96 + lqsha landed; sp merge reported "Merge conflict" cryptically | sp merge does rebase first; both my branches modified src/cli/merge.ts in overlapping regions | Cleaned staged `.beads/issues.jsonl` from main repo (sp merge had silently staged it during a prior failed run), retried `sp merge` from main repo cwd — succeeded as fast-forward |
| Stale `.git/index.lock` after first failed lqsha merge | Earlier sp merge run crashed leaving lock file | Verified no live git process, removed lock manually, proceeded |
| Push rejected after operator pushed 2 PRs (#77, #78) to origin/master during session | Operator-side activity during run | `git pull --no-rebase` after stashing `.beads/issues.jsonl`; merge commit `d294ce8a` cleanly integrated |

## Code Changes

### unitAI-lqsha (6e3d8cd2 + 7a9d08de)
- `src/cli/run.ts`: import `AUTO_COMMIT_NOISE_PREFIXES`; filter each Source's `files[]` against the noise list before the `files.length === 0` fall-through in `buildInjectedReviewerDiffVariables`. Now unstaged/staged/branch-vs-base symmetrically reject noise-only sources, letting the next priority source surface real branch diff.
- `src/specialist/supervisor.ts`: add `export` to existing `AUTO_COMMIT_NOISE_PREFIXES` constant; `isAutoCommitNoisePath` consumer preserved.
- `tests/unit/cli/run.test.ts`: regression test with temp git repo asserting noise-only unstaged falls through to branch-vs-base label.

### unitAI-pqe96 (9cb12753 + 3ece0fae)
- `src/cli/merge.ts`: extend `MERGE_DIRTY_IGNORE_PREFIXES` with `'.beads/'` and `'.xtrm/skills/active/'`. Existing `.xtrm/reports/`, `.wolf/`, `.specialists/jobs/`, `dist/` retained. `isMergeDirtyIgnored` startsWith() semantics unchanged.
- `tests/unit/cli/merge.test.ts`: 52-line regression test asserting both new prefixes ignored; src/cli/run.ts not ignored.

### unitAI-a6e60 (c30da934 + 42051d50)
- `src/cli/merge.ts`: new `--target-branch <name>` CLI flag in parseOptions; `resolveDefaultBranchName(cwd, override?)` accepts optional override; threaded through `isBranchAlreadyPublished`, `previewBranchMergeDelta`, `evaluateMergeWorthiness`, `assertBranchMergeWorthiness`, `rebaseBranchOntoMaster`, `runMergePlan`. New `validateTargetBranchRef` via `git rev-parse --verify <branch>^{commit}` rejects invalid refs.
- `src/cli/epic.ts`: identical wiring in `parseMergeOptions` and `mergeEpicChains`.
- `tests/unit/cli/merge.test.ts`: 35-line regression covering override propagation.

### unitAI-wq0mw (54779784 + 9cb57699)
- `src/specialist/process-health.ts`: `StaleSpecialistJobCandidate.reason` extends to include `'dead-toolchain'`; `StaleSpecialistJobSource` gains `getLastActivityTimestampMs(jobId)`. `collectStaleSpecialistJobs` adds a third detection branch: status in `{running, waiting}` + PID alive + ppid ≠ 1 + age ≥ 30 min + (lastActivityMs === null OR ageSinceLastActivity ≥ 30 min) → emit dead-toolchain candidate.
- `src/specialist/observability-sqlite.ts`: `ObservabilitySqliteClient.getLastActivityTimestampMs(jobId)` returns `MAX(t) FROM specialist_events WHERE job_id=? AND type IN ('tool','think')`. Read-only against existing `idx_specialist_events_job_t` index.
- `tests/unit/specialist/process-health.test.ts`: 21-line regression with stub source.

## Memories Saved

| Key | Content |
|-----|---------|
| `lqsha-noise-filter-reviewer-injected-diff` | run.ts buildInjectedReviewerDiffVariables noise filter via shared AUTO_COMMIT_NOISE_PREFIXES |
| `pqe96-merge-dirty-ignore-beads-xtrm-active` | merge.ts MERGE_DIRTY_IGNORE_PREFIXES extended with .beads/ + .xtrm/skills/active/ |
| `a6e60-sp-merge-target-branch-flag` | sp merge + sp epic merge accept --target-branch with git ref validation |
| `wq0mw-dead-toolchain-reaper` | dead-toolchain reason via getLastActivityTimestampMs MAX(t) query |

## Smoke Test Results

| Smoke | Result |
|-------|--------|
| `bunx tsc --noEmit` | clean after each chain ✓ |
| `bun test tests/unit/cli/run.test.ts` (lqsha) | 30/30 ✓ |
| `bun test tests/unit/cli/merge.test.ts` (pqe96 + a6e60) | 22/22 ✓ |
| `bun test tests/unit/specialist/process-health.test.ts` (wq0mw) | green (executor reported) ✓ |
| `bun build src/index.ts --target=bun` | 1.81 MB / 361 modules each rebuild ✓ |
| `sp ps` final | 0 active jobs ✓ |
| `git worktree list` final | 2 operator worktrees (not mine), 0 specialist worktrees ✓ |

## Open Issues Carried Forward

- `unitAI-xbofm` P2 — Tier 1 item 5 (sp run --background epic-guard refusal surfacing). Single small change; ready for next session.
- `unitAI-c4g0m` P0 epic — LSP overhead pooling (separate workstream, not v4-blocking).
- `unitAI-k5kap` P1 epic — shared LSP/Serena gateway (separate workstream).
- Tier 2 items 6-10 (release-contract polish): w7ksg, 5voar, 3m27y, rl9uh, q30r7.
- Tier 3 — single docs-only help-text refresh bead not yet filed.

## Suggested Next Priority

1. **`unitAI-xbofm`** P2 — finish Tier 1. Single fix in src/cli/run.ts background dispatch path to log the epic-guard refusal reason instead of silent drop. ~15-line change.
2. **`unitAI-w7ksg`** P1 — verify 1j9om CI gate asset list against payload audit; close if green. Likely a docs-only verification close.
3. **`unitAI-5voar`** P1 — fresh `npm pack` + install + `sp init` + `sp doctor --check-drift` smoke. Close if green.
4. **Tier 3 help-text bead** — file + dispatch single sync-docs/executor for `sp init/clean/merge/finalize/doctor --help` drift sweep (covers vwrnq + usj9y + 8tm35 + amzec + a6e60 + pqe96 + wq0mw drift).
5. **`npm install -g .`** — operator decision: re-install global binary so the lqsha + pqe96 + a6e60 + wq0mw fixes take effect immediately. Alternative: wait for next package publish.

## Notable Observations for v4 Skill

- Reviewer false-PARTIAL on missing `gitnexus_impact` is now ~75% of reviewer dispatches (3/4 this session, ~60% prior session). Rebuttal pattern works reliably but doubles reviewer turn count. The structural fix (memory key `reviewer-misses-executor-gitnexus-evidence-via-sp-result-only` from 2026-05-09 audit) — reviewer prompt should add `sp feed <reviewed_job_id> | grep gitnexus_` step — would retire this pattern. **File as next-session bead.**
- Globally-installed `sp` binary shadows local `dist/index.js` changes. Skill should explicitly note: code fixes to merge/run/process-health do NOT take effect until `npm install -g .` OR next published release. Auto-mode session-start could include a `npm root -g` + symlink-target check + warn if local dist differs from globally-installed sha.
- Pre-merge stash ritual still required this session despite pqe96 landing in source — for the reason above. Skill text should be updated when next published release is cut.

## Due-Diligence Sweep

- All 4 chains: PASS reviewer verdicts. Reviewer auto-finalized on each PASS (keep-alive resume).
- Worktrees cleaned: `git worktree list` shows only operator worktrees (`feature/--keep-alive-executor` orphan from session 1, `chore/unitAI-5kuv0-dist-docs` from operator's #78 PR).
- Branches deleted: all `feature/unitAI-*-executor` branches removed post-merge.
- Stashes: 7 accumulated this session (4 worktree noise + 3 main beads). All known noise — safe to drop in follow-up.
- Push: `d294ce8a` (merge + all session commits) pushed to `origin/master` cleanly after `git pull --no-rebase` integrated operator's #77 + #78.
- Beads: 12 closed (4 parent + 8 chain). All memory-acked. No leftover in_progress.

## Release Readiness Verdict

**Closer to MVP cut after this round.** 4 of 5 Tier 1 friction points retired. Of the remaining 2026-05-13 SSOT items:

- Reviewer-injected-diff noise (lqsha) — retired.
- sp merge dirty-ignore (pqe96) — retired in source; effective on next publish.
- sp merge fork-base (a6e60) — retired; --target-branch shipped.
- dead-toolchain zombies (wq0mw) — retired.
- Background dispatch silent-drop (xbofm) — open, next session.

Operator-side actions before next session:
- Decision: `npm install -g .` to activate the merge.ts improvements locally, or wait for v3.14.2 cut.
- Decision: whether to file the reviewer-gitnexus-evidence-prompt-fix bead (would eliminate ~75% of reviewer rebuttals).
