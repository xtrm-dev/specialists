# XTRM-93 N3 freeze audit

Owner: coordinator `xt-pi-osz3`. Tracker: Substrate epic `SPECIALISTS-94`.
Status of this document: the freeze record. Read it before quoting any N3 result, and read §3 and §8 before
treating any epic success item as met.

## 1. Frozen baseline

FROZEN: `origin/master` at `1ff421c21356fada9d60752c14cdba76d62f4e99`, the merge of SPECIALISTS-123 (PR #399).

N3 is the frozen **node**. This document does not claim that XTRM-93 is frozen: the migration is an eleven-node
programme (`N0..N10` in `migration-dag.md`) and N4–N10 are untouched. N3's own epic (`SPECIALISTS-94`) also
remains open, because three of its eight defect children carry live defects — see §4.

The baseline is only defensible together with §9 (what N3 does not establish). N3 did not freeze a
product; it froze a set of enforced observability guarantees, a corpus reading, and a register of what
remains open.

What is enforced by mandatory CI at the frozen baseline (a red build blocks merge):

| Gate | Enforces |
|---|---|
| `canonical-oracle` | the 9-entry canonical event inventory, now including the resume re-entry leg |
| `bun-sqlite` | the four declared sqlite test files, with an executed-set assertion |
| `telemetry-contract` | the telemetry contract surface |
| `payload-contract` | the payload contract surface |
| `packed-smoke` | the packed artifact smoke test |
| `Semgrep scan`, `Gitleaks scan`, `OSV scan`, `pr-review-gate` | security and review gates |

## 2. Delivery ledger

| Bead | PR | Merge commit | Delivered | Reviews |
|---|---|---|---|---|
| SPECIALISTS-110 | #391 | `4681bf2a` | telemetry-contract enforcement | — |
| SPECIALISTS-118 | #392 | `a7c651ad` | oracle enforced by mandatory CI; bun-sqlite declared list + executed-set assertion | — |
| SPECIALISTS-111 | #393 | `67ee1851` | mapper-totality guard: parser-owned comment trivia, object-form emits, 28-file corpus parity | 128 (round 1), 134 (round 2, PASS 94/100) |
| — (Lane D) | #396 | `e5def352` | phase-accounting corpus provenance receipt + the measurement scripts | — |
| SPECIALISTS-113 | #395 | `313b8936` | sink adopts the host's event-carried attempt id (+5/−8 source-only) | 136 (PASS 90/100) |
| SPECIALISTS-119 | #397 | `211fec68` | flush endpoint = last job-produced event; decision, rejected alternative and policy limit recorded | 143 (CONDITIONAL 84), 146 (CONDITIONAL 92, F1 resolved) |
| SPECIALISTS-122 | #398 | `cac9749c` | canonical-oracle resume-re-entry entry + generic persisted-field assertion, hardened and pinned | 148 (PASS 92/100), 149 (PASS 95/100) |
| SPECIALISTS-123 | #399 | `1ff421c2` | `activation_admitted` mapper arm; configured/requested model durable; fallback chain proven end to end | 151 (CONDITIONAL 82), 152 (verification PASS 94/100) |

Evidence classes are recorded per bead in its own issue journal. The dominant class is
coordinator-executed probes plus writer-run suites plus CI at the reviewed head; independent clean-checkout
`dist` reproduction was performed for 111, 113, 119 and 123.

## 3. Epic success items — assessment

The epic states nine success items. Four are met, three are met by an explicit decision rather than by the
literal artifact, and one is not met. No item is asserted met without the evidence named here.

| # | Requirement (abbreviated) | Status | Evidence and reason |
|---|---|---|---|
| 1 | Rebuilt telemetry matrix; **no row left UNKNOWN** at completion | **NOT MET** | The matrix holds 51 `PARITY` rows and **1 `UNKNOWN` parity row**: `CAP-TEL-050` (`branch_integration_events`), whose owner is unresolved between core and substrate. `03-telemetry-observability.md` §(f) additionally lists **eight unknowns U-1..U-8** with reasons. Several are unreachable from this repository (U-1 needs another package; U-2 needs the xtrm monorepo; U-5 needs substrate status); others are runtime questions (U-7 wall-clock denominator, U-8 multi-process idempotency). The literal criterion is therefore unmet and is carried as residual R1. |
| 2 | Both engines route through shared semantic events; no second native vocabulary | **MET** | Carriers are shared: `control_signal` (`activation_admitted`, SPECIALISTS-123), `model_change` (`model_fallback`, SPECIALISTS-103), `status_change` (resume re-entry, #388), `job.status_changed` across both engines. No CLI adapter guesses between vocabularies. |
| 3 | Every emitted-but-dropped signal mapped or explicitly retired; zero unexplained `default: return null` | **MET** | `NATIVE_LIFECYCLE_OBSERVABILITY_GAPS` and `NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED` are the register; each entry carries a written reason. SPECIALISTS-118 made the inventory manifest-driven and CI-enforced; SPECIALISTS-122 added a manifest guard that fails on **any** id-set drift, so the register cannot silently narrow. |
| 4 | Identity first-class and exact; attempt never flattened into activation | **MET** | SPECIALISTS-113 removed the sink's synthetic attempt counter so every durable row carries the host's event-carried identity; SPECIALISTS-122 added the resume-re-entry durable oracle; the writer guards (`observability-sqlite.ts:1571-1572`, `:1681`) keep rows on event identity while the job pointer stays at the maximum attempt. |
| 5 | Token/turn/context basis documented, an additive machine-readable discriminator, a reader converting to a common basis, and a test that fails if a cumulative value is summed repeatedly | **MET BY DECISION, ARTIFACT NOT BUILT** | The underlying defect is closed: the reader resolves nested `token_usage` with a flat fallback and accepts delta- and cumulative-shaped providers, so both engines produce series. Repeated-summing is guarded by tests (`activation-native-host.test.ts` double-count case; reconciliation tests asserting `summed == session_stats`). **No additive discriminator was built**, and `03-telemetry-observability.md` D-5 records that the proposed discriminator would not have fixed the defect. The literal artifact is therefore not present; the decision is recorded rather than the artifact. |
| 6 | Lifecycle phase machine agrees across engines for a resumed activation, preserving N2 waiting semantics | **MET** | resume re-entry maps to `status_change('running','waiting')` (#388); the post-loop flush endpoint is decided and recorded (SPECIALISTS-119); the resume-re-entry durable row is oracle-enforced (SPECIALISTS-122). The phase-accounting policy limit is stated in the code, the invariant header and the corpus receipt. |
| 7 | Model/fallback telemetry answers the six questions for any activation | **MET** | SPECIALISTS-123: `control.activation_admitted.recorded` carries `configured_model`, `requested_model`, `resolved_model`, `model_override`; executed model is `specialist_jobs.status_json.model`; fallback rows carry `model`, `previous_model`, `error_class`, `terminal`, `attempt_n`, `note`, `resolved_model`. **Limit:** no single emit site carries all seven fallback keys, so answerability holds across rows (stated in the test header and §9). **Review history worth recording:** the first version of this proof could not fail for the defect it guarded — with `requested_model` sourced from the resolved value it still passed, a counterexample the coordinator executed. Round 2 made the fixture resolve a requested alias to a different canonical id, and the same counterexample now fails. The property is met; it was not met by the first attempt. |
| 8 | Settlement telemetry distinguishes produced/stored/published/degraded/retried/duplicate-suppressed/provenance | **MET for the evidenced distinctions; one distinction unverified here** | `tests/unit/specialist/activation-settlement-publication.test.ts` covers: stored-then-published with WorkReceipt and bounded Journal result; a failed attempt stored **without** publishing, then the retry published under a **new attempt id**; bounded publication (full text behind an artifact ref); degraded publication emitting `settlement_degraded` without failing the activation; publication throwing while the stored record survives; and zero-commit results still producing durable provenance. `settled` and `published` are distinct values in `src/activation/native-host.ts` and `src/activation/settlement-publication.ts`. **Not verified in this audit:** the `duplicate-suppressed` distinction. Treated as met for the distinctions listed and unverified for that one. |
| 9 | Extension-discovery sessions durably distinguishable from a real/resumed/retry session | **MET BY DECISION** | The operator ruled extension resolution out of scope; the absence is explicit, not silent, and carries a written reason in `NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED`, enforced by the canonical inventory as `EXPECTED_ABSENT_WITH_REASON`. Distinguishability by a durable row is therefore **not** delivered; the retirement decision is. |

## 4. Epic output artifacts — assessment

| # | Artifact | Status |
|---|---|---|
| 1 | Rebuilt telemetry matrix and recomputed classification delta with per-signal citations | **MET** — `docs/migrations/xtrm-93/03-telemetry-observability.md`, `telemetry-delta.md`, `state-machine-delta.md`, with file:line citations, less the unknowns in R1 |
| 2 | The canonical observability contract: shared events, projection rules, identity/attempt model | **MET** — matrix + `04-persistence-identity.md` + the canonical inventory |
| 3 | Ordered node sequence **N3.0 .. N3.10** with files, dependencies, acceptance tests and rollback per node, in the migration DAG | **NOT MET** — `migration-dag.md` orders the programme as **N0..N7** (N3 being the telemetry node). No `N3.0..N3.10` decomposition with per-node files, dependencies, acceptance tests and rollback exists. `N3.0`/`N3.1`/`N3.2` appear only as prose references in two coordinator verification notes. Carried as residual R2. |
| 4 | Implementation commits per node, each with its regenerated `dist` | **MET** — ledger §2; every `src/` change carried regenerated `dist`, independently reproduced byte-identically for 111, 113, 119, 123 |
| 5 | Differential acceptance corpus with evidence it fails on an injected regression | **NOT MET** — `10-differential-acceptance-corpus.md:145` states plainly that neither `L-ADAPTER` nor `N-ADAPTER` exists in-tree and that the corpus is a **design document, not an executable suite**. It cannot fail on an injected regression because it cannot run. Carried as residual R3. |
| 6 | Closure evidence for `unitAI-kmbb9` and `unitAI-9n93`, or a plainly stated reason each stays open | **MET** — `unitAI-kmbb9` (`sp ps` starves activations: 3 of 259 visible) is filed as `SPECIALISTS-94.3` with plan and starvation regression; `unitAI-9n93` root cause is exact (empty `node:child_process` mock vs real `spawn`/`spawnSync`/`execFileSync` imports; 48 of 50 failures from one cause) and the suite remains known-red. Both reasons are stated in `n3/README.md` §3.1 and §3.8. |
| 7 | Explicit statement of every residual: unverified, deferred to N4+, intentionally different | **MET by §8 and §9 of this document** |

## 5. What N3 fixed (the load-bearing changes)

1. **Attempt attribution was wrong on disk.** Every retry/resume leg persisted under the previous attempt
   id. Fixed in SPECIALISTS-113 and oracle-enforced for the resume leg in SPECIALISTS-122.
2. **Phase buckets were a function of operator read timing.** An operator running `sp ps` charged up to
   924,277,987 ms (256.74 h) across 31 jobs to job phase time. The flush endpoint is now the last
   job-produced event, and the resulting undercount is stated rather than hidden.
3. **The bounded enumeration guard had three fail-open holes** (comment blindness, object-form new-name
   filter, hard-coded file set). Fixed in SPECIALISTS-111 using parser-owned comment trivia.
4. **The canonical oracle was correct but not enforced.** SPECIALISTS-118 put it in mandatory CI with a
   declared file list, an executed-set assertion and a manifest floor.
5. **The manifest could be narrowed silently.** SPECIALISTS-122 pinned the exact id/class set, so
   deleting *any* entry fails; verified by executing the deletion of a pre-existing entry.
6. **Configured/requested model was unanswerable after a restart.** SPECIALISTS-123 made it durable on the
   existing carrier.

## 6. N3 epic children — reconciled against code

The epic's child refs resolve to distinct top-level issues. This reconciliation replaced board state with
code evidence; two children were closed, three were confirmed open, and one coordinator error was retracted.

| Child | Canonical ref | State | Basis |
|---|---|---|---|
| 94.1 repair the Supervisor test harness | SPECIALISTS-95 | **OPEN** | The empty `node:child_process` mock against real `spawn`/`spawnSync`/`execFileSync` imports is unchanged, so the legacy oracle is still unreachable; the quarantined run remains 38 failed / 18 passed, identical to its own baseline |
| 94.2 `xtrm_llm_tokens_total` zero series | SPECIALISTS-97 | **CLOSED by coordinator** | PR #377 (`180c6b78`); nested-first reader with flat tolerance at `prometheus-projection.ts:440-447`; regression `prometheus-token-trajectory-nested.test.ts` green at head |
| 94.5 legacy `--mine` unsupported query | SPECIALISTS-105 | **CLOSED by coordinator** | SPECIALISTS-104 (#385): `--mine` resolves before the activation bound and fails closed instead of broadening; pinned by `ps-mine-selection.test.ts` |
| 94.7 native activations produce no metrics row | SPECIALISTS-107 | **OPEN** | `aggregateJobMetrics` is called only from `supervisor.ts` and `control.ts`; no `src/activation/` caller exists, so a native activation still writes no `specialist_job_metrics` row |
| 94.8 `elapsed_ms` overwritten per `run_complete` | SPECIALISTS-108 | **OPEN** | `observability-sqlite.ts:3229` still assigns `excluded.elapsed_ms` unguarded; `elapsedMs` is recomputed per `run_complete` at `:3121` and back-filled at `:3174-3175`; no commit resolves it |

94.3, 94.4 and 94.6 were closed before this freeze. Result: **5 of 8 children delivered, 3 open with live
defects**. The epic therefore stays open, and the freeze covers the guarantees listed in §1, not "N3 is complete".

**Coordinator correction recorded here as a lesson:** an earlier coordinator note claimed `94.8` and
`SPECIALISTS-108` were duplicates. They are the same issue — the `94.x` numbering is a display relationship,
and the CLI prints canonical top-level refs on closure (closing `94.2` printed `SPECIALISTS-97`). The false
claim was retracted on the issue and the mapping is recorded on the epic.

## 7. The review pattern that carried this programme

Four times in this programme a reviewer found a claim that outran its own assertion, and each was fixed
before merge rather than after:

| Bead | Review finding | Consequence had it merged |
|---|---|---|
| 111 | three fail-open holes in the bounded enumeration guard (comment blindness, object-form filter, hard-coded file set) | the guard's oracle would have been enforced but unsound |
| 119 | the invariant header and code comment claimed a universal exact partition while the shipped endpoint drops the tail | a false contract reading would be quoted as an acceptance surface |
| 122 | `assertPersistedFields` was silently ignored on the `legacy-append` proof branch | a future entry could advertise field coverage that asserted nothing |
| 123 | the override case did not discriminate `requested_model` from `resolved_model` | the proof for the six model questions could not fail for its own defect |

The common shape is a test or document asserting a property that nothing in the artefact actually enforces.
A second, cheaper instance also recurred: the manifest could be narrowed silently (122), and the proof was
not wired into any gate (123) — both cases of an artefact being correct but unenforced.

## 8. Residual register

Severity is stated as: **blocking** (prevents a defensible freeze), **carried** (known, documented, does
not block), **deferred** (belongs to N4 or an owner outside this workstream).

| # | Residual | Severity | Owner |
|---|---|---|---|
| R1 | Telemetry matrix retains 1 `UNKNOWN` parity row (`CAP-TEL-050`) and 8 unknowns U-1..U-8, several unreachable from this repository | carried | N4 / owner named per unknown |
| R2 | No `N3.0..N3.10` ordered node sequence with per-node files, dependencies, acceptance tests and rollback | carried | N4 planning (the N0..N7 DAG is the actual structure) |
| R3 | Differential acceptance corpus is a design document; no `L-ADAPTER`/`N-ADAPTER`, so it cannot fail on an injected regression | deferred | N4 (largest unmet epic output) |
| R4 | SPECIALISTS-139 — no executed test for interleaved host retry→resume, or compaction-row attribution (correct by construction, unproven) | carried | filed follow-up |
| R5 | SPECIALISTS-140 — dead exported `nativeAttemptIdForNo` plus three telemetry statements still describing the removed advance | carried | filed follow-up |
| R6 | SPECIALISTS-150 — the resume-entry header's uniqueness qualifier is still overstated | carried | filed follow-up |
| R7 | SPECIALISTS-132 — producer-execution coverage: path coverage is representative, not a universal proof | carried | filed follow-up |
| R8 | Quarantined population: 47 annotated tests in `vitest.config.ts` plus 1 (unitAI-9n93); the quarantined supervisor suite is environment-contaminated here (38 failed / 18 passed, identical to its own baseline) | carried | pre-existing; N4 or a dedicated bead |
| R9 | One intermittent single-test failure observed in 1 of 6 full-suite runs at a reviewed head; the failing test's identity was lost to coordinator output truncation, so the cause is unestablished | carried | unowned; **plausibly the same host-load phenomenon as R13, but that instance cannot be proven retroactively** |
| R13 | Host contention corrupts local suite results: another agent session ran a deliberate sustained-load experiment (32 `yes` processes, load average 119.87) and reproduced failures in `tests/integration/sp-serve.test.ts`. Under that load a coordinator run failed 2 tests and an isolated re-run failed a different test in the same file, while the tree was clean and the diff could not reach that file | carried | operational: check `uptime` and `pgrep -x yes` before attributing a local suite failure to code, and prefer the CI job at the exact head as the authoritative suite gate |
| R10 | GitNexus is unusable for this worktree (index storage version 43 vs build 42). All impact claims in this programme are textual or structural, and method-level impact is **UNKNOWN**, not clean | carried | tooling |
| R11 | `beads-commit-gate.test.ts` cannot collect on a fresh checkout (imports untracked-at-HEAD `.xtrm/hooks/*.mjs`) | carried | environment/tooling |
| R12 | The build script does not prune stale `dist/types` for retired sources | carried | tooling |
| R14 | SPECIALISTS-153 — the telemetry gate does not trigger on the producer surface its proof guards (`native-host.ts`), so a reintroduced conflation would be caught by the unfiltered default suite rather than the path-scoped gate | carried | filed follow-up |
| R15 | SPECIALISTS-154 — the per-row key-set assertion is filtered through `DIAGNOSTIC_KEYS` while the wording says exact; novel per-row keys are caught only by the file-level union equality | carried | filed follow-up |
| R16 | Three fallback emit sites (`:1310`, `:2531`, `:2557`) remain fixture-uncovered; `:2531` needs write-tier lease contention | carried | filed follow-up |

## 9. What N3 does not establish

1. **No universal proof that the mapper enumerates everything.** The guard proves that emit sites in the
   scanned corpus are inventoried; R7 states the limit.
2. **The corpus proves what the store records, not that the timings describe real work.** The receipt's §5
   states this and the phase-accounting policy limit depends on it.
3. **`waiting_ms` and `xtrm_job_wait_seconds` now measure activation-bounded waiting, not wall-clock
   waiting.** A parked activation whose only later evidence is an operator read reports zero. This is a
   deliberate policy undercount, recorded in the code comment, the invariant header and the receipt.
4. **Attempt identity's store-observed entry point for post-settle legs remains unestablished.** Zero
   `activation_resumed`/`activation_retried` rows exist store-wide at measurement time. The fix is correct
   regardless of which entry point advances the host id, which is why this does not gate it.
5. **Reader-produced event classification is heuristic.** A future reader row that omits the `status-load`
   fields would be treated as job-produced. No test guards that drift (R3-adjacent).
6. **The differential corpus is not executable**, so no cross-engine differential acceptance has been run
   as a suite (R3).
7. **Method-level graph impact is UNKNOWN throughout** (R10).

## 10. N4 handoff

N3's freeze does **not** authorise N4 implementation. The following are preconditions and first-node
candidates, recorded so that N4 does not inherit N3's open items silently.

Preconditions before N4 starts:

- R3 must be decided: either build the differential adapters or formally retire the corpus as a design
  document. It is the largest unmet epic output and N4 is the natural owner.
- R1's remaining unknowns must be closed or re-owned, at minimum U-1 (another package), U-2 (xtrm
  monorepo) and U-5 (substrate ownership), each of which needs a repository N3 could not read.
- The epic's success item 5 discriminator question must be answered explicitly: build it, or record the
  decision that the reader-side resolution replaced it.

First-node candidates, in dependency order:

1. Differential acceptance harness (R3) — the missing executable acceptance surface.
2. Attempt/identity completion: R4's interleaved retry→resume and compaction attribution tests.
3. Producer-execution coverage (R7) — turning representative coverage into a stated, bounded proof.
4. Consumer migration off deprecated shapes: the `_total` naming decision and the retained `activation`
   family, both of which are recorded as open decisions in `n3/README.md` §6.

Open decisions from `03`/`n3` not yet made (each is a decision, not a defect):

| Decision | Status after N3 |
|---|---|
| Attempt identity across engines (synthesise a legacy resume boundary vs compare legs as turns) | **partly made**: attempt semantics fixed and oracle-enforced; the legacy-side synthesis remains open |
| Extension telemetry (establish a surface vs record non-retention) | **made**: non-retention, operator ruling, recorded in the deliberate list |
| Refusal vs failure (`activation_rejected` vs `activation_failed` share one terminal body) | **open** |
| Retired `activation` family (exclude vs surface separately) | **open** |
| `_total` naming (boundary observation vs running total) | **open** |
| Retention per table | **open** |

## 11. Reproduction

```bash
# frozen baseline
git log origin/master --oneline --merges | head -10

# the epic's open children, with canonical refs
sb issue list --search "XTRM-93 N3" --all

# enforcement
gh pr checks <pr>          # canonical-oracle, bun-sqlite, telemetry-contract, payload-contract, packed-smoke

# corpus measurements behind the phase-accounting decision
cd docs/migrations/xtrm-93/n3/coordinator/laned
python3 policy.py && python3 laned3.py && python3 reader-terminal-population.py

# oracle
bun --bun vitest run tests/unit/specialist/supervisor-canonical-oracle.test.ts
```

A materially different result from the corpus scripts means the live store moved; re-record the epoch
before quoting any figure from the receipt. Before attributing a local suite failure to code on this host,
check `uptime` and `pgrep -x yes` for a concurrent load experiment (R13).

## Addendum A (2026-09-19): post-freeze N3 child closures and audit corrections

Base: `origin/master` at `fb830d44` (PR #408 merge). This addendum corrects three
stale statements in the frozen record above; it does not rewrite history — the
freeze assessment was correct at `1ff421c2`.

1. **§6 row 94.1 is stale.** SPECIALISTS-95 (harness classification) is CLOSED
   (commit `4edf222e`, classification doc
   `docs/migrations/xtrm-93/n3/SPECIALISTS-95-classification.md`). The "empty
   `node:child_process` mock" premise was already repaired in `7243e534`
   (real-surface re-export; only `spawn` stubbed, `spawnSync`/`execFileSync`
   real), and the mock-signature failure count is zero in both directions.
   The 38/18 quarantined count is now fully attributed (24 file/DB split, 4 +
   2 positional drift at slots 10/11 and 8/9, 5 stale doubles/assertion drift,
   2 production divergence, 1 shared-store bleed) with Mechanism E traced to
   its exact bind site. Residual: the 24-test sqlite-assertion rewrite is a
   dedicated repair node; follow-ups filed as SPECIALISTS-4202/4203/4204;
   SPECIALISTS-100 (already open) covers the shared-store case.
2. **§6 rows 94.7/94.8 are stale.** SPECIALISTS-107 + SPECIALISTS-108 are
   CLOSED (PR #408, `0f6fb9c` → `fb830d44`): native `specialist_job_metrics`
   rows are now written by the forensic-sink terminal hook and `elapsed_ms`
   accumulates per round instead of overwriting.
3. **§8 R8 count is stale.** The quarantined supervisor count remains 38/18,
   but it is no longer "environment-contaminated ... identical to its own
   baseline" as an unexplained noise floor — see (1). The count is now an
   attributed register, not an unknown.
