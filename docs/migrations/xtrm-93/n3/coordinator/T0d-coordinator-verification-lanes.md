# T0d — Coordinator verification of lanes T3, T4, T5, T9

Tree: `feature/xtrm-93-n0n2-recon` @ `553b5a23`. The coordinator re-derived every load-bearing claim below
from source rather than accepting the lane's citation. Results: **one lane claim corrected, three
confirmed.**

## T5 — the recommended canonical carrier does not exist  ❌ CORRECTED

**Lane recommendation:** represent `model_fallback` as a shared `fallback_step` event type.

**Verification:** there is no `fallback` token anywhere in `src/specialist/timeline-events.ts`. A
`fallback_step` type does not exist, is not in `TIMELINE_EVENT_TYPES`, and has no factory. Recommending it
would create a new type, not use a shared one — which is the opposite of what the lane's own reasoning
required.

**What does exist:** a genuine shared `model_change` type, already produced by the legacy path.

| Element | Location |
|---|---|
| type + closed `action` union | `src/specialist/timeline-events.ts:365-366` — `action: 'set_model' \| 'cycle_model'` |
| enum member | `src/specialist/timeline-events.ts:490` — `MODEL_CHANGE: 'model_change'` |
| Pi-event mapping | `src/specialist/timeline-events.ts:708-715` — `set_model` / `cycle_model` → `model_change` |
| legacy producer | `src/pi/session.ts:1529-1535` emits `{ type: 'model_change', ...modelChange }` via `onMetric` |
| legacy consumer | `src/specialist/supervisor.ts:2279` handles it, defaulting `action` to `set_model` |
| forensic classification | `src/specialist/forensic-events.ts:818` → family `model`; `:849` → event_name `model.changed` |
| CLI consumer | `src/cli/log.ts:52` allowlists `model_change` |
| contract type | `src/specialist/session-metrics-contract.ts:42` |

So the correct carrier is the **existing shared `model_change`**, not a new type.

**Constraint the lane did not surface:** `action` is a **closed union** in two places
(`timeline-events.ts:366`, `session-metrics-contract.ts:42`). Widening it to add `'fallback'` is a type
change that also widens the `event_json.action` value set, which the byte-compatibility register treats as
consumer-parsed. The additive-only option is therefore to **keep `action` unchanged and add a
fallback-specific field to the `model_change` payload** (for example `fallback?: boolean` plus `reason`),
preserving both the union and every existing value.

**Disposition:** T5's three-emit-meanings finding and its silent-drop confirmation stand and are useful.
Its canonical-carrier recommendation must be replaced by the above.

## T4 — confirmed, and stronger than the brief's framing  ✅

The brief asked whether the native watchdog emits `stale_warning` with a correctly-spelled `reason`. That
framing is too weak, and T4 did **not** fall for it.

Verified independently:

| Producer | Reasons emitted |
|---|---|
| `src/specialist/supervisor.ts:1255`, `:1303` | `waiting_stale` |
| `src/specialist/supervisor.ts:1988` | `running_silence` |
| `src/specialist/supervisor.ts:1994` | `running_silence_error` |
| `src/specialist/supervisor.ts:2064` | `tool_duration` |
| **native (`src/activation/native-host.ts`, `forensic-sink.ts`)** | **none — no `createStaleWarningEvent` call site exists outside `supervisor.ts`** |

The four spellings agree with the typed union (`timeline-events.ts:316`). The real defects are:

1. **`NATIVE_GAP`: native has no stall/watchdog producer at all.** So native `stall_gaps_json` is empty
   unconditionally, not because of a spelling mismatch. Confirmed: `grep -rn createStaleWarningEvent src/`
   yields only `supervisor.ts` callers.
2. **`LEGACY_GAP`: the aggregator accepts only `tool_duration`** (`observability-sqlite.ts:2953`), so three
   of the four legacy reasons never reach `stall_gaps_json`.
3. **New, not in the brief: `waiting_stale` bypasses `appendTimelineEvent`** (`supervisor.ts:1250-1260`,
   `1298-1308`) and is written directly to `events.jsonl`, so that path never enters SQLite. It is
   durable-but-unqueryable, which is worse than a gap for forensic reconstruction.

Also surfaced by T4 and worth carrying into the identity node: **legacy resume does not advance
`attempt_id`, while native resume does** (`registry.ts:81-90`, `native-host.ts:2383-2405`). Resume legs are
therefore not comparable across engines unless compared as turns or a synthetic legacy boundary is added.

## T9 — confirmed  ✅

**The `settled ≠ published` rule holds**, verified directly:

- `mapNativeLifecycleEvent` handles `activation_settled` as **only** `createStatusChangeEvent('waiting',
  'running')` (`native-activation-observability.ts:249-250`).
- `grep -c "settlement_" src/specialist/native-activation-observability.ts` = **0**. No settlement signal
  reaches the mapper, so publication success, degradation, retry and duplicate suppression leave **no
  durable trace** and cannot be conflated with a settle only because neither is recorded.

T9 also reconciled the count discrepancy it was steered on (historical 11 → current 10, §1 of its artifact)
and proved the settlement-store write sequence rather than asserting non-atomicity.

## T3 — confirmed and exceeded  ✅ (see T0c)

Already recorded. The lane's nested-vs-flat reader claim was verified at the call site and against 748/748
real rows, and it supersedes the audit's TEL-D-014/C4 basis framing entirely: the metric has no series to
have a basis.

## Cross-lane pattern worth naming

Three of four lanes independently found the same failure shape: **a classifier or reader exists, the
producer or the mapping does not, and nothing errors.**

| Finding | Shape |
|---|---|
| `xtrm_llm_tokens_total` | reader expects a shape the writer never emits → 0 series, no error (T3/T0c) |
| `settlement_*` (10–11 names) | emitter exists, mapper `default: return null` → 0 rows, no error (T9) |
| `stale_warning` native | aggregator and type exist, no native producer → empty silently (T4) |
| `model_fallback` | 5 emit sites, no mapper case, absent from both gap lists → dropped (T5) |

This is the strongest argument for the canonical-contract node in N3.0/N3.1: the migration's risk is not
wrong numbers, it is **silent absence**, which differential testing cannot see because both engines report
nothing and the comparison reads as parity.

---

## T8 — Prometheus / OTel, checked after the lane completed

### Confirmed: the token defect, from a second independent direction  ✅

T8 reached the flat-vs-nested token projection defect independently of T3. Two lanes converging on
`xtrm_llm_tokens_total` from different starting points — one from the accounting basis, one from the metric
inventory — is the strongest corroboration in this pass, and the coordinator then confirmed it against
748/748 real rows (T0c) and landed the fix (PR #377). Recorded as convergence, not as a second finding.

### Confirmed: OpenTelemetry is absent  ✅

There is no OTel SDK, no tracer, no span exporter. What exists is **named** OTel surface — `trace_id`,
`span_id`, `parent_span_id`, `otel` metadata blocks in the forensic envelope — i.e. correlation *fields*
shaped like OTel, with nothing emitting spans. A future reader could reasonably mistake the field names for
an integration. Worth stating plainly in the telemetry reference so it is not rediscovered.

### Corrected: "values are unchecked and no series-count ceiling exists"  ⚠️ PARTLY OVERSTATED

The mechanism, read directly:

```ts
// src/specialist/forensic-events.ts:443
export function pickAllowedLabels(source, allowlist = DEFAULT_LABEL_ALLOWLIST) {
  for (const [key, value] of Object.entries(source)) {
    if (!allowlist.has(key) || value === undefined || value === null) continue;
    labels[key] = String(value);          // <- value stringified with no bound
  }
  assertNoForbiddenLabels(labels);
}
// src/specialist/forensic-events.ts:436
export function assertNoForbiddenLabels(labels) {
  const forbidden = Object.keys(labels).filter(k => FORBIDDEN_PROMETHEUS_LABELS.has(k));  // KEYS only
  ...
}
```

So the lane is **right** that the generic path does not bound values, and **right** that there is no global
series-count ceiling.

But "values are unchecked" is too broad in two ways:

1. **Per-value normalisation does exist for at least one key.** `normalizeChainTemplate`
   (`prometheus-projection.ts:303`, applied at `:298`) bounds `chain_template` to 80 characters and maps a
   non-matching value to `_`.
2. **The key allowance IS the intended safeguard, and it directly enforces the brief's §19 requirement.**
   `FORBIDDEN_PROMETHEUS_LABELS` (`forensic-events.ts:158-189+`) is a 30-plus-name denylist that explicitly
   names `job_id`, `participant_id`, `session_id`, `turn_id`, `tool_call_id`, `trace_id`, `span_id`,
   `commit_sha`, `raw_path`, `raw_command`, `raw_error`, `raw_diff`, `prompt`, `model_output` and more.
   "Never put a high-cardinality activation id into a metric label" is therefore **enforced today**, not
   aspirational.

**The accurate statement:** the safeguard is a **key-level allow-and-deny list**, which is the correct
design and does enforce the brief's specific cardinality rule; it does **not** additionally bound
*values*, and there is no global series-count ceiling. The residual exposure is concentrated in the
value-carrying allowlisted keys — `model`, `tool_name`, `mcp_server`, `mcp_method`, `error_type`,
`deployment_environment` — where an unusual value flows straight into a label with no normalisation.

### Not yet verified from T8

- "8 forensic families are unreachable from shipped collectors" — plausible and specific, not checked by the
  coordinator.
- The dual-running double-count claim (legacy and native rows for the same logical work counted twice).
  The audit's TEL-D-C10 predicted it and noted `idx_jobs_active_bead_specialist` enforces uniqueness only
  for `status IN ('starting','running')` on `(bead_id, specialist)`. Not measured here.

---

## T7 — CLI consumers, checked after the lane completed

### Convergent, and it corroborates a node already filed  ✅

T7 audited all nine requested consumers with 126 citations and independently reached the same two
conclusions the coordinator had already verified and acted on:

| T7 conclusion | Coordinator state |
|---|---|
| `sp ps` limits 1000 **forensic rows**, not activation ids, and noisy activations starve quiet ones | Verified independently at T0b (3 of 259 activations returned; noisiest holds 7,804 rows) |
| Recommended fix: select latest activation **ids** first, then indexed event lookup | Already written into `SPECIALISTS-94.3` with the measured plan and the starvation regression |

Two lanes and the coordinator converging on the same defect and the same remedy, with the remedy reduced to a
concrete contract before T7 returned, is the strongest cross-check available in this pass. No correction
required.

### Confirmed: the window-count rename is complete and honest  ✅

The N2B rename was claimed for both `ps --json` and `feed --json`. Verified across the whole path:

- interface declares `window_event_count` / `window_turns` (`native-activation-summary.ts:26,28`)
- the projection populates them (`:196`, `:202`)
- both human renders label them in-window: `ps.ts:773` and `feed.ts:517` print "... events in window" /
  "... turns in window"
- no stale `event_count` / `turns` key survives in the JSON path
- `tests/unit/cli/native-activation-summary.test.ts` pins it

So the breaking rename is complete, labelled, and tested rather than half-applied with a lying old key left
beside it. The breaking-change surface for a consumer parsing the old names is real and already documented.

---

## T10 — extension / admission, checked after the lane completed

### Confirmed and extended: discovery sessions are not represented  ✅

T10 reached the same conclusion as T0f independently — discovery sessions are **not represented** durably. T0f
established the stronger form: all three extension signals are emitted and silently discarded, with no table,
no writer and zero rows in the store.

T10 adds the reason the leak has not caused damage: **discovery attribution is safe today only because fenced
sessions are never prompted and never subscribed — there is no explicit telemetry guard.** The safety is
*structural*, not *enforced*. That distinction is the important part: nothing would fail if a future change
began subscribing to the fenced session, so the current correctness is an invariant of the code's shape rather
than of an assertion. It should be recorded as such, and the §14 requirement remains unsatisfied even though
the practical risk is currently nil.

### Verified: native resume and native retry are indistinguishable in telemetry  ✅ — and this is the sharpest finding

T10 claimed resume is indistinguishable from the same-session retry. Confirmed at the mechanism:

- `nextAttemptId(record.snapshot.attemptId)` is called on **both** paths — `src/activation/native-host.ts:2383`
  and `:2726` — so a resume and a retry advance the attempt id through the identical function.
- `activation_resumed` appears **only in the gap list** (`native-activation-observability.ts:55`); it has no
  mapper case arm.
- `activation_retried` does **not appear in the mapper at all** — it is one of the eighteen undocumented
  silent drops enumerated in T0f.

So from durable rows alone an operator watching `attempt_id` go `att:X:1` → `att:X:2` **cannot tell whether
that was a resume or a retry.** The two lifecycle events that would distinguish them are both discarded.

This makes the brief's own §11 list unsatisfiable as written: it requires `resumed` and `retrying` as distinct
covered states, and the signals that carry that distinction are exactly the two that are dropped.

Combined with T4's finding, the attempt axis across engines is:

| engine | resume | retry | comparable? |
|---|---|---|---|
| legacy | does **not** advance `attempt_id` | advances at `retry/start` | — |
| native | advances `attempt_id` | advances `attempt_id` | **resume and retry look identical** |

Legacy and native therefore cannot be compared on the attempt axis at all without either synthesising a legacy
resume boundary or comparing resume legs as turns. That is a design decision, not a bug fix, and it belongs in
the identity node rather than being settled by whichever node touches the mapper first.

---

## T6 — git / worktree / reviewer / test evidence, checked after the lane completed

### Corrected: "zero-git-invocation claim no longer holds"  ⚠️ IMPRECISE

T6's headline says the audit's claim that the native path performs **zero git invocations** no longer holds.
Grepping `src/activation/` for `'git'`, `"git"`, `runGit`, `gitExec`, `readGit`, `resolveHead`, `'rev-parse'`,
`'merge-base'`, `'symbolic-ref'`, `execSync('git'`, `spawnSync('git'` and `execFileSync('git'` returns **no
matches**. The claim **still holds**.

What actually changed, and what T6 was sensing:

```ts
// src/activation/native-host.ts:1797-1798
...(typeof (binding as { baseCommit?: unknown }).baseCommit === 'string'
    && ((binding as { baseCommit?: string }).baseCommit as string).trim() !== ''
  ? { bindingBaseCommit: (binding as { baseCommit?: string }).baseCommit as string }
  : {})
```

Native now **receives** a `baseCommit` from the ExecutionBinding and **records** it, carrying it through
settlement publication onto the settlement workspace (`settlement-publication.ts:72-73,155-156,201-206,541-542`)
and `workitem-store.ts:283`.

**Recorded-as-data is not resolved-by-git, and the distinction is the whole point for evidence quality.** A
value supplied by the caller can be stale, wrong, or simply absent — the spread above is conditional, so it is
optional. A base commit resolved by git at dispatch time would be authoritative and independently checkable.

Note also that `specialist_jobs` carries **separate** `base_sha_pinned` and `base_sha_pinned_at_ms` columns
(`observability-sqlite.ts:630-631`) which the native path does not write. So the *pinned*-base evidence lives
on the legacy path, and native's recorded base is an unpinned caller assertion. When the identity node decides
how base/branch evidence should work, "we record a base commit" must not be read as "the base commit is
established".

### Confirmed: native's remaining git-axis gaps  ✅

Consistent with the above and with T0b/T2: native leaves no durable branch/HEAD pin, no PR drift, no
auto-commit, no normalised test evidence and no reviewer-verdict events. Legacy carries all of them. The one
native addition is the optional recorded base commit described above.
