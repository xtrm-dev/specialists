# XTRM-93 N3 — telemetry parity: evidence, merged classification, corrections

Status: **swarm complete, matrix rebuilt from source.** This directory is the N3 evidence base. It supersedes
the telemetry conclusions in `../03-telemetry-observability.md`, `../telemetry-delta.md` and
`../09-go-no-go.md` wherever they conflict, and it lists every such conflict explicitly in §4.

| | |
|---|---|
| Measurement tree | `feature/xtrm-93-n0n2-recon` @ `553b5a23` (XTRM-93 N0/N2 merged onto master `2118b5a3`) |
| Master moved during this pass | A concurrent session pushed four commits to master: `40d7cbb7`, `458893c9`, `1007b459`, `73170716`. Two of them independently produced work this migration had in flight — see §3.7 and §3.9. The reconciliation was redone onto `73170716` as `e5b2a4f7`, and the N3 findings below were re-checked against it rather than assumed to carry over. |
| Store | `<git-common-root>/.specialists/db/observability.db`, 1.62 GB, queried read-only in place |
| Lanes | T1–T10, all complete, artifacts verbatim under `lanes/` |
| Coordinator evidence | `coordinator/`, written and verified by the coordinator |
| Programme issue | Substrate `SPECIALISTS-94`, contract revision 3 |

Every lane ran read-only. No lane modified the git tree.

## 1. The finding that governs everything else: silent absence

Four of ten lanes, from four different starting points, found the same failure shape: **a reader or classifier
exists, the producer or mapping does not, and nothing errors.**

**CORRECTION 2026-09-17 — every row below is now closed (living document; the original
measurement is preserved in the lane artifacts).** The silent-absence shape was real at
measurement time, and all four holes have since been fixed in source:

| Signal | Mechanism (at measurement) | Measured consequence (at measurement) | Status at `6530c226` |
|---|---|---|---|
| `xtrm_llm_tokens_total` | reader reads flat keys; the writer nests under `token_usage` | **0 series**, 748/748 rows confirm the shape (`coordinator/T0c`) | CLOSED by PR #377: the reader resolves nested `token_usage` first with flat fallback (`prometheus-projection.ts:442-458`) |
| `settlement_*` (10 names, 19 sites) | `mapNativeLifecycleEvent` `default: return null` | **0 durable rows**; degradation was stderr-only | CLOSED by PR #382 (mapper totality): each name has its own arm (`native-activation-observability.ts:407-455`) |
| `stale_warning` (native) | `createStaleWarningEvent` has no call site outside `supervisor.ts` | native `stall_gaps_json` is unconditionally empty | CLOSED by SPECIALISTS-102 / PR #387: the tool-duration checker emits object-form `name: 'stale_warning'` (`native-host.ts:2146`), persisted by the mapper (`native-activation-observability.ts:473-482`) |
| `model_fallback` (5 sites) | no mapper arm, absent from both gap lists | silently discarded | CLOSED by PR #382 (arm) + PR #384 (diagnostics): maps to `model.changed` preserving all seven diagnostic keys (`native-activation-observability.ts:390-405`) |

Plus, from the taxonomy lane, the generalised count: of **40 emitted lifecycle/settlement names**, only 9 have
mapper arms; **18 of the 33 unmapped names are absent from both explicit gap lists**
(`coordinator/T0f`).

**Why this is the governing finding:** it is invisible to differential testing. Running legacy and native side
by side yields "both empty", which reads as parity. A parity harness cannot detect a signal that neither
engine produces. Any N3 acceptance criterion built only on cross-engine comparison would therefore have
passed while these four holes were open — all four are now closed (see the correction above), so this
paragraph is the historical rationale for the mapper-totality work, not a current defect list.

## 2. Classification, recomputed

T1's rebuilt taxonomy over the canonical vocabulary:

| status | count |
|---|---|
| `PARITY` | 15 |
| `ADAPTER_NEEDED` | 4 |
| `NATIVE_GAP` | 22 |
| `LEGACY_GAP` | 0 |
| `SEMANTIC_DIVERGENCE` | 4 |
| `INTENTIONAL_DIFFERENCE` | 11 |
| `OBSOLETE_AFTER_CUTOVER` | 8 |
| **total canonical producible names** | **64** |

No row is `UNKNOWN`.

The audit's historical headline was 108 signals / 53 parity / 49 gaps / 13 blockers / 10 counting divergences.
**Those numbers are not comparable to this table** and should not be quoted together: the audit counted signal
*rows* across all lanes including metrics and CLI surfaces, whereas this table counts canonical *event names*.
What can be compared is which specific claims survived, and §4 lists the ones that did not.

**CORRECTION 2026-09-17 — this table predates PRs #382, #387 and #388 and is not recounted here
(a full 64-name recount is explicitly out of scope).** Known direction of movement since measurement:
PR #382 (mapper totality) converted the 18 undocumented silent drops into mapped arms (settlement_* ×10,
`model_fallback`, `activation_retried`, `lease_release_failed`, `mandatory_rules_injection`,
`tool_contract_unsatisfied_on_fallback`, extension_* ×3 deliberately unpersisted) plus a test-time
totality obligation, so `NATIVE_GAP` rows of that shape are now mapped or deliberately absent;
PR #387 added the native `tool_duration` stale-warning producer and mapper arm; PR #388 mapped
`activation_resumed` to `status_change('running','waiting')` and added the post-loop phase flush.
Quote the counts above only with this correction attached.

## 3. Verified defects, with the acceptance consequence of each

### 3.1 `sp ps` cannot enumerate activations — `unitAI-kmbb9`

`src/cli/ps.ts` passes a global `limit: 1000`, bounding raw event **rows**, not activations. Measured: the
window contains **3 of 259** activations while the noisiest single activation holds **7,804 rows** — 7.8× the
whole window. The fix, measured: a two-stage activation-oriented selection returns exactly the 10 requested
**including** 12-row and 29-row activations the current query can never reach. Plan is index-backed for the
range and sorts only the bounded activation set.

Filed as **`SPECIALISTS-94.3`** with the plan and the starvation regression. Evidence:
`coordinator/T0b-ps-enumeration.md`.

### 3.2 `xtrm_llm_tokens_total` has no series

Verified against 748/748 real rows counting the **last** element, because that is what the reader reads:
748 nested, 0 flat. Supersedes the audit's per-turn-vs-cumulative basis framing entirely — there is no basis
question when no series is produced for either engine.

Fixed and landed as **PR #377** (`SPECIALISTS-94.2`), CI-verified at the package-payload gate. Evidence:
`coordinator/T0c-llm-tokens-metric-dead.md`.

### 3.3 The phase accumulator silently drops unterminated phases

`closePhase` has exactly three call sites, all inside the event loop; the post-loop `completedAtMs` back-fill
feeds `elapsed_ms` only. Any phase open when the stream ends is lost from **both** `active_runtime_ms` and
`waiting_ms`, with no error and no null.

**The brief's acceptance check is insufficient and this matters more than the bug.** "active + waiting ≤ wall
clock" is satisfied *by the defect*, because dropping intervals can only shrink the sum. Corrected in the
parent contract at revision 3. Evidence: `coordinator/T0e-phase-flush.md`.

**CORRECTION 2026-09-17 — CLOSED by PR #388 (SPECIALISTS-106, Lane D).** The post-loop flush ships:
a phase still open at end-of-stream is closed at the last event's t (`observability-sqlite.ts:3069-3077`),
landing in the bucket named by the actually-open phase. The present-tense "silently drops" above is
HISTORICAL. Residual semantics — the flush target is the last event of ANY type (not the last
phase-relevant event), and null-phase windows stay unattributed — are documented in
`tests/unit/specialist/phase-accounting-invariant.test.ts` (I1-FLUSH).

### 3.4 The extension telemetry surface does not exist

`extension_discovery_sessions`, `extension_tools_discovered` and `extension_tools_refused` are emitted
(`native-host.ts:1270,1315,1322`) and discarded. Verified four ways: no writer, no table mentioning
`extension`, **zero** forensic rows whose `event_name` mentions `extension`, no extension-ish name at all.

The brief's §14 requirement that these "must **remain** distinguishable" presumes a surface to preserve. There
is none; that node is a design decision, not a compatibility question. Evidence:
`coordinator/T0f-extension-telemetry-absent.md`.

### 3.5 Resume and retry are distinguishable in native telemetry (corrected 2026-09-17)

**CORRECTION — the indistinguishable verdict below is HISTORICAL.** `activation_resumed` gained a mapper
arm in PR #388 (`native-activation-observability.ts:320-327`, resume re-enters running as
`status_change('running','waiting')`), and `activation_retried` has had one since PR #382: it shares the
`control_signal` carrier with its own action name (`native-activation-observability.ts:373-380`, forensic
`control.activation_retried.recorded`). A resume and a retry therefore leave distinct durable rows.
Original measurement, preserved for the record:

`nextAttemptId` was called on both paths (`native-host.ts:2383` and `:2726`); `activation_resumed` had no
mapper arm; `activation_retried` had none either. An operator watching `att:X:1 → att:X:2` could not tell
which happened. **The brief's §11 list was therefore judged unsatisfiable as written** — it requires
`resumed` and `retrying` as distinct covered states, and the two signals carrying that distinction were
the two that were dropped. (That judgment lapsed with the two mapper arms above.) The attempt-axis
observation in §3.6 stands: both paths still advance `attempt_id` through the identical function, so the
*attempt id alone* still does not distinguish them — the distinguishing signal is now the durable row,
not the attempt id.

### 3.6 The attempt axis is not comparable across engines

| engine | resume | retry |
|---|---|---|
| legacy | does **not** advance `attempt_id` | advances at `retry/start` |
| native | advances `attempt_id` | advances `attempt_id`, indistinguishably |

Legacy and native cannot be compared on the attempt axis without synthesising a legacy resume boundary or
comparing resume legs as turns. A design decision for the identity node.

### 3.7 `dist/` provenance — the rule was inverted

`bun.lock` pins `@modelcontextprotocol/{core,server}/node_modules/zod` to **4.5.4**; the main checkout drifted
to **4.6.2**, so its builds are rejected by the `package-payload` gate, which builds with
`bun install --frozen-lockfile`. At the time of measurement **`origin/master` was failing its own package-payload
gate** — unnoticed because that job triggers on `pull_request` only, never on `push`.

**UPDATE, and it is an independent confirmation:** a concurrent session landed `1007b459 chore(dist): rebuild
from the lockfile-resolved dependency set`, moving master's committed `dist/index.js` `fc02ac28` → `9e9a19eb`.
That blob is **byte-identical to the one a frozen-lockfile build of `2118b5a3` produced when this pass first
measured the drift**, so the finding was reproduced by a second party from a different direction, not merely
agreed with. Master's committed dist is now lockfile-compliant, and the CI gate accepts lockfile-faithful
bundles. **This paragraph's "master fails the gate" statement is therefore historical, not current.**

The artifact is defined by the **lockfile**, not by the checkout. Confirmed twice by CI accepting lockfile-faithful
bundles (PR #374 and PR #377). Corollary for every N3 node: rebuild `dist` on a lockfile-compliant **base**, or
the node's bundle diff absorbs the whole pre-existing zod correction — measured at ~221 hunks on a
non-compliant base versus **8 insertions / 7 deletions** on a compliant one. Evidence:
`../13-dist-provenance-correction.md`.

### 3.9 A new consumer now parses the activation-id format

Concurrent commit `40d7cbb7` renders the fleet row as `${specialist}:${activation_id.slice(4)}` in
`config/pi-extensions/specialist-subagents/index.mjs`, replacing a row that showed only the specialist name.

This is presentation-only and adds no telemetry signal, but it **does** introduce a consumer that assumes the
activation id's `act:` prefix is exactly four characters. Neither the audit nor this pass found any
representation-parsing consumer before this; the standing rule recorded for `job_id` and `attempt_id` was that
both are used as opaque keys, and `attempt_id` parsing was explicitly forbidden. This is the first exception,
and it is a silent-corruption risk rather than a loud one: a future change to the id grammar would mis-slice the
display without failing anything.

Recorded as a compatibility note for the identity node. It is not a defect in the current grammar.

### 3.8 `unitAI-9n93` — the legacy oracle

The Supervisor suite was unreachable by any configuration; on the reconciliation branch it is reachable and
**50 of 54 tests fail**. Root cause is exact: `tests/unit/specialist/supervisor.test.ts:22` installs an **empty**
`node:child_process` mock while `supervisor.ts:22` imports `spawn`/`spawnSync`/`execFileSync`. 48 of the 50
failures are that one cause. Evidence: `coordinator/T0-coordinator-infra.md`.

## 4. Audit and brief claims disproved or corrected by measurement

This section is the point of the exercise. Each row is a plausible statement that measurement overturned.

| # | Claim (source) | Measured reality | Where |
|---|---|---|---|
| 1 | Rebuild `dist` in the **main checkout** (unitAI-1pqtl closeout) | Inverted. The main checkout is the **drifted** host; the lockfile defines the artifact | §3.7 |
| 2 | `xtrm_llm_tokens_total` is per-turn for legacy, cumulative for native (audit TEL-D-014/C4) | The metric has **no series** for either engine. The proposed `aggregation` discriminator would not have fixed it | §3.2 |
| 3 | `waiting_ms` **absorbs** the post-settle interval (brief §11) | Both intervals undercount when a phase is left open; there is no post-loop flush — CORRECTED 2026-09-17: the flush ships (PR #388, `obs-sqlite:3069-3077`); this row is HISTORICAL | §3.3 |
| 4 | `extension_discovery_sessions` exists and must be preserved (brief §14) | Nothing is persisted. Zero rows, no table, no writer | §3.4 |
| 5 | `resumed` and `retrying` are distinct covered states (brief §11) | The distinguishing signals are both dropped; native resume ≡ retry — CORRECTED 2026-09-17: `activation_resumed` maps to running re-entry (PR #388) and `activation_retried` to `control.activation_retried.recorded` (PR #382); this row is HISTORICAL | §3.5 |
| 6 | The counting divergence is *between* engines (`total_turns`, tokens) | The token defect is a **shared** reader bug: `NATIVE_GAP` **and** `LEGACY_GAP`, not a divergence | §3.2 |
| 7 | Cardinality safeguards need preserving / "values are unchecked" (T8) | A 30-plus-name key denylist **already enforces** §19's rule. The residual is narrower: values are unbounded for a few allowlisted keys, and there is no series ceiling | `coordinator/T0d` |
| 8 | Native performs **zero git invocations** → "no longer holds" (T6) | The claim **still holds**. What changed is that native *records* a caller-supplied `baseCommit` — recorded-as-data is not resolved-by-git | `coordinator/T0d` |
| 9 | Historical settlement emit count is 11 (audit) | An **arithmetic error**: the enumerated set contains the same 10 names | `lanes/T9.md` |
| 10 | `sp ps` native block "renders empty" (audit D2) | It rendered **40 stale** entries, hiding everything current. The wrong fix — adding a filter — would have made it blind | `../11-cutover-prep-log.md` |

## 5. Cross-lane corroboration

Two independent lanes plus the coordinator converged on the same defect and remedy for `sp ps` (T2, T7,
coordinator), and two independent lanes converged on the token defect from different starting points (T3 from
the accounting basis, T8 from the metric inventory). That convergence is the strongest assurance available here,
because neither pair shared a method.

## 6. Open decisions this evidence creates

These are decisions, not defects. Each is stated so it is made deliberately rather than by whichever node
touches the code first.

1. **Attempt identity across engines** — synthesise a legacy resume boundary, or compare resume legs as turns?
2. **Extension telemetry** — establish it in the shared vocabulary, or record an explicit decision that
   discovery-session evidence is not retained? (The specific verdict already persists as a rejection; the
   admission *evidence* does not.)
3. **Refusal vs failure** — `activation_rejected` and `activation_failed` share one terminal body, so an
   admission refusal currently reads as a run that failed.
4. **Retired `activation` family** — exclude as obsolete, or surface separately? It must never be blended into
   current activations: 40 job_ids, 214 rows, zero attempt ids, frozen 2026-09-08.
5. **`_total` naming** — the token metric now reports a *boundary observation*, not a running total. Renaming is
   a consumer-compatibility decision.
6. **Retention** — the asymmetry is deliberate (forensic/metrics/node/membership/branch tables are never
   pruned) and the native stack's only durable answer surface is `specialist_forensic_events`. Decide it per
   table rather than inheriting it.

## 7. Method note

Every lane was read-only and every load-bearing claim was re-derived by the coordinator from source or from the
store before being written here. **Six of the claims checked were corrected or narrowed, one was confirmed
clean, and three converged.** The corrections in §4 are the highest-value output of this pass: each was a case
where a plausible statement would have directed implementation work at the wrong thing, and each check was
cheap.
