# XTRM-93 — Ordered Migration DAG

> Derived from the lane evidence, not from the brief's assumed shape. Where the brief's expected
> order is wrong, the divergence is stated with its evidence.
> Baseline: worktree HEAD `6553ef05` = master `472b1aef` + local `rx1bu`; GitNexus index current.
> Companion: `00-capability-matrix.md` (§3 rows, §6 hard-rule violations, §7 open questions),
> `09-go-no-go.md`.

## Node contract

Every node declares the same six fields:

| Field | Meaning |
|---|---|
| **inputs** | What must already be true/merged. |
| **files** | Primary touch surface. |
| **dependency** | Which other nodes must land first, and why it is a real dependency (not a preference). |
| **acceptance tests** | The differential scenario id(s) from `10-differential-acceptance-corpus.md` plus any unit gate. |
| **rollback point** | The exact state to return to if the node fails; each node must be independently revertible. |
| **old path still reachable?** | Whether the legacy route is still live after this node lands. |
| **deletion unlocked?** | Which ledger rows become deletable, or `none`. |

**Strangler rule for every node:** the old path stays reachable until its replacement has passed the
node's acceptance tests with both paths co-resident. No node may be the first to make a legacy route
unreachable *and* delete it.

---

## N0 — Compile-surface prerequisite: extract `SupervisorStatus` types

| | |
|---|---|
| **inputs** | none |
| **files** | `src/specialist/supervisor.ts` (types `SupervisorJobStatus` `:115`, `SupervisorStatus` `:117`), `src/activation/forensic-sink.ts:34`, `src/specialist/observability-sqlite.ts:104` |
| **dependency** | Nothing depends on it, and *everything* depends on it. Both native consumers import these **as `import type`**, so deleting `supervisor.ts` later breaks the **native compile**, not just the legacy runtime. Until the types live in a module the native path may legitimately depend on, every "no native runtime path" verdict is defeated at compile time. |
| **acceptance tests** | `bun run lint` (tsc `--noEmit`) clean; `bun --bun vitest run tests/unit/specialist/activation-telemetry.test.ts tests/integration/cli/*doctor*` |
| **rollback point** | `git revert` the type-move commit; the aliases at `forensic-sink.ts:34` / `observability-sqlite.ts:104` keep the old import valid either way. |
| **old path still reachable?** | Yes — this node changes no behaviour. |
| **deletion unlocked?** | none on its own. It is the precondition for H-B1 and "the four modules blocked transitively by B-1". |

**Why first:** Lane H identified this as the single unavoidable pre-cutover prerequisite. It is cheap,
behaviour-neutral, and unblocks the deletion order.

---

## N1 — Canonical native service boundary + freeze the capability matrix

| | |
|---|---|
| **inputs** | N0 |
| **files** | new `src/activation/service.ts` (or equivalent facade over `NativeActivationHost`); `src/lib.ts`; `src/tools/specialist/activation.tool.ts` |
| **dependency** | N0 only. This is the seam every later node calls, so it must exist before any frontend moves. |
| **acceptance tests** | `DX-EXEC-005` (admission), `DX-EXEC-026` (both-sides blindness sentinel). Plus: the facade must not widen the tool surface — assert the resolved tool contract is unchanged. |
| **rollback point** | The facade is additive; revert the commit and every existing caller is untouched. |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | none. |

**Design constraint, from evidence:** the facade must accept an **`activationId`**, not a `job_id`,
and must not pretend `types.ts:19-20`'s "ActivationId maps to job_id" is a mechanism. That comment is
the only thing in the tree that claims the two identities bridge; no code implements it.

---

## N2 — Identity + read-only result/status adapters (highest compat value, lowest cost)

| | |
|---|---|
| **inputs** | N1 |
| **files** | `src/cli/result.ts:93-98` (the `:` split), `src/cli/feed.ts`, `src/cli/ps.ts:747`, `src/specialist/native-activation-summary.ts` |
| **dependency** | N1. These verbs must resolve both id shapes before any dispatch moves, or the first native dispatch produces an unreachable result. |
| **acceptance tests** | `DX-ID-001` (**must go green — it fails today**), `DX-TEL-013`, `DX-CLI-005`. Regression: `sp result <6-hex>` must keep working byte-identically. |
| **rollback point** | The id-resolution change is localized to `result.ts`; revert restores the current behaviour exactly (including the defect). |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | none. |

**This node contains the single highest-value fix in the audit.** `sp result act:<id>` is broken
today: `result.ts:93-98` rewrites any id containing `:` into a node/member pair, and
`native-host.ts:507` mints `act:${uuid}`. Reproduced live:
`bun run src/index.ts result act:deadbeef1234` → `No node matching ref: act`.

**Second fix in this node:** `ps.ts:747` reads `event_family='activation'`, which nothing writes
since `febef0ad` deleted the writer. Either restore a producer or repoint the reader at the
dual-path timeline families. Leaving it means `sp ps`'s native block stays empty.

---

## N3 — Telemetry parity for the signals the native path already claims to emit

| | |
|---|---|
| **inputs** | N2 |
| **files** | `src/specialist/native-activation-observability.ts:235-305` (mapper switch), `src/specialist/native-activation-observability.ts:45-89` (gap lists), `src/specialist/prometheus-projection.ts`, `src/activation/settlement-publication.ts` (emit side) |
| **dependency** | N2, and it must precede N4. Rationale from evidence: 13 telemetry blockers exist for events the native path **already emits into the void** — settlement telemetry writes zero durable rows, and `model_fallback` is dropped with no gap-list entry. Moving dispatch onto a path whose telemetry is silently discarded makes the migration unverifiable: you cannot diff what was never recorded. Telemetry is the evidence channel for N4–N7. |
| **acceptance tests** | `DX-TEL-001/002` (run_start/run_complete), `DX-TEL-005` (ordered status_change), `DX-TEL-003/006` (**counting semantics** — the 10 divergences), `DX-TEL-013`, `DX-ID-011` (settlement exactly-once). |
| **rollback point** | Mapper changes are additive `case` arms; revert restores the current drop. |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | none. |

**The counting-semantics divergences are the hard part and must not be rushed.** Concretely:
`total_turns` counts one row per **assistant message** natively but one per **turn** in legacy;
`tool_call_counts_json` counts a call with an update as **3**; and `xtrm_llm_tokens_total`'s last
trajectory element is **per-turn** for legacy and **session-cumulative** natively, so `rate()` means
different things per producer. A "both sides changed" regression is invisible to the existing parity
harness (PR #373's own caveat), which is why these need absolute pins, not cross-runtime equality.

---

## N4 — `sp run` dispatch onto the native path

| | |
|---|---|
| **inputs** | N3 |
| **files** | `src/cli/run.ts:1654`, `src/specialist/launch.ts`, new frontend adapter |
| **dependency** | N1 (facade), N3 (telemetry evidence). Not N5 — a first landing does not need steer. |
| **acceptance tests** | `DX-EXEC-001..004` (owned by `execution-profile-parity.test.ts`), `DX-EXEC-008` (mandatory rules), `DX-EXEC-021` (output validation), `DX-CLI-001/002`. |
| **rollback point** | Keep `launchSpecialist` reachable behind a flag; revert the flag flip. |
| **old path still reachable?** | **Yes — behind the flag. This is the node that must not remove it.** |
| **deletion unlocked?** | none. |

**Blockers that must be decided here, not later:** there is no streaming foreground surface natively
(`start()` returns after admission), and no background/detached mechanism (the host is in-process).
CAP-CLI-001/002 therefore cannot be `PARITY` on this node; they are `ADAPTER_NEEDED`.
Also note the `doctor` consequence: `checkSubstrateRuntime()` is advisory-only **because** the legacy
CLI still carries the install. The Substrate probe must be promoted into the exit status in this node,
not after it.

---

## N5 — Control lifecycle (steer, resume, retry, stop, answer, finalize)

| | |
|---|---|
| **inputs** | N4 |
| **files** | `src/cli/{steer,resume,retry,stop,finalize}.ts`, `src/specialist/control.ts`, `src/activation/native-host.ts` |
| **dependency** | N4, because control verbs act on work the new dispatch created. |
| **acceptance tests** | `DX-CTL-002` (steer — **currently `UNCOMPARABLE` because no native steer exists**), `DX-CTL-003` (resume), `DX-CTL-004`, `DX-CTL-007` (stop), `DX-CTL-010` (ask/follow-up). |
| **rollback point** | Per-verb revert; each verb is independently flaggable. |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | none. |

**This node is where the largest functional hole is.** Evidence:

- **`steer` has no native implementation at all**, yet `retry`'s own refusal text tells the operator
  to *"steer it or stop it first"* (`native-host.ts:1886-1889`). The vocabulary asserts a verb that
  does not exist. `DX-CTL-002` is marked `UNCOMPARABLE` for exactly this reason.
- **`stop` is semantically different, not renamed.** Legacy marks a durable terminal `cancelled`
  result; native `stop()` disposes and **forgets the row**, and `ActivationResult.status` is
  `completed | failed | uncertain` — there is no `cancelled`.
- **`retry` cannot retry `cancelled`** natively, and gates on `failed` only.
- **`finalize` has no native counterpart** (no keep-alive chain, no reviewer-PASS cascade).
- **`answer` is native-only** — legacy has no ask tool.

---

## N6 — Git / worktree / review compatibility

| | |
|---|---|
| **inputs** | N4 (dispatch), and **Core must answer two questions** (see below) |
| **files** | `src/specialist/worktree.ts`, `src/specialist/git-diff-evidence.ts`, `src/cli/{merge,end}.ts`, `src/activation/native-host.ts:273-275,1328-1330` |
| **dependency** | N4. **Partially externally blocked**: it cannot complete until Core states whether it consumes `xtrm.branch.integration.v1` and whether it exposes the session worktree path as a contract field. |
| **acceptance tests** | `DX-GIT-002` (auto-commit / zero-commit), `DX-EXEC-030` (reviewer evidence), `DX-TEL-016` (integration surface). |
| **rollback point** | The git surface is additive; revert restores legacy-only git behaviour. |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | `worktree.ts` only after Core's merge-path answer. |

**Gaps that are real, not cosmetic:**

- **Native produces no diff evidence at all.** `src/activation/` contains zero git invocations.
- **Native pins no base SHA and no branch** (`native-host.ts:273-275,1328-1330`).
- **Native reviewer has no `reviewed_job_id`**, while the shipped reviewer contract declares it
  required (`config/specialists/reviewer.specialist.json:41`).
- **`sp end` cannot derive a bead from a native branch**: its regex is
  `/^feature\/(unitAI-[^-]+)-/i` (`end.ts:89`), which no `xt/<slug>` branch matches.
- **Lease ≠ worktree isolation.** Native is single-writer over a *shared* tree; legacy gives a
  separate tree. Any equivalence claim here is false.
- **`sp merge` is declared broken in-tree**, so retiring it deletes written gates with no code
  successor.

---

## N7 — Secondary surfaces: decide, then act

| | |
|---|---|
| **inputs** | N1, and a **product decision on the script class** |
| **files** | `src/cli/{node,script,serve,chat,console}.ts`, `src/specialist/{node-supervisor,job-control,script-runner}.ts`, `src/server.ts`, `src/tools/specialist/*_specialist.tool.ts` |
| **dependency** | N1. Independent of N4–N6 (this is why it is late but not last). |
| **acceptance tests** | `DX-SEC-001` (node, `UNCOMPARABLE`), `DX-SEC-002` (script, `EXIT-CODE-only`), `DX-EXEC-026`. |
| **rollback point** | Each surface independently revertible. |
| **old path still reachable?** | Yes. |
| **deletion unlocked?** | `src/server.ts`, the three legacy `*_specialist.tool.ts` files, `pipeline.ts` — all provably unregistered/unimported **today** (they do not need the cutover). |

**Three engines, and only one is the target.** The repo has:

1. the legacy Supervisor job engine (`sp run`, `sp chat`, `sp node`, control verbs, projection verbs);
2. the native activation engine (MCP/Claude, `src/lib.ts`, `src/server.ts`);
3. the **script class** (`sp script`, `sp serve`) — `script-runner.ts` drives `PiAgentSession` and
   `spawn('pi')` directly and imports only the `SupervisorStatus` **type** from engine 1.

Engine 3 is **not** the legacy backend. It carries the only documented external consumer
(`handoff-feedor.md`, `docs/specialists-service.md`, `docs/examples/specialists_client.py`) and the
cron exit-code contract `0/1/2/3/4/5/6/7/75` (`script.ts:104-118`). It must be explicitly preserved
or explicitly retired with a cited decision — silence is not an option.

`sp node` is **engine 1**: `NodeSupervisor` → `JobControl` → `new Supervisor` (**7 sites**). It needs
a `JobControl` replacement keyed on `activationId`, which does not exist.

---

## N8 — Schema/config cleanup and Beads-doctrine removal

| | |
|---|---|
| **inputs** | N4–N6 (the legacy consumers must be unreachable) |
| **files** | `src/specialist/schema.ts`, `src/specialist/global-config.ts`, `src/specialist/mandatory-rules.ts:377-390`, `src/specialist/memory-retrieval.ts:10-21`, `config/specialists/*.json`, `config/mandatory-rules/**` |
| **dependency** | N4–N6. Removing `beads_integration`/`beads_write_notes` while the legacy backend still consumes them breaks the legacy path mid-migration. |
| **acceptance tests** | `DX-EXEC-008` (mandatory rules injection), plus the 84-deletion mechanical list in `06-schema-config-rules.md`. |
| **rollback point** | Config removal is data-losing for authors; ship a deprecation warning one release before removal. |
| **old path still reachable?** | **No — by design, this is the first node allowed to remove a legacy consumer.** |
| **deletion unlocked?** | 22 schema lines, 12 `global-config.ts` lines, 13 per-config field removals, 11 `user.json` key families, 6 stale fields. |

**Two distinct jobs here, and they must not be conflated:**

1. **Mechanical config cleanup** — 84 discrete deletions, enumerated in Lane F. `execution.mode` is
   the clearest case: set by 24/24 configs, validated, listed in `sp edit` enums, consumed by
   nothing, ever.
2. **The Beads-doctrine violation (§6.1).** This is not cleanup — it is a correctness bug in the
   native runtime today. `workflow-quick-rules` is injected at `priority: 'must_keep'` into native
   prompts and contains `bd update <id> --claim` and `bd close <id>`, with the heading stripped as
   cosmetic cover. `core-session-boundary` (the *required* set on every activation) says the assigned
   **Bead** is authority. `bead-id-verbatim` is referenced by 18 of 19 `template_sets` and is 100%
   `bd`-scoped — **rewrite it, do not delete it.**

---

## N9 — Old backend unreachable

| | |
|---|---|
| **inputs** | N4–N8 |
| **files** | `src/cli/run.ts`, `src/specialist/launch.ts` |
| **dependency** | Every prior node. This is the flag flip, and it is deliberately the **only** node whose output is "the legacy route is gone". |
| **acceptance tests** | Full differential corpus in stub mode; the 10-entry minimal CI subset green. |
| **rollback point** | **Flip the flag back.** This node must be a single revertible switch, never a deletion. |
| **old path still reachable?** | **No.** |
| **deletion unlocked?** | The 43 `DELETE_AFTER_CUTOVER` rows in `08-dead-code-ledger.md`, subject to their unlock conditions. |

---

## N10 — Deletion and rebuild

| | |
|---|---|
| **inputs** | N9, plus N0 (compile-surface prerequisite) |
| **files** | the ledger's 43 `DELETE_AFTER_CUTOVER` rows; `dist/**`; `package.json` |
| **dependency** | N9. No deletion before supported runtime paths stop reaching the candidate. |
| **acceptance tests** | `bun run lint`, full `bun --bun vitest run`, and **`git diff --exit-code -- dist/` plus a clean `git status -- dist/`** (the CI gate in `package-payload.yml:75-76`). |
| **rollback point** | Per-commit revert; deletions must be committed in dependency order, not as one sweep. |
| **old path still reachable?** | No. |
| **deletion unlocked?** | n/a — this node performs it. |

**Two traps in this node:**

1. **`runner.ts` is `KEEP_SHARED`, not legacy.** `native-host.ts:41-50` imports 10 *runtime* symbols
   from `../specialist/runner.js`. A path-based cleanup deletes the native path's own dependency.
2. **`dist/` is committed and CI-enforced reproducible.** `package.json` `bin` → `dist/index.js`,
   and the plugin MCP launcher resolves `../../../dist/index.js` as its "local-first, load-bearing"
   runtime. A PR that removes legacy source but does not rebuild+commit `dist/` **still ships the
   legacy engine** while the diff looks complete. `class Supervisor`, `launchSpecialist`, and
   `NodeSupervisor` all remain in the committed `dist/index.js` today.

---

## Ordering divergences from the brief's expected shape

| Brief expected | Actual evidence | Change |
|---|---|---|
| canonical service/facade first | agreed | none — N1 |
| read-only/status/result adapters | agreed, and **promoted**: this node also carries the live `sp result act:` defect | N2 kept and strengthened |
| run/dispatch | **telemetry must come before dispatch** | N3 inserted before N4 |
| control lifecycle | agreed | N5 |
| telemetry/query surfaces | **moved earlier** (was after control) | folded into N3 |
| git/worktree/review | agreed, but **externally blocked on Core** | N6 marked partially blocked |
| secondary surfaces | agreed | N7, plus an explicit script-class product decision |
| schema/config cleanup | agreed, but **split** into mechanical cleanup and the Beads-doctrine bug | N8 |
| old backend unreachable | agreed | N9 — must remain a flag, not a deletion |
| dead-code deletion | agreed, plus **a compile-surface prerequisite that must come first** | N0 added; `dist/` rebuild folded in |

**Critical path:** `N0 → N1 → N2 → N3 → N4 → N5 → N6/N7 → N8 → N9 → N10`.
N6 and N7 can run partly in parallel once N4 lands. N0 is short and unblocks everything downstream.

---

## Node status at the N3 freeze (2026-09-18)

Verified against code and commits, not against board state, because the board had drifted: several node
beads were still OPEN for work that had long since merged. All XTRM-93 tracking lives in Substrate
(`sb`); there are zero XTRM-93 beads in the Beads (`bd`) store.

| Node | Status | Evidence | Bead |
|---|---|---|---|
| **N0** extract `SupervisorStatus` | **DELIVERED** | `06ff4d19`; `SupervisorStatus` now in `src/specialist/status-contract.ts:30`, imported by `supervisor.ts`, `observability-sqlite.ts` and `activation/forensic-sink.ts`, so the native compile path no longer depends on the legacy supervisor module | SPECIALISTS-77 closed 2026-09-18 |
| **N0.1** neutral session metric contract | **DELIVERED** | `11a48aad`; contract in `src/specialist/session-metrics-contract.ts`, consumed by `runner.ts`, `supervisor.ts`, `native-activation-observability.ts`, `timeline-events.ts` | SPECIALISTS-86 closed 2026-09-18 |
| **N1** canonical native service boundary + capability matrix | **PARTIAL / UNVERIFIED** | The capability matrix exists (`00-capability-matrix.md`). No facade or `native-service` module was found by search, and three consumers were checked only by inspection, so this node's "canonical boundary" claim is **not** established here. No bead tracks it | — |
| **N2** identity + read-only result/status adapters | **DELIVERED** | N2A: `b8f34462` + review fix `0292b225`, positional fix `813e3b01` + dist `0e76b315`; N2B: `ps.ts:18-19` consumes `summarizeNativeActivations` / `resolveNativeActivationOwnership` + review fix `2603358e`, verified at `6113a710`. Adversarial review gate verdict: "N0 accepted; N2A / N2B / dist accepted-with-findings" (`11-cutover-prep-log.md:16,340`) | SPECIALISTS-78, 80, 81, 92 closed 2026-09-18 |
| **N3** telemetry parity | **FROZEN** | Code baseline `1ff421c2`; freeze record `e34b2255` (`n3/coordinator/N3-FREEZE-AUDIT.md`). Epic deliberately OPEN: 5 of 8 defect children delivered, 3 open with live defects (`SPECIALISTS-95` harness, `107` native metrics row, `108` `elapsed_ms` overwrite). Three epic output artifacts are NOT met — no `N3.0..N3.10` sequence (this DAG's `N0..N7` is the real structure), the differential corpus is a design document, and one matrix row keeps `UNKNOWN` parity | SPECIALISTS-94 OPEN |
| **N4** `sp run` dispatch onto the native path | **NOT STARTED** | Preconditions and first-node candidates are recorded in `n3/coordinator/N3-FREEZE-AUDIT.md` §10 | — |
| **N5** control lifecycle | **NOT STARTED** | Depends on N4 | — |
| **N6** git/worktree/review compatibility | **NOT STARTED, EXTERNALLY BLOCKED** | Cannot complete until Core states whether it consumes `xtrm.branch.integration.v1` and whether it exposes the session worktree path as a contract field | — |
| **N7** secondary surfaces | **NOT STARTED** | Also needs the script-class product decision | — |
| **N8–N10** schema cleanup, flag flip, deletion | **NOT STARTED** | N8 depends on N4–N6; N9 is the flag flip; N10 is deletion and rebuild | — |

**Legacy-oracle prerequisite, still open:** `SPECIALISTS-87` (make the Supervisor suite reachable, unitAI-9n93)
remains OPEN. `tests/unit/specialist/supervisor.test.ts` installs an empty `node:child_process` mock while
`supervisor.ts` imports `spawn`/`spawnSync`/`execFileSync`, so the legacy oracle cannot run; the quarantined
run is 38 failed / 18 passed, identical to its own baseline.

**Critical path from here:** the migration's next node is **N4**, whose inputs are `N1` (facade) and `N3`
(telemetry evidence — now frozen). N1's status above is the one unresolved input: it should be established
or restated before N4 depends on it.
