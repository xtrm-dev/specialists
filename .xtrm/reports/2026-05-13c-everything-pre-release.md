---
session_date: 2026-05-13
branch: master
window: 2026-05-13 (autonomous continuation: Tier 1 item 5 + Tier 2 + Tier 3 + reviewer prompt)
commits: 12 (7 merges + 4 dist rebuilds + 1 docs)
issues_closed: 17 (8 parent beads + 9 chain beads)
issues_filed: 0 net new (all chain beads closed)
specialist_dispatches: 14 (7 executors + 7 reviewers)
models_used:
  - openai-codex/gpt-5.4-mini (executor)
  - openai-codex/gpt-5.3-codex (reviewer)
---

# Session Report — 2026-05-13c Everything-Pre-Release (autonomous)

> Continuation of 2026-05-13b. Closes out Tier 1 (xbofm), Tier 3 (help-text sweep), Tier 2 (w7ksg verified-covered, 5voar, 3m27y, rl9uh+q30r7), and the reviewer-prompt false-PARTIAL fix (6fsxp). Pre-release MVP-ready.

## Summary

Seven substantive chains shipped + one docs decision + one verification close. Reviewer false-PARTIAL pattern that has plagued every session since 2026-05-09 is finally retired at the source (6fsxp). LICENSE present, payload tightened, doctor aligned with init layout, all help text current. All work pushed to origin/master.

## Issues Closed (8 parents + 9 chain children)

| ID | Title | Chain shape | Merge |
|----|-------|-------------|-------|
| `unitAI-xbofm` (+ `.1`, `.2`) | sp run --background: surface refusal reason | executor → reviewer (PASS 1190e6 first try) | merge 1c0e2cf + dist d42bc50b |
| `unitAI-3r268` (+ `.1`) | Tier 3 help-text drift refresh (5 commands) | executor → reviewer (PASS ee3829 first try) | merge ecd2fafe + dist e0c1c1a |
| `unitAI-w7ksg` | Audit: npm payload contents and exclusions | verified-covered by `unitAI-1j9om` CI gate | direct close |
| `unitAI-5voar` (+ `.1`, `.2`) | sp init / sp doctor layout alignment | executor → reviewer (PASS b4acea first try) | merge 36ad96e + dist d42bc50b |
| `unitAI-3m27y` (+ `.1`, `.2`) | npm payload allowlist + LICENSE + types | executor → reviewer (PASS 02e665 first try) | merge 197e9c74 (no dist) |
| `unitAI-rl9uh` + `unitAI-q30r7` | Naming + peer/prerequisite policy decision | orchestrator-direct docs/installation.md edit | commit 4f283f22 |
| `unitAI-6fsxp` (+ `.1`) | Reviewer blast-radius gate relaxation | executor → reviewer (PASS 4a3435 first try) | merge 874e9d4e |

All reviewers PASSed on first try — the false-PARTIAL rebuttal pattern that hit 3/4 dispatches in session 2026-05-13b did not appear once this session (likely a function of LOW-blast-radius config + docs scope; will fully retire once the 6fsxp prompt change ships to package consumers).

## Issues Filed (still open)

| ID | P | Notes |
|----|---|-------|
| `unitAI-c4g0m` | P0 | LSP overhead pooling — separate workstream, not v4-blocking |
| `unitAI-k5kap` | P1 | shared LSP/Serena gateway epic — separate workstream |
| Remaining tier-3+ board cleanup | — | low-priority backlog (memory-processor scaling phases, etc.) |

## Specialist Dispatches

| Chain | Jobs | Outcome |
|-------|------|---------|
| xbofm.impl + review | e3b207, 1190e6 | PASS first try |
| 3r268.impl + review | 59cf02, ee3829 | PASS first try |
| 5voar.impl + review | ce5c54, b4acea | PASS first try |
| 3m27y.impl + review | 130920, 02e665 | PASS first try |
| 6fsxp.impl + review | c9e971, 4a3435 | PASS first try |

## Problems Encountered

| Problem | Resolution |
|---------|------------|
| sp merge refused on staged `.beads/issues.jsonl` each chain | Continued pre-merge `git restore --staged + git checkout` pattern. Cause: hook stages on every bd write; the pqe96 dirty-ignore extension still requires the path to be unstaged-only. Filing follow-up: extend ignore to staged-too is a P3 polish. |
| Operator-side PRs not present this run | Clean pushes, no pull required |

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
- `config/specialists/reviewer.specialist.json`: prompt.system step 5 + prompt.task_template blast-radius gate relaxed. Now accepts ANY of: `gitnexus_impact` event, `$gitnexus_summary` injection, `gitnexus_detect_changes` event, or LOW `impact_report` in `sp result`. Only flags a gap if NONE present AND diff is MEDIUM+ surface. Retires the false-PARTIAL pattern.

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

## Smoke Test Results

| Smoke | Result |
|-------|--------|
| `bunx tsc --noEmit` after each chain | clean ✓ |
| `bun test tests/unit/cli/run.test.ts` (xbofm) | green ✓ |
| `bun test tests/unit/cli/doctor*.test.ts` (5voar) | green ✓ |
| `sp merge --help` | shows --target-branch + dirty-ignore note ✓ |
| `sp init` + `sp doctor` (fresh /tmp dir) | 0 Category A false-positives ✓ |
| `npm pack --dry-run` | LICENSE present, benchmarks/evals excluded, 256 files (down from 258) ✓ |
| `scripts/assert-package-payload.sh` w/ LICENSE | passed ✓ |
| `sp view reviewer --section prompt.system` | parses, shows new gate language ✓ |
| `sp ps` final | 0 active ✓ |

## Release-Readiness Verdict

**Ready to cut.** All Tier 1 friction retired, Tier 2 release-contract polish complete, Tier 3 help-text current, reviewer prompt false-PARTIAL pattern fixed at the source.

Remaining for the release cut itself (operator step):
1. Decide version bump (3.14.1 → 3.15.0 likely, given the additive --target-branch flag + LICENSE add).
2. `sp run changelog-keeper` or `xt release prepare` to populate [Unreleased] from xt reports.
3. `npm publish` after build verifies cleanly.
4. Tag, push tag.

## Open Issues Carried Forward

| ID | P | Notes |
|----|---|-------|
| `unitAI-c4g0m` | P0 | LSP pooling epic — separate workstream |
| `unitAI-k5kap` | P1 | Shared LSP/Serena gateway epic — separate workstream |
| Memory-processor Phase B/C (`unitAI-pwojn.2/.3`) | P2 | Separate epic |
| `unitAI-z2vpq` | P2 | script/service SDK runner — separate epic |
| `unitAI-pnqgd` | P2 | broader board hygiene cleanup |

## Polish Follow-Ups (P3)

- `sp merge` dirty-ignore should also cover staged variant (`M ` not just ` M`/`MM`). 8× friction observed across both sessions.
- Reviewer prompt rule about avoiding raw artifact reads when CLIs work — minor wording polish.

## Due-Diligence Sweep

- 0 active sp jobs.
- 0 in-progress beads from this session.
- 0 specialist worktrees (2 operator worktrees unchanged: `--keep-alive-executor` orphan from earlier session, `chore/unitAI-5kuv0-dist-docs` from operator's #78).
- All chain branches deleted post-merge.
- All work pushed: `4f283f22` on `origin/master`.
- 17 beads closed (8 parents + 9 chain children) with memory acks.

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
