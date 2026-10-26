# SPECIALISTS-4340: coordinator surfaces

Status: complete (2026-10-26). All ten children are closed. Released in v4.1.0; the live-check fixes ship in v4.1.1. Baseline: PR #498 merged as `2a450f5b8`.
The Issue revision is the contract. This document links and summarises. It is not authority for any contract text.

## 1. What the epic changes

| Area | Effect |
|---|---|
| Refusal text (4341) | Every dispatch refusal carries a `fix` field in Substrate vocabulary. MCP and Pi produce identical refusal payloads. |
| Tool descriptions (4342) | Each `specialist_*` description exists once and is consumed by Pi and the MCP servers. A drift test fails when surfaces diverge. |
| Role nudges (4343) | A coordinator that writes a review, deploy or monitor prompt sees one context line naming the matching specialist. The session-start output carries one doctrine line. The map derives from `config/specialists/*.specialist.json`. |
| One skill (4344) | Pending (unrevised): one canonical `using-specialists` skill would serve Claude and Pi, with `supervising-activations` folded in. |
| Fleet display (4345) | A recorded decision: shared display fields in `specialist_status`, or two tested implementations. |
| Mod UX (4346) | The Claude mod fleet band and pane follow the Pi layout, show labelled controls, and confirm before stop. |
| Global CLAUDE.md (4347) | Pending (unrevised): `~/.claude/CLAUDE.md` would move from `bd` to `sb` vocabulary (out-of-repo change, operator-approved diff). |

## 2. Children

| Ref | Title | Scope | Surfaces | Rev |
|---|---|---|---|---|
| 4341 | Refusals carry a corrective fix; Pi adopts renderRejection | `DISPATCH_REFUSAL_REASONS`, `FIX_BY_REASON`, Pi adoption | `src/activation/rejection.ts`, `activation.tool.ts`, Pi `index.mjs` | 2 |
| 4342 | One source for tool descriptions | shared description module, drift test | `src/tools/specialist/`, `src/lib.ts`, Pi `index.mjs`, MCP servers | 3 |
| 4343 | Role-to-specialist nudges | catalog-derived map, `prompt.submit` hook, session-start line | `plugins/specialists/hooks/register.tsx`, `session-start.mjs`, `config/` map | 3 |
| 4344 | One canonical using-specialists skill | build step, byte-equality test, doctor check | `config/skills/using-specialists`, `plugins/specialists/skills` | 1 |
| 4345 | Decide shared fleet display formatting | decision record | Issue journal | 2 |
| 4346 | Claude mod fleet UI | snapshot harness, layout parity, confirmed stop | `plugins/specialists/hooks/register.tsx`, `tests/register.test.ts` | 2 |
| 4347 | Align global CLAUDE.md from bd to sb | operator-approved diff | `~/.claude/CLAUDE.md` | 1 |
| 4363 | Chain templates as a read-only reference (operator chose option A) | validity table, scrutiny guidance, no tool or CLI | `config/skills/using-specialists/references/chain-recipes.md`, `.xtrm/reports/specialists-4363/REPORT.md` | 2 |
| 4364 | Suggest the chain reference after a dispatch | settings-level PostToolUse hook (Claude), appended line in the dispatch execute path (Pi) | `plugins/specialists/hooks/hooks.json`, `config/pi-extensions/native-specialists/index.mjs` | 2 |
| 4365 | specialist_status emits display fields; mod and Pi consume with local fallback | additive `display` block, shared formatter, fallback tests | `src/tools/specialist/specialist_status.tool.ts`, Pi `index.mjs`, `register.tsx` | 1 |

Dependencies: no open blocks edges remain. Satisfied: 4345 -> 4346, 4365 -> 4346, 4341 -> 4342, 4343 -> 4365, 4363 -> 4364. Relates: 4325 -> 4346 (visual reference), 4344 -> 4347 and 4346 -> 4347 (soft sequencing: 4347 had blocks edges from epic creation; converted on 2026-10-26 because 4347 is gated by the operator's approval of the diff, not by those Issues).

## 3. Review record

An independent review verified every claim against the tree at `2a450f5b8`. It found these defects. Each is corrected in the current revision.

- **4341.** The refusal set had no closed definition. `src/activation/native-host.ts` has 32 `reject()` sites and 30 distinct reasons. `src/activation/rejection.ts` has no reason union and no fix text. Seven more wire reasons are thrown directly (four lease reasons in `workspace-lease.ts`, three lifecycle reasons in `native-host.ts`), which makes 37. `workspace_lease_unavailable` is event-only and excluded. The claim that session-start and the mod read `issue_ref` first was unimplementable: the observability column is `bead_id`. It is now a non-goal.
- **4343.** Three named roles do not exist: `pr-reviewer`, `deploy-watcher`, `production-monitor`. `tool.call` is not a plugin-engine event. The engine catalogue is `prompt.submit`, `mcp.call`, `session.start`, `command.register`, `command.run`, `ui.render/open/close/invalidate/toast`. The tool-call consumer is removed.
- **4346.** `$.ui.ask` does not exist. The contract now uses an inline confirm state rendered with `$.ui.render`. The snapshot harness extends the existing `$.ui.render` to `textOf` approach.
- **4345.** The premise "the plugin cannot import dist" was false. `plugins/specialists/scripts/lease-warn.mjs:38` resolves `../../../dist/lib.js`. The real constraint is that `register.tsx` is engine-loaded with a type-only import.
- **4342.** The contract named `specialist_ask` and `specialist_settled` as Pi-only tools. They are event-card customTypes (`config/pi-extensions/native-specialists/index.mjs:1877-1878`, customType emitted at 1932). Pi and the v2 server expose the same eleven tools. The v1 server exposes nine (no `specialist_feed`, no `specialist_resume`).

Provenance (peer messages, session `specialists-xt-pi-pr498`): `83b587dd` defects; `fb1e42d1` reason inventory with file:line; `d9becea5` attestations and the withheld 4342; `2b6410b3` 4342 attested at rev 3; `3ce305a9` 4343 rev 3 store-level diff.

Baseline note for 4344: PR #498 added one `contextRefs` doctrine bullet to `config/skills/using-specialists/SKILL.md`. 4344 must reconcile it.

## 4. State

| Ref | Rev | State | Evidence (master commit; pre-rebase commit) |
|---|---|---|---|
| 4341 | 2 | closed | `9cf4fcd4b`; `52fdae5c6`. Reviewer PASS `act:db82ef87-0f1`; blast radius CRITICAL (journal seq 3) |
| 4342 | 3 | closed | `fc3a972f5`; `251d0af5f`. Reviewer PASS `act:fdaecbeb-e5d` |
| 4343 | 3 | closed | `af18d9771`; `6f2bdf443`. Blast radius UNKNOWN: plugins are not in the code-graph index |
| 4344 | 3 | closed | `7c94da8d7`; `f9ba97671`. Accepted deviation, see below |
| 4345 | 2 | closed | decision option A (journal seq 2); follow-up 4365 |
| 4346 | 2 | closed | `b7f62d2bc`, harness `940f6b576`; `3d881b9b9`, `d82fb6c3e`. The operator's live check found two defects, fixed in `f5b5867cc` (header separator) and `d90610eaa` (plain button labels, no hotkeys) |
| 4347 | 4 | closed | out of repo: `~/.claude/CLAUDE.md` has no `bd` or Beads reference; dated backup and diff beside it |
| 4363 | 2 | closed | `36a3c817d`; `7ca50fee0`. 15 templates: 13 statically valid, 1 valid after variable resolution (`research-only`), 1 invalid (`memory-hygiene`) |
| 4364 | 2 | closed | `11faea631`; `954485e4b`. Marker pruning in `b440b27aa` |
| 4365 | 1 | closed | `e6289a653`; `85d98c10f` |
| 4340 | 3 | closed | this epic |

PR #499 was merged with a rebase, so every pre-rebase SHA above changed. The tag `pre-rebase-xt-4340` (annotated, at `43633351e`) keeps the pre-rebase commits fetchable. The canonical dist commit is `512df4e1c` (pre-rebase `b249051d9`).

Validation at the merge: full suite 3810 passed, 2 failed. Both failures also fail on master `2a450f5b8` (`doctor-catalogs --require-installed`, `integration/pi/extension-grant`). CI could not run (GitHub account billing lock); gitleaks, semgrep and osv-scanner ran locally with no new findings.

**Accepted deviation (4344).** "A Claude session and a Pi session each load the same skill text" is accepted as structurally equivalent (one source file, a byte-equality test). No live Pi session ran. It is not satisfied.

**Waiver.** The release renews the bounded host-read-isolation waiver (`release-attestation.json`). The waiver is bound to one exact version, so a release of any other version is refused by `scripts/generate-release-attestation.mjs` until the waiver itself is edited with the operator's approval. It also ends at `2026-11-01T00:00:00Z`. Closing this epic does not resolve the risk: host-read isolation is still not provided.

Follow-ups filed: SPECIALISTS-4366 (repair or label `code-with-advisors`), SPECIALISTS-4367 (ship or retire `memory-hygiene`), CORE-2518 (re-pin core's `using-specialists` copy after the xtrm install and update rework).
