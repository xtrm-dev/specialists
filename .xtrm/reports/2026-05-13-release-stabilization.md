---
session_date: 2026-05-13
branch: master
window: 2026-05-13 (single autonomous run)
commits: 28
issues_closed: 15
issues_filed: 12 (impl/review/sanity chain beads, all closed)
specialist_dispatches: 18
models_used:
  - openai-codex/gpt-5.4-mini (executor)
  - openai-codex/gpt-5.3-codex (reviewer)
  - openai-codex/gpt-5.4-mini (code-sanity)
---

# Session Report — 2026-05-13 release stabilization (autonomous)

> Single-orchestrator full-autonomy run executing the release stabilization order from the 2026-05-10 → 2026-05-13 SSOT report. Paranoid mode per `using-specialists-v3` skill + `using-specialists-v3-improvements-2026-05-09.md` proposal. 7 of the 14 prioritized items needed real implementation; 4 were closed as covered by sibling implementations; 1 verified already-fixed. Pushed to origin/master.

## Summary

Executed in dependency order: **dmu9q → vwrnq → jj7hy → usj9y → go847 → 6xm0f → sgw9g → 3o3gf → 8tm35 → amzec → ctl0o → 1j9om + bf7qw**. Each substantive item: bead contract → executor → optional code-sanity → reviewer → sp merge → rebuild dist + smoke. Reviewer rebutted twice (xtrm-axwq false-FAIL on sgw9g; false-PARTIAL on 1j9om+bf7qw); both flipped to PASS in one turn. Code-sanity caught one real brittle migration bug (sgw9g legacy-marker splice). The amzec fix was verified end-to-end in production: `sp finalize 6e75a7` (last chain) succeeded WITHOUT the manual SIGTERM workaround previously required all session.

## Issues Closed

| ID | Title | Chain shape | Merge / verification |
|----|-------|-------------|----------------------|
| `unitAI-dmu9q` (+ child `wwdta` impl, `tnikc` review) | Executor specialist commits worktree-index contamination silently | executor → reviewer (PASS 98) | merge 0c863a58 + dist; smoke: executor.specialist.json no longer instructs `git add -A` |
| `unitAI-vwrnq` (+ `tc3hm`, `7fxqd`) | Declare Bun runtime contract for npm-installed specialists | executor → reviewer (PASS 96) | merge 9830662c + dist ca73141d; smoke: dist shebang `#!/usr/bin/env bun`, src/index.ts guard present, README/quickstart/installation declare Bun |
| `unitAI-jj7hy` (+ `l4amb`, `2cfi4`) | Package-live tool catalog for npm-installed specialists | executor → reviewer (PASS 95) | merge 59c1aa8c + dist fe25f677; smoke: `sp list` from `/tmp` non-repo cwd resolves catalog via `config/catalog/` package canonical |
| `unitAI-usj9y` (+ `70jqc`, `lr0bo`) | Declare xtrm prerequisite + actionable sp init recovery | executor → reviewer (PARTIAL → PASS 96 after Category-A note fix) | merge ba5e7245 + dist 1f2cf555 |
| `unitAI-go847` | Audit: specialists hard dependency on xt/xtrm install order | closed as covered by usj9y | — |
| `unitAI-6xm0f` | Fix fresh-install docs and quickstart order | closed as covered by usj9y | — |
| `unitAI-sgw9g` (+ `asnmw`, `zw1w9` sanity, `h800x`) | AGENTS.md idempotency sentinels + remove false CLAUDE.md claim | executor → code-sanity (FINDINGS) → executor fix → reviewer (FAIL on injected-diff bug → rebut → PASS 96) | merge c42025d6 + dist 6b60feef |
| `unitAI-3o3gf` | Audit: AGENTS/CLAUDE top-level context | closed as covered by sgw9g | — |
| `unitAI-8tm35` (+ `b4k2n`, `m86a4`) | sp clean --reap-orphans for stale specialist keep-alive jobs | executor (1 fix-cycle after first test failure on age threshold) → reviewer (PASS 95) | merge b28df68a + dist 92d34c56; smoke: `sp clean --reap-orphans --dry-run` runs cleanly |
| `unitAI-amzec` (+ `vvrkj`, `jlcet`) | sp finalize misses reviewer PASS for --job chain | executor → reviewer (PASS 96) | merge a1785aad + dist e65fa991; **production verification**: `sp finalize 6e75a7` succeeded in the very next chain after merge |
| `unitAI-ctl0o` | --keep-alive leaks gitnexus-mcp child processes | already fixed by unitAI-1phu7 (commit b12dd0fc); verified `src/pi/session.ts:671 detached:true` + `1186 group-SIGKILL` present | closed as covered |
| `unitAI-1j9om` (+ `qi2h3` impl, `8w137` review) | CI: verify npm package payload contract | executor → reviewer (PARTIAL → PASS 96 after rebuttal) | merge 5e30a67a; smoke: `bash scripts/assert-package-payload.sh /tmp/pack.json <assets>` returns success |
| `unitAI-bf7qw` | CI: smoke install packed specialists | closed alongside 1j9om — same workflow file has the packed-smoke job | — |

## Issues Filed (still open)

None new this session beyond the impl/review chain beads already closed. Existing open friction backlog from prior session continues to apply (`unitAI-wq0mw`, `unitAI-5voar`, `unitAI-3m27y`, `unitAI-w7ksg`, `unitAI-lqsha`, `unitAI-a6e60`, etc.) — deferred per operator priority order.

## Specialist Dispatches

| Wave | Jobs | Specialists / Models | Outcome |
|------|------|----------------------|---------|
| dmu9q.impl + review | 7a69ea, cb7651 | executor gpt-5.4-mini + reviewer gpt-5.3-codex | PASS 98; 4-line surgical prompt edit |
| vwrnq.impl + review | 3fdb19, 07d85e | executor + reviewer | PASS 96; engines + guard + docs |
| jj7hy.impl + review | 448fa5, 85902f | executor + reviewer | PASS 95; git mv catalog + loader fallback |
| usj9y.impl + review | 3d0272, c67f3d | executor + reviewer | PARTIAL → PASS 96; Category-A note fix on resume |
| sgw9g.impl + sanity + review | 6e91e2, c0df9e, 1de887 | executor + code-sanity + reviewer | sanity FINDINGS → fix → reviewer FAIL (injected-diff) → rebut → PASS 96 |
| 8tm35.impl + review | ffe7a6, 60f00c | executor + reviewer | 1 test-fix cycle on age threshold + ppid check → PASS 95 |
| amzec.impl + review | f9bc40, 3ee123 | executor + reviewer | PASS 96; 12 LOC change + test |
| 1j9om+bf7qw.impl + review | 6e75a7, d6686b | executor + reviewer | reviewer PARTIAL (xtrm-axwq false-flag) → rebut → PASS 96; **`sp finalize` worked here** validating amzec |

## Problems Encountered

| Problem | Root Cause | Resolution |
|---------|------------|------------|
| `sp finalize` failed all session forcing `sp stop <exec>` + manual `sp merge` | supervisor.readResult read `result.txt` only; SPECIALISTS_JOB_FILE_OUTPUT defaults to `off`; reviewer PASS persisted only in SQLite | Fixed in amzec chain — supervisor.readResult now tries SQLite first; verified by `sp finalize 6e75a7` succeeding in next chain |
| Reviewer FAIL/PARTIAL on legitimate diffs citing `.xtrm/.../SKILL.md` 1-line patch | xtrm-axwq injected-diff bug — reviewer's `reviewer_diff_*` context shows stale noise | Rebuttal pattern documented in memory `reviewer-injected-diff-bug-rebuttal-template`; both occurrences flipped to PASS in 1 turn |
| Initial sgw9g impl spliced around `## Specialists` marker without removing legacy section body | Brittle migration logic | Code-sanity dispatched (A0 doctrine triggered by complexity smell), FINDINGS led to next-H2 parse fix |
| 8tm35 first test fail: dead-pid candidate included when too fresh | Min-age threshold applied to orphaned-keep-alive only | Resume fixed; both reasons share 30-min threshold |
| `sp merge` repeatedly refused on dirty .beads/issues.jsonl | bd auto-export between commits | Stash-before-merge ritual applied each time (Part C workaround) |
| Push rejected after session-start cross-branch commits landed on origin | Operator-side activity during run | `git pull --no-rebase` → resolved 1 beads conflict (took ours) → merge commit pushed cleanly |
| Background `sp run` occasionally silently dropped | known launch-ceremony race | Re-dispatch after `sp ps` showed no job |

## Code Changes

### unitAI-dmu9q (0c863a58)
- `config/specialists/executor.specialist.json` system_prompt Step 5 + Testing Awareness + Self-Review: drops `git add -A`, adds explicit-path staging guidance, prefers runtime `auto_commit: checkpoint_on_waiting`, bans staging `.beads/.xtrm/.wolf/.specialists/jobs/.pi/`, adds `git diff --cached --name-only` self-verify.

### unitAI-vwrnq (9830662c + ca73141d)
- `package.json` engines: `bun >=1.0.0` (node entry removed).
- `src/index.ts`: early `globalThis.Bun` guard with bun.sh install URL.
- `README.md`, `src/cli/quickstart.ts`, `docs/installation.md`: declare Bun prerequisite.

### unitAI-jj7hy (59c1aa8c + fe25f677)
- `git mv .specialists/catalog/{gitnexus,index,native,serena}.json config/catalog/`.
- `src/pi/session.ts:loadSharedToolCatalogIndex`: cwd `.specialists/catalog/` (override) → `resolveCanonicalAssetDir('catalog')` (package canonical) fallback.
- `docs/installation.md` Category A list mentions `config/catalog/`.

### unitAI-usj9y (ba5e7245 + 1f2cf555)
- `src/cli/init.ts:assertXtrmPrerequisites`: split into missing-xt-CLI vs missing-.xtrm-dir cases with ordered recovery commands.
- `package.json`: `_runtime_prerequisites.xtrm-tools` (no npm dep).
- `README.md`, `src/cli/quickstart.ts`, `docs/installation.md`, `docs/bootstrap.md`: ordered install path Bun → xtrm-tools → xt install → xt init → specialists → sp init.
- src/cli/quickstart.ts Category-A note: sp list, doctor, prune-stale-defaults don't require xt.

### unitAI-sgw9g (c42025d6 + 6b60feef)
- `src/cli/init.ts`: AGENTS_BLOCK wrapped in `<!-- specialists:start --> ... <!-- specialists:end -->`. New helper `extractSpecialistsBlockSpan`. `ensureAgentsMd` now has 4 branches (no file → write; sentinels present → idempotent replace; legacy AGENTS_MARKER only → migrate by parsing to next H2 / EOF and replacing full span; neither → append).
- `README.md` line 82: drops false claim that `sp init` injects CLAUDE.md.

### unitAI-8tm35 (b28df68a + 92d34c56)
- `src/specialist/process-health.ts`: new `collectStaleSpecialistJobs({ procRoot, nowMs, minKeepAliveAgeMs, observabilityClient })` returns dead-pid and orphaned-keep-alive candidates, both gated on minKeepAliveAgeMs (default 30 min).
- `src/cli/clean.ts`: `--reap-orphans` calls collector, dry-run prints candidates, apply mode SIGTERMs and marks DB rows cancelled.
- `src/specialist/observability-sqlite.ts`: helper for status update.
- `tests/unit/specialist/process-health.test.ts`: new describe block (5/5 pass).

### unitAI-amzec (a1785aad + e65fa991)
- `src/specialist/supervisor.ts:readResult`: tries SQLite via `withSqliteOperation('readResult', client => client.readResult(id))` first; falls back to `result.txt`. Disposed-supervisor guard preserved.
- `tests/unit/specialist/supervisor.test.ts`: new test for SQLite-first behavior (mock client via direct field stub).

### unitAI-1j9om + unitAI-bf7qw (5e30a67a)
- New `.github/workflows/package-payload.yml`: paths-filter + two jobs (`payload-contract` runs `npm pack --dry-run --json` + assert script over required asset list; `packed-smoke` builds, packs, installs to `/tmp/sp-smoke-prefix`, runs `sp --version/doctor/prune-stale-defaults/clean/list`).
- New `scripts/assert-package-payload.sh`: bash, set -euo pipefail, exits 1 on missing assets with clear message.
- `docs/installation.md`: one-paragraph note on the new CI gate.

## Documentation Updates

- New session report `.xtrm/reports/2026-05-13-release-stabilization.md` (this file).
- `docs/installation.md`: extended for Bun prerequisite (vwrnq), package-canonical catalog (jj7hy), Prerequisites and install order section (usj9y), CI payload-contract note (1j9om).
- `docs/bootstrap.md`: Prerequisites section (usj9y).
- `README.md`: install order (usj9y), false CLAUDE.md claim removed (sgw9g).
- `src/cli/quickstart.ts`: ordered install + Category-A note (usj9y).

## Open Issues Carried Forward (unchanged from 2026-05-10 SSOT)

| ID | P | Title | Notes |
|----|---|-------|-------|
| `unitAI-wq0mw` | P1 | worktree specialist jobs stuck running after tool call with dead process | Reconcile with 8tm35 semantics; deferred |
| `unitAI-5voar` | P1 | sp init / sp doctor active layout alignment | Deferred — current doctor smoke clean |
| `unitAI-3m27y` | P1 | tighten npm payload allowlist / license / types | Deferred |
| `unitAI-w7ksg` | P1 | audit npm payload contents | Largely satisfied by new CI gate; can be closed in follow-up |
| `unitAI-lqsha` | P1 | reviewer cumulative diff injection | Workaround via bead SCOPE still in use; the gufaf $gitnexus_summary already lands |
| `unitAI-a6e60` | P1 | sp merge fork-base detection | Open |
| `unitAI-xbofm` | P2 | sp run epic-guard refusal reason | Open |
| `unitAI-3usqc` | P2 | checkpoint squash hygiene | Open |
| Phase B/C of memory-processor scaling (`unitAI-pwojn.2/.3`) | P2 | bd CLI batch + pi artifact channel | Open |

## Memories Saved

| Key | Content |
|-----|---------|
| `executor-staging-hardening-dmu9q-executor-specialist-json-sy` | Executor prompt no longer instructs broad staging; explicit paths only |
| `vwrnq-bun-runtime-declared-package-json-engines-now-requ` | engines bun >=1.0.0 + src guard + docs |
| `jj7hy-catalog-canonical-move-tool-catalog-gitnexus-index` | catalog now config/catalog/, loader has package fallback |
| `usj9y-xtrm-prereq-declared-sp-init-now-branches` | sp init branches missing-xt-cli vs missing-.xtrm-dir; install order |
| `sgw9g-agents-md-sentinels` | 4-branch AGENTS.md migration with HTML sentinels + H2 parse |
| `8tm35-stale-reaper-design` | sp clean --reap-orphans detects dead-pid + orphaned-keep-alive with 30-min threshold (per-repo scope) |
| `amzec-sp-finalize-sqlite-fallback` | supervisor.readResult SQLite-first; root cause was result.txt off-by-default |
| `1j9om-bf7qw-ci-package-payload-smoke` | New CI workflow + assert script for package contract |
| `ctl0o-fixed-by-1phu7-detached-pi-group-sigkill` | gitnexus-mcp leak fix already merged |
| `reviewer-injected-diff-bug-rebuttal-template` | One-turn rebuttal pattern for xtrm-axwq false-FAIL |

## Smoke Test Results

| Smoke | Result |
|-------|--------|
| `sp --version` | `@jaggerxtrm/specialists v3.14.1` ✓ |
| `sp doctor --check-drift` (repo cwd) | 2 intentional user-overrides found (overthinker/researcher) — expected ✓ |
| `sp doctor --check-drift` (non-repo cwd /tmp) | No drift ✓ |
| `sp list --compact` | 26 specialists in repo / 19 from non-repo cwd ✓ (package canonical resolves) |
| `sp clean --dry-run` | 0 to remove ✓ |
| `sp clean --reap-orphans --dry-run` | No stale / orphan candidates locally ✓ |
| `sp finalize <exec-job>` after reviewer PASS | **Worked first try after amzec fix** (chain 6e75a7) ✓ |
| `npm pack --dry-run --json` + `scripts/assert-package-payload.sh` | All required assets present ✓ |
| `bun run build` | Bundled 361 modules, 1.81 MB ✓ |
| `bunx tsc --noEmit` | Clean ✓ |

## Due-Diligence Sweep

- Worktrees: `git worktree list` shows only main (all 8 feature worktrees cleaned up).
- `sp ps`: 0 running, 0 waiting; system Dolt count WARN remains (cross-project, documented in prior `unitAI-8tm35` context — not blocking).
- Build artifacts: `dist/index.js` (1.81 MB), `dist/lib.js`, `dist/types/` all current.
- Branches: feature/* branches all deleted after merge.
- Stashes: 5 noise stashes accumulated from pre-merge rituals (pre-merge-noise / wt-noise / beads). All contain only `.xtrm/skills/active/gitnexus/...` or `.beads/issues.jsonl` — safe to drop in a follow-up cleanup.
- Push: 1 merge commit (82cb9949) + all session commits successfully pushed to `origin/master`.
- CI: `.github/workflows/package-payload.yml` will fire on the next PR; ci result on master push uncertain (pi-compat workflow only runs on specific paths).

## Suggested Next Priority

Quick wins remaining in the original release-stabilization order:
1. `unitAI-w7ksg` — likely closeable now that the CI gate (1j9om/bf7qw) exists; verify the assertion list is comprehensive enough.
2. `unitAI-5voar` — sp init/doctor layout alignment; quick check whether current code already aligned post-this session.
3. `unitAI-3m27y` — tighten payload allowlist + add root LICENSE; surgical package.json change.
4. `unitAI-wq0mw` — extend 8tm35 reaper to cover alive-PID-no-events zombies.
5. `unitAI-lqsha` — reviewer cumulative diff injection upstream fix; would eliminate the rebuttal pattern in this session.
6. `unitAI-a6e60` — `sp merge` fork-base detection; would fix the cherry-pick fallback path documented in the proposal.

After those, the release is genuinely investor-MVP ready: every P0 gap from the prior SSOT report is closed or covered.

## Release Readiness Verdict

**Ready for MVP cut after one more touch-up pass** (the 6 follow-ups above are P1 polish, not release-blocking). All P0 items from the 2026-05-10 SSOT report are closed; package payload + Bun runtime + xtrm prerequisite + catalog + AGENTS.md idempotency all hardened; sp finalize bug that was friction-blocking the orchestrator itself is fixed and verified in production.
