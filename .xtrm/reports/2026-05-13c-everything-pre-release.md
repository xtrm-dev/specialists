---
session_date: 2026-05-13
branch: master
window: 2026-05-13 (autonomous SSOT: Tier 1 item 5 + Tier 2 + Tier 3 + reviewer prompt + user-reported GH issues + ye5s9 epic close + v3.3 doctrine merge + researcher consolidation)
commits: 24 (12 merges + 6 dist rebuilds + 4 docs/skill + 2 specialist-config audits)
issues_closed: 27 (12 parent beads + 15 chain children); +2 GH issues closed (#76, #71); +2 audits superseded (u0nbr, 6kofw); ye5s9 epic closed
issues_filed: 0 net new (all chain beads closed within session)
specialist_dispatches: 22 (11 executors + 11 reviewers)
models_used:
  - openai-codex/gpt-5.4-mini (executor)
  - openai-codex/gpt-5.3-codex (reviewer)
---

# Session Report — 2026-05-13c Everything-Pre-Release SSOT (autonomous)

> SSOT for the 2026-05-13 afternoon→evening orchestration after 13b. Single-orchestrator full-autonomy run. Final state: pre-release MVP-ready, release-contract epic `ye5s9` closed (19/19 children shipped), reviewer false-PARTIAL pattern retired at the source (twice — once via prompt relaxation `6fsxp`, then structurally via `889dv` fixing the underlying `sp feed` DB-replay bug that was hiding executor tool events), two user-reported GH issues closed (#76 endless `sp feed -f` scroll, #71 tsc gate false-positive), v3 skill bumped to v3.3 with full doctrine merge, auto-mode skill trimmed to v2.0 minimal overlay, researcher specialist consolidated to be actually dispatchable.

## Summary

Continuation from 2026-05-13b retired the remaining Tier 1 friction item (xbofm), swept Tier 3 help-text drift (3r268), shipped Tier 2 release-contract polish (w7ksg/5voar/3m27y/rl9uh+q30r7), and landed the reviewer blast-radius gate relaxation (6fsxp). Operator pushback flagged a deeper concern: the false-PARTIAL pattern was actually a symptom of `sp feed <job-id>` returning ~8 lines instead of full DB replay (`889dv`, P1 bug filed earlier this day). Fixed `889dv` as the structural retirement of the false-PARTIAL pattern — 6fsxp prompt relaxation now stays as a safety net but is largely obsoleted. Two user-reported GH issues surfaced and closed in-session: #76 (sp feed -f hangs forever on keep-alive waiting jobs — fixed via `032n4`), #71 (sp merge tsc gate false-positive on non-TS repos — fixed via `dpf3a`). Two release-drift audit beads (u0nbr, 6kofw) closed as covered by today's chains. Release contract epic ye5s9 closed (19/19 children: jj7hy, lqsha, pqe96, a6e60, wq0mw, xbofm, 6fsxp, 3r268, 5voar, w7ksg, 3m27y, rl9uh, q30r7, 7ezse, cww2s, dnqas, plus pre-day-of-session shipped children). New `dist/asset-contract.json` deterministic manifest + new `release-gate.yml` workflow firing `repository_dispatch` to xtrm-tools (operator wired `XTRM_TOOLS_DISPATCH_PAT` secret). Doctrine merge from `docs/proposals/using-specialists-v3-improvements-2026-05-09.md` landed as v3 SKILL.md v3.3 + auto-mode SKILL.md v2.0 minimal overlay (171→137 lines, all overlap delegated to v3). Researcher specialist consolidated to v1.2.0: model swapped from flaky qwen3.5-thinking to claude-sonnet-4-6, redundant skills dropped (folded ~3-4k tokens of duplicate content), description rewritten with aggressive triggers, v3 skill researcher section expanded with concrete dispatch-trigger table. All work pushed; operator running parallel session captured for handoff (does not affect this session's pushes).

## Issues Closed

### Tier 1 friction retirement (completes ye5s9 epic's last pending P2)

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| `unitAI-xbofm` (+ `.1`, `.2`) | sp run --background: surface refusal reason | executor → reviewer (PASS 1190e6 first try) | merge 1c0e2cf + dist d42bc50b |

### Tier 3 help-text drift sweep

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| `unitAI-3r268` (+ `.1`) | help-text refresh: sp init/clean/merge/finalize/doctor | executor → reviewer (PASS ee3829 first try) | merge ecd2fafe + dist e0c1c1a |

### Tier 2 release-contract polish

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| `unitAI-w7ksg` | Audit: npm payload contents and exclusions | verified-covered by `unitAI-1j9om` CI gate | direct close |
| `unitAI-5voar` (+ `.1`, `.2`) | sp init / sp doctor layout alignment | executor → reviewer (PASS b4acea first try) | merge 36ad96e + dist d42bc50b |
| `unitAI-3m27y` (+ `.1`, `.2`) | npm payload allowlist + LICENSE + types | executor → reviewer (PASS 02e665 first try) | merge 197e9c74 (no dist) |
| `unitAI-rl9uh` + `unitAI-q30r7` | Naming + peer/prerequisite policy decision | orchestrator-direct docs/installation.md edit | commit 4f283f22 |
| `unitAI-6fsxp` (+ `.1`) | Reviewer blast-radius gate relaxation | executor → reviewer (PASS 4a3435 first try) | merge 874e9d4e |

### User-reported GH issues retired

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| GH#76 / `unitAI-032n4` (+ `.1`) | sp feed -f does not stop scrolling (Rico1109) | executor → reviewer (PASS d6715a after 1 fix loop on Vitest API→Bun cleanup) | merge + dist |
| GH#71 / `unitAI-dpf3a` (+ `.1`) | sp merge tsc gate false-positive on non-TS repos | executor → reviewer (PASS a00f0e first try) | merge + dist 1c6ea417 |

### Hidden root-cause fix surfaced mid-session

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| `unitAI-889dv` (+ `.1`, `.2`) | sp feed <job-id> returns partial tail instead of full DB-backed replay | executor → reviewer (PASS da905a after 1 test-failing-assertion fix loop) | merge d006a6b5 + dist cc617a3d |

`889dv` is the real structural fix for the reviewer false-PARTIAL pattern. The earlier 6fsxp prompt relaxation was a workaround for reviewers seeing ~8 events when the DB had thousands; with `889dv`, reviewers can actually see executor's `gitnexus_*` tool events via `sp feed <reviewed_job_id>`, so the gate works correctly as originally designed.

### Audit / epic closures

| ID | Title | Resolution |
|----|-------|-----------|
| `unitAI-u0nbr` | Audit A: specialists release/build/update drift surface | Closed as covered by today's chains (jj7hy, 5voar, 1j9om, 3m27y, usj9y, rl9uh+q30r7, 889dv) |
| `unitAI-6kofw` | Audit B: same drift surface | Same — closed as covered |
| `unitAI-5i7ow` | Reviewer process-strictness PARTIAL on functional contracts | Closed as covered by `unitAI-6fsxp` blast-radius gate relaxation + structural fix via `unitAI-889dv` |
| `unitAI-ye5s9` epic | Harden specialists ↔ xtrm-tools release contract | **Closed — 19/19 children shipped.** Cross-repo handshake now operational (deterministic asset-contract.json + repository_dispatch wiring); xtrm-tools side has `xtrm-cvjg` open as the receiving handler |

### Release-contract ye5s9 children landed in-session

| ID | Title | Chain |
|----|-------|-------|
| `unitAI-7ezse` (+ `.1`, `.2`) | Add .specialists/user/mandatory-rules tier to list-rules + docs | executor → reviewer (PASS ef75b6 after 1 test-shift fix) |
| `unitAI-cww2s` (+ `.1`, `.2`) | Machine-readable asset contract generator | executor → reviewer (PASS be76e8 after 1 determinism fix loop on generated_at timestamp) |
| `unitAI-dnqas` (+ `.1`, `.2`) | Release gate workflow validating asset-contract + repository_dispatch | executor → reviewer (PASS acb525 after 1 YAML-validity rebuttal) |

## Issues Filed (still open)

| ID | P | Notes |
|----|---|-------|
| `unitAI-c4g0m` | P0 | LSP overhead pooling — separate workstream, not release-blocking |
| `unitAI-k5kap` | P1 | shared LSP/Serena gateway epic — separate workstream |
| `unitAI-z2vpq` | P1 | script/service SDK runner — separate epic |
| `unitAI-pnqgd` | P1 | board cleanup epic — meta-cleanup |
| Memory-processor `unitAI-pwojn.2/.3` | P2 | Phase B/C of scaling — separate epic |
| Tier 3 polish: `sp merge` dirty-ignore for STAGED `.beads/issues.jsonl` (currently only ignores unstaged) | P3 | not filed; ~5-line fix; hit 8× this session as repeated `git restore --staged + checkout` ritual before each merge |
| `executor.specialist.json` "don't edit generated files" CONSTRAINT (proposal L588 residual) | P3 | not filed; ~5-min `sp edit` patch |

## Specialist Dispatches

| Chain | Jobs | Outcome |
|-------|------|---------|
| xbofm.impl + review | e3b207, 1190e6 | PASS first try |
| 3r268.impl + review | 59cf02, ee3829 | PASS first try |
| 5voar.impl + review | ce5c54, b4acea | PASS first try |
| 3m27y.impl + review | 130920, 02e665 | PASS first try |
| 6fsxp.impl + review | c9e971, 4a3435 | PASS first try |
| 032n4.impl + review (GH#76) | 28d7e1, d6715a | PASS after 1 executor fix loop (Vitest API in Bun) |
| dpf3a.impl + review (GH#71) | 0efc21, a00f0e | PASS first try (1 reviewer re-dispatch after silent drop) |
| 889dv.impl + review | 3eb680, da905a | PASS after 1 executor fix loop (test-failing-assertion) |
| 7ezse.impl + review | aefce3, ef75b6 | PASS after 1 executor fix loop (test row-shift after RULE_TIERS add) |
| cww2s.impl + review | 6923e2, be76e8 | PASS after 1 determinism fix (generated_at removal) |
| dnqas.impl + review | 44f53a, acb525 | PASS after 1 YAML-validity rebuttal |

22 specialist dispatches (11 executors + 11 reviewers). All chains merged. 4 reviewer fix-loops + 1 rebuttal; the new 6fsxp blast-radius gate kept the rebuttal rate dramatically lower than 2026-05-13b's 3-of-4 false-PARTIAL pattern.

## Problems Encountered

| Problem | Root cause | Resolution |
|---------|-----------|------------|
| `sp merge` refused on STAGED `.beads/issues.jsonl` each chain | `pqe96` MERGE_DIRTY_IGNORE_PREFIXES handles untracked/modified but not staged variant (`M ` not ` M`/`MM`) | Pre-merge `git restore --staged + git checkout` workaround each time. P3 polish needed. |
| GH#76 surfaced: `sp feed -f` hangs forever | followMerged() global mode never exits while keep-alive `waiting` jobs are tracked (never reach done/error/cancelled) | Fixed via `032n4` — global mode now treats keep-alive waiting as terminal-equivalent for exit; per-job mode unchanged |
| GH#71 surfaced: tsc gate false-positive on non-TS repos | runTypecheckGate ran unconditionally; tsc help-text exit was non-zero | Fixed via `dpf3a` — gate now checks for tsconfig.json existence first |
| Reviewer false-PARTIAL pattern persisted on 6fsxp despite prompt relaxation | Operator flagged: was actually a symptom of `sp feed <job-id>` returning ~8-line tail when DB had 2071 events | Fixed via `889dv` — queryTimeline uses jobId-scoped DB path when filter.jobId set; reviewers now see full tool-event history. 6fsxp prompt relaxation stays as safety net but is largely obsoleted |
| Operator running parallel session: 2 sp-executor tmux sessions + 3 worktrees + 1 master commit `e5da92e9` post-my-last-push | Operator-side concurrent work | Hands off; tracked here for cleanup-verification context. NOT cleaned up — would touch operator's in-flight work |
| Dolt remote diverged when checking xtrm-tools and operator's bd state | bd shared-server pulled commits I hadn't seen | `bd vc commit` + `bd dolt pull` + `bd dolt push` cycle synced |
| Stale user override at `.specialists/user/researcher.specialist.json` missing `per-turn-handoff-schema` mandatory rule | Old override mirrored package with minor drift | Deleted overlay; package canonical takes over |
| Background dispatch silent-drop on dnqas reviewer + 889dv reviewer + sp merge between chains | Known launch-ceremony race (now diagnosable post-xbofm — child stderr surfaces) | Re-dispatched after `sp ps` showed no job started |
| qwen3.5-thinking documented to flail; researcher was assigned this model | Stale model choice from May 4 | Swapped to claude-sonnet-4-6 (reliable tool exec); fallback gpt-5.4-mini |

## Code Changes

### unitAI-xbofm (1c0e2cf + d42bc50b)
- `src/cli/run.ts`: detached background dispatch now uses `stdio:['ignore','ignore','pipe']` and forwards child stderr to process.stderr; exits non-zero on early child failure before jobId appears. tmux path unchanged.

### unitAI-3r268 (ecd2fafe + e0c1c1a)
- `src/index.ts`: refreshed 5 `--help` blocks: sp init (Bun prereq + xtrm order), sp clean (dead-toolchain reason), sp merge (--target-branch usage + dirty-ignore note), sp finalize (SQLite-first + cascade), sp doctor (--check-drift Category A scope).

### unitAI-5voar (36ad96e + d42bc50b)
- `src/cli/doctor.ts`: Category A check now validates flat `.xtrm/skills/active/<skill>` symlink layout exclusively. Removed scoped `for (const scope of ['claude', 'pi'])` loop. Aligned with sp init layout. Fresh `sp init` + `sp doctor` reports 0 Category A false-positives.

### unitAI-3m27y (197e9c74)
- `LICENSE`: new MIT file, 2026 copyright Dawid (Jaggerxtrm).
- `package.json`: explicit `files` allowlist (config/specialists, /mandatory-rules, /skills, /catalog, /nodes, /hooks, /presets.json, LICENSE) plus inverse-exclusions for benchmarks/evals. Top-level `types` field added.
- `.npmignore`: additionally excludes config/benchmarks/ and config/skills/**/evals/.
- `.github/workflows/package-payload.yml`: LICENSE added to required-asset list.
- Payload shrank from 258 to 256 files; benchmarks + evals excluded; LICENSE included.

### unitAI-rl9uh + unitAI-q30r7 (4f283f22)
- `docs/installation.md`: new "Naming and prerequisite policy" subsection codifying the decision — scoped `@jaggerxtrm/specialists`, xtrm-tools as separate published package recorded only via `_runtime_prerequisites` field + runtime guard in sp init. No peerDependencies, no normal dependency on xtrm-tools.

### unitAI-6fsxp (874e9d4e)
- `config/specialists/reviewer.specialist.json`: prompt.system step 5 + prompt.task_template blast-radius gate relaxed. Now accepts ANY of: `gitnexus_impact` event, `$gitnexus_summary` injection, `gitnexus_detect_changes` event, or LOW `impact_report` in `sp result`. Only flags a gap if NONE present AND diff is MEDIUM+ surface.

### unitAI-032n4 (GH#76 — sp feed -f hang)
- `src/cli/feed.ts`: `followMerged()` now treats keep-alive `waiting` jobs as terminal-equivalent in GLOBAL follow mode (options.jobId not set). Per-job follow (`sp feed <id> -f`) keeps tracking across `sp resume` turns. `--forever` still overrides for daemon-style usage.
- `tests/unit/cli/feed.test.ts`: regression test added; Vitest `vi.doUnmock` swapped out for Bun-compatible cleanup after reviewer caught the test-harness incompatibility in fix loop.

### unitAI-dpf3a (GH#71 — sp merge tsc gate false-positive)
- `src/cli/merge.ts`: `runTypecheckGate` now checks for tsconfig.json before invoking `bunx tsc --noEmit`. Without tsconfig, logs "TypeScript gate: skipped (no tsconfig)" and returns clean. Unblocks markdown/notes/non-TS repos.

### unitAI-889dv (cc617a3d — sp feed full DB-backed replay)
- `src/specialist/timeline-query.ts`: `queryTimeline` + `readAllJobEvents` now use a jobId-scoped DB read path when filter.jobId is set, instead of iterating `listStatuses` + filtering (which lost events). Reviewers can now actually see executor's gitnexus tool events via `sp feed <reviewed_job_id>`.
- `src/cli/feed.ts`: cleaner DB-backed "job not found" message when looking up a specific jobId.
- `tests/unit/specialist/timeline-query.test.ts` + `tests/unit/cli/feed.test.ts`: regression tests added.
- `CHANGELOG.md`: `[Unreleased]` updated to record the behavior change.

### unitAI-7ezse (post-merge dist rebuild folded)
- `src/cli/list-rules.ts`: RULE_TIERS now includes `.specialists/user/mandatory-rules` at the TOP (user-overlay highest priority, matches runner's `mandatoryRules.resolve()` order at src/specialist/mandatory-rules.ts:66+185).
- `docs/surface-ownership.md`, `config/mandatory-rules/README.md`: docs sync to add user-overlay tier with same precedence note as specialists user overrides.
- `tests/unit/cli/list-rules.test.ts`: regression test + 2 existing tests fixed for tier-shift.

### unitAI-cww2s (asset contract generator)
- `scripts/generate-asset-contract.mjs`: new deterministic generator. Produces `dist/asset-contract.json` with schema_version, package_version, sha256-hashed shipped_skills/specialists/mandatory_rules/catalogs/nodes/hooks. No wall-clock timestamps (byte-identical regen verified).
- `package.json`: `generate:contract` npm script added; `dist/asset-contract.json` ships in payload via the existing dist/ allowlist entry.
- `.github/workflows/package-payload.yml`: asset-contract.json added to required-asset list.

### unitAI-dnqas (release-gate workflow)
- `.github/workflows/release-gate.yml`: new workflow. Triggers on push to master + workflow_dispatch. Detects cross-repo asset path changes (paths-filter on config/skills, config/specialists, config/mandatory-rules, config/catalog, config/hooks, config/nodes, package.json, dist/, dist/asset-contract.json). Regenerates asset-contract and asserts byte-equality vs committed (fails if drift). Fires `repository_dispatch` to Jaggerxtrm/xtrm-tools with event_type=specialists-asset-validation and client_payload (specialists git SHA + tag). Requires `XTRM_TOOLS_DISPATCH_PAT` repo secret (operator wired this in-session).

### ye5s9 epic closeout
- 19/19 children closed across 2026-05-13a/b/c sessions. Cross-repo handshake now operational at the specialists side; xtrm-tools side has `xtrm-cvjg` (handler workflow) + `xtrm-nogp`/`xtrm-sn9t`/`xtrm-2yn4` (smoke + publish-gate) open as the xtrm-tools-side workstream.

### v3 skill v3.3 doctrine merge (commit 0b4487c0 + 9c6e4161)
- `config/skills/using-specialists-v3/SKILL.md`: bumped 3.2 → 3.3 (+292 lines net then +492 lines for researcher expansion). Frontmatter description extended with integration-phase + debugger-restitch + conflict-cluster + test-failure-map keywords.
- New sections: Escalation Matrix table, Pre-Dispatch: Conflict Cluster Identification, Pre-Epic: Test-Failure-Map Pattern, Specialist Rebuttal As Routine (overthinker + reviewer templates), Bead Lifecycle And Parallel Commit Ordering, At Session End — Mandatory Handoff (references /session-close-report), Integration Phase — Cherry-Pick Playbook (non-sp-merge cases), Debugger-Restitch Pattern, E2E Smoke Phase procedure.
- Strengthened: Advisory Passes Are Part Of Every Chain (routing patterns + skip-trigger criteria), Long autonomous runs — dual-mechanism (bash sleep + cron heartbeat), Failure Recovery table extended with sp run silent-drop diagnosis + sp feed truncation check + bd/Dolt recovery.
- Researcher section expanded with three-mode breakdown, concrete dispatch-trigger table (7 agent-thought → bead-shape mappings), cost framing, "what researcher does NOT do" boundaries.
- Hard rule 13 added (orchestrator never edits code directly).
- Updated "What Orchestrator Does Differently" list with new behaviors.

### auto-mode skill v2.0 trim (commit 0b1d8220)
- `config/skills/using-specialists-auto/SKILL.md`: rewritten as minimal discipline overlay (171 → 137 lines). Delegates shared content to v3 (sleep cadence, reviewer rebuttal pattern, memory-gate batch, escalation matrix, session-close template). Keeps auto-specific: 5 hard-rule extensions, per-item loop shape, dist-rebuild cadence, per-chain smoke (distinct from v3's E2E integration smoke), pre-merge stash hygiene (marked transitional), auto-mode escalation triggers, drift telltale signs.

### Proposal closeout (commit 7be0a765)
- `docs/proposals/using-specialists-v3-improvements-2026-05-09.md`: DONE banner prepended. Lists commits + summarizes 80% of Part C workarounds obsoleted by code fixes earlier in session. Historical content preserved below.

### Researcher specialist consolidation (commit b0349c27 + 9c6e4161)
- `config/specialists/researcher.specialist.json`: bumped 1.1.0 → 1.2.0. Model swapped `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` → `anthropic/claude-sonnet-4-6` (qwen has documented tool-call flailing per memory; sonnet reliable for tool exec); fallback `openai-codex/gpt-5.4-mini`. Description rewritten with aggressive "DISPATCH BEFORE answering from training data" framing. System prompt consolidated to 3-mode structure (Targeted / Discovery / Media), dropped verbose Python wrapper for Mode 3 (points at last30days skill). Skills list reduced from 4 → 1 (only last30days kept; find-docs + deepwiki + github-search were 100% duplicates of inlined prompt content — saves ~3-4k tokens per dispatch). `mandatory_rules` now includes `per-turn-handoff-schema` (was missing in stale user overlay).
- Stale `.specialists/user/researcher.specialist.json` deleted (mirrored package with minor drift; package canonical now superior).
- v3 skill researcher section expanded with concrete dispatch triggers (see v3.3 doctrine merge above).

### Anthropic/Claude removal sweep — researcher (c02f4c1a) + 9-specialist audit (d6f8d8fa)
- Operator flagged that Anthropic Claude models don't work in their env. Researcher had been swapped TO claude-sonnet earlier in the session as part of the v1.2.0 consolidation; reverted to non-Anthropic.
- **researcher** (c02f4c1a): primary `anthropic/claude-sonnet-4-6` → `openai-codex/gpt-5.4-mini` (matches executor; reliable for tool-heavy Bash CLI). Fallback `openai-codex/gpt-5.4-mini` → `google-gemini-cli/gemini-3.1-pro-preview` (long-context fallback for research synthesis). v3 skill cost framing updated (~$0.02-0.08 → ~$0.005-0.02 per call).
- **Full audit (d6f8d8fa)**: found 9 other specialists with claude refs. **3 with claude as PRIMARY (fully broken — would fail on dispatch)**:
  - `test-runner` [LOW]: `claude-haiku-4-5` → `openai-codex/gpt-5.4-mini`
  - `specialists-creator` [HIGH]: `claude-sonnet-4-6` → `openai-codex/gpt-5.5`
  - `xt-merge` [MEDIUM]: `claude-sonnet-4-6` → `openai-codex/gpt-5.4-mini`
- **6 with claude as FALLBACK (silent never-fires)**: overthinker, executor, changelog-keeper, node-coordinator → `google-gemini-cli/gemini-3.1-pro-preview` (premium reasoning); explorer, changelog-drafter → `google-gemini-cli/gemini-3-flash-preview` (fast/cheap).
- Final provider distribution: 12 specialists × openai-codex (primary), 2 × nano-gpt/glm-5, 0 × anthropic. Fallback diversity via gemini + glm + cross-provider.
- `grep -rl "anthropic\|claude-*" config/specialists/` returns empty. All 17 specialists schema-validate clean.

## Memories Saved

| Key | Content |
|-----|---------|
| `xbofm-background-stderr-surfacing` | detached spawn pipes stderr, forwards on early-exit |
| `3r268-help-text-refresh` | 5 help blocks updated for vwrnq+usj9y+8tm35+wq0mw+amzec+a6e60+pqe96 drift |
| `5voar-doctor-flat-active-layout` | doctor validates flat .xtrm/skills/active/, no scoped claude/pi loop |
| `3m27y-payload-tightening-license` | LICENSE + explicit files allowlist + types field + benchmarks/evals excluded |
| `rl9uh-q30r7-naming-and-prereq-policy` | docs codify scoped package + _runtime_prerequisites only |
| `6fsxp-reviewer-blast-radius-gate-relaxed` | reviewer prompt accepts 4 evidence forms, only flags MEDIUM+ surfaces with no evidence |
| `w7ksg-covered-by-1j9om-ci-gate` | npm payload audit closed as covered by CI gate |
| `032n4-sp-feed-f-global-exit-on-keepalive-waiting` | GH#76 fix; global follow exits cleanly when only keep-alive waiting jobs remain |
| `dpf3a-sp-merge-tsc-gate-tsconfig-check` | GH#71 fix; runTypecheckGate checks tsconfig.json before running tsc |
| `889dv-sp-feed-db-backed-replay` | sp feed jobId-scoped DB read path; structural retirement of reviewer false-PARTIAL pattern (6fsxp prompt relaxation was a workaround) |
| `7ezse-list-rules-user-tier` | list-rules shows .specialists/user/mandatory-rules at TOP of RULE_TIERS; docs synced |
| `cww2s-asset-contract-generator` | deterministic dist/asset-contract.json + scripts/generate-asset-contract.mjs; CI assert lists it |
| `dnqas-release-gate-workflow` | .github/workflows/release-gate.yml fires repository_dispatch to xtrm-tools when cross-repo assets change |
| `v3-skill-doctrine-merge-2026-05-13` | v3.3 doctrine merge from 2026-05-09 proposal; 80% of Part C workarounds obsoleted by today's code fixes |

## Smoke Test Results

| Smoke | Result |
|-------|--------|
| `bunx tsc --noEmit` after each chain | clean ✓ |
| `bun test tests/unit/cli/run.test.ts` (xbofm) | green ✓ |
| `bun test tests/unit/cli/doctor*.test.ts` (5voar) | green ✓ |
| `bun test tests/unit/cli/feed.test.ts` (032n4) | 28/28 pass ✓ |
| `bun test tests/unit/cli/merge.test.ts` (dpf3a) | 23/23 pass ✓ |
| `bun test tests/unit/cli/list-rules.test.ts` (7ezse) | 5/5 pass ✓ |
| `bun run generate:contract` twice → cmp byte-identical | YES (cww2s determinism) ✓ |
| `sp merge --help` | shows --target-branch + dirty-ignore note ✓ |
| `sp init` + `sp doctor` (fresh /tmp dir) | 0 Category A false-positives ✓ |
| `npm pack --dry-run` | LICENSE present, benchmarks/evals excluded, 256 files (down from 258), asset-contract.json present ✓ |
| `scripts/assert-package-payload.sh` w/ LICENSE | passed ✓ |
| `sp view reviewer --section prompt.system` | parses, shows new gate language ✓ |
| `sp view researcher` after consolidation | model=claude-sonnet-4-6, v1.2.0, skills=[last30days only] ✓ |
| `sp validate researcher` | Schema validation passed ✓ |
| Global `sp` symlink → `dist/index.js` shas match | YES (every rebuild auto-applies) ✓ |
| `sp ps` final | 0 active ✓ |

## Release-Readiness Verdict

**Genuinely ready to cut as v3.15.0.** Patch (3.14.2) would understate the surface additions: new flag (`--target-branch`), new public files (LICENSE, dist/asset-contract.json), new workflow (release-gate.yml), new CLI behaviors (sp feed full DB replay, sp merge tsc-gate skip on non-TS, sp feed -f clean exit on keep-alive waiting), and material new `package.json` `types` field. Minor bump is the honest call.

Operator steps remaining for the cut:
1. Decide version bump (recommendation: 3.15.0).
2. `sp run changelog-keeper` (or `xt release prepare`) — note `[Unreleased]` already has 889dv entry; keeper will add the rest from xt reports.
3. `npm publish` after build + payload-contract gate verify cleanly.
4. Tag + push tag.
5. **Heads up**: `release-gate.yml` will fire on next master push touching cross-repo asset paths. `XTRM_TOOLS_DISPATCH_PAT` is set. xtrm-tools-side `xtrm-cvjg` handler is NOT yet shipped — dispatch will succeed but xtrm-tools won't act on it until that handler lands (parallel operator session in xtrm-tools is on this).

## Open Issues Carried Forward

### Ready for next session

| ID | P | Context / Suggestions |
|----|---|----|
| xtrm-tools `xtrm-cvjg` + `xtrm-nogp` + `xtrm-sn9t` + `xtrm-2yn4` | mixed | Complete cross-repo handshake. Operator started a parallel auto-mode session in xtrm-tools (2 sp-executor tmux sessions visible + 3 worktrees + commit `e5da92e9` post-my-last-push). **Do not touch from specialists repo** — different bd workspace, different observability DB. |
| `executor.specialist.json` "don't edit generated files" CONSTRAINT (proposal L588 residual) | P3 | Not filed. ~5-min `sp edit executor` patch to system_prompt. Bake: "Never edit files inside `dist/`, `build/`, `__generated__/`, or paths with `// AUTO-GENERATED` headers. Regenerate via build script." |
| `sp merge` STAGED `.beads/issues.jsonl` ignore | P3 | Hit 8× this session as repeated `git restore --staged + git checkout` ritual. Extend `MERGE_DIRTY_IGNORE_PREFIXES` filter to also strip staged-variant paths (`M ` not just ` M`/`MM`). |
| Reviewer prompt minor wording polish (raw-artifact-reads vs CLIs) | P3 | Filed only as report mention. Low-leverage. |

### Backlog (separate workstreams, not release-blocking)

| ID | P | Notes |
|----|---|-------|
| `unitAI-c4g0m` | P0 | LSP pooling epic — performance, separate workstream |
| `unitAI-k5kap` | P1 | Shared LSP/Serena gateway epic — separate workstream |
| `unitAI-z2vpq` | P1 | script/service SDK runner — separate epic |
| `unitAI-pnqgd` | P1 | board cleanup epic — meta |
| Memory-processor Phase B/C (`unitAI-pwojn.2/.3`) | P2 | Separate epic |
| GH#69 | open | Node members stuck in recovery_pending — node-mode only, separate workstream from core specialist runtime |

## Due-Diligence Sweep

- 0 active sp jobs FROM THIS SESSION. `sp ps` shows operator's parallel jobs (2 sp-executor tmux sessions + 3 worktrees: `unitAI-ad0ol-operator`, `unitAI-fn2wd-executor`, `chore/unitAI-5kuv0-dist-docs`). NOT cleaned up — would touch operator's in-flight work.
- 0 in-progress beads from this session.
- 0 specialist worktrees from this session. The `--keep-alive-executor` worktree visible is a pre-existing orphan that predates today's work; left untouched per "don't blindly delete what you don't understand" rule.
- All session chain branches deleted post-merge.
- 27 issues closed (12 parent + 15 chain children) with memory acks; +2 audits superseded (u0nbr, 6kofw); +1 reviewer-evidence bead superseded (5i7ow); +1 epic closed (ye5s9); +2 GH issues closed (#76, #71).
- Push state at end of my work: `9c6e4161`. Operator landed `e5da92e9` after my last push — that's their concurrent work, not part of my session.
- Skill mirrors: `config/skills/using-specialists-v3/SKILL.md` and `.xtrm/skills/default/using-specialists-v3/SKILL.md` sha256 match (`be1dbea6`). Same for `using-specialists-auto`.
- `CHANGELOG.md`: `[Unreleased]` has the `889dv` entry from the executor's run. Other session items remain to be added by next `changelog-keeper` run during release prep — report-only entries don't belong in `[Unreleased]`.
- Service skills / docs SSOT / CLAUDE.md / evidence artifacts / decisions / tests / skill packs / open beads: checked. No surprises. Skill mirrors hand-synced via `cp` (canonical flow is `sp init --sync-skills`). `.xtrm/skills/active/using-specialists-auto` is the operator-side leftover symlink, not part of my commits.
- npm globally-installed `sp` symlinks back to local `dist/index.js` (verified earlier this session): every `bun run build` auto-applies for local testing.

## Cumulative Pre-Release Status (sessions 2026-05-13 + 2026-05-13b + 2026-05-13c)

| Item | Status |
|---|---|
| Reviewer cumulative-diff noise filter (lqsha) | ✓ shipped |
| sp merge dirty-ignore .beads + .xtrm/skills/active (pqe96) | ✓ shipped |
| sp merge --target-branch (a6e60) | ✓ shipped |
| dead-toolchain stale-reaper reason (wq0mw) | ✓ shipped |
| Background-dispatch stderr surfacing (xbofm) | ✓ shipped |
| Tier 3 help-text refresh (3r268) | ✓ shipped |
| sp init/doctor layout alignment (5voar) | ✓ shipped |
| npm payload tightening + LICENSE + types (3m27y) | ✓ shipped |
| Naming/prereq policy decision (rl9uh + q30r7) | ✓ documented |
| Reviewer blast-radius gate relaxation (6fsxp) | ✓ shipped |
| Payload audit (w7ksg) | ✓ verified covered by 1j9om CI gate |
| GH#76 sp feed -f endless scroll (032n4) | ✓ shipped |
| GH#71 sp merge tsc gate non-TS false-positive (dpf3a) | ✓ shipped |
| sp feed jobId DB-backed full replay (889dv) | ✓ shipped — structural fix for false-PARTIAL pattern |
| list-rules user-overlay tier + docs sync (7ezse) | ✓ shipped |
| Machine-readable asset contract generator (cww2s) | ✓ shipped |
| Cross-repo release-gate workflow + dispatch (dnqas) | ✓ shipped (xtrm-tools-side handler still open) |
| Release contract epic ye5s9 | ✓ CLOSED — 19/19 children |
| v3 skill doctrine merge to v3.3 | ✓ shipped + mirror synced |
| auto-mode skill trim to v2.0 minimal overlay | ✓ shipped + mirror synced |
| 2026-05-09 proposal closeout (DONE banner) | ✓ shipped |
| Researcher specialist v1.2.0 consolidation | ✓ shipped (model swap + skill dedup + aggressive description) |
| v3 skill researcher section expansion | ✓ shipped + mirror synced |
| Researcher: claude → openai-codex/gpt-5.4-mini (operator env doesn't have Claude) | ✓ shipped (c02f4c1a) |
| 9-specialist Anthropic audit + remediation (3 PRIMARY broken: test-runner, specialists-creator, xt-merge) | ✓ shipped (d6f8d8fa). 0 specialists now reference anthropic/claude-* |

## Suggested Next Priority

1. **Cut v3.15.0 release** — see Release-Readiness Verdict for the 5-step sequence. Operator-driven. Specialists-side is genuinely ready.
2. **Wait on xtrm-tools-side parallel session to land `xtrm-cvjg`** (handler for the new `repository_dispatch`) — then the cross-repo handshake is operational end-to-end. Without it, our release-gate fires successfully but xtrm-tools does nothing with the dispatch (no regression — just incomplete loop). Operator's parallel auto-mode session in `~/dev/xtrm-tools` is already on this.
3. **File the 2 P3 polish beads** (executor "don't edit generated files" CONSTRAINT + sp merge staged-`.beads/issues.jsonl` ignore) when bandwidth allows. Both ~5-min fixes. Total session friction they would have prevented: ~10 ritual interruptions.
4. **Watch researcher dispatch rate post-release** — the consolidation (model swap + 4 skills → 1 + aggressive description + v3 skill expansion) should materially increase dispatch frequency. If still rarely used after a few sessions, the bottleneck is description discoverability, not capability — escalate to a stronger trigger phrase or proactive injection in orchestrator boot.
