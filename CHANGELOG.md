# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [3.8.0] - 2026-04-26

`specialists-service` v1 — HTTP and CLI surfaces for script-class specialists, plus a strict 1:1 schema cut so every JSON field maps to a runtime consumer.

### Added

- `sp serve` — Node `http` server exposing `POST /v1/generate` and `GET /healthz` for script-class specialists; real semaphore queue with HTTP 429 on contention, SIGTERM forwarding to in-flight pi children, 4MB stdout cap, trace rows persisted to the canonical `observability.db` with `surface: 'script_specialist'` (unitAI-c6uvn).
- `sp script <name> [--vars k=v ...] [--json] [--single-instance <lockpath>]` — one-shot CLI peer to `sp serve` for cron and host scripts; cron-friendly exit codes (0/1/2/3/4/5/6/7/75); `--single-instance` uses `flock` with `EX_TEMPFAIL` on contention (unitAI-6qctn).
- `sp validate <path> --target script` — offline pre-deploy validator that runs schema parse plus `compatGuard` and exits non-zero on failure with structured error (unitAI-bahj1).
- Docker image — multi-stage `oven/bun` build, non-root UID 10001 user, `WORKDIR /work`, `ARG PI_VERSION=latest`. Sidecar template at `docker/compose.example.yml` (unitAI-atwom).
- CI canary `.github/workflows/pi-compat.yml` — weekly cron and PR-triggered smoke that fails loud on pi spawn-flag drift; no quota, no secrets, no LLM calls (unitAI-nsru6).
- Reference Python adapter `docs/examples/specialists_client.py` — stdlib-only, mirrors the closed `error_type` union with a `TRANSPORT` value for caller-side HTTP failures; live-smoked end-to-end against real pi (unitAI-s2won).
- Reference script-class spec `docs/examples/mercury-atomic-summarizer.specialist.json` — Phase 1 first-spec, copyable, validated against the migration doc's schema target (unitAI-t9t11).
- Reference smoke spec `docs/examples/smoke-echo.specialist.json` for verifying a fresh deployment.
- `handoff-feedor.md` at repo root — one-page operator handoff for adopting `specialists-service` v1 in darth-feedor.
- Documentation: `docs/specialists-service.md` (canonical contract), `docs/specialists-service-install.md` (build-from-repo install with rootless-podman + Fedora-SELinux notes), `docs/specialists-service-evaluation.md` (production-evaluation memo), `docs/release-image.md` (maintainer build/push reference), `Script-class authoring` section in `docs/authoring.md`, `Schema target` translation table in `docs/darth-feedor-migration.md`.
- Spec uniformity audit script `config/skills/specialists-creator/scripts/audit-spec-uniformity.mjs` — portable, reports parse failures and unknown keys; KNOWN sets stay in lockstep with `src/specialist/schema.ts`.

### Changed

- Zod `SpecialistSchema` now uses `.passthrough()` on every nested object so unknown keys survive `parseSpecialist()` and `sp edit` round-trip stops silently dropping fields (unitAI-xutg2).
- Strict 1:1 schema-to-runtime cut: every JSON field must map to a runtime consumer (unitAI-8n0aa). Dropped `CommunicationSchema` entirely (`next_specialists`, `publishes`), `capabilities.diagnostic_scripts`, `prompt.normalize_template`, `prompt.examples`, `execution.preferred_profile`, `execution.approval_mode`, `metadata.author`, `metadata.created`, root `heartbeat`, and the deprecated `ScriptEntry.path` alias. 26 specs and `docs/authoring.md`, `config/skills/specialists-creator/SKILL.md`, `src/cli/view.ts`, `scaffold-specialist.ts` updated in lockstep.
- `sp script` and `sp serve` flag rename: `--user-dir` → `--project-dir` (the flag has always been the project root, not a user-spec dir); `--user-dir` retained as a deprecated alias (unitAI-rfjbd).
- Pi 0.70.x compatibility: dropped the `args.push('--', prompt)` option terminator in `src/specialist/script-runner.ts`; both 0.64 and 0.70.2 accept positional prompt. Image base unpinned to `@mariozechner/pi-coding-agent@latest` (unitAI-w0h7z).
- `xt-merge` specialist `output_to` migrated to canonical top-level `output_file` — a typo'd dead alias had been silently dropping `merge-prs-result.md` writes since the spec was authored (unitAI-yb9qu).
- README.md documentation map points to the new specialists-service docs.

### Fixed

- NDJSON parser handles pi's real `message_end` and `agent_end` event shapes; the prior parser matched a fictional shape that the test mock perpetuated, returning empty assistant text in production (unitAI-68owr).
- Surface pi-level `message.errorMessage` when content is empty so quota and auth errors no longer silently return `success: true` with empty output (unitAI-68owr).
- `stripMarkdownFences()` runs before `JSON.parse` for `response_format=json` responses; some models (e.g. kimi) wrap JSON in markdown code fences regardless of the format directive (unitAI-68owr).
- `config/specialists/specialists-creator.specialist.json` JSON corruption: a zsh prompt artifact had been pasted into the file as a JSON key (`"permission_requiredspecialists — zsh "`); only caught after `.passthrough()` exposed the silent survival of unknown keys (unitAI-826wl).
- Bulk-swept 19 stale `.xtrm/skills/active/pi/<name>/` skill paths across canonical and mirror specs; the `pi/` subdirectory was removed in a prior layout migration but the references were never updated (unitAI-826wl).

### Removed

- `parallel-review` specialist files removed from canonical and mirror (renamed to `parallel-runner` in 3.4.0; spec files lingered until this cleanup).
- 11 declarative-only schema fields (see Changed → strict 1:1 schema cut) — none had a runtime consumer.

[Unreleased]: https://github.com/Jaggerxtrm/specialists/compare/v3.8.0...HEAD
[3.8.0]: https://github.com/Jaggerxtrm/specialists/releases/tag/v3.8.0
