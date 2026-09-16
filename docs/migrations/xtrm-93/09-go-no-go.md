# XTRM-93 — GO / NO-GO

> Recommendation is derived from `00-capability-matrix.md` (§3 rows, §6 hard-rule violations, §7 open
> questions) and the lane artifacts. It is **not** derived from how clean the target architecture
> looks. Where the two conflict, the matrices win.
>
> Baseline: worktree HEAD `6553ef05` = master `472b1aef` + local `rx1bu`. GitNexus index current at
> `6553ef0`. Nine lanes (A–J) audited; every lane verified by the coordinator, with headline graph
> queries reproduced exactly.

## Bottom line

| Question | Answer |
|---|---|
| Is the **cutover** approved? | **NO-GO** |
| Is the **migration program** approved to start? | **GO** — begin at N0/N2, which are prerequisites *and* fix live production defects |
| Capability rows at `UNKNOWN`? | **0** (gate condition on rows is satisfied) |
| Gate-blocking open decisions? | **4** (§7.1: G-1…G-4) |
| `NATIVE_GAP` rows? | **26** — each becomes an implementation item before cutover |
| Telemetry rows at `NATIVE_GAP`? | **49 of 108** |
| Live production defects found and reproduced? | **4** |

The gate forbids GO while any row is `UNKNOWN`. No row is. It does **not** follow that GO is
permitted: the gate says every `NATIVE_GAP` must become an implementation item before cutover, and
there are 26 of them plus 4 undecided product questions. So the honest verdict is: **the audit
passes, the cutover does not.**

---

## 1. How many distinct legacy capabilities exist?

**60 capability rows** in the merged matrix (`CAP-CLI` 22, `CAP-EXEC` 9, `CAP-CTL` 2, `CAP-TEL`
8 blocks, `CAP-ID` 6, `CAP-GIT` 4, `CAP-CFG` 4, `CAP-SEC` 3, `CAP-FE` 2).

Expanded to atomic surfaces, the same capabilities are described by **108 telemetry signal rows**
(`CAP-TEL-001..108`, authored in `03-telemetry-observability.md`) and **47 CLI command contracts**
(authored in `01-cli-surface.md`, 47 dispatch tokens confirmed against `src/index.ts`).

## 2. How many already have native parity?

**10 rows `PARITY`** at capability granularity; **53 of 108** telemetry rows.

The high telemetry parity count is structural, not luck: native and legacy write **one**
`observability.db` and **one** event vocabulary through the same writer
(`activation/forensic-sink.ts:1-21,174` → `observability-sqlite.ts:1367,1605,1651`). This is the
single most important fact in the audit, and it is stated in-source.

## 3. How many need adapters?

**18 rows `ADAPTER_NEEDED`** — the native primitive exists, the surface does not. Examples: resume
and retry (native methods exist, CLI does not call them), identity mapping (`act:` ↔ `[0-9a-f]{6}`),
store anchoring, config resolution, the library surface, and the CLI-as-frontend rows.

## 4. How many are true native gaps?

**26 rows `NATIVE_GAP`.** Plus **49 of 108** telemetry signals with no native destination.

## 5. Which gaps are blockers?

**Blocking the cutover:**

| # | Gap | Evidence |
|---|---|---|
| B1 | No native `cancelled` result state | `ActivationResult.status = completed\|failed\|uncertain` (`types.ts:261`); `stop()` disposes and forgets the row (`native-host.ts:2195-2213`) |
| B2 | `sp result` cannot resolve a native id | Reproduced live: `result act:deadbeef1234` → `No node matching ref: act`. `result.ts:93-98` splits on `:`, `native-host.ts:507` mints `act:` |
| B3 | No native mid-run `steer`, while `retry`'s own error text says *"steer it or stop it first"* | `native-host.ts:1886-1889`; no `steer` method exists |
| B4 | `waiting` is declared but never produced natively | `snapshot.state` is assigned only `starting/running/needs_reply/escalated/settled/stopping/stopped/failed` = 8 produced; `waiting`, `uncertain` unproduced. `RESUMABLE_STATES` and the telemetry bridge both assume `waiting` |
| B5 | No activation crash recovery / orphan reconciliation | Legacy self-heals on every `run()`/`loadStatuses()` (`supervisor.ts:1336-1425`); native has none. `auditDeadJobs` SQL requires `pid IS NOT NULL` and native never writes a pid |
| B6 | Settlement telemetry writes **zero durable rows** | `settlement-publication.ts` emits 10 names across 19 sites; `mapNativeLifecycleEvent` has no case → `default: return null`. Degradation is stderr-only |
| B7 | `model_fallback` is silently dropped, and absent from **both** gap lists | 5 emit sites (`native-host.ts:843,1759,1769,1807,1833`); undocumented drop |
| B8 | `sp ps` native block reads a family nothing writes | `ps.ts:747` reads `event_family='activation'`; writer deleted by `febef0ad` |
| B9 | Beads doctrine is injected into native prompts at `must_keep` | §6.1; `bd update --claim` / `bd close` reach native dispatch with the heading stripped as cover |
| B10 | No native diff evidence and no base/branch pin | Zero git invocations in `src/activation/`; `native-host.ts:273-275` |
| B11 | `specialist_retry` unregistered on the shipped MCP entrypoint | Absent from `v2-server.ts`; present only in unreferenced `src/server.ts:31,170` |
| B12 | `sp node` has no `activationId`-keyed equivalent | `NodeSupervisor` → `JobControl` → `new Supervisor` (7 sites) |

## 6. Estimated migration complexity by subsystem

| Subsystem | Complexity | Why |
|---|---|---|
| Identity + `sp result`/`ps` adapters (N2) | **Low** | Localized; two live defects; highest value per unit effort |
| Compile-surface type extraction (N0) | **Low** | Behaviour-neutral move |
| Canonical facade (N1) | **Medium** | Design decision on id acceptance, but additive |
| Telemetry parity (N3) | **High** | 49 gap rows, 10 count-semantics divergences, cumulative-vs-per-turn token attribution, and a parity harness structurally blind to both-sides changes |
| Dispatch (N4) | **High** | No streaming foreground, no background mechanism, `doctor` exit-code contract change |
| Control lifecycle (N5) | **High** | `steer` does not exist; `stop` has different terminal semantics; `finalize` has no native model |
| Git/worktree/review (N6) | **Very high, partly external** | Blocked on Core; native produces no evidence at all; lease ≠ worktree isolation |
| Secondary surfaces (N7) | **High** | Three engines; `sp node` needs a new control layer; script class needs a product decision |
| Schema/config + doctrine (N8) | **Medium** | 84 mechanical deletions, plus one correctness bug |
| Deletion + rebuild (N10) | **Medium** | `runner.ts` is shared; `dist/` is committed and CI-enforced |

## 7. Which files/modules become deletable?

`08-dead-code-ledger.md` holds 71 candidate rows: **43 `DELETE_AFTER_CUTOVER`**, 16 `KEEP_SHARED`,
15 `MOVE`, 11 `KEEP_COMPAT`, and — after the coordinator resolved Lane H's UNKNOWN-2 —
**1 remaining `UNKNOWN`**.

**34 modules are shared and must not be deleted.** The sharpest case is `src/specialist/runner.ts`:
it reads as legacy by path, but `native-host.ts:41-50` imports 10 of its exports **at runtime**.

Already deletable *today*, without any cutover: `src/server.ts`, the three unregistered
`*_specialist.tool.ts` files, `src/specialist/pipeline.ts`, all four `pi/rpc/*` files (zero importers).

## 8. What telemetry work is required?

The largest single workstream. Required before dispatch moves (N3):

1. Add mapper cases for the 10 `settlement_*` names, or they stay invisible (B6).
2. Add `model_fallback` to the mapper **and** to a gap list (B7) — a silent drop is worse than a
   documented gap.
3. Reconcile the **10 counting divergences**: `total_turns` per-message vs per-turn; a tool call with
   an update counts 3; `xtrm_llm_tokens_total`'s last element is per-turn for legacy and
   session-cumulative natively, so `rate()` is not comparable across a mixed fleet.
4. Populate `context_pct`/`context_trajectory_json` or `xtrm_context_usage_ratio` stays empty for
   every native activation.
5. Decide the identity/lineage columns: native carries no `trace_id`/`span_id`/`chain_id`.
6. Repoint or restore `sp ps`'s `event_family='activation'` reader (B8).
7. Decide the asymmetric retention policy (`pruneObservabilityData` prunes `specialist_events` but
   never `specialist_forensic_events`, `specialist_job_metrics`, or `branch_integration_events`).
8. Reconcile the 6 metric families and 6 forensic names that have **classifiers but no producer**
   (independently corroborated by open bead `unitAI-rrdnt.38`).

## 9. What schema/config cleanup becomes possible?

**84 discrete deletions**, enumerated mechanically in `06-schema-config-rules.md`: 22 schema lines,
12 `global-config.ts` lines, 8 native-host/renderer lines, 26 legacy-runtime lines, 11 `user.json`
key families, 13 per-config field removals, 4 doc/generated actions.

Config data affected: **24/24** shipped configs carry `beads_integration` + `beads_write_notes`,
**24/24** carry `execution.mode`, **24/24** carry `interactive` + `max_retries`.

**6 stale fields** with no consumer at all — `execution.mode` is the exemplar: set everywhere,
validated, listed in `sp edit` enums, consumed by nothing, ever.

Constraint honoured: nothing is removed while the legacy backend still consumes it. The Beads fields
are removed only at N8, after N4–N6 make the legacy consumer unreachable, and **no
`substrate_write_notes` replacement is introduced.**

## 10. What work should move to Core?

- Worktree provisioning, branch naming, base-sha/base-ref pinning (Core already launches
  coordinators into worktrees; it publishes only the *branch*, not the path).
- `sp run --background` / detached-tmux dispatch (host is in-process; there is no native mechanism).
- Auto-commit and PR creation (`obs:1319` already documents `pr_url` as *"recorded by xt"*, so two
  producers exist today).
- Branch-integration lineage ownership.
- The four Core-boundary render envelopes (`render-task`, `render-bead`, `render-skill-prefix`,
  `launch-outcome`).
- `sp node` orchestration.

**Not** to be moved on the strength of a name match: `sp merge`/`sp end` gates must be proven
equivalent or explicitly retired — `sp merge` is declared broken in-tree, so retiring it deletes
written gates with no code successor.

## 11. Can the migration be done incrementally without breaking existing CLI scripts?

**Yes, and it must be** — but three surfaces need explicit handling:

1. **`sp result act:<id>` is broken right now.** Fixing it (N2) is a prerequisite, not a cutover step.
2. **`sp integration record|list --json` is a published cross-repo write surface** for
   `xtrm.branch.integration.v1`, consumed by `xtrm-tools core` which "carries no sqlite dependency"
   and "shells out to this verb" (`docs/cli-reference.md:1637-1643`). Byte-compatibility.
3. **The `sp script` exit-code table `0/1/2/3/4/5/6/7/75`** is the documented cron contract with a
   real external consumer.

Also load-bearing: `sp ps --json`, `sp run --background`'s single launch line (or
`specialists.background_launch.v1` under `--json`), `sp doctor`'s default-run `0`-always contract,
and the fact that `sp run --json`/`sp feed --json` emit **pi's** camelCase NDJSON, not repo
snake_case. Error envelopes are already inconsistent across verbs
(`{ok:false,error}` vs `{error}` vs `{epic_id,error}`; `ps` prints `{error}` on **stdout** with
exit 1), so no single parser works across the surface today — that inconsistency must not be
"fixed" casually, because scripts may already depend on it.

## 12. What is the recommended PR/lane sequence?

`N0 → N1 → N2 → N3 → N4 → N5 → N6 ∥ N7 → N8 → N9 → N10`, one PR per node, each independently
revertible. See `migration-dag.md` for the per-node inputs, files, dependencies, acceptance tests,
rollback point, and which deletion each unlocks.

Two nodes are worth doing before any cutover decision is revisited:

- **N0** — behaviour-neutral, cheap, and it is the compile-time precondition for every "no native
  runtime path" verdict.
- **N2** — fixes two live defects (`sp result act:`, `sp ps` empty block) and is pure compatibility
  work.

## 13. What is the earliest safe cutover point?

**After N0–N8 are green, and after four decisions are made.** Not before. Specifically:

- G-1 `peer-registration.ts`: wiring gap or dead code? (An operator approval dated 2026-09-07 is
  recorded in the module header with two binding conditions, and `peer-transport.ts:24` says the
  adapter *"requires `registerPeer()`"*.)
- G-2 consumer census for the `sp script` exit-code table, `sp node`, `src/server.ts`, `pi/rpc/**`,
  `verifyExactLineCitation`, `xtrm.branch.integration.v1`, and the `::attempt::` id form.
- G-3 `waiting_auto_close_ms = 0`: intentional retirement or unset default? (No cited decision.)
- G-4 Is native `waiting` meant to be produced, or should `settled` be the only park state?

And after 26 `NATIVE_GAP` rows have implementation items.

## 14. What must remain after cutover?

- The `sp` CLI UX in full — 47 verbs. The surface stays; the backend behind it changes.
- The script-class runtime (`sp script`, `sp serve`) unless explicitly retired with a cited decision.
- `src/specialist/runner.ts` and the other 33 shared modules — imported by native at runtime.
- The 108-signal telemetry vocabulary and the single shared `observability.db`.
- Published compatibility surfaces: `sp integration record|list --json`, `sp ps --json`, the script
  exit-code table, `sp doctor`'s documented exit contract, the four render envelopes.
- The `@jaggerxtrm/specialists/lib` export surface (it currently exports **both** stacks; the legacy
  exports need their own retirement decision).
- `dist/` rebuilt and committed, or the legacy engine ships regardless.

## 15. What residual risks remain?

| # | Risk | Why it survives the audit |
|---|---|---|
| R1 | **The graph under-counts the legacy blast radius.** | GitNexus breaks at three dynamic-dispatch seams: `supervisor.ts:23` imports `SpecialistRunner` as `import type` then calls `runner.run(...)` at `:2219`; `runner.ts:1016` uses `PiAgentSession.create.bind(...)`; `activation.tool.ts:330` takes `getHost: () => NativeActivationHost`. Lane I reconstructed these with explicit INFERRED edges. Any later auditor trusting graph emptiness will under-scope. |
| R2 | **The existing parity harness cannot see a both-sides change**, by its own admission: *"Cross-runtime equality cannot see a change made to BOTH sides"* (PR #373). | Only cheap dimensions have absolute pins. The new corpus must pin values, not just compare runtimes. |
| R3 | **The existing harness never runs the legacy path** — it is a reconstruction, *"because running the legacy path needs a real `pi` subprocess and this suite forbids one"*. | Real legacy behaviour is unverified end-to-end in CI. |
| R4 | **GitNexus cannot answer CLI reachability at all** — every verb is a dynamic `await import()`. `impact run` returns `ambiguous` with 73 candidates. | All CLI reachability was established by source reading. The tool can never confirm it. |
| R5 | **`dist/` can silently ship the legacy engine** even after source deletion, unless the rebuild is committed. | CI does enforce it (`package-payload.yml:75-76`), but only if the PR runs that job. |
| R6 | **Out-of-tree consumers are unobservable from this tree.** | The consumer census (G-2) is an operator task; the audit cannot close it. |
| R7 | **`sp node` and the script class may have unstated external consumers.** | No in-tree evidence either way; retirement without a census would violate the no-feature-left-behind rule. |
| R8 | **A quarantined smoke test is the only end-to-end assertion of the forensic envelope + Prometheus text**, and it is half-broken: it reads two docs deleted by `092c0462`, and is `SPECIALISTS_LIVE_SMOKE=1`-gated so it never runs. | Telemetry changes land with no end-to-end guard. |

---

## Unrelated production defects found during the audit

Recorded, **not fixed**, per the audit's no-opportunistic-fix rule. Each is independently
reproducible.

| # | Defect | Evidence |
|---|---|---|
| D1 | `sp result` cannot resolve native activation ids | Reproduced live: `result act:deadbeef1234` → `No node matching ref: act` |
| D2 | `sp ps` native-activation block renders empty | Writer of `event_family='activation'` deleted by `febef0ad`; reader left at `ps.ts:747`; stale header comment in `native-activation-summary.ts:6` |
| D3 | Beads doctrine injected into native prompts at `must_keep` | §6.1 — with the `## Beads Workflow Quick Rules` heading stripped as cosmetic cover |
| D4 | `run-dashboard-workflow.js` is broken at HEAD | Imports three `dist/` paths that do not exist |

Additional non-blocking findings: `.specialists/ready/` is documented in two places and read by
**nobody in `src/`**; `docs/surface-ownership.md` documents `.specialists/default/` as tier 2 for
specialist definitions although `loader.ts:145-157` retired it (`31a6421c`); `execution.mode` has had
zero consumers; `vitest.config.ts:59` quarantines a deleted test file; `src/cli/quickstart.ts:217-222`
advertises five MCP tools that `docs/mcp-tools.md:279-283` states are unregistered.
