---
title: Specialists Catalog
scope: specialists-catalog
category: overview
version: 2.0.0
updated: 2026-05-31
synced_at: b92a11ba
description: Current package-canonical specialists and what each one is for.
source_of_truth_for:
  - "config/specialists/*.specialist.json"
  - ".specialists/default/*.specialist.json"
  - ".specialists/user/*.specialist.json"
domain:
  - specialists
---

# Specialists Catalog

Runtime resolution is layered and package-canonical by default:

1. `.specialists/user/` — repo custom specialists and overrides, highest precedence
2. `.specialists/default/` — optional pins / compatibility snapshots
3. package-canonical `config/specialists/` — installed package fallback
4. legacy paths — migration compatibility only

Fresh repositories normally do not need `.specialists/default/` populated. Use `sp doctor --check-drift` and `sp prune-stale-defaults` to remove stale default snapshots; use `.specialists/user/` for intentional customization.

## Current package specialists

Run `sp list` for the live merged registry, including user-local specialists. The table below reflects package-canonical `config/specialists/*.specialist.json` at the current release.

| Name | Version | Primary model | Permission | Keep-alive | Typical use |
|---|---:|---|---|---|---|
| `changelog-drafter` | 1.0.0 | `openai-codex/gpt-5.4-mini` | READ_ONLY | no | Read-only bundle synthesis for `xt release prepare`; no publishing or edits. |
| `changelog-keeper` | 3.0.0 | `openai-codex/gpt-5.4-mini` | MEDIUM | yes | Fill sparse `[Unreleased]` sections from xt reports and commits; edits `CHANGELOG.md` only. |
| `seconder` | 1.0.0 | `openai-codex/gpt-5.4-mini` | READ_ONLY | yes | Smell pass after executor and before reviewer. |
| `debugger` | 2.0.0 | `openai-codex/gpt-5.3-codex` | HIGH | yes | Root-cause symptoms, regressions, flaky tests, and unknown-cause bugs before executor. |
| `executor` | 1.0.0 | `openai-codex/gpt-5.4-mini` | HIGH | yes | Implement already-scoped code or docs changes in an isolated worktree. |
| `explorer` | 1.1.0 | `nano-gpt/zai-org/glm-5` | READ_ONLY | yes | Map architecture, call flows, dependencies, and implementation options without edits. |
| `memory-processor` | 1.1.0 | `openai-codex/gpt-5.3-codex` | MEDIUM | no | Curate persistent project memory into `.xtrm/memory.md`. |
| `node-coordinator` | 1.3.0 | `openai-codex/gpt-5.4` | LOW | yes | Drive NodeSupervisor research-node runs through `sp node` commands. |
| `overthinker` | 1.0.0 | `openai-codex/gpt-5.5` | READ_ONLY | yes | Deep reasoning, tradeoff review, premortems, architecture critique. |
| `planner` | 1.1.0 | `openai-codex/gpt-5.4` | HIGH | yes | Turn broad initiatives into phased bead boards with dependencies and tests. |
| `researcher` | 1.2.0 | `openai-codex/gpt-5.4-mini` | MEDIUM | yes | Current library/API docs, GitHub examples, and ecosystem evidence. |
| `reviewer` | 1.0.0 | `openai-codex/gpt-5.3-codex` | MEDIUM | yes | Compliance review of executor/debugger output via `--job`; emits PASS/PARTIAL/FAIL. |
| `security-auditor` | 1.0.0 | `openai-codex/gpt-5.4` | LOW | yes | Threat modeling, secure-code review, dependency advisory triage; recommendations only. |
| `specialists-creator` | 1.3.0 | `openai-codex/gpt-5.5` | HIGH | no | Create/fix `.specialist.json` definitions and validate schema/model choices. |
| `sync-docs` | 3.1.0 | `nano-gpt/zai-org/glm-5` | MEDIUM | yes | Sync exactly one documentation file from scoped report/commit context. |
| `test-engineer` | 1.0.0 | `openai-codex/gpt-5.5` | HIGH | no | Write/update tests, fixtures, smoke/E2E harnesses, and telemetry assertions from actual implementation diff; no production fixes. |
| `test-runner` | 2.0.1 | `openai-codex/gpt-5.4-mini` | LOW | no | Execute exact requested test commands first, fall back to manifest-detected suites only when needed, capture evidence, classify failures by owner; no fixes. |
| `xt-merge` | 1.1.0 | `openai-codex/gpt-5.4-mini` | MEDIUM | no | Drain xt worktree PR queues with CI/rebase/conflict handling. |

## Notable release highlights

- **No package specialist uses Anthropic Claude as primary.** v3.15 moved package specialists off Anthropic-only defaults for operator environments where those models are unavailable. Fallback diversity is handled through Gemini/GLM/openai-codex models.
- **`sync-docs` v3.1 is single-doc only.** One bead scope must name exactly one doc. It is not a broad docs-tree auditor.
- **`test-engineer` v1 writes tests from actual diff evidence.** It is ambidextrous for `test-only` and `code-with-tests` chains, creates/updates test assets only, emits exact `test-runner` commands, and routes source bugs back to debugger/executor.
- **`test-runner` v2.0.1 is exact-command first.** It prefers orchestrator/test-engineer command lists, falls back to manifest-detected suites only when no exact command is provided, and reports owner-routed failures with evidence.
- **`test-runner` v2 is polyglot.** It detects `package.json`, Python, Rust, and Go manifests and runs the appropriate test command.
- **`changelog-keeper` v3 is file-scoped.** It fills `CHANGELOG.md` gaps only; version bump/build/tag/publish are owned by the release skill flow.
- **`researcher` v1.2 is for external truth.** Use it before answering library/API/framework/CLI questions from memory.
- **`seconder` and `security-auditor` are advisory passes.** They provide evidence and findings before final reviewer PASS.

## Discover current runtime catalog

```bash
sp list
sp list --compact
sp list --json
sp list-rules
```

## Tool resolution

The `Permission` column is the input tier to the manifest-driven tool resolver. Runtime tools are computed from the tier plus package/user catalogs and any per-specialist `permissions[<TIER>]` override.

Inspect a resolved specialist:

```bash
sp config show <name> --resolved
```

See [manifest.md](manifest.md) for resolution semantics and override policy.

## See also

- [manifest.md](manifest.md)
- [authoring.md](authoring.md)
- [workflow.md](workflow.md)
- [skills.md](skills.md)
