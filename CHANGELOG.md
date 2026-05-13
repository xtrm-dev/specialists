# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `LICENSE` file at repo root — MIT, 2026 copyright `Dawid (Jaggerxtrm)`. Now ships in the npm payload (asserted by the package-payload CI gate). README badge ↔ ship parity restored (`unitAI-3m27y`).
- `package.json` top-level `types` field pointing at `dist/types/lib.d.ts` — TS consumers can now import `@jaggerxtrm/specialists/lib` with type resolution from the root (`unitAI-3m27y`).
- `dist/asset-contract.json` — deterministic, byte-identical-on-regen manifest of every asset specialists ships: `schema_version`, `package_version`, sha256-hashed `shipped_skills` / `shipped_specialists` / `shipped_mandatory_rules` / `shipped_catalogs` / `shipped_nodes` / `shipped_hooks`. Generator at `scripts/generate-asset-contract.mjs` (npm script `generate:contract`). Manifest excludes wall-clock timestamps so xtrm-tools can verify its vendor mirror by sha-comparison instead of a hand-maintained vendor list (`unitAI-cww2s`).
- `.github/workflows/release-gate.yml` — fires on push to master + manual `workflow_dispatch`. paths-filter detects cross-repo asset path changes; regenerates `dist/asset-contract.json` and asserts byte-equality against the committed copy (fails on drift with a clear remediation command); fires `repository_dispatch` to `Jaggerxtrm/xtrm-tools` with `event_type=specialists-asset-validation` and `client_payload` containing the specialists git SHA + tag. Requires `XTRM_TOOLS_DISPATCH_PAT` repo secret (`unitAI-dnqas`).
- `sp merge --target-branch <name>` flag — rebase target override for chains forked from non-`origin/HEAD` branches. Threaded through `parseOptions`, `resolveDefaultBranchName`, `isBranchAlreadyPublished`, `previewBranchMergeDelta`, `rebaseBranchOntoMaster`, `assertBranchMergeWorthiness`, `runMergePlan` in both `sp merge` and `sp epic merge`. Validated via `git rev-parse --verify <branch>^{commit}` before use. Backward-compatible — missing flag preserves current `origin/HEAD` behavior. Retires the xtrm-nr05 cherry-pick playbook for non-main-fork chains (`unitAI-a6e60`).
- `sp clean --reap-orphans` adds a third detection reason: `dead-toolchain`. Surfaces specialist jobs whose PID is alive but `ppid != 1` and which haven't emitted any `tool` or `think` event in the last 30 minutes while status is `running` or `waiting`. Closes the market-data zombie-job pattern (jobs 525851 / 89ab98) where supervisor `stall_timeout_ms` missed the case. Powered by new `ObservabilitySqliteClient.getLastActivityTimestampMs(jobId)` reading `MAX(t) FROM specialist_events WHERE type IN ('tool', 'think')` (`unitAI-wq0mw`).
- `sp list-rules` now shows `.specialists/user/mandatory-rules` as the highest-priority overlay tier in the matrix (matches the runner's actual resolution order). `docs/surface-ownership.md` + `config/mandatory-rules/README.md` synced to document the user-overlay tier alongside specialist user overrides (`unitAI-7ezse`).

- `sp clean --reap-orphans` now also detects stale specialist jobs: dead-pid (DB row in `starting`/`running`/`waiting` whose PID is gone) and orphaned-keep-alive (alive PID with `ppid=1` and `specialists run`/`sp run` cmdline). Both gated by a 30-minute min-age threshold to avoid racing in-progress jobs. Dry-run prints `jobId`, `pid`, `beadId`, `specialist`, `cwd`, `ageMs`, `reason`. Apply mode SIGTERMs alive stale processes and marks the DB row `cancelled` with a `stale-reaper:<reason>` note — observability history preserved (`unitAI-8tm35`).
- `sp feed <job-id>` now replays full DB event history from `observability.db` in seq order for snapshot mode, with `--limit` still capping output and `--follow` unchanged.
- CI workflow `.github/workflows/package-payload.yml` — runs on PRs touching `package.json`, `src/`, `config/`, `dist/`, the assert script, or the workflow itself. Two jobs: `payload-contract` runs `npm pack --dry-run --json` through `scripts/assert-package-payload.sh` against a required asset list (dist entrypoints, `config/specialists/{executor,reviewer}.specialist.json`, `config/mandatory-rules/{executor-delivery,index}`, `config/skills/using-specialists-v3/SKILL.md`, `config/catalog/{index,native,gitnexus,serena}.json`); `packed-smoke` builds, packs, installs the tarball to an isolated `/tmp/sp-smoke-prefix`, and exercises `sp --version` / `doctor --check-drift` / `prune-stale-defaults --dry-run` / `clean --dry-run` / `list --compact` (`unitAI-1j9om` / `unitAI-bf7qw`).
- `scripts/assert-package-payload.sh` — bash helper, `set -euo pipefail`, exits non-zero with explicit missing-asset list when a required path is absent from the dry-run pack JSON.
- New skill `config/skills/using-specialists-auto/` (v1.0) — operator-offline paranoid autonomous orchestration mode for multi-item release runs. Codifies per-role sleep cadence, pre-merge ritual, reviewer rebuttal pattern, dist-rebuild-per-P0 discipline, batch memory-gate close loop, and escalation criteria. Activates on "auto mode", "go", "run autonomously", or similar handover phrasing.
- `sp ps` process-health dashboard — reports Linux `/proc` health above the job dashboard: aggregate specialist process count, Dolt sql-server count, Serena LSP workspaces, orphan count, RSS, CPU, age, MemAvailable thresholds, and JSON `process_health` output. Detailed per-process rows are available via `sp ps --health` (`unitAI-uof0t`).
- `sp clean --ps` soft-clean workflow — hides terminal dashboard history from default `sp ps` with `ps_hidden_at` / `ps_hidden_reason` metadata while preserving SQLite audit history; `sp ps --include-cleaned` and `sp ps --all` restore audit visibility (`unitAI-59nry`).
- `sp clean --reap-orphans` flag — kills leaked dolt/gitnexus/pi processes by walking `/proc`. Matches three orphan classes: `dolt sql-server` whose cwd is under `*/.worktrees/*`, `gitnexus mcp` orphaned to PID 1, `pi`/`pi-coding-agent` orphaned to PID 1. SIGTERM + 1.5s grace + SIGKILL escalation. Linux-only (depends on `/proc`). Combine with `--dry-run` for safe preview (`unitAI-85xxp`).
- `template_field_misuse` error_type returned by `runScriptSpecialist` when `input.template` is the literal name of a key on `spec.prompt` (e.g. `task_template`, `normalize_template`, `system`) instead of a template body — catches the production bug where consumers pass a key name and the service treats it as a 13-char prompt (`unitAI-i6khn`).
- Reference Python client at `clients/python/` — stdlib-only, ~170 LOC, with `pyproject.toml` and live-service smoke tests. Mirrors the closed `error_type` taxonomy 1:1 plus a caller-side `transport` value (`unitAI-huwov`).
- `execution.expected_output_keys: string[]` on script-class specs — triggers a required-keys check independent of `response_format`, so text-format specs that ship a JSON contract inline in `task_template` get `error_type: "invalid_json"` on hallucinated key sets instead of saving corrupt output. Documented in `docs/authoring.md` and `docs/examples/smoke-echo-text-expected-keys.specialist.json` (`unitAI-31kwe`).
- Dockerfile-level `HEALTHCHECK` (node-fetch on `/healthz`, port 8000, 30s interval) — operators inheriting the image get container health reporting for free; explicit compose-level `healthcheck:` is now only needed when overriding the listen port (`unitAI-cnlea`).

### Fixed
- `sp feed -f` (global follow mode, no specific job-id) no longer hangs indefinitely when keep-alive `waiting` jobs remain in the dashboard. `followMerged()` now treats keep-alive `waiting` as terminal-equivalent for exit purposes in global mode. Per-job follow (`sp feed <id> -f`) keeps tracking across `sp resume` turns. `--forever` still overrides for daemon-style usage. Closes GH#76 reported by `Rico1109` (`unitAI-032n4`).
- `sp merge` `bunx tsc --noEmit` post-merge gate no longer false-positives on repos without a `tsconfig.json` (markdown / notes / non-TypeScript projects). `runTypecheckGate` in `src/cli/merge.ts` now checks for tsconfig existence and prints `TypeScript gate: skipped (no tsconfig)` when absent, instead of treating tsc's help-text exit as a merge failure. Closes GH#71 (`unitAI-dpf3a`).
- `sp feed <job-id>` snapshot mode now replays full event history for that job from `observability.db` instead of truncating to the last ~8 events. `queryTimeline` / `readAllJobEvents` use a jobId-scoped DB read path when `filter.jobId` is set (instead of `listStatuses` → filter, which silently dropped events). Reviewers running the documented `sp feed <reviewed_job_id>` audit path now actually see executor's `gitnexus_*` tool events; the previous behavior was the structural cause of the reviewer "missing tool-event evidence" false-PARTIAL pattern that plagued multi-session orchestration. Cleaner `job <id> not found in .specialists/db/observability.db` message replaces the generic `No jobs directory found.` (`unitAI-889dv`).
- `sp merge` `MERGE_DIRTY_IGNORE_PREFIXES` extended with `.beads/` and `.xtrm/skills/active/` — `sp merge` no longer refuses on dirty main when only bd auto-export (`.beads/issues.jsonl`) or gitnexus stat refresh (`.xtrm/skills/active/**`) noise dirties the tree. Existing `.xtrm/reports/`, `.wolf/`, `.specialists/jobs/`, `dist/` entries unchanged. Hit 8× per multi-chain session before the fix (`unitAI-pqe96`).
- `sp run --background` detached spawn now pipes child stderr (`stdio: ['ignore', 'ignore', 'pipe']`) and forwards it to the parent's stderr, with non-zero exit when the child fails before writing a jobId. Operators no longer see only the generic `Warning: job started but ID not yet available` when the dispatch was refused by the epic-guard or stale-base check — the actual refusal reason surfaces. tmux dispatch path unchanged (tmux captures its own stderr in pane) (`unitAI-xbofm`).
- `sp doctor` Category A check now validates the flat `.xtrm/skills/active/<skill>` symlink layout that `sp init` writes, instead of the scoped `active/claude/<skill>` + `active/pi/<skill>` layout that no longer exists. Loop over `['claude', 'pi']` removed; `.claude/skills` and `.pi/skills` are now expected to symlink directly to `.xtrm/skills/active`. Fresh `sp init` followed by `sp doctor` no longer reports 4 false-positive Category A failures on first run (`unitAI-5voar`).
- `package.json` `files` allowlist tightened to explicit subdirs (`config/specialists/`, `config/mandatory-rules/`, `config/skills/`, `config/catalog/`, `config/nodes/`, `config/hooks/`, `config/presets.json`, plus `LICENSE`). `.npmignore` additionally excludes `config/benchmarks/` and `config/skills/**/evals/`. Payload shrank 258 → 256 files; dev artifacts (benchmarks, evals) no longer ship. CI `package-payload.yml` now asserts `LICENSE` is present (`unitAI-3m27y`).
- Reviewer injected-diff sources (`buildInjectedReviewerDiffVariables` in `src/cli/run.ts`) now filter each source's `files[]` against `AUTO_COMMIT_NOISE_PREFIXES` (`.xtrm/`, `.wolf/`, `.specialists/jobs/`, `.beads/`) before the empty-source fall-through. Noise-only unstaged files (e.g. `.xtrm/SKILL.md` from gitnexus stat refresh) no longer shadow the real branch-vs-base diff. Combined with `unitAI-889dv` (full DB replay), this fully retires the reviewer false-PARTIAL pattern that doubled review-turn counts (`unitAI-lqsha`).
- Reviewer specialist (`config/specialists/reviewer.specialist.json`) blast-radius gate relaxed to accept multiple evidence forms: `gitnexus_impact` event, pre-injected `$gitnexus_summary` block, `gitnexus_detect_changes` event, or LOW `impact_report.highest_risk` in `sp result`. Reviewer only flags a real gap when NONE present AND the diff touches MEDIUM+ surface (auth/secrets/input/public API/schema/control flow/framework). Safety net post-`889dv`'s structural fix (`unitAI-6fsxp`).
- Researcher specialist (`config/specialists/researcher.specialist.json`) consolidated and v-bumped 1.1.0 → 1.2.0. Model: `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` → `openai-codex/gpt-5.4-mini` (qwen3.5-thinking documented to flail with parallel-rejected tool calls; gpt-5.4-mini matches executor's choice — proven for tool-heavy Bash CLI workloads); fallback `google-gemini-cli/gemini-3.1-pro-preview` (long-context fallback for research synthesis). Description rewritten with aggressive "DISPATCH BEFORE answering any library/API/framework/CLI question from training data" framing. System prompt consolidated to 3-mode structure (Targeted / Discovery / Media); skills list reduced from 4 to 1 (the 3 dropped skills — `find-docs`, `deepwiki`, `github-search` — were 100% duplicates of inlined prompt content; saves ~3-4k tokens per dispatch). `mandatory_rules` adds `per-turn-handoff-schema`. Stale `.specialists/user/researcher.specialist.json` overlay removed.
- All specialists swapped off `anthropic/claude-*` models — operator environments without Anthropic API access can now dispatch every specialist without silent dispatch failures. Three specialists had Claude as PRIMARY and were fully broken: `test-runner` (`claude-haiku-4-5` → `openai-codex/gpt-5.4-mini`), `specialists-creator` (`claude-sonnet-4-6` → `openai-codex/gpt-5.5`), `xt-merge` (`claude-sonnet-4-6` → `openai-codex/gpt-5.4-mini`). Six others had Claude as fallback (silent never-fire on primary failure): `overthinker`, `executor`, `changelog-keeper`, `node-coordinator` now fall back to `google-gemini-cli/gemini-3.1-pro-preview`; `explorer`, `changelog-drafter` fall back to `google-gemini-cli/gemini-3-flash-preview`. Final provider distribution: 12 specialists primary on openai-codex, 2 on nano-gpt/glm-5, 0 on anthropic — fallback diversity via gemini + glm.
- `sp init --help`, `sp clean --help`, `sp merge --help`, `sp finalize --help`, `sp doctor --help` refreshed to reflect post-`vwrnq`/`usj9y`/`8tm35`/`wq0mw`/`amzec`/`a6e60`/`pqe96` drift: sp init notes Bun runtime + ordered xtrm-tools install; sp clean documents `--reap-orphans` `dead-toolchain` reason; sp merge usage includes `--target-branch <name>` + auto-ignore note; sp finalize notes SQLite-first verdict read + cascade; sp doctor notes `--check-drift` Category A scope (`unitAI-3r268`).
- `sp finalize <job-id>` now succeeds when reviewer PASS verdict is persisted in SQLite even if `result.txt` was never written. Root cause: `SPECIALISTS_JOB_FILE_OUTPUT` defaults to `off`, so `<jobsDir>/<reviewer-id>/result.txt` never existed for `--job`-launched reviewers; `supervisor.readResult` only checked the file path; the PASS regex never matched. Fix: `supervisor.readResult` now reads `specialist_results.output` via `withSqliteOperation('readResult', ...)` first, falls back to the file. Eliminates the operator-override pattern that required `sp stop <exec>` + manual cleanup after every reviewer PASS dispatched via `--job` (`unitAI-amzec`).
- Executor specialist prompt no longer instructs broad `git add -A` staging. Workflow Step 5 now reads "Prefer runtime `auto_commit: checkpoint_on_waiting`; when manual staging is needed, use explicit paths only". Testing Awareness adds an explicit ban on staging `.beads/`, `.xtrm/`, `.wolf/`, `.specialists/jobs/`, `.pi/`. Self-Review adds a `git diff --cached --name-only` vs bead SCOPE check. Closes the silent-worktree-index-contamination class that broke `mercury-market-data .beads` via PR #103 on 2026-05-11 (`unitAI-dmu9q`).
- `sp init` now prints actionable, ordered recovery commands when the xtrm prerequisite is missing. Two distinct error paths: missing `xt` CLI → "install xtrm-tools globally → xt install → xt init → verify"; present `xt` CLI but missing `.xtrm/` → "run xt init in this repo → verify". `package.json` adds an underscore-prefixed `_runtime_prerequisites.xtrm-tools` field documenting the requirement without adding an npm dependency. README quickstart, `src/cli/quickstart.ts` step 1, `docs/installation.md`, and `docs/bootstrap.md` now declare the ordered install path Bun → xtrm-tools → xt install → xt init → @jaggerxtrm/specialists → sp init. `sp list`, `sp doctor --check-drift`, and `sp prune-stale-defaults` are documented as Category A commands that do not require `xt` or `.xtrm/` (`unitAI-usj9y`, audit `unitAI-go847`, docs `unitAI-6xm0f`).
- Tool catalog is now package-canonical at `config/catalog/` (was `.specialists/catalog/`). `loadSharedToolCatalogIndex` in `src/pi/session.ts` tries cwd `.specialists/catalog/index.json` first (user override path — created on demand) and falls back to `resolveCanonicalAssetDir('catalog')/index.json` from the installed package. Eliminates the silent-tool-policy-degrade that occurred for npm-installed users without a source checkout — verified by `sp list` working from a non-repo cwd. `docs/installation.md` Category A list now explicitly names `config/catalog/`. File history preserved via `git mv` (`unitAI-jj7hy`).
- AGENTS.md Specialists block is now wrapped in `<!-- specialists:start --> ... <!-- specialists:end -->` HTML sentinels, making `sp init` re-runs fully idempotent. `ensureAgentsMd` has four branches: file missing → write block; sentinels present → byte-identical replace (no-op when unchanged); legacy `## Specialists` marker but no sentinels → migrate by parsing from marker to next H2 / EOF and replacing the full legacy span; neither → append. `README.md` line 82 no longer falsely claims `sp init` injects `CLAUDE.md` (it never did; the line was a 2026-05 audit finding) (`unitAI-sgw9g`, audit `unitAI-3o3gf`).
- `package.json` declares `engines.bun: ">=1.0.0"` (was `node: ">=16.0.0"` which was misleading — the built `dist/index.js` is `bun build --target=bun` with `#!/usr/bin/env bun` shebang and uses bun-only APIs). `src/index.ts` adds an early `globalThis.Bun` runtime guard that prints an actionable error with the `https://bun.sh/install` URL and exits non-zero — defense in depth for code paths where Bun is technically available but the import sequence runs before the shebang takes effect. README quick start, `src/cli/quickstart.ts`, and `docs/installation.md` now declare Bun as a runtime prerequisite (`unitAI-vwrnq`).
- `sp ps` process-health specialist count no longer treats Serena/GitNexus MCP servers, tsserver, shell wrappers, or generic tooling as specialist jobs. The count is now intentionally narrow: direct `sp/specialists run` commands and pi-coding-agent processes only. Unknown `sp ps` flags now fail fast; `sp ps --ps` points operators to `sp clean --ps` (`unitAI-f2vhd`).
- `sp ps` no longer defaults to raw historical terminal rows. The default dashboard shows active jobs plus unresolved terminal problems, detailed process tables require `--health`, and Dolt/orphan regressions raise WARN instead of a false OK (`unitAI-0wbhi`, `unitAI-eeiza`, `unitAI-59nry`).
- `sp clean --reap-orphans` also detects deleted-cwd Dolt/tool leaks, covering stale worktree cleanup cases missed by the initial orphan collector (`unitAI-uxpl2`).
- Reviewer evidence collection now surfaces executor GitNexus tool-call evidence: reviewer prompt instructs `sp feed <reviewed_job_id>` fallback, and runner pre-injects `$gitnexus_summary` from the reviewed executor's `run_complete` observability event when dispatched with `--job` (`unitAI-gufaf`).
- `provisionWorktree`: drop the `.beads` dir→symlink swap entirely. Worktree provisioning now `rm -rf <worktree>/.beads` and marks the tracked `.beads/*` paths as `skip-worktree` via the new `markBeadsSkipWorktree` helper. Modern bd 1.0.3 stores `core.hooksPath` as an absolute parent path at `bd init`, so the worktree inherits parent hooks via shared git config — no on-disk `.beads/` is needed, and bd resolves the DB via git common-dir. Removes a serious merge hazard: any branch carrying the worktree-local `.beads` symlink (mode 120000) wipes the parent's `.beads/` on squash-merge into main (real incident: projects/infra PR #39, 2026-05-12). Removes now-unused `readFileSync`/`writeFileSync` imports. Supersedes `unitAI-u08e8` / `xtrm-nsca`. The xtrm-tools `xt end` pre-push guard (`xtrm-w1ip`) stays in place as defense-in-depth for older clones and non-CLI push paths (`unitAI-yvqmf`).
- `provisionWorktree` previously suppressed phantom `.beads/` deletions inside specialist worktree checkpoint commits via `info/exclude` + `skip-worktree`. Now superseded by `unitAI-yvqmf` above (no symlink → no noise to suppress) (`unitAI-u08e8`).
- `sp run --bead <id>` no longer race-spawns duplicate jobs against the same bead+specialist when a keep-alive job is already in `waiting`. The active-job check now includes `waiting` (was `starting`/`running` only), and `sp run` performs an early SQLite pre-flight before the supervisor fork — failing fast with `existing <status> job '<id>' already targets bead '<id>'` plus a hint to resume via `--job <id>` or cancel via `sp stop <id>` (`unitAI-55cb3`).
- `supervisor.handleResumeTurn` now auto-finalizes a keep-alive session when the resume turn produces a PASS-shaped Compliance Verdict — closes the gap that made `sp finalize <id>` necessary after every resume-driven PASS. Initial-turn auto-finalize was already in place; the resume-turn path now mirrors it (`unitAI-y6crh`).
- `supervisor` now triggers `npx gitnexus analyze` immediately after each successful auto-commit checkpoint for MEDIUM/HIGH-permission specialists (was: only at terminal completion). Reviewers/orchestrators inspecting a keep-alive worktree mid-session no longer see stale graph data. Embeddings are preserved when `.gitnexus/meta.json` shows `stats.embeddings > 0` (passes `--embeddings`). Checkpoint-time and terminal-time fires dedupe via `lastGitnexusAnalyzedSha`. Timeline events (`gitnexus_analyze_started` / `gitnexus_analyze_start_failed`) tag `backend` with the source (`checkpoint` / `terminal`) and use the dual-write `appendTimelineEvent` path so they land in `observability.db` regardless of `SPECIALISTS_JOB_FILE_OUTPUT` gating — visible in `sp feed` / `sp result` (`unitAI-hrsvj`).
- `provisionWorktree` (and xt claude / xt pi `launchWorktreeSession` in xtrm-tools) now replaces bd's stub `.beads/` inside new worktrees with a symlink to `<commonRoot>/.beads`. bd's post-checkout/pre-commit/post-merge git hooks (registered via parent's `core.hooksPath = .beads/hooks/`) re-fire on any git operation inside the worktree (notably supervisor's auto-commit checkpoint) and would otherwise re-scaffold a per-worktree `.beads/` + dolt-sql-server (60–200 MB RSS each, plus a process-leak vector on cleanup, plus the user-reported `database 'jaggers_agent_tools' not found` symptom in xtrm-tools). The symlink is preserved by all bd hooks and routes bd inside the worktree to the parent's data — single shared dolt server, shared writes (`unitAI-0wz2p` / `xtrm-as7d`).
- `supervisor.startDetachedGitnexusAnalyze` now invokes `npx gitnexus analyze --skip-agents-md --no-stats` (still passes `--embeddings` when `.gitnexus/meta.json` shows `stats.embeddings > 0`). The graph is still re-indexed (downstream `gitnexus_impact`/`context` queries see fresh data), but the AGENTS.md/CLAUDE.md edit pass and stat-block refresh are skipped — these would dirty the worktree branch on every checkpoint and cause noisy auto-commit churn.
- `pi/session.ts` no longer leaks `gitnexus mcp` / `serena mcp` child processes when a `--keep-alive` specialist is cancelled or torn down. `pi` is now spawned with `detached: true` so it owns its process group, and the cancellation paths (`close()` and `kill()`) replace the old 2s redundant SIGTERM with an 8s graceful window followed by a `process.kill(-pid, 'SIGKILL')` group-kill backstop. The redundant SIGTERM had been racing pi's in-flight MCP dispose: pi's RPC-mode handler at `rpc-mode.js:533` saw `shuttingDown=true` and called `process.exit(143)` synchronously, aborting `manager.closeAll()` mid-flight and orphaning MCP children to PID 1. The new window is enough for the worst-case ~4s/server `transport.close()` graceful path; the group-SIGKILL backstop reaps anything that survives (`unitAI-1phu7` / `unitAI-ctl0o`).

### Changed
- `memory-processor` specialist redesigned for N>500 bd memory audits. Old single-pass workflow exhausted context past ~150-200 memories (Phase 5 per-entry classification text + Phase 7 inline `bd forget` cumulated in chat history regardless of model context size). New design: chunked file-backed audit ledger documented in `config/skills/memory-audit-transaction/SKILL.md`, with a pre-script (`config/skills/memory-audit-transaction/scripts/pre-bulk-export.sh`) that runs `bd memories --json` in a single dolt query (~ms, no per-key `bd recall` round-trips) and stages the artifacts at `.tmp/memory-audit/` before the model spawns. Spec system_prompt + task_template rewritten to defer to the skill and forbid: per-entry chat output, default-Current-without-evidence, destructive git commands. Model also switched from `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` to `openai-codex/gpt-5.3-codex` — qwen3.5 via nano-gpt exhibited persistent per-turn flailing (5 rejected tool calls per turn) plus 95% default-to-Current with empty evidence on a live 508-memory audit; gpt-5.3-codex completed the same audit with 91/508 evidence-backed prunes (18% rate) in 22min for $0.019 (`unitAI-pwojn.1`, parent epic `unitAI-pwojn` Phase A; runtime support Phase B+C still open).
- Canonical specialist model defaults migrated off the unavailable `dashscope` provider. `memory-processor` now uses `nano-gpt/deepseek/deepseek-v4-pro-cheaper:thinking` (synthesis workload, operator preference). `researcher` and the `executor-benchmark-matrix` use `nano-gpt/qwen/qwen3.5-397b-a17b-thinking` (faithful family match, 256K context, thinking-enabled). The `cheap` preset in `config/presets.json` switched to `nano-gpt/moonshotai/kimi-k2.5` (no-thinking, matches the preset's `thinking_level: off`). Stale local `.specialists/user/memory-processor.specialist.json` override removed — canonical now matches operator choice (`unitAI-ght3j`).
- `test-runner` specialist v2.0.0 — now polyglot: pre-script detects manifest (`package.json` / `pyproject.toml` / `pytest.ini` / `setup.cfg` / `Cargo.toml` / `go.mod`) and dispatches the canonical test command (`npm test`, `pytest`, `cargo test`, `go test ./...`); falls back to a `[test-runner] no project test manifest detected` descriptive message with exit 0 instead of a missing-binary crash. system prompt + task_template are project-language-aware. `vitest`/`jest` removed from tags (`unitAI-0er69`).
- `executor` and `debugger` specialist prompts soften hardcoded `tsc --noEmit` / `npm run lint` references to neutral "project-appropriate lint and typecheck" phrasing with multi-language examples (Node / Python / Rust / Go) (`unitAI-dults`).
- `executor` post-script is manifest-aware: `package.json` → `npm run lint`, `pyproject.toml`/`setup.cfg` → `ruff` + `mypy` (when on PATH), `Cargo.toml` → `cargo clippy`/`check`, `go.mod` → `go vet`, none → descriptive no-op (`unitAI-dults`).
- `reviewer` specialist system prompt step 4 (Job linkage and evidence collection) now teaches `git diff $(git merge-base HEAD master)..HEAD` for the canonical changed-range and explicitly forbids rebase / squash / reset / amend / hand-merge / making new commits in the reviewed worktree. Auto-commit checkpoints (live since Apr 13 `11e9b016`) produce N-commit feature branches; reviewer was sometimes panicking and trying git surgery. `sp merge` / `sp epic merge` own publication squashing.

### Changed
- `docs/specialists-service.md` documents the full closed `error_type` taxonomy (now includes `template_field_misuse`, `prompt_too_large`, `output_too_large`) and cross-references the Python reference client (`unitAI-huwov`).
- `docs/examples/specialists_client.py` removed; canonical reference now lives at `clients/python/specialists_client.py` (`unitAI-huwov`).
- New `docs/deploying-alongside.md` — copyable compose recipe for adding `specialists-service` to an existing multi-service stack on a non-host network, with the three required tweaks (`user:`, `HOME=/pi-home`, rw `.specialists/`) explained and a symptom→cause→fix troubleshooting matrix (`unitAI-2fz5b`).

---

## [v3.14.1] — 2026-05-07

### Changed
- `changelog-keeper` specialist scoped to `CHANGELOG.md` only — no longer bumps version, builds, commits, tags, pushes, or publishes; the `/releasing` skill owns those steps and dispatches `changelog-keeper` only to fill `[Unreleased]` gaps from xt reports (`unitAI-g29jv`).

---

## [v3.14.0] — 2026-05-07

### Added
- `sp serve` operational logging with `--log-level off|info|debug` and structured JSON `/v1/generate` request events (`unitAI-8y70l`).
- `sp serve --readiness-canary off|warn|require` for Pi child readiness validation (`unitAI-z2vpq`).
- Script-runner JSON output-contract injection from `response_format: json` schema (`unitAI-z2vpq.4`).
- Local dev container name `sp-service-dev` to distinguish repo-local Compose dev service from consumer-owned `specialists-service` (`unitAI-826pp`).
- Paranoid-mode orchestration discipline, sleep-timer monitoring, mandatory security/sanity chain, project-specific specialist guidance, and worktree cleanup steps in `using-specialists-v3` skill.

### Changed
- Script-runner sends rendered prompts via stdin instead of argv to prevent process-list leakage and avoid Pi CLI parsing on `--`/`@`-prefixed content (`unitAI-z2vpq.1`).
- Script-runner spawns Pi child with `cwd: projectDir` so service consumers resolve files relative to their configured project (`unitAI-z2vpq.2`).
- Rendered prompt-size preflight added before Pi spawn (`prompt_too_large`, `execution.prompt_limit_bytes`, `SPECIALISTS_SCRIPT_PROMPT_LIMIT_BYTES`, 4MiB default) (`unitAI-z2vpq.3`).
- `sp serve --allow-local-scripts` and `skills.scripts` in script/service mode now fail-closed until a sandboxed lifecycle exists (`unitAI-z2vpq.7`).
- `--allow-skills-roots` boundary validation switched to normalized `path.relative` containment for both `skills.paths` and `prompt.skill_inherit` (`unitAI-z2vpq.6`).
- Trusted skills forwarded to Pi child as explicit repeated `--skill` arguments only (`unitAI-z2vpq.5`).
- `--db-path` now treated as an exact SQLite file path (`unitAI-z2vpq.8`).
- script-runner forwards `spec.prompt.system` via Pi `--system-prompt` (full override) when set, so non-coding specialists no longer inherit pi's default coding-agent system prompt (`specialists-37x`).
- AGENTS.md: replaced hardcoded `sp` command catalog with `sp help` instruction and added `sp steer` to orchestration command list.

### Fixed
- `--offline` flag now propagates to script-runner Pi invocation in `sp serve` (`f61032a5`).
- Script-runner isolates Pi prompts from project context (`specialists-6vy`).

---

## [v3.13.0] — 2026-05-05

### Added
- Documented the canonical-live Category A and xtrm-managed Category B distribution model, including installation, skill/hook drift, and operator refresh commands (`unitAI-o4khi`).

### Changed
- Removed deprecated `sp poll`; use `sp ps <id> --json` for status, `sp feed <id>` for events, and `sp result <id>` for final output (unitAI-kbxu7).
- `update-specialists` v2.1 now separates specialists-owned runtime refresh (`sp doctor --check-drift`, `sp prune-stale-defaults`) from xtrm-owned asset refresh (`xt doctor`, `xt update`) so operators do not conflate the two distribution tracks (`unitAI-tsnwh.5`, `unitAI-o4khi`, `specialists-4iq`).

### Fixed
- Bundled `sp doctor`, `sp status`, and related diagnostics no longer crash when resolving package metadata from installed `dist/index.js`; version checks now support both source and packaged layouts (`specialists-4iq`).
- `security-auditor` no longer ships machine-specific `/home/dawid/projects/xtrm-tools` skill paths; optional security skills now resolve through repo-relative `.xtrm/skills/optional/...` paths (`specialists-4iq`).

---

## [v3.12.0] — 2026-05-05

### Added
- `specialists list --full` live registry surface now shows worktree behavior, chain position, median runtime, and role-specific mandatory rules for routing (unitAI-5ad59543)
- `using-specialists-v3` skill adds live-registry orchestration guidance and keeps command discovery centered on `specialists list --full` and `sp help` (unitAI-3ecd8ddf; unitAI-d222b022)
- `specialists list` routing descriptions now stay rich enough to support live role selection from registry output (unitAI-a1605ced; unitAI-0539c3cd)

### Changed
- `changelog-keeper` draft flow now uses script-safe changelog synthesis from curated xt reports (unitAI-0b179f8f)
- `sp script` timeout and scope-bleed handling tightened so long-running script work does not bleed into adjacent worktree state (unitAI-22c0bf39)
- Epic merge dirty-state integration tests stabilized after merge/publication edge cases (unitAI-eb68cf6c)
- `sp release` / release-pipeline handoff and `using-specialists-v3` activation docs updated for v3 orchestration flow (unitAI-fc588ba4; unitAI-5677cce8; unitAI-fb0ed5ee)
- Specialist metadata and mandatory rules refreshed so live registry output reflects current roles and policies (unitAI-5b3c3839; unitAI-77e21085; unitAI-d1ca9f96; unitAI-28781c48)

### Fixed
- Scope-bleed fix paired with raised script timeout to keep release drafting bounded (unitAI-22c0bf39)
- `sp epic merge` dirty-tree publication path now survives unrelated dirty state and preserves merge-ready validation (unitAI-eb68cf6c)
- `sp config show --resolved` and repo-local mandatory rules now resolve from current worktree instead of stale global dist (unitAI-77e21085)

---

## [v3.11.0] — 2026-05-03

### Added
- `changelog-keeper` specialist v1 for release-note synthesis from curated xt reports (unitAI-znkgi.2)
- Releasing skill workflow for prepare/publish release flow after CLI removal (unitAI-fhbf4)
- `sp doctor` / `sp status` version-check nudges with cached tag awareness and per-tag dedupe (unitAI-znkgi.9)
- `using-kpi` skill for KPI analysis and payload/runtime observability recipes (unitAI-drs41.4)
- `sp db extract` / `sp db stats` surfaces for KPI extraction and analysis help (unitAI-drs41.4; unitAI-svnft)
- GitNexus-required new-file escape hatch rule for additive specialist/doc changes (unitAI-znkgi.7)
- `sp release prepare` range flags `--from` / `--to` for explicit backfill windows (unitAI-1evl2)
- `sp release` publish-time validation for top-section gating, annotated tag creation, and push flow (unitAI-znkgi.3)

### Changed
- `sp release prepare` now accepts markdown-only specialist output, normalizes missing section keys, and keeps section replacement bounded (unitAI-8elrc; unitAI-1avsn; unitAI-a3s9a)
- `changelog-keeper` output tightened with fallback chain and stricter section fidelity for release drafts (unitAI-8elrc; unitAI-khlqj)
- `sp clean` migrated to DB-first job selection with PID-primary stale-process cleanup (`--processes`) (unitAI-ltwme)
- `sp clean --keep` now preserves chain-root jobs referenced by epic membership by default; `--aggressive-prune` bypasses that protection for hard purges, and `sp ps --include-terminal` renders orphaned terminal epics without dropping chain rows (unitAI-b0bc62)
- `sp script` stdout cap raised to 128MB with incremental parse for oversized streams (unitAI-9cygd; unitAI-a47ub)
- `sp script` retained cap handling fixed so overflow recovery stays stable under repeated reads (unitAI-1avsn; unitAI-a47ub)
- `sp script` template-check / compat guard fix for spec loading under release-related flows (unitAI-r7zte)
- `sp release` semver section label now derives from `--to HEAD` correctly (unitAI-7qu0t)
- `sp release` draft parser now accepts array-shape sections and markdown fallback (unitAI-a3s9a)
- Release parser now accepts JSON drafts missing section keys and backfills empty buckets (unitAI-1avsn)
- `using-specialists-v2`, `update-specialists`, `CLAUDE.md`, `AGENTS.md`, and related docs synced for release awareness and update checks (unitAI-znkgi.5; unitAI-jhhu4.1; unitAI-c190df90)
- `docs/design/gzrx-tool-catalog.md` aligned with source policy for centralized tool catalog design (unitAI-gzrx)
- `src/cli/doctor.ts` drift check now warns on stale user-overlay specialists before they shadow defaults (unitAI-bb3h6)
- `src/specialist/script-runner.ts` and tests got stdout-cap, parse, and tool-allowlist fixes across release/debugger work (unitAI-9cygd; unitAI-1avsn; unitAI-a47ub; unitAI-c6he0)
- `src/cli/release.ts` / `src/cli/version-check.ts` / `src/cli/clean.ts` got the release, version-check, and DB-first cleanup flow updates (unitAI-znkgi.3; unitAI-znkgi.9; unitAI-ltwme)
- `docs/observability-metrics.md`, `docs/cli-reference.md`, and skill mirrors updated for KPI and release workflow drift (unitAI-drs41.4; unitAI-znkgi.5)

### Fixed
- Release draft rendering now handles markdown-only output and JSON drafts missing section keys without losing bullets (unitAI-8elrc; unitAI-1avsn)
- `sp script` overflow handling now preserves retained caps across parse retries and large stdout bursts (unitAI-a47ub)
- `sp release` publish/prepare validation now rejects section-label and array-shape edge cases before bad tags land (unitAI-7qu0t; unitAI-a3s9a)
- `sp clean` no longer depends on file-era job dirs and survives deleted process state (unitAI-ltwme)

### Removed
- `sp release` CLI path replaced by releasing skill workflow for publishing releases (unitAI-fhbf4)

---

## [3.10.0] - 2026-04-27

Reviewer traceability, hook DB migration, `/lib` export, `list-rules` CLI, and the `serena-cheatsheet` mandatory rule.

### Added
- `sp list-rules` — rule × specialist matrix CLI for inspecting which mandatory rules each specialist loads (unitAI-wv3l9)
- `/lib` subpath export for Node consumers embedding the runner library (unitAI-rw13n)
- `serena-cheatsheet` mandatory rule providing per-specialist Serena-tool guidance, opt-in via `template_sets` (unitAI-acb59b59)
- Auto-close linked bead on terminal job status (cancelled/done/error) — supervisor closes the bead when the job ends (unitAI-9truh)
- PID-liveness inference for zombie job visibility in readers (unitAI-zw9w1)
- `output_type` surfaced in `SupervisorStatus` and `run_complete` events (unitAI-e90j)

### Changed
- Default `--context-depth` raised from 1 to 3 — chained specialists now see own bead + predecessor + parent task by default (unitAI-231x)
- `sp poll` deprecated in favor of `sp ps` (state) + `sp feed` (stream) (unitAI-zjhsj)
- Reviewer prompts now include diff context wired through cleanly (unitAI-18d1d)
- `serena-cheatsheet` removed from `default_template_sets`; specialists must opt in explicitly (unitAI-49188)

### Fixed
- `specialists-complete` hook reads job state via `sp ps` (DB-first) instead of stale file paths (unitAI-q5k2p)
- `specialists-creator` spec now includes `fallback_model` field as required (unitAI-9ilgw)
- Reviewer traceability gaps for GitNexus invocation evidence and injected diff context (unitAI-ctkk9)
- CLI help test stabilized for bun spawn behavior (unitAI-56f98)

---

## [3.9.0] - 2026-04-26

`fln4q-epic` SQLite observability migration, `specialists-service` v1 (HTTP + CLI surfaces for script-class specialists), `sp script` CLI, and a strict 1:1 schema-to-runtime cut.

### Added
- `sp script` CLI — synchronous one-shot specialist invocation (READ_ONLY, template + variables, JSON out) for service/script consumers (unitAI-2cbbae)
- `specialists-service` v1 — HTTP and CLI surfaces for script-class specialists (`sp serve` + `sp script`) (unitAI-fln4q)
- Script target validate mode for pre-run validation of scripts/commands/tools/shebangs (unitAI-4b591)
- Pre-flight `pi-coding-agent` compat regression CI workflow (unitAI-5077f)
- Mercury atomic-summarizer schema-target PoC example (unitAI-f2075)
- Python adapter reference for `darth-feedor` migration (unitAI-f98788)

### Changed
- **Strict 1:1 schema-to-runtime cut**: every JSON field must map to a runtime consumer. Dropped `CommunicationSchema` (`next_specialists`, `publishes`), `capabilities.diagnostic_scripts`, `prompt.normalize_template`, `prompt.examples`, `execution.preferred_profile`, `execution.approval_mode`, `metadata.author`, `metadata.created`, root `heartbeat`, deprecated `ScriptEntry.path` alias. 26 specs + `docs/authoring.md` + `config/skills/specialists-creator/SKILL.md` + `src/cli/view.ts` + `scaffold-specialist.ts` updated in lockstep (unitAI-68edd, unitAI-8n0aa)
- Schema validation now uniform across all 26 specs; `xt-merge` `output_to` → `output_file` (typo'd dead alias was silently dropping merge result writes) (unitAI-02deb, unitAI-yb9qu)
- Schema preserves unknown keys via `.passthrough()` on every nested `SpecialistSchema` object — fixes silent acceptance of typo'd fields (unitAI-f27c8)
- `--user-dir` → `--project-dir` rename in `sp script` and `sp serve` with deprecated alias retained (unitAI-rfjbd)
- Pi 0.70.x compatibility — dropped `args.push('--', prompt)` option terminator in `script-runner.ts`; image base unpinned to `@latest` (unitAI-w0h7z)
- `fln4q-A`: env-gated file fallback for `attach`/`list`/`poll`/`status`/`feed_specialist` with `SPECIALISTS_JOB_FILE_OUTPUT` (unitAI-5521c)
- `fln4q-B`: detached watchdog DB-backed child read path; `cleanupProcesses` file fallback gated by env (unitAI-50283, unitAI-91cfea)
- `fln4q-B2` v2: Bun runtime helper, mode-split watchdog, read-only DB child (unitAI-73c1d)
- DB-first job reads, crash recovery, event reads, job cleanup readers (multiple commits, fln4q-epic)
- Supervisor file writes gated behind `SPECIALISTS_JOB_FILE_OUTPUT` env (unitAI-ppkdg)
- README documentation map points to specialists-service docs
- `sp serve` and `sp script` surfaced in core commands list (unitAI-2f8f4)
- `db` legacy migration tooling clarified; canonical store is SQLite (unitAI-23a1c, unitAI-3425a)

### Fixed
- NDJSON parser handles pi's real `message_end` and `agent_end` shapes (prior parser matched a fictional shape that the test mock perpetuated) (unitAI-68owr)
- Pi `errorMessage` surfacing — when content is empty, `message.errorMessage` flows through error taxonomy so quota/auth errors no longer silently return success-with-empty-output (unitAI-68owr)
- JSON-mode markdown fence stripping — `stripMarkdownFences()` runs before `JSON.parse` for `response_format=json` so kimi-style fenced output parses (unitAI-68owr)
- `specialists-creator` JSON corruption — zsh prompt artifact had been pasted into the file as a JSON key; only caught after `.passthrough()` exposed the silent survival of unknown keys (unitAI-826wl)
- Stale `.xtrm/skills/active/pi/<name>/` skill paths bulk-swept across canonical and mirror specs (`pi/` subdirectory removed in prior layout migration but references lingered) (unitAI-826wl)
- `withSqliteOperation` callbacks now return non-undefined sentinel (unitAI-f30e56)

### Removed
- `parallel-review` specialist files (renamed to `parallel-runner` in 3.4.0; spec files lingered until cleanup)
- 11 declarative-only schema fields (no runtime consumer — see Changed → strict 1:1 schema cut)

---

## [3.8.0] - 2026-04-26

`specialists-service` v1 — HTTP and CLI surfaces for script-class specialists, plus a strict 1:1 schema cut so every JSON field maps to a runtime consumer.

### Added
- **`sp serve`**: Node `http` server exposing `POST /v1/generate` and `GET /healthz` for script-class specialists; real semaphore queue with HTTP 429 on contention, SIGTERM forwarding to in-flight pi children, 4MB stdout cap, trace rows persisted to canonical `observability.db` with `surface: 'script_specialist'` (unitAI-c6uvn).
- **`sp script <name>`**: One-shot CLI peer to `sp serve` for cron and host scripts; cron-friendly exit codes (0/1/2/3/4/5/6/7/75); `--single-instance <lockpath>` uses `flock` with `EX_TEMPFAIL` on contention (unitAI-6qctn).
- **`sp validate <path> --target script`**: Offline pre-deploy validator that runs schema parse plus `compatGuard` and exits non-zero on failure with structured error (unitAI-bahj1).
- **Docker image**: Multi-stage `oven/bun` build, non-root UID 10001 user, `WORKDIR /work`, `ARG PI_VERSION=latest`. Sidecar template at `docker/compose.example.yml` (unitAI-atwom).
- **CI canary `.github/workflows/pi-compat.yml`**: Weekly cron + PR-triggered smoke that fails loud on pi spawn-flag drift; no quota, no secrets, no LLM calls (unitAI-nsru6).
- **Reference Python adapter `docs/examples/specialists_client.py`**: Stdlib-only, mirrors the closed `error_type` union with a `TRANSPORT` value for caller-side HTTP failures; live-smoked end-to-end against real pi (unitAI-s2won).
- **Reference script-class spec `docs/examples/mercury-atomic-summarizer.specialist.json`**: Phase 1 first-spec, copyable, validated against the migration doc's schema target (unitAI-t9t11).
- **Reference smoke spec `docs/examples/smoke-echo.specialist.json`**: For verifying a fresh deployment.
- **`handoff-feedor.md`**: One-page operator handoff at repo root for adopting `specialists-service` v1 in darth-feedor.
- **Documentation**: `docs/specialists-service.md` (canonical contract), `docs/specialists-service-install.md` (build-from-repo install with rootless-podman + Fedora-SELinux notes), `docs/specialists-service-evaluation.md` (production-evaluation memo), `docs/release-image.md` (maintainer build/push reference), `Script-class authoring` section in `docs/authoring.md`, `Schema target` translation table in `docs/darth-feedor-migration.md`.
- **Spec uniformity audit script `config/skills/specialists-creator/scripts/audit-spec-uniformity.mjs`**: Portable, reports parse failures and unknown keys; KNOWN sets stay in lockstep with `src/specialist/schema.ts`.

### Changed
- **Zod schema passthrough**: `SpecialistSchema` now uses `.passthrough()` on every nested object so unknown keys survive `parseSpecialist()` and `sp edit` round-trip stops silently dropping fields (unitAI-xutg2).
- **Strict 1:1 schema-to-runtime cut**: Every JSON field must map to a runtime consumer (unitAI-8n0aa). Dropped `CommunicationSchema` entirely (`next_specialists`, `publishes`), `capabilities.diagnostic_scripts`, `prompt.normalize_template`, `prompt.examples`, `execution.preferred_profile`, `execution.approval_mode`, `metadata.author`, `metadata.created`, root `heartbeat`, and the deprecated `ScriptEntry.path` alias. 26 specs, `docs/authoring.md`, `config/skills/specialists-creator/SKILL.md`, `src/cli/view.ts`, and `scaffold-specialist.ts` updated in lockstep.
- **`--user-dir` → `--project-dir`**: Flag renamed in `sp script` and `sp serve` (the flag has always been the project root, not a user-spec dir); `--user-dir` retained as a deprecated alias (unitAI-rfjbd).
- **Pi 0.70.x compatibility**: Dropped the `args.push('--', prompt)` option terminator in `src/specialist/script-runner.ts`; both 0.64 and 0.70.2 accept positional prompt. Image base unpinned to `@mariozechner/pi-coding-agent@latest` (unitAI-w0h7z).
- **`xt-merge` output_to → output_file**: Migrated to canonical top-level field — a typo'd dead alias had been silently dropping `merge-prs-result.md` writes since the spec was authored (unitAI-yb9qu).
- **README documentation map**: Now points to the new specialists-service docs.

### Fixed
- **NDJSON parser real shape handling**: Now handles pi's real `message_end` and `agent_end` event shapes; prior parser matched a fictional shape that the test mock perpetuated, returning empty assistant text in production (unitAI-68owr).
- **Pi `errorMessage` surfacing**: When content is empty, `message.errorMessage` is surfaced through the error taxonomy so quota and auth errors no longer silently return `success: true` with empty output (unitAI-68owr).
- **JSON-mode markdown fence stripping**: `stripMarkdownFences()` runs before `JSON.parse` for `response_format=json` responses; some models (e.g. kimi) wrap JSON in markdown code fences regardless of the format directive (unitAI-68owr).
- **`specialists-creator.specialist.json` JSON corruption**: A zsh prompt artifact had been pasted into the file as a JSON key (`"permission_requiredspecialists — zsh "`); only caught after `.passthrough()` exposed the silent survival of unknown keys (unitAI-826wl).
- **Stale skill-path sweep**: Bulk-swept 19 stale `.xtrm/skills/active/pi/<name>/` skill paths across canonical and mirror specs; the `pi/` subdirectory was removed in a prior layout migration but the references were never updated (unitAI-826wl).

### Removed
- **`parallel-review` specialist files**: Removed from canonical and mirror (renamed to `parallel-runner` in 3.4.0; spec files lingered until this cleanup).
- **11 declarative-only schema fields**: See Changed → strict 1:1 schema cut. None had a runtime consumer.

[Unreleased]: https://github.com/Jaggerxtrm/specialists/compare/v3.11.0...HEAD
[v3.11.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.11.0
[3.10.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.10.0
[3.9.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.9.0
[3.8.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.8.0
