# Decision record — SPECIALISTS-4363: chains return as a read-only coordinator reference (option A)

**Date decided:** 2026-10-26 (operator).
**Worktree:** `.worktrees/specialists-4363`.
**Output:** decision record (this file) + extended reference
`config/skills/using-specialists/references/chain-recipes.md`
("Chain templates — read-only reference (option A)").

## 1. Decision

Chains return to the coordinator surface as a **read-only reference**: a
per-template validity table against the live catalog, the kept template format,
scrutiny-to-chain guidance, and the committed reference location. There is
**no instantiation, no CLI verb, and no tool** that lists, shows, or pours
chain templates. Each stage stays one manual `specialist_dispatch` per the
existing role-and-gate sequences. No statement is made about unreleased
ChainRun behaviour; ChainRun semantics remain owned by the XTRM runtime canon.

## 2. Options considered (with consequences)

| Option | Shape | Consequences |
|---|---|---|
| **A — read-only reference (decided)** | Extend `chain-recipes.md` with validity table, format, scrutiny guidance. No CLI/tool. | Zero new surface to maintain; no ChainRun semantics needed; templates stay non-executable docs so the `code-with-advisors` dangling-`needs` and `memory-hygiene` absent-role defects are harmless. Cost: coordinators keep hand-deriving sequences. |
| B — list/show verb (read, no instantiate) | CLI verb or MCP tool that lists/shows templates. | Implies a freshness guarantee the catalog cannot keep (roles drift; two templates already diverge); creates a surface to maintain against the unreleased ChainRun canon. Rejected. |
| C — full instantiation (pour/materialize) | Pour templates into Issues, Substrate-bound. | Requires ChainRun runtime semantics (unreleased, owned by the XTRM runtime canon), revives the legacy `bd mol pour` path the templates README marks as design history, and needs a Substrate-binding design outside this Issue. Rejected. |

## 3. Per-template validity table (against `config/specialists/`, 24 live roles)

Method: every `role:` label in each of the 15
`docs/design/roadmap/chain-templates/*.formula.json` files was checked against
the live specialist filenames. `{{specialist}}` template vars were resolved
against the catalog instead of counted as roles.

| Template | Roles (in sequence) | Verdict |
|---|---|---|
| `code-quick` | reviewer | Valid |
| `code-standard` | executor → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid |
| `code-with-advisors` | executor → seconder → test-engineer → test-runner → obligations-scanner → reviewer; executor `needs` explorer/researcher/overthinker | Roles valid, topology broken: advisor steps referenced but not declared. Hand-dispatch advisors; all three roles exist. |
| `code-with-tests` | executor → seconder → test-engineer → test-runner → security-auditor (`optional:sensitive`) → obligations-scanner → reviewer | Valid |
| `debug` | debugger → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid |
| `doc-sync` | sync-docs | Valid |
| `memory-hygiene` | memory-processor | **Invalid — role absent from the live catalog.** Do not use. |
| `planning` | planner | Valid |
| `premortem` | overthinker | Valid |
| `release-prep` | changelog-drafter → changelog-keeper | Valid |
| `research-only` | `{{specialist}}`, default explorer | Valid when resolved to explorer/researcher (both live) |
| `restitch` | debugger → seconder → test-engineer → test-runner → obligations-scanner → reviewer | Valid |
| `security-deep` | security-auditor (advisor) → executor → seconder → test-engineer → test-runner → security-auditor (gate) → obligations-scanner → reviewer | Valid |
| `test-only` | test-engineer → seconder → test-runner → reviewer | Valid |
| `triage` | explorer → overthinker | Valid |

Summary: 13 valid as-declared, 1 valid-with-manual-advisors
(`code-with-advisors`), 1 invalid (`memory-hygiene`).

## 4. Template format kept

`formula.json` (bd-era ChainSource compatibility assets). The `bd mol pour` /
`bd dep` procedure in `docs/design/roadmap/chain-templates/README.md` stays
marked legacy design history. No Substrate-native shape is introduced by this
Issue.

## 5. Scrutiny-to-chain guidance (committed in `chain-recipes.md`)

LOW → `code-quick`; medium production diff → `code-standard`; medium bug →
`debug`; medium tests-only → `test-only`; HIGH/CRITICAL → `code-with-advisors`
(manual advisors) or `code-with-tests`; critical/sensitive → `security-deep`;
no-scrutiny meta → `planning` / `premortem` / `triage` / `research-only` /
`release-prep` / `doc-sync` / `restitch` (`memory-hygiene` excluded).

## 6. Committed reference location

Extended `config/skills/using-specialists/references/chain-recipes.md` in
place; no sibling reference added (smallest diff; chains stay one reference
alongside the existing role-and-gate sequences).

## 7. Canon citations (runtime-boundary compliance)

- Canonical pipeline statement (seconder → test-engineer → test-runner →
  security-auditor-if-sensitive → obligations-scanner → reviewer, Release
  Checklist, severity-modulated, not opt-in): per
  `xtrm-dev/xtrm docs/substrate/chain_templates.md` **§2**, via the in-scope
  templates README's canon map. The canon file is not vendored in this
  worktree; no section text is reproduced beyond the README's summary.
- Per-template resolved canonical chains: canon **§3** (reference pointer only).
- Pending DevOps-gates gap: canon **§4** (acknowledged; design fill is out of
  scope for this Issue).
- No claim about unreleased ChainRun behaviour is made anywhere in the
  reference or this record; ChainRun material under `docs/runtime` was
  therefore not cited.

## 8. Validation performed

- All 15 formulas parsed; roles extracted and joined against the 24 live
  catalog entries (one absent: `memory-processor`; one dangling-`needs`:
  `code-with-advisors`).
- `git diff --stat` scope check before completion (docs-only change set).
- No code symbols modified: no `gitnexus_impact` target exists for this
  markdown-only change (docs-only scope exemption); concept search performed
  for the chain coordination surface at session start.
