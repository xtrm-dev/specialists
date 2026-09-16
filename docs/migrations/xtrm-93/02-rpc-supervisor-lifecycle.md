# XTRM-93 — 02: Legacy RPC / Supervisor Lifecycle (Lane B)

> Scope: the legacy `sp run` execution engine, reconstructed from source on worktree
> `specialists-xt-pi-akkh` (HEAD `6553ef05` = master `472b1aef` + local `rx1bu`).
> Graph evidence: GitNexus index for the worktree path, `gitnexus status` = up-to-date at
> `6553ef0`. All `file:line` citations are against that tree.
>
> Companion artifact: `docs/migrations/xtrm-93/state-machine-delta.md` (delta table, true
> gaps, blocking gaps, UNKNOWNs, unrelated findings).

---

## a) Lifecycle narrative

### a.1 Entry and admission (`sp run`)

`sp run` lands on `run()` at `src/cli/run.ts:1654`. The order is:

1. `parseArgs` (`src/cli/run.ts:127`) reads `--prompt` (:160), `--bead` (:161), `--model`
   (:162), `--context-depth` (:163), `--no-beads` (:164), `--no-bead-notes` (:165),
   `--keep-alive` (:166), `--no-keep-alive` (:167), `--background` (:170), `--json`/`--raw`
   (:171-172), `--worktree` (:173), `--job` (:182), `--force-job` (:183), `--epic` (:184),
   `--base-sha`/`--base-ref` (:185-186), `--accept-stale-base` (:188), and the deprecated
   `--force-stale-base` alias (:189-193). `--no-worktree` is a hard error (:174-181).
2. Specialist spec is loaded (`src/cli/run.ts:1658`).
3. Worktree policy (`src/cli/run.ts:1663-1680`): `permission_required` MEDIUM/HIGH plus
   `requires_worktree` (default true) auto-provisions. An edit-capable specialist with no
   `--bead` and no `--job` is refused (`:1674-1680`).
4. Active-job pre-flight (`src/cli/run.ts:1692-1711`): a starting/running/waiting job for
   the same bead+specialist is refused before any child is spawned.
5. Runtime origin is captured *before* the background branch (`src/cli/run.ts:1719-1721`)
   so a detached child inherits the invoking pane, not its own `sp-*` feed pane.
6. `launchSpecialist` (`src/specialist/launch.ts:62`) builds a `SpecialistRunner`
   (`:64`) and `Supervisor` (`:71`), sets a `bd kv` bead-claim in the worktree
   (`:127-137`), and calls `supervisor.run()` (`:144`). In the foreground this call blocks
   until the terminal state; the `bd kv` claim is cleared afterwards (`:153-163`).

### a.2 Background vs foreground launch

`--background` is handled entirely in the parent before `launchSpecialist`
(`src/cli/run.ts:1724-1877`):

- With tmux available, the parent creates a tmux session running a live feed plus the
  re-invoked `sp run` without `--background` (`src/cli/run.ts:1749-1761`).
- Without tmux, it spawns a fully detached child (`src/cli/run.ts:1764-1786`).
- The parent then polls `.specialists/jobs/latest` and the tmux handoff file for the new
  job id, up to 15 s (tmux) or 5 s (plain) (`src/cli/run.ts:1790-1816`).
- It prints exactly one launch line (`formatBackgroundLaunchLine`, `src/cli/run.ts:94`)
  and exits (`:1876`). Under `--json` that line is
  `{"schema":"specialists.background_launch.v1","type":"job_started",...}` (:103-112),
  deliberately *not* a `session`/`agent_start` pi stream.

Foreground launch is the same code path minus the parent-side detach: `supervisor.run()`
returns the job id only after the terminal state, and `launchSpecialist` prints the footer
from the persisted status (`src/specialist/launch.ts:171-183`). The foreground process
owns the job; the background process owns the job and the parent is a launcher.

### a.3 Creation, admission and job creation (`Supervisor.run`)

`Supervisor.run()` (`src/specialist/supervisor.ts:1431`):

1. `gc()` and `crashRecovery()` run first (`:1434-1435`).
2. Job id is `crypto.randomUUID().slice(0, 6)` (`:1437`) — six lowercase hex chars.
3. `startup_context` is assembled from run options and variables (`:1450-1481`); spawn
   origin precedence is resolved (`:1501-1505`) per spec §13.4.
4. `initialStatus` is written with `status: 'starting'` (`:1507-1549`), pid = this
   supervisor process (`:1512`), lineage defaults `chain_kind` chain/prep (`:1521-1527`).
5. A detached status watchdog is started (`:1550`, script at `:664-758`) whose only
   transitions are self-exit when the supervisor pid dies or the job reaches done/error.
6. `.specialists/jobs/latest` is updated when file output is on (`:1552-1554`), and
   `onJobStarted` fires (`:1555`) — this is the hook that writes the background handoff
   file (`src/specialist/launch.ts:117-120`).
7. `run_start` is appended (`:1629-1633`). When `permissionRequired` is defined and not
   `READ_ONLY`, `--force-job` is absent and a bead is bound, `claimJobStart` is the
   transactional admission gate (`:1634-1647`); otherwise `upsertStatusWithEvent` is used
   (`:1648-1656`).
8. A named FIFO `steer.pipe` is created for cross-process control (`:1660-1666`).
9. A 10 s stuck-detection interval is registered (`:2095-2184`) and a one-shot `SIGTERM`
   handler is installed (`:2186-2212`).
10. `runner.run(...)` is awaited with `onProgress`, `onEvent`, `onMetric`, `onMeta`,
    `onKillRegistered`, `onSessionRegistered`, `onBeadCreated`, `onSteerRegistered`,
    `onResumeReady`, `onToolStart`, `onToolEnd` callbacks (`:2219-2682`).
11. Success path writes `status: 'done'` (`:2867-2879`), a final `run_complete`
    (`:2890-2905`), notifies the parent (`:2910`) and returns the id. Failure path writes
    `status: 'error'` (`:2922-2929`), a `run_complete` with `ERROR` (`:2947-2956`) and
    rethrows (`:2978`). `finally` clears intervals, removes the handler, kills the
    watchdog, closes the FIFO, fsyncs events, removes the pipe, kills a tmux session if
    present, and disposes (`:2979-3009`).

### a.4 Prompt composition, skills, mandatory rules, extensions, tools, model, thinking

`SpecialistRunner.run()` (`src/specialist/runner.ts:1039`):

- Spec load (`:1080`); model chain (`:1086-1088`, `resolveModelChain` at
  `src/specialist/model-chain.ts:7`); `initialModel` via `selectAvailableModel`
  (`:1090`, definition at `:970-979`).
- Permission level and keep-alive resolution (`:1093-1097`); `--no-keep-alive` wins over
  `--keep-alive` (`:1095-1097`).
- Extension selection (`:1098`, `resolveExecutionExtensionSelection`); resolved tool
  contract (`:1100-1107`); `$resolved_tool_contract` injected into variables
  (`:1109-1112`).
- `pre_render` hook (`:1114`) then `validateBeforeRun` (`:1123`, definition `:370-451`).
- Pre-phase scripts run locally before any session; a required failure throws
  `RequiredPreScriptError` (`:1129-1136`).
- Task prompt is rendered once via `renderTaskPrompt` (`:1160-1176`); mandatory-rules
  budget failure is turned into a `mandatory_rules_injection` meta event and rethrown
  (`:1177-1195`).
- `post_render` hook (`:1210`); output contract schema resolution (`:1217-1220`);
  `buildSystemPrompt` (`:1222-1235`) producing the system prompt and the static/memory/
  gitnexus token split (`:1237-1249`).
- Skills: `prompt.skill_inherit` plus `skills.paths` become `--skill` flags
  (`:1281-1283`; applied at `src/pi/session.ts:1136-1138`).
- Mandatory rules metadata event (`:1251-1279`); payload breakdown (`:1301-1304`).
- Bead binding or creation (`:1323-1331`); `onBeadCreated` fires before the session
  starts (`:1330`).
- Per-run env (`SPECIALISTS_NODE_ID`, `SPECIALISTS_JOB_ID`) (`:1352-1355`).

Model selection, thinking, tools and extensions are ultimately enforced by the pi
subprocess argv in `PiAgentSession.start()` (`src/pi/session.ts:1090`):
`--mode rpc`, resource fence head/tail (`:1103-1112`), provider or `--model`
(`:1094-1096`), `--no-session`, `--offline` unless disabled (`:1108-1109`), `--tools`
from the resolved contract (`:1114-1128`), `--thinking` (`:1131-1133`), `--skill`
(`:1136-1138`), curated `-e` extensions (`:1143-1149`), de-duplicated dynamic extension
sources (`:1150-1163`), system prompt append/replace (`:1165-1168`), worktree-boundary
extension (`:1170-1176`), read-line-numbers extension (`:1183-1184`), and the extension
tool-policy gate (`:1189-1190`). The process is spawned detached so the whole subtree can
be group-SIGKILLed later (`:1205-1215`).

### a.5 Running, waiting, keep-alive, steer, resume, retry, stop

- Running: every session event resets silence and writes `status: 'running'`
  (`src/specialist/supervisor.ts:2236-2251`).
- Waiting (keep-alive): `onResumeReady` sets `keepAliveSession = true` and calls
  `setWaitingStatus()` (`:2595-2601`); `agent_end` on a keep-alive session also parks in
  waiting (`:2241-2243`); `setWaitingStatus` writes `current_event: 'waiting'` and a
  `status_change` (`:1613-1626`).
- Steer: a FIFO reader is wired on `onSteerRegistered` (`:2540-2594`); a `steer` line is
  forwarded to `session.steer` (`:2564-2570`), which sends the pi `steer` RPC
  (`src/pi/session.ts:1797-1805`).
- Resume: a `resume` FIFO line calls `handleResumeTurn` (`:2571-2575`), which sets
  `running`, emits `resume_consumed`, calls the runner's `resumeFn`
  (`:1971-2039`). `resumeFn` is `session.resume` (`src/specialist/runner.ts:1453-1456`),
  which resets done state and re-prompts the *same* pi process
  (`src/pi/session.ts:1823-1838`).
- Retry: `sp retry` never mutates a job; it re-dispatches `sp run` with `--bead` and
  `--job` (`src/cli/retry.ts:63-68`), gated to `error`/`cancelled` (`:15`, `:56-61`).
- Stop: `sp stop` reads the job, reaps an orphaned pid if the registry says terminal but
  the process lives (`src/specialist/control.ts:70-100`), finalizes a waiting job
  (`:107-113`), marks the terminal status *before* signalling (`:143-150`), escalates to
  group SIGKILL on `--force` (`:151-159`), kills the tmux session (`:176-180`) and closes
  the bead unless siblings are live (`:182-195`).
- Finalize: `sp finalize` requires a reviewer PASS in the chain, then closes every
  waiting chain member through `finalizeWaitingJob`
  (`src/specialist/control.ts:201-253`).

### a.6 Failure, orphan recovery, cleanup

Failure surfaces at three layers: the pi session (`StallTimeoutError`, `SessionKilledError`,
backend errors, `src/pi/session.ts:2-12`), the runner (fallback/retry, bead close,
`src/specialist/runner.ts:1473-1493`), and the supervisor (`run()` catch,
`src/specialist/supervisor.ts:2918-2978`). Orphan recovery is four independent sweeps:
`crashRecovery` on every `run()` (`:1336-1425`), `reconcileDeadStatus` on every
`readStatus` (`:975-1008`), `loadStatuses` event/pid reconciliation
(`src/specialist/status-load.ts:266-337`), and the out-of-band
`collectStaleSpecialistJobs` (`src/specialist/process-health.ts:394-491`) plus
`auditDeadJobs` (`src/specialist/dead-job-audit.ts:33-95`). Cleanup is the `finally`
block at `src/specialist/supervisor.ts:2979-3009`.

---

## b) Legacy state machine

Declared states, `SupervisorJobStatus` (`src/specialist/supervisor.ts:115`; mirrored by
`TimelineEventStatusChange.status`, `src/specialist/timeline-events.ts:230-235`):
`starting`, `running`, `waiting`, `done`, `error`, `cancelled`. Six states.

### b.1 Transitions

| # | From | To | Trigger | Guard / condition | Owner (module) | Persisted |
|---|------|----|---------|-------------------|----------------|-----------|
| T1 | (none) | `starting` | `Supervisor.run()` allocates id, builds `initialStatus` | always | `src/specialist/supervisor.ts:1437-1549` | `status.json`, SQLite `upsertStatus`, `run_start` |
| T2 | `starting` | `running` | first pi session event via `onEvent` | not (`keepAliveSession` and `agent_end`) | `src/specialist/supervisor.ts:2236-2251`; also `handleResumeTurn:1976` | `status.json`, SQLite upsert, `status_change` |
| T3 | `running` | `waiting` | `onResumeReady` / keep-alive `agent_end` / end of first turn | keep-alive session active and not read-only auto-close | `src/specialist/supervisor.ts:1613-1626, 2241-2243, 2595-2601, 2779` | `status.json`, `status_change` |
| T4 | `running` | `done` | `runner.run` resolves | output defined, keep-alive not active (or auto-close / PASS finalize) | `src/specialist/supervisor.ts:2867-2905` | `status.json`, `result.txt`, `run_complete` COMPLETE |
| T5 | `waiting` | `running` | FIFO `{type:"resume",task}` consumed | `resumeFn` registered | `src/specialist/supervisor.ts:1971-1986, 2571-2575` | `status.json`, `resume_consumed` |
| T6 | `waiting` | `done` | `finalizeWaitingJob`, keep-alive close, waiting auto-close | threshold/operator | `src/specialist/supervisor.ts:1091-1123`; `src/specialist/control.ts:201-253`, `:107-113` | `status.json`, `status_change`, handoff |
| T7 | `waiting` | `error` | `closeKeepAliveSession` forced termination | graceful close timeout + `killFn` available | `src/specialist/supervisor.ts:2069-2080, 2139-2169` | `status.json`, `run_complete` ERROR |
| T8 | `running` | `error` | thrown error, silence-error threshold, backend error | silence > `running_silence_error_ms`, or `run()` catch | `src/specialist/supervisor.ts:2111-2117, 2918-2978` | `status.json`, `run_complete` ERROR |
| T9 | `starting`/`running`/`waiting` | `error` | dead pid or dead tmux session detected | `isJobDead` and status is starting/running; waiting only warns | `src/specialist/supervisor.ts:793-830, 975-1008, 1336-1425`; `src/specialist/status-load.ts:238-308` | `status.json`, `death.txt`, `dead_job_detected`, `run_complete` ERROR |
| T10 | `starting`/`running`/`waiting` | `done` or `cancelled` | external `updateJobStatus` from `sp stop` | terminal-not-already; `hasRunCompleteEvent` decides done vs cancelled | `src/specialist/control.ts:27-29, 143-150` | `status.json`, `status_change` |
| T11 | `error`/`cancelled`/`done` | (new job `starting`) | `sp retry` re-dispatch | status in `{error, cancelled}` and bead or worktree present | `src/cli/retry.ts:15, 55-68` | new job dir, new identity |

Additional non-status transitions: `waiting` + `waiting_stale_ms` silence emits a
`stale_warning` without changing status (`src/specialist/supervisor.ts:1411-1422`); `waiting` +
`waiting_auto_close_ms` triggers close (`:2119-2171`); a degenerate empty turn with no
tool calls triggers one nudge resume before parking (`:2743-2764`).

### b.2 Persisted representation

Every job gets `.specialists/jobs/<id>/` rooted at the git common root
(`src/specialist/job-root.ts:34-36`):

| Artifact | Written by | Gate |
|---|---|---|
| `status.json` | `writeStatusFileOnly` (`src/specialist/supervisor.ts:1254-1262`, atomic tmp+rename) | file output on unless SQLite-only path |
| `events.jsonl` | `appendTimelineEvent` (`src/specialist/supervisor.ts:1590-1603`) | `isJobFileOutputEnabled()` (`src/specialist/job-file-output.ts:15`) |
| `result.txt` | `src/specialist/supervisor.ts:1993, 2687`, `finalizeWaitingJob` path | file output |
| `steer.pipe` | `execFileSync('mkfifo', ...)` (`:1660-1666`), removed in `finally` (`:3003`) | best-effort |
| `death.txt` | `writeDeadJobArtifact` (`:836-847`) | best-effort |
| `latest` | `src/specialist/supervisor.ts:1552-1554`, read by the background parent (`src/cli/run.ts:1800`) | file output |
| observability SQLite | `upsertStatus` (`:1273`), `appendEvent` (`:1596`), `claimJobStart` (`:1635`), `upsertStatusWithEvent` (`:1649`, `:2958`), `upsertStatusWithEventAndResult` (`:2889`) | client present |

`readyDir()`/`writeReadyMarker` (`src/specialist/supervisor.ts:959-966`) exist but are **never called**
(only `mkdirSync(this.readyDir())` at `:1442`). That is dead code, recorded as an
unrelated finding.

### b.3 Identity

- `SupervisorStatus.id` — six-hex job id, minted at `src/specialist/supervisor.ts:1437`.
- `session_id` — pi session id, captured from `onMeta` (`src/specialist/supervisor.ts:2527-2532`) and
  reported by `PiAgentSession` (`src/pi/session.ts:1084`).
- Chain identity — `chain_id`, `chain_root_job_id`, `worktree_owner_job_id`,
  `trace_id`/`span_id` derived by `derivePersistedChainIdentity`
  (`src/specialist/chain-identity.ts:33`, applied `src/specialist/supervisor.ts:1223-1252`).
- There is no separate attempt identity on the legacy path. One job = one process = one
  pi session per model attempt; a fallback model reuses the job id and mints nothing.

---

## c) RPC command / event vocabulary actually used

`PiAgentSession` spawns `pi --mode rpc` as a subprocess and speaks JSONL over its
stdin/stdout (`src/pi/session.ts:1105`, `:1208-1215`). Commands are correlated by a
client-assigned numeric `id` (`:1633-1656`).

### c.1 Commands sent by the adapter

| Command | Sent at | Purpose |
|---|---|---|
| `prompt` | `src/pi/session.ts:1666` | first turn of a run |
| `steer` | `src/pi/session.ts:1801` | mid-run steering |
| `abort` | `src/pi/session.ts:1763` | best-effort abort inside `kill()` |
| `get_last_assistant_text` | `src/pi/session.ts:1697` | final output, 5 s race with in-memory fallback |
| `get_state` | `src/pi/session.ts:1712` | session state read, 5 s race, returns `null` on failure |

`follow_up` is declared but **not implemented**: `followUp()` throws
(`src/pi/session.ts:1814-1816`). The adapter never sends `set_model`,
`set_thinking_level`, `compact`, `set_auto_retry`, `bash`, `new_session`, `fork`,
`get_messages`, `get_commands`, or `get_session_stats`, although all are legal
(`pi/rpc/rpc-types.ts:18-67`).

### c.2 Events consumed by `_handleEvent` (`src/pi/session.ts:1375-1627`)

`response` (:1383); `message_start` (:1397); `message_end` (:1411); `turn_start` (:1423);
`turn_end` (:1428); `agent_end` (:1444, the run-completion boundary);
`tool_execution_start` (:1472); `tool_execution_update` (:1494);
`tool_execution_end` (:1498); `auto_compaction_start`/`end` (:1521);
`auto_retry_start`/`end` (:1538); `set_model`/`cycle_model` (:1557);
`extension_error` (:1568); and `message_update` (:1579) with nested
`assistantMessageEvent` types `text_delta` (:1583), `thinking_start` (:1589),
`thinking_delta` (:1592), `toolcall_start` (:1598), `toolcall_end` (:1603),
`done` (:1606), `error` (:1615).

### c.3 Protocol surface declared but not consumed

The vendored protocol reference `pi/rpc/rpc-types.ts` declares 30+ commands
(`:18-67`), the full response union (`:111-205`), and the extension UI
request/response sub-protocol (`:212-257`). The adapter:

- never handles `extension_ui_request` — no reference to it exists anywhere in
  `src/pi/session.ts`, so a curated extension calling a blocking `ctx.ui.*` dialog in RPC
  mode has no responder. The protocol notes confirm `ctx.hasUI` is `true` in RPC mode
  (`pi/pi-rpc.md:979`).
- consumes no `RpcExtensionUIResponse` path for the same reason.
- has no typed client: `pi/rpc/rpc-client.ts` and `pi/rpc/rpc-mode.ts` are pi's own
  reference implementation (they import `../../core/agent-session.js`) and **no file under
  `src/` imports `pi/rpc/*`**. Verified by text scan; the index exposes no edge because no
  edge exists.

### c.4 Adapter-internal event vocabulary

Beyond raw RPC events, `PiAgentSession` projects into `onEvent` names consumed by the
runner and supervisor: `message_start_assistant`, `message_start_tool_result`,
`message_end_assistant`, `message_end_tool_result`, `turn_start`, `turn_end`,
`agent_end`, `tool_execution_start`, `tool_execution_update`, `tool_execution_end`,
`text`, `thinking`, `toolcall`, `message_done`, `message_error`,
`auto_compaction_start`/`end`, `auto_retry_start`/`end`, `extension_error`
(`src/pi/session.ts:1400-1622`). Those map to timeline events through
`mapCallbackEventToTimelineEvent` (`src/specialist/supervisor.ts:2368`).

---

## d) Fallback / model-chain walk (legacy)

1. `resolveModelChain({...execution, model})` unless `--model` overrides the chain to a
   single entry (`src/specialist/runner.ts:1086-1088`; `src/specialist/model-chain.ts:7`).
2. `selectAvailableModel` returns the first circuit-breaker-available model, else the last
   entry (`src/specialist/runner.ts:970-979`). This value is used for hook metadata and
   `$backend_resolved` only; the loop starts at index 0.
3. The model loop iterates the chain (`:1357`). An unavailable circuit-broken model that
   is not terminal is skipped with a `fallback_step` event (`:1362-1365`).
4. For each model, the attempt loop runs `maxAttempts = maxRetries + 1`, where
   `maxRetries` = `options.maxRetries ?? execution.max_retries ?? 0` (`:1348-1349`).
   - Prompt, wait, output (`:1401-1405`).
   - Transient, non-rate-limit errors retry the same model with jittered backoff
     (`:1412-1419`; `getRetryDelayMs` `:460`, base 1 s, 20 % jitter `:453-454`).
   - Rate-limit is never retried on the same model; it falls through to the fallback walk
     (`:1408, 1412`).
   - Non-transient errors (auth, killed) throw immediately (`:1422`).
   - A transient failure on a non-terminal model records a circuit-breaker failure, emits
     `fallback_step` and kills the session (`:1424-1434`).
   - A transient failure on the terminal model emits a terminal `fallback_step` and throws
     (`:1426-1429`).
5. Error classes come from `classifyFallbackError` (`:981-989`): `auth`, `rate_limit`,
   `timeout`, `transient`, `unknown`, using the shared predicates in
   `src/utils/circuitBreaker.ts:55-` .
6. On success the breaker records success (`:1472`). In the catch path a real backend
   error records a failure unless already recorded (`:1476-1479`).
7. `fallback_step` events carry `attempt_n`, `model_tried`, `error_class`, `terminal`
   (`:991-1010`).

Semantics that must not be flattened: the legacy chain has a **per-model retry budget**
*and* a model fallback walk, and a rate-limit is explicitly not retried in place. The
native walk (`src/activation/native-host.ts:1732-1860`) has no per-model retry loop; it
runs one attempt per model and delegates transient retries to pi's own auto-retry. Rows
in the delta table record this.

---

## e) Stall detection (legacy)

Two independent layers plus sweeps:

| Layer | Threshold | Effect | Source |
|---|---|---|---|
| Pi session stall timer | `execution.stall_timeout_ms` | kills the session with `StallTimeoutError` | `src/pi/session.ts:1293-1307, 1345-1356`; wire-in `src/specialist/runner.ts:1378` |
| Test-command window | 300 s | extends the stall window while a `bash` test command runs | `src/pi/session.ts:54, 1478-1481, 1298-1301` |
| GitNexus impact window | 300 s | extends the stall window while `gitnexus_impact` runs | `src/pi/session.ts:55, 1482-1485, 1302-1304` |
| Supervisor `running_silence_warn_ms` | 60 s | `stale_warning` `running_silence` | `src/specialist/supervisor.ts:106, 2099-2105` |
| Supervisor `running_silence_error_ms` | 300 s | status `error`, kill session | `src/specialist/supervisor.ts:107, 2106-2117` |
| Supervisor `waiting_stale_ms` | 3600 s | `stale_warning` `waiting_stale`, status unchanged | `src/specialist/supervisor.ts:108, 1363-1374, 1411-1422` |
| Supervisor `waiting_auto_close_ms` | 0 (disabled) | closes the keep-alive session when > 0 | `src/specialist/supervisor.ts:109, 2119-2171` |
| Supervisor `tool_duration_warn_ms` | 120 s | `stale_warning` `tool_duration` | `src/specialist/supervisor.ts:110, 2172-2183` |

Defaults live in `STALL_DETECTION_DEFAULTS` (`src/specialist/supervisor.ts:105-111`); per-specialist
overrides arrive through `SupervisorOptions.stallDetection`
(`src/specialist/launch.ts:96`). The `waiting_auto_close` path is the only
stall-derived state transition (T7).

Native has no equivalent warn/error/auto-close ladder. `NativeActivationHost` updates
`snapshot.lastActivityAt` on every session event (`src/activation/native-host.ts:1443`) and exposes it
through `liveStats` (`:2145-2156`); the decision thresholds are left to the coordinator.

---

## f) Signal handling and crash recovery (legacy)

1. `Supervisor` installs a one-shot `SIGTERM` handler (`src/specialist/supervisor.ts:2186-2212`). If a
   keep-alive session is parked and holds unappended output, it writes a final
   `status: 'cancelled'` handoff block first (`:2193-2206`) and closes the session; a
   non-keep-alive run calls the registered `killFn` (`:2210`).
2. `PiAgentSession.kill` writes pi `abort`, rejects pending RPCs, sends SIGTERM, then
   schedules a group-SIGKILL after 8 s (`src/pi/session.ts:1757-1786`). `close()` sends
   stdin EOF and applies the same 8 s group-SIGKILL backstop (`:1728-1752`).
3. The process is spawned detached so the group kill reaps MCP children
   (`src/pi/session.ts:1205-1215`).
4. `sp stop` marks the terminal status before signalling, so a stop is observable even if
   the process ignores SIGTERM (`src/specialist/control.ts:143-159`); `--force` escalates
   to group SIGKILL and marks `error` (`:154-159`).
5. Crash recovery on the supervisor: `crashRecovery` marks dead-pid starting/running jobs
   `error` ("orphaned (parent supervisor died)") and emits waiting-stale warnings
   (`src/specialist/supervisor.ts:1336-1425`). `reconcileDeadStatus` does the same lazily on `readStatus`
   including `death.txt`, parent notification (`:975-1008`).
6. `loadStatuses` reconciles active rows from a terminal `run_complete` and re-notifies
   the parent (`src/specialist/status-load.ts:266-308, 318-337`).
7. Out-of-band sweeps: `collectStaleSpecialistJobs` classifies `dead-pid`,
   `orphaned-keep-alive`, `dead-toolchain`, `terminal-alive`
   (`src/specialist/process-health.ts:394-491`); `auditDeadJobs` cancels
   `container-restart-orphan` rows and emits a `dead_declared` forensic event
   (`src/specialist/dead-job-audit.ts:33-95`).
8. A detached status watchdog watches the supervisor pid and self-exits; it never moves
   the job (`src/specialist/supervisor.ts:664-758`).

Native signal behaviour is different in kind: `stop()` is cooperative
(`abort()` then `dispose()`, `src/activation/native-host.ts:2191-2215`) and the whole fleet lives in an
in-process `Map` (`src/activation/registry.ts:55-78`). There is no pid sweep, no tmux
kill, no detached watchdog, and no crash recovery for a dead host beyond the
authority-store rows (`src/activation/authority-store.ts:124-160`) and the persisted
settlement store.
