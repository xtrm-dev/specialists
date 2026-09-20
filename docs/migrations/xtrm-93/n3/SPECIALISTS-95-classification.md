# SPECIALISTS-95 closeout: Supervisor suite failure classification

Base: `fb830d44` (post-#408 master), worktree `specialists-xt-pi-oracle`.
Command (pipeline-honest, exit captured separately):
`env SPECIALISTS_TEST_QUARANTINED=1 timeout 440 bun --bun vitest run
tests/unit/specialist/supervisor.test.ts --no-file-parallelism`
Runner exit code: **1**. Summary block, verbatim:

```text
Test Files  1 failed (1)
     Tests  38 failed | 18 passed (56)
```

The contract's "50 failed / 4 passed" before-numbers were measured on the
pre-repair tree at `e1a463b8` and are unreproducible here; the harness was
repaired in `7243e534` (real-surface child_process re-export). This file is
the after-record, not a before/after of one tree.

## Zero-signature proof (contract VALIDATION)

```text
$ grep -c 'No "spawn" export is defined' /tmp/sup95-base.log
0
$ grep -c 'No "spawnSync" export is defined' /tmp/sup95-base.log
0
```

The mock-class failure is gone. `tests/unit/specialist/supervisor.test.ts:28-42`
re-exports the real module surface and stubs only `spawn` (detached watchdog);
`spawnSync`/`execFileSync` stay real. Double fidelity is locked by the
`child_process double fidelity (unitAI-9n93 harness lock)` describe block at
the file end (2 tests, both green).

## Failure histogram (from /tmp/sup95-base.log — 38 unique failing tests; the
FAIL summary prints 39 lines because `status.json is updated with bead_id...`
appears twice, and detail blocks are [1/39]–[37/39] plus one unhandled-errors
section. References below are FAIL-summary line numbers (1–39).)

| sig | lines | n | mechanism |
|---|---|---|---|
| ENOENT on `<tmp>/jobs/<id>/{status.json,events.jsonl,latest}` | 2,4,8,10,17,24,25,26,27,28,30,31,32,33,38,39 | 16 | file/DB split (A) |
| `expected null...`, `expected false...`, `expected []...` (legacy-file assertions) | 1,3,9,20,34,35,36,37 | 8 | file/DB split (A), assertion side |
| 30s timeout on tool/gitnexus/tool_duration tests | 5,6,7,29 | 4 | positional drift, slots 10/11 (B) |
| beads doubles (`appendResult.ok` ×2, `closeBeadIfInProgress` ×1), handoff-format assertion drift ×1, session double (`session.kill`) ×1 | 13,14,15,16,22 | 5 | stale double (C) |
| `orphaned (parent supervisor died)` vs `Process crashed or was killed` | 18,19 | 2 | production divergence (D) |
| `Binding expected string...` (keep-alive slots 8/9 misfire) | 11,12 | 2 | positional drift, slots 8/9 (E) |
| `listJobs` length 27 vs 2 (shared-store bleed) | 21 | 1 | environment (F) |

16+8+4+5+2+2+1 = 38. ✓ No provisionals remain.

## Mechanism A — file/DB split (24 tests): STALE-DOUBLE

`writeStatusFile` (`src/specialist/supervisor.ts:1145`) normalises through
`withStatusLineageDefaults` (`:1104`), which calls `readStatus`. On a fresh
row the sqlite half returns null, and the file fallback
(`:904-910`) misses because `writeStatusFileOnly` (`:1135`) is gated on
`isJobFileOutputEnabled` (default OFF) and the jobsDir is an isolated tmpdir.
Identity falls back to `chain_kind: 'prep'`
(`src/specialist/chain-identity.ts:44-48`). The row IS persisted to sqlite;
the tests assert legacy files (`status.json`, `events.jsonl`, `latest`,
`.specialists/ready/<id>`) that production deliberately no longer writes since
the N0 file-gating change. Fixing means updating the tests to read sqlite,
not changing production. Out of scope here (record, don't fix).

Tests (FAIL-summary lines): direct-ENOENT 2,4,8,10,17,24,25,26,27,28,30,31,
32,33,38,39; assertion-side 1 (`readResult` null — the result row is never
written on this path, same store-miss as line 197), 3 (line 197, see below),
9 (ready marker), 20 (artifact recreation), 34,35 (tmux `capturedStatuses` —
the mock scans `jobsDir` for `status.json` inside `runner.run`, but with file
output off no per-job dirs exist, so `capturedStatuses` is `[]`), 36,37
(external-bead `capturedStatuses`, same miss).

### Line 197 classification (contract's specific demand): STALE-DOUBLE

`crashRecovery repairs db-backed running job when file output off`
(`tests/unit/specialist/supervisor.test.ts:197`,
`expected null not to be null`): the db-seeded `dead01` row IS recovered
through the sqlite crashRecovery path, but the test asserts on
`sup.readResult('dead01')`, which reads `specialist_results` — a table the
recovery path never writes (it persists status + run_complete event only).
The assertion reads a store the exercised path doesn't populate.
Follow-up question (not fixed here): should recovery also persist the result
row? Filed separately.

## Mechanism B — positional drift (4 tests + 1 provisional): STALE-DOUBLE

Runner protocol `src/specialist/runner.ts:1038-1075` has 12 positionals;
`onToolStart` is slot 11, `onToolEnd` slot 12. All 4 mocks bind `onToolStart`
at slot 10, which is `onResumeReady` — each fires keep-alive
(`src/specialist/supervisor.ts:2513-2519`) and hangs at `:2703`
(`await keepAliveExitPromise`) until the 30s guillotine. Verified by explorer
activation `act:067940c5-ad3` (worker bead SPECIALISTS-4201, closed) and
independently confirmed against `runner.ts` in this tree. None reaches
`aggregateJobMetrics`/`elapsedMs` (terminal persist at `:2802-2828`
unreached) — the 107/108 metrics path is NOT implicated.

Tests: `captures tool_calls list`, `captures tool result summaries`,
`includes gitnexus_summary`, `emits tool_duration stale_warning`.
(`keeps keep-alive jobs in waiting...`, line 11, looks like this family but
is Mechanism E — same positional drift, earlier slots; see below.)

## Mechanism C — stale doubles / assertion drift (5 tests): STALE-DOUBLE

- Lines 14,16 (`does NOT close input bead`, `appends READ_ONLY result...`):
  mock `beadsClient.updateBeadNotes` is a bare `vi.fn()` returning
  `undefined`; production dereferences `appendResult.ok`
  (`src/specialist/supervisor.ts:1725-1726`) → `TypeError: undefined is not
  an object (evaluating 'appendResult.ok')`. The `BeadsClient` contract
  returns `{ ok: boolean; error?: string }` (`src/specialist/beads.ts:225`).
- Line 15 (`skips note writing...`): mock lacks `closeBeadIfInProgress`,
  which production calls at `src/specialist/supervisor.ts:2774`
  (`closeBeadIfInProgress` exists on the real client,
  `src/specialist/beads.ts:215`).
- Line 13 (`pins result output and metadata...`): the note-content assertions
  expect a `prompt_hash=abc123def4567890` line in the bead note, but
  `formatHandoffBlock` no longer renders a `prompt_hash=` line (received note
  shows the `## <name> · <model> · [FINAL · DONE]` format) — handoff-format
  assertion drift, production correct per its current contract.
- Line 22 (`auto-bead status.json is updated with bead_id...`): the mock
  declares 7 params ending in `onBeadCreated`, which binds production slot 7
  `onSessionRegistered` (`(session) => this.setActiveSession(session)`,
  `src/specialist/supervisor.ts:2452`), so the string `'unitAI-auto-99'` is
  stored as the active session; at dispose `closeActiveSession` calls
  `session.close()` (`:812`, warns) then `session.kill()` (`:815`, throws) →
  `TypeError: session.kill is not a function`. Same off-by-one drift family
  as B (mock assumes `onBeadCreated` is 7th; it is 8th).

## Mechanism D — production divergence (2 tests): PRE-EXISTING PRODUCTION DEFECT

#18-19: the sqlite crashRecovery path writes
`orphaned (parent supervisor died)` (`:1232-1242`) while the file path writes
`Process crashed or was killed` via `buildDeadJobRecovery`. Same dead job,
two error strings depending on which store served it. Recorded, not fixed
(contract scope). Deserves its own issue.

## Mechanism E — slots 8/9 misfire (2 tests): STALE-DOUBLE — TRACED

Runner protocol (`src/specialist/runner.ts:1063-1071`): slot 7
`onSessionRegistered`, slot 8 `onBeadCreated`, slot 9 `onSteerRegistered`,
slot 10 `onResumeReady`. Production handlers
(`src/specialist/supervisor.ts:2452-2456`): slot 8 is
`(beadId) => { setStatus({ bead_id: beadId }); }`; slot 9 is the FIFO-gated
steer wire-up (early return when no `fifoPath`).

Both keep-alive mocks (`keeps keep-alive jobs in waiting...`, line 11, test
file :448-451; `auto-closes keep-alive READ_ONLY...`, line 12, test file
:513-519) declare 9 params ending `..., onSteerRegistered, onResumeReady` —
i.e. they bind mock-`onSteerRegistered` at production slot 8 (`onBeadCreated`)
and mock-`onResumeReady` at production slot 9 (`onSteerRegistered`).
Off-by-two drift: the mocks predate the insertion of `onSessionRegistered`
(slot 7). (Mock slot 9 → production slot 9-steer is harmless: the mock's
`(resumeFn, closeFn)` args hit the steer handler, which returns early with no
`fifoPath`; true `onResumeReady` at slot 10 never fires.)

The mock then calls `onSteerRegistered?.(vi.fn()...)`, which invokes
production `onBeadCreated` with a **function** as `beadId`:
`setStatus({ bead_id: <vi.fn()> })` (`:1446` ← `:2455`) → `writeStatusFile`
(`:1150-1156`) → `upsertStatus` (`observability-sqlite.ts:2088`) →
`writeStatusRow` binds `status.bead_id ?? null` = a function →
`bun:sqlite: Binding expected string, TypedArray, boolean, number, bigint or
null`, retried ×5 (`withRetry`, `observability-sqlite.ts:140-163`) → throw.
`startup_context` / `spawn_origin` objects in the same snapshot are
JSON-stringified into `status_json` and innocent; the scalar `bead_id` bind
is the failing site.

Live probe (temporary `zz-eprobe.test.ts`, removed after): wrapped
`writeStatusFile` and logged the first poisoned call —
`call#3 status=starting bead_id=function NAME=vi.fn() STACK=setStatus
(:1446) ← supervisor.ts:2455 (onBeadCreated body) ← mock line`; then `call#4
status=error bead_id=function` via the catch-block `mergeRunMetrics`
(`:2848` → `:1457` → `:1446`), i.e. the poisoned snapshot re-throws during
error handling. Final error verbatim:
`Failed after 5 attempts (upsertStatus): Binding expected string, TypedArray,
boolean, number, bigint or null`.

Line 11 surfaces differently with the same root cause: that test floats
`sup.run()` un-awaited (`runPromise`) and polls `jobs/latest`; the Binding
throw rejects the un-awaited promise, so the test times out (`Condition not
met before timeout`) and the rejection lands in the log's Unhandled Errors
section (`[38/39]`, verbatim stack ending `run supervisor.ts:2848`, latest
test named as `keeps keep-alive jobs in waiting...`). One root cause, two
surface signatures — the unhandled block is accounted for, not a 39th
failure.

Verdict: **stale-double** (positional drift, sibling of B at earlier slots).
Production is correct — a `beadId` callback receiving a function is a
double artefact, not a reachable production input. No metrics-path
implication (dies at initial-turn persist; terminal persist `:2807-2828` and
`aggregateJobMetricsBestEffect`/`aggregateJobMetricsBestEffort` `:2828`
unreached). Hardening question for a follow-up (not a defect verdict):
whether `setStatus`/`writeStatusRow` should defensively reject non-string
`bead_id` instead of letting it reach the sqlite bind.

## Mechanism F — shared-store bleed (1 test): ENVIRONMENT

#21 (`listJobs` length 27 vs 2): `listJobs` prefers sqlite
(`src/specialist/supervisor.ts:1074-1082`); the file-seeded `older1`/`newer2`
rows never reach the isolated store (no `workingDirectory`, so the client
resolves to the per-file isolated DB which holds 25 rows from earlier tests
in the same file — isolation is per-FILE, not per-TEST). The assertion counts
2, the store holds 27. Test-isolation granularity, not production.

## Oracle demonstration record (contract VALIDATION)

The landed inventory (`tests/unit/specialist/supervisor-canonical-inventory.ts`,
9 entries) already carries the machinery; the following was EXECUTED on this
tree (not merely cited):

- Both-engines-silent failure: `activation_disposed` has no mapper arm, so
  both engines emit nothing durable for it and a differential comparison reads
  parity. The durable check fails verbatim:
  `[oracle] durable proof for "activation_disposed": mapper link MISSING —
  mapNativeLifecycleEvent returned null (no case arm; ...)`.
  Demonstrated live in `zz-95-mutation-demo.test.ts` (1 passed, then removed;
  same semantics permanently pinned by M1 in
  `supervisor-canonical-oracle-repair.test.ts:66-102`).
- Mutation matrix M1-M7 + M5/M6 injection: green in the default suite,
  `supervisor-canonical-oracle.test.ts` +
  `supervisor-canonical-oracle-repair.test.ts`: **37 passed**.
- Positive control: the same two files passing IS the positive control —
  an oracle that failed everything would fail them.
- Inventory independence: static manifest under version control; no code path
  regenerates it from observed events (M5 proves a comment containing the
  event name does not satisfy a durable expectation).

Coverage boundary (unchanged, stated in the inventory header): producer wiring
is NOT bound — commenting out a producer emit leaves the oracle green.
Bound only by the gated live smoke test. DX-TEL-005/DX-CTL-003 remain defined
but not executable (R3, N4 owner).

## Guards

- `bun run lint` (tsc --noEmit): exit 0 (run in this worktree).
- Default-selection guard: `vitest.config.ts` untouched; the quarantined file
  remains excluded by default and reachable only via `bun run test:supervisor`.
  Full default suite was green at base `fb830d44` (253 files / 3245 tests).
- No-weakening: this node changes NO test assertions. `git diff --stat` must
  list only this file (plus journal entries, which live outside the repo).
- Production untouched: zero files under `src/`.

## Open items / follow-ups to file

1. Mechanism D error-string divergence — own issue (sqlite vs file wording).
2. Should crashRecovery persist the result row (line 197 follow-up question).
3. Hardening question from E: type-guard `bead_id` at `setStatus` /
   `writeStatusRow` so a double artefact fails loud instead of Binding-error.
4. N3-FREEZE-AUDIT staleness: claims "empty child_process mock" (§6 row 94.1,
   §8 R8) and baseline "39 failed / 25 passed" (107/108 contracts) — actual:
   harness repaired in `7243e534`, baseline 38/18. Doc touch-up, not this node.
5. The 24 file/DB-split tests need sqlite-assertion rewrites — the actual
   repair this node diagnoses; a dedicated node with test-only scope.
