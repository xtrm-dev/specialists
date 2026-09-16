# T0e — The phase accumulator silently drops any unterminated phase (coordinator-verified)

Origin: lane T4 reported a worked example where a resumed native activation reports `active 10s, waiting 0s`
against a semantic `active 30s, waiting 20s`, i.e. **both** intervals undercount — contradicting the brief's
statement that `waiting_ms` *absorbs* the post-settle interval. The coordinator traced the accumulator to
find out which is right. Both are, and the underlying defect is a third thing neither stated.

Tree: `feature/xtrm-93-n0n2-recon` @ `553b5a23`. Source: `src/specialist/observability-sqlite.ts`.

## 1. The accumulator

```ts
2885:  let activeRuntimeMs = 0;
2886:  let waitingMs = 0;
2887:  let phase: 'running' | 'waiting' | null = null;
2888:  let phaseStartedAtMs: number | null = null;
2890:  const closePhase = (endAtMs: number): void => {
2891:    if (phase === null || phaseStartedAtMs === null || endAtMs < phaseStartedAtMs) return;
2892:    const durationMs = endAtMs - phaseStartedAtMs;
2893:    if (phase === 'running') { activeRuntimeMs += durationMs; } else { waitingMs += durationMs; }
2898:  };
```

Phase is opened by `run_start` (`:2921-2925`) and by any `status_change` whose status is `running` or
`waiting` (`:2928-2932`). It is closed only by a subsequent `status_change` (`:2929`, `:2935`) or by
`run_complete` (`:2943`).

`closePhase` is called at **exactly three sites, all inside the event loop**. There is **no post-loop
flush**. After the loop the code back-fills the completion timestamp:

```ts
2955:  if (startedAtMs !== null && completedAtMs === null) {
2956:    completedAtMs = events.length > 0 ? events[events.length - 1]!.t : startedAtMs;
2957:  }
```

That back-fill feeds `elapsed_ms`. It does **not** close the open phase.

## 2. Consequence

**Any interval that is still open when the event stream ends is silently lost from both
`active_runtime_ms` and `waiting_ms`, while `elapsed_ms` remains correct.**

So `active_runtime_ms + waiting_ms <= elapsed_ms` holds trivially, but the sum can be far below elapsed,
and the split is wrong. Nothing errors, nothing is logged, no column is null — the numbers just shrink.

## 3. Both accounts were right, about different cases

The native mapper emits `activation_settled` → `createStatusChangeEvent('waiting', 'running')`. The factory
signature is `createStatusChangeEvent(status, previousStatus?)` (`timeline-events.ts:811-821`), so that row
is `{status:'waiting', previous_status:'running'}` — it **closes the running phase and opens the waiting
phase**. Verified by reading the signature, not by inferring from the argument order.

| Case | What the accumulator produces |
|---|---|
| Native activation settles into the parked/resumable state and the stream ends there | The waiting phase opens at settle and is **never closed** → `waiting_ms = 0`. The whole parked interval vanishes. `active_ms` still counts only the first leg. → **both undercount** (T4's example). |
| Native activation settles, is resumed, and later reaches a terminal `run_complete` | Waiting closes at the terminal → `waiting_ms` spans the entire resumed leg → **waiting absorbs it** (the brief's example). |

## 4. This is a LEGACY defect too, not a native divergence

`aggregateJobMetrics` is shared. Any job — legacy included — whose event stream ends while a phase is open
loses that interval the same way. The brief framed this as a native phase-machine divergence; the shared
defect underneath it is wider.

## 5. What N3 must therefore do — two fixes, not one

1. **Flush the open phase after the loop**, using the same back-filled `completedAtMs` the `elapsed_ms`
   path already computes. Without this, adding a running re-entry edge merely moves the interval from one
   dropped bucket to another.
2. **Add the running re-entry edge for resume** so the split is correct rather than merely complete. The
   brief and T4 agree on this; it is necessary but not sufficient.

Doing (2) alone leaves the parked interval uncounted. Doing (1) alone makes the totals honest but keeps the
resumed leg misattributed to waiting.

## 6. Acceptance consequence

The brief's lifecycle check — *"show that active_runtime_ms and waiting_ms sum to no more than wall clock
AND that active_runtime_ms is not under-counted by the post-settle interval"* — is **not sufficient**. The
"no more than wall clock" half is satisfied today by the very bug being fixed, because dropping intervals
only ever makes the sum smaller. The check must instead be:

- `active_runtime_ms + waiting_ms` accounts for **every** second between `started_at_ms` and the last
  event, with the residual attributable to a named third state (not silently absent);
- for a sequence `run_start → settle → resume → settle → terminal`, the resumed leg lands in `active`;
- and a job whose stream ends mid-phase still reports the open phase, proving the flush exists.

A test that only asserts `active + waiting <= elapsed` passes against the current defect and must not be
accepted as the regression.

## 7. Not established

- Whether any consumer already compensates by reading `elapsed_ms` instead. Not investigated.
- How many stored `specialist_job_metrics` rows are currently affected. The 748-row trajectory population
  was measured for T0c; the phase population was not.
