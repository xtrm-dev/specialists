# T0f — The extension-discovery telemetry surface does not exist (coordinator-verified)

Origin: lane T1 reported 18 emitted-but-undocumented drops. Verifying the enumeration mechanically surfaced
three of them in the extension path, and the consequence is larger than a missing gap-list entry.

Tree: `feature/xtrm-93-n0n2-recon` @ `553b5a23`. Store: `<git-common-root>/.specialists/db/observability.db`, read-only.

## 1. The enumeration, reproduced mechanically

Extracted from source rather than sampled:

```
emit(...) names in src/activation/native-host.ts        : 30
emit(...) names in src/activation/settlement-publication.ts : 10
union                                                   : 40
mapNativeLifecycleEvent case arms                       :  9
NATIVE_LIFECYCLE_OBSERVABILITY_GAPS                     : 21
NATIVE_SESSION_OBSERVABILITY_GAPS                       : 13
documented total                                        : 34

emitted but NOT mapped            : 33
  ...documented in a gap list     : 15
  ...UNDOCUMENTED (silent)        : 18
```

T1's headline is exact. The 18 undocumented silent drops:

```
activation_retried                      settlement_artifact_attached
extension_discovery_sessions            settlement_degraded
extension_tools_discovered              settlement_receipt_allocated
extension_tools_refused                 settlement_republish_deferred
lease_release_failed                    settlement_republish_error
mandatory_rules_injection               settlement_republish_reconciled
model_fallback                          settlement_republish_refused
tool_contract_unsatisfied_on_fallback   settlement_result_published
                                        settlement_store_failed
                                        settlement_stored
```

Ten are the `settlement_*` family (lane T9's scope), one is `model_fallback` (lane T5's), and **three are the
extension path**, which is what this note is about.

## 2. The extension signals are emitted and discarded

Emit sites: `src/activation/native-host.ts:1270` (`extension_discovery_sessions`), `:1315`
(`extension_tools_refused`), `:1322` (`extension_tools_discovered`).

The in-source comment immediately above `:1270` states:

> `// per activation. The `extension_discovery_sessions` forensic signal states that bound`

So the code asserts this is a forensic signal. It is not. Verified:

| Check | Result |
|---|---|
| any writer in `observability-sqlite.ts` or `forensic-sink.ts` | **none** |
| any DB table whose name mentions `extension` | **none** |
| forensic rows whose `event_name` mentions `extension` | **0** |
| any extension-ish `event_name` present at all | **none** |

There is no mapper arm, no gap-list entry, and no durable destination. The signals are dropped with no error,
no log and no null — the same silent-absence shape as the dead token metric and the settlement family.

## 3. This breaks the brief's §14 premise

The brief requires:

> `extension_discovery_sessions` must remain distinguishable from: real Specialist AgentSession,
> retry/fallback AgentSession, interactive resume session.

That instruction is unexecutable as written. "Must **remain** distinguishable" presumes a persistence
surface to preserve. **No such surface exists.** The requirement must be *established*, not preserved, and
T10's task is therefore materially different from the brief's framing: it is a design question — what
extension telemetry should exist, in which shared vocabulary — not a compatibility question.

## 4. What this means for the extension closeout's claims

The unitAI-1pqtl closeout lists extension safety/audit signals as part of the resolved workstream:
`extension_discovery_sessions`, extension admission/refusal, resolved sources, pinned tools, active-tool
verification, source attribution, `extension_tool_shadowed`.

The distinction that matters:

- The **decision** does leave a durable trace. A shadow refusal calls `reject('extension_tool_shadowed')`,
  and `activation_rejected` maps to `createRunCompleteEvent('ERROR', ...)`. So the operator can see *that*
  an activation was refused and can read the reason text on the terminal row.
- The **evidence** does not. Which tools were discovered, which were refused and why, what the discovery
  session was bounded to, and which base set the collision was computed against all go nowhere. A
  post-mortem cannot reconstruct the admission decision, only its verdict.

That is a narrower and more defensible statement than "extension telemetry is missing": the verdict
persists, the audit trail does not. It does not contradict the closeout's behavioural findings, which were
about which tools became active — and those were verified by fresh-process reproduction, not by telemetry.

## 5. Separate, verified, and already landed

`activation_rejected` and `activation_failed` both map to the same `createRunCompleteEvent('ERROR', ...)`
call (`native-activation-observability.ts:291-303`), so the **boundary between an admission refusal and an
execution failure is lost** at the terminal row. A refusal is an operational event — lease contention,
extension shadowing, an unsatisfied tool contract — and it currently reads as a run that failed. T1 found
this independently; it is confirmed here by reading both `case` labels and their shared body.

## 6. Consequence for the plan

1. **T10's contract must be rewritten** before it is dispatched, from "preserve extension telemetry" to
   "establish extension telemetry in the shared vocabulary, or record an explicit product decision that the
   discovery session's evidence is not retained". Either answer is acceptable; silence is not.
2. **N3.2 (native producer completion) must treat these 18 names individually**, not as a category. The
   settlement family and `model_fallback` have their own lanes with their own recommendations; the
   extension three do not, and would otherwise be swept up by whichever node touches the mapper first.
3. **The reject/fail conflation needs its own decision**, because it changes what an operator sees on a
   terminal row and therefore what `sp ps` / `sp log` report for a refused activation.

## 7. Not established

- Whether any extension signal is persisted by a path outside `src/` (a plugin, a wrapper, an out-of-tree
  consumer). No in-tree evidence exists either way.
- Whether the discovery-session bound is recoverable from the real session's own rows by inference. Not
  investigated; inference is not a substitute for a recorded fact.
