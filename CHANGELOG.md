# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- `template_field_misuse` error_type returned by `runScriptSpecialist` when `input.template` is the literal name of a key on `spec.prompt` (e.g. `task_template`, `normalize_template`, `system`) instead of a template body — catches the production bug where consumers pass a key name and the service treats it as a 13-char prompt (`unitAI-i6khn`).
- Reference Python client at `clients/python/` — stdlib-only, ~170 LOC, with `pyproject.toml` and live-service smoke tests. Mirrors the closed `error_type` taxonomy 1:1 plus a caller-side `transport` value (`unitAI-huwov`).
- `execution.expected_output_keys: string[]` on script-class specs — triggers a required-keys check independent of `response_format`, so text-format specs that ship a JSON contract inline in `task_template` get `error_type: "invalid_json"` on hallucinated key sets instead of saving corrupt output. Documented in `docs/authoring.md` and `docs/examples/smoke-echo-text-expected-keys.specialist.json` (`unitAI-31kwe`).
- Dockerfile-level `HEALTHCHECK` (node-fetch on `/healthz`, port 8000, 30s interval) — operators inheriting the image get container health reporting for free; explicit compose-level `healthcheck:` is now only needed when overriding the listen port (`unitAI-cnlea`).

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
