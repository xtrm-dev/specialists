# XTRM-93 — Lane D: Persistence and Durable Identity

> **Status: LANE D AUDIT ARTIFACT — evidence only. This file modifies no source.**
> Scope: every durable artifact the legacy backend writes, every durable artifact the
> native runtime writes, and the **identity contract** between them — specifically what an
> external script can persist today and what still resolves after cutover.
>
> Related lanes: [`00-capability-matrix.md`](./00-capability-matrix.md),
> [`01-cli-surface.md`](./01-cli-surface.md),
> [`02-rpc-supervisor-lifecycle.md`](./02-rpc-supervisor-lifecycle.md),
> [`03-telemetry-observability.md`](./03-telemetry-observability.md).
> Lane C owns the *content* of `observability.db` rows; this lane owns the *stores, paths,
> keys and lifetimes*.

---

## 0. Method and verified baseline

| Fact | Value | How verified |
|---|---|---|
| Audit worktree | `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh` | `pwd` |
| Worktree HEAD | `6553ef05` (`fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch`) | `git log --oneline -3` |
| Upstream master | `472b1aef` (`test(parity): stop calling the contract quote a mechanical tie (#373)`) | `git log --oneline -3` |
| GitNexus index | **indexed for THIS tree.** `.gitnexus/meta.json` `lastCommit` = `6553ef05877a263384d6572980cc6e4affc3952a`; `gitnexus status` → `✅ up-to-date`; CLI 1.6.11 | `cat .gitnexus/meta.json`, `gitnexus status` |
| GitNexus usage | `impact resolveJobsDir` (ambiguous, 2 candidates, max 59 impacted, knownMaxRisk HIGH); `impact loadStatuses` (21 impacted, **CRITICAL**); `impact crashRecovery` (10 impacted, **CRITICAL**); `impact resolveAuthorityDbPath` (17 impacted, **CRITICAL**); `impact publishSettlement` (5, LOW); `impact republishOncePerProcess` (1, LOW); `impact writeReadyMarker` (0 impacted, risk **UNKNOWN** + `riskNote`) — the UNKNOWN was resolved by text search: `grep -rn writeReadyMarker src/` returns **only the definition**, so the symbol is genuinely uncalled, not merely unwalked | tool output + `grep` |
| Newest files under audit | `src/activation/settlement-store.ts`, `settlement-publication.ts`, `settlement-lease.ts` (SPECIALISTS-66, PR #372 / `c33b8e1b`) were **read directly from the worktree**, not via the index | `read` |

**Path aliases used in the tables** (kept short so every citation stays greppable):

| Alias | Path |
|---|---|
| `job-root` | `src/specialist/job-root.ts` |
| `sup` | `src/specialist/supervisor.ts` |
| `status-load` | `src/specialist/status-load.ts` |
| `job-file-out` | `src/specialist/job-file-output.ts` |
| `jobRegistry` | `src/specialist/jobRegistry.ts` |
| `obs-sqlite` | `src/specialist/observability-sqlite.ts` |
| `chain-id` | `src/specialist/chain-identity.ts` |
| `dead-audit` | `src/specialist/dead-job-audit.ts` |
| `authority` | `src/activation/authority-store.ts` |
| `workitems` | `src/activation/workitem-store.ts` |
| `types` | `src/activation/types.ts` |
| `registry` | `src/activation/registry.ts` |
| `wlease` | `src/activation/workspace-lease.ts` |
| `wreconcile` | `src/activation/workspace-reconcile.ts` |
| `sstore` | `src/activation/settlement-store.ts` |
| `spub` | `src/activation/settlement-publication.ts` |
| `slease` | `src/activation/settlement-lease.ts` |
| `sink` | `src/activation/forensic-sink.ts` |
| `host` | `src/activation/native-host.ts` |
| `pending` | `src/activation/transport/pending-store.ts` |
| `result` | `src/cli/result.ts` |
| `feed` | `src/cli/feed.ts` |
| `ps` | `src/cli/ps.ts` |
| `console-rt` | `src/cli/console/runtime.ts` |

### 0.1 Two structural facts that decide most of this lane

1. **The two runtimes share exactly ONE durable store: `.specialists/db/observability.db`.**
   Native and legacy both write `specialist_jobs` / `specialist_results` /
   `specialist_forensic_events` through the same writer (`sink:1-15`, `sink:174`,
   `sink:220-245`; production wiring `src/server.ts:153-160`, `src/mcp/v2-server.ts:105-113`).
   Every other legacy durable artifact (the per-job directory, the ready markers, the job
   registry) has **no native counterpart at all**, and every other native durable artifact
   (`.specialists/settlements/`, `.specialists/leases/`, `.specialists/interactions/`,
   `~/.xtrm/state.db`) has **no legacy counterpart at all**. The intersection is one file.
2. **Native ids and legacy ids are two disjoint namespaces that share one column.**
   `specialist_jobs.id` / `specialist_results.job_id` / `specialist_forensic_events.job_id`
   hold a 6-hex legacy job id **or** an `act:<12hex>` native activation id, and nothing in
   the schema, the readers, or the CLI tells them apart.

---

## A. Legacy durable artifact inventory

`S` = survives process restart (state is on disk and re-read by a fresh process).
`EXT` = visible to an external script (a documented path/command, not an internal detail).

| # | Artifact (path / shape) | Writer (file:line) | Reader(s) (file:line) | Fields + schema contract | Lifetime | S | Identity keys | EXT | Destination |
|---|---|---|---|---|---|---|---|---|---|
| A1 | `.specialists/jobs/<job_id>/status.json` — pretty JSON `SupervisorStatus` | `sup:1254-1262` (`writeStatusFileOnly`, tmp+rename); entry `sup:1264-1318` | `sup:1023-1030` (`readStatus` file fallback); `status-load:15-31`; `console-rt:975-989`; `feed:392-397`→`readStatusJson` | `sup:117-190` — `id, specialist, status, current_event, current_tool, model, backend, output_type, pid, started_at_ms, elapsed_s, last_event_at_ms, bead_id, node_id, session_id, conversation_id, trace_id, span_id, parent_span_id, session_file, fifo_path, tmux_session, worktree_path, reused_from_job_id, worktree_owner_job_id, chain_kind, chain_id, chain_root_job_id, chain_root_bead_id, epic_id, branch, startup_payload_json, startup_context{}, metrics{}, context_pct, context_health, error, auto_commit_*, pr_*, base_sha_pinned*, spawn_origin, parent_job_id, root_runtime_origin`. **No version field.** Lineage defaults are backfilled on every write (`sup:1256`, `withStatusLineageDefaults`) | until job end, then until GC (7 d default) | yes | `id` (= `job_id`) | yes | **REUSE_EXISTING_NATIVE** — the same object is the `specialist_jobs` row; the file mirror itself is not reproduced natively |
| A2 | `.specialists/jobs/<job_id>/result.txt` — raw final assistant text | `sup:1992-1993`, `sup:2686-2687`; `job-file-out:19-30`; append-on-error `sup:1851` | `sup:1069-1089` (`readResult` fallback); `result:355-367`; `console-rt:1015-1025` | free text; primary key is the enclosing dir name | until GC | yes | dir name (= `job_id`) | yes (`sp result`) | **REUSE_EXISTING_NATIVE** — mirrored to `specialist_results(job_id, output, updated_at_ms)` (`obs-sqlite:515-519`) |
| A3 | `.specialists/jobs/<job_id>/events.jsonl` — append-only timeline, one JSON event/line | `sup:1580` (`openSync` + append); `sup:1000`, `sup:1372`, `sup:1420` (recovery events) | `status-load:33-51`; `result:154`; `console-rt:998-1006`; `timeline-query.ts:10` | `TimelineEvent` union, parsed by `parseTimelineEvent`; malformed lines skipped | until GC | yes | dir name | yes (`sp feed`) | **REUSE_EXISTING_NATIVE** — same events land in `specialist_jobs_events` / `specialist_forensic_events` (Lane C) |
| A4 | `.specialists/jobs/<job_id>/death.txt` — one appended line naming pid/tmux/specialist | `sup:836-847` (`writeDeadJobArtifact`) | **none found in `src/`** (diagnostic-only by its own comment, `sup:845`) | `ISO-timestamp "Process crashed or was killed" (job=… specialist=… pid=… tmux_session=…)` | until GC | yes | dir name | no | **INTENTIONAL_RETIREMENT** — no reader, no native equivalent, no consumer |
| A5 | `.specialists/jobs/<job_id>/git-diff-<sha12>.patch` | `sup:1894` (`writeGitDiffHunksArtifact`) | none found in `src/` | git diff hunks | until GC | yes | dir name + sha prefix | no | **INTENTIONAL_RETIREMENT** (no reader; Lane C has the evidence-bearing equivalent) |
| A6 | `.specialists/jobs/<job_id>/steer.pipe` — FIFO for `steer`/`resume` | `sup:1663` (`setStatus({ fifo_path: fifoPath })`); close message `sup:1096-1098` | `src/cli/steer.ts:37-51`, `src/cli/resume.ts:38-62`, `src/tools/specialist/{steer,resume}_specialist.tool.ts` | newline-delimited JSON control messages | job lifetime; removed on completion | no (FIFO) | dir name | yes (`sp steer`/`sp resume`) | **INTENTIONAL_RETIREMENT** — native control is in-process (`registry`/`host`) + the durable interaction store (`pending`) |
| A7 | `.specialists/ready/<job_id>` — empty marker file | `sup:963-966` (`writeReadyMarker`) — **`grep -rn writeReadyMarker src/` returns only the definition, so it has NO caller**; the directory alone is still created at `sup:1442` | **none in `src/`**; `src/cli/doctor.ts:471-486` only stat()s the directory; `src/cli/init.ts:507-519,671`, `src/index.ts:299` only create it | empty file; presence = readiness | never deleted | yes | file name (= `job_id`) | documented in `docs/background-jobs.md:174-177`, `docs/surface-ownership.md:21` | **DEAD_AFTER_CUTOVER** — already dead in the legacy path; nothing to migrate |
| A8 | `.specialists/db/observability.db` — SQLite, schema v15 | `obs-sqlite` (whole module); legacy writes via `sup:1272-1317` (`upsertStatus`), `sup:988-991`; `status-load:187-215` | `status-load:318-337` (`loadStatuses`), `sup:1015`, `sup:1074`; `src/cli/{ps,feed,status,db,log}.ts`; `console-rt:960-1030` | `specialist_jobs`, `specialist_jobs_events`, `specialist_results`, `specialist_forensic_events`, `specialist_job_metrics`, `node_*`, `epic_*`, `specialist_job_metrics`; `schema_version` table (`obs-sqlite:483-511`) | until manual `sp db` prune | yes | `specialist_jobs.id` / `specialist_results.job_id` / `specialist_forensic_events.job_id` | yes (`sp ps`, `sp feed`, `sp log`, console) | **REUSE_EXISTING_NATIVE** — already the shared store; this is the single success of the cutover |
| A9 | In-memory `JobRegistry` (`Map<id, JobState>`) | `jobRegistry.ts:47-232` | `src/tools/specialist/{steer,resume}_specialist.tool.ts` | `job_id, status, output, delta, next_cursor, current_event, backend, model, specialist_version, duration_ms, error, beadId` (`jobRegistry.ts:9-27`) | process lifetime | **no** | `job_id` | no (in-process tool only) | **INTENTIONAL_RETIREMENT** — the class header already declares it a compatibility shim (`jobRegistry.ts:3-5`) |
| A10 | Chain identity fields inside A1/A8 | `chain-id:24-59` (`derivePersistedChainIdentity`), written through `sup:1241-1251` | `obs-sqlite:readChainIdentity`, `sup:1057-1067`, `src/cli/epic.ts`, `src/cli/finalize.ts` | `chain_kind ∈ {chain, prep}`, `chain_id, chain_root_job_id, chain_root_bead_id, trace_id, span_id, parent_span_id`; **fallback rules are load-bearing** (`chain-id:35-56`) | until GC | yes | `chain_root_job_id` (= owning `job_id`) | yes (`sp epic`, `sp ps`) | **MOVE_TO_CORE** — no native chain equivalent exists (see E3) |
| A11 | Bead cross-references: `bead_id` in A1/A8, bead notes via `bd update --append-notes` | `beads.ts:227-240`; `bead-notes.ts:7-39` | `obs-sqlite` queries, `src/cli/ps.ts:1190` (`--bead`), session-start hook | bead id string; notes land in Beads' own store, not ours | Beads' lifetime | yes | `bead_id` | yes (`sp ps --bead`) | **REUSE_EXISTING_NATIVE** — native writes `bead_id = snapshot.issueRef` into the same column (`host:1466`, `:2069`, `:2079`) |
| A12 | Worktree/branch metadata (`worktree_path`, `branch`, `worktree_owner_job_id`, `reused_from_job_id`) | `sup:1463-1468`, `sup:521-523` region; `worktree.ts:52-66` derives names, `worktree.ts:88-105` lists worktrees | `sup:1057-1067`, `src/cli/run.ts:473-526`, `ps:1206` (`groupByTree`), `console-rt` | path string + branch string; ownership chain resolved by walking `status.json` (`docs/ARCHITECTURE.md:385`) | until GC | yes | `worktree_owner_job_id` (a `job_id`) | yes (`sp ps` trees) | **REUSE_EXISTING_NATIVE** — native writes `workspace.worktreePath`/`branch` into `specialist_jobs` via `statusOf` (`sink:114-115`, `sink:194`) |
| A13 | PID / tmux-session liveness references | `sup:1512` (`pid: process.pid`), `sup:1550` (watchdog), `sup:1515` (`tmux_session`) | `sup:781-798` (`isPidAlive`/`isJobDead`), `sup:1336-1425` (`crashRecovery`), `dead-audit:33-95`, `src/specialist/process-health.ts` | `pid:number`, `tmux_session:string` | until GC | yes | `job_id` | yes (`sp ps` `is_dead`) | **PRESERVE_NATIVE** — native carries **no** pid (see E1); the legacy column stays meaningful only for legacy rows |
| A14 | Runtime-origin lineage (`spawn_origin`, `root_runtime_origin`, `parent_job_id`) | `sup:117-190` fields; `runtime-origin.ts` captures; read-back via `readChainIdentity` | `runtime-origin-reconstruct.ts:24-52` (`reconstructLineage`), `src/cli/forensic.ts`, console | `RuntimeOriginV1` (`runtime-origin.ts:17-32`): `schema_version, kind, host_id, tmux_*, agent_instance_id, bead_id, parent_session_id, captured_at_ms, capture_source, verified` | until GC | yes | `job_id` | yes (`sp ps --json` `spawn_origin`) | **MOVE_TO_CORE** — native emits `activation_*` forensics but records no `RuntimeOriginV1`; `reconstructLineage` keys on the `job.started` event name only (`runtime-origin-reconstruct.ts:26-27`) |
| A15 | Console config state | `console/repo-config.ts:61-68` | `console-rt:420`, `console/config-source.ts:106-154` | `console.json` in `$XDG_CONFIG_HOME/specialists/`, `~/.config/specialists/`, legacy `~/.specialists/console.json` | user-managed | yes | none (single file) | yes | **PRESERVE_NATIVE** — UI config, not job state; unaffected by the cutover |
| A16 | `.specialists/jobs/latest` — one line, the id of the most recently started job | `sup:1552-1554` (only when `isJobFileOutputEnabled`) | `src/cli/run.ts:1728-1729, 1800` — the `--background` handoff poll | free text: a single `job_id` + newline | overwritten by every job start | yes | none (implicit "most recent") | documented as a handoff path (`docs/background-jobs.md:50`) | **INTENTIONAL_RETIREMENT** — native dispatch returns `activation_id` synchronously over MCP (`src/tools/specialist/activation.tool.ts:60-115`), so no discovery marker is needed; there is no native `--background` launcher |

**Legacy writers that are NOT durable state** (recorded so the inventory is closed):
`jobRegistry` (A9, in-memory), `sup:664-780` (`startDetachedStatusWatchdog` — a detached
child process, not a store), auto-commit noise prefixes (`sup:508`).

---

## B. Native durable artifact inventory

| # | Artifact (path / shape) | Writer (file:line) | Reader(s) (file:line) | Fields + schema contract | Lifetime | S | Identity keys | EXT | Destination |
|---|---|---|---|---|---|---|---|---|---|
| B1 | `~/.xtrm/state.db` → table `activations` | `authority:112-192` (`createFileAuthorityWriter`), called from `host:2028-2038` (`save`) | `plugins/specialists/scripts/session-start.mjs:48-68` (raw SQL); `src/cli/*` via `resolveAuthorityDbPath` | **exactly 5 columns** (`authority:33-39`): `activation_id TEXT PRIMARY KEY, specialist TEXT NOT NULL, state TEXT NOT NULL, bead_id TEXT, last_activity_at INTEGER NOT NULL`; `AUTHORITY_SCHEMA_VERSION = 1` (`authority:26`) | until `forget()` on stop (`host:2195-2213`) — settled rows survive by design (`authority:131-136`) | yes | `activation_id` (= `act:<12hex>`) | yes (SessionStart hook) | **PRESERVE_NATIVE** |
| B2 | Path of B1: `SUBSTRATE_DB` → `XTRM_STATE_DB` → `~/.xtrm/state.db` | `authority:60-66` | `workitems:172-174`, `host:1370-1375` | absolute path; **never derived from cwd or the project** (`authority:11-13`) | n/a | n/a | n/a | yes | **PRESERVE_NATIVE** |
| B3 | `.specialists/settlements/<safe(activationId)>/<safe(attemptId)>.json` | `sstore:167-177` (`save`), root wired at `host:494` = `join(this.cwd, '.specialists','settlements')` | `sstore:178-207` (`get`, `listAttempts`, `listPendingPublication`, `listRuntimeRefused`) | `SettlementRecord` (`sstore:51-84`): `activationId, attemptId, specialist, issueRef, issueRevision, contractHash, executionBindingId, status ∈ {completed,failed}, output (raw), validation{valid,errors?}, receiptId?, journalEntryId?, artifactRef?, completedAt, publication?{state ∈ {published,pending,refused}, note?, refusal?, attempts, updatedAt}`; **no version field**; id projection `safeSegment` keeps `[A-Za-z0-9.:_-]` (`sstore:114-119`) | forever (no GC) | yes | `(activationId, attemptId)` — the pair is the primary key | no (no CLI surface) | **PRESERVE_NATIVE** |
| B4 | `<gitCommonDir ?? repositoryRoot>/.specialists/leases/<sha256(realpath(worktreePath))[:16]>.json` | `wlease:277-327` (`acquire`, `linkSync` publish), `wlease:330-338` (`rewrite` on resume) | `wlease:229-257` (`inspect`), `wlease:348-376` (`release`), `wreconcile:200`, `wreconcile:429-473` | `WorkspaceLease` (`wlease:110-121`): `workspaceKey (sha256[:16]), worktreePath, activationId, attemptId, specialist?, holder{pid, startTicks}, acquiredAtMs`; mode `0o600` | until `release`/`reconcile` | yes | `workspaceKey` hashed from the **worktree path**; record carries `activationId` | yes (`ps:1157` uncertain-workspace block via `wreconcile`) | **PRESERVE_NATIVE** |
| B5 | `<gitCommonDir>/.specialists/leases/<workspaceKey>.reconcile.jsonl` | `wreconcile:308-311` (`appendRecord`, append-only) | `wreconcile:314-328` (`readReconciliationLog`), `wreconcile:450-471` | `ReconciliationRecord` (`wreconcile:129-148`): `workspaceKey, worktreePath, applied, outcome ∈ {safe_free,recovered_holder,superseded,manual_attention_required}, proposedOutcome?, refusalReason?, observedState, observedUncertainReason?, holder?{pid,activationId,specialist?}, decidedBy, basis[], supersededBy?, note?, decidedAtMs` | forever (append-only, never pruned) | yes | `workspaceKey` | yes (`ps`) | **PRESERVE_NATIVE** |
| B6 | Settlement exclusion leases — **the same directory as B4**, synthetic keys `settlement:<act>:<att>` and `settlement-reclaim:<act>:<att>` | `slease:80-86`, `slease:117-165`, `slease:213-244` | `slease:128-152`, `slease:231-234` (`inspect`) | `WorkspaceLease` reused verbatim; `worktreePath` is a **literal, not a path** (`slease:76-79`) so `workspaceKey` hashes the literal | until `release`/reclaim | yes | synthetic `worktreePath` literal | no | **PRESERVE_NATIVE** |
| B7 | `.specialists/interactions/<activationId>/<messageId>.json` and `.reply.json` | `pending:161` (`writeFileSync` tmp), `pending:187-207` (`create`), root `pending:137-146` | `pending:210-257` (`read`/`readReply`/`recordAttempt`/`recordReceipt`), `pending:357-377` (`listForActivation`/`listAll`), `src/activation/transport/polling.ts` → `src/tools/specialist/specialist_status.tool.ts:5` | `InteractionMessage` (`src/activation/interaction.ts`), id shapes `msg:<12hex>` (`interaction.ts:143`, `async-events.ts:88`); `WireDeliveryState ∈ {pending, sent_unconfirmed, delivered, undeliverable, failed}`; mode `0o600` | until reply/close | yes | `(activationId, messageId)`; directory name = `activationId` | yes (`specialist_status` MCP) | **PRESERVE_NATIVE** |
| B8 | `specialist_jobs` + `specialist_jobs_events` rows keyed by a **native** id | `host:forensics` → `sink:174-177` (`upsertStatus`/`upsertStatusWithEvents`) | `status-load:318-337`; `ps:1036,1182`; `console-rt:960-970`; `sup:1015,1023-1030` | `SupervisorStatus` built by `sink:96-127` (`statusOf`) — **no `pid`, no `tmux_session`**; carries `id, specialist, status, current_event, model, backend, started_at_ms, elapsed_s, last_event_at_ms, bead_id, session_id, worktree_path, metrics{token_usage,finish_reason,turns,tool_calls,tool_call_names,auto_compactions,auto_retries}`, `error`, plus `attemptId/attemptNo` identity projection (`sink:92-94`) | forever unless `sp db` prunes | yes | `id` (= `act:<12hex>`) | yes (`sp ps`, `sp feed`, `sp log`) | **REUSE_EXISTING_NATIVE** (A8) |
| B9 | `specialist_results` row for a native activation | `sink:219-236` (`upsertStatusWithEventAndResult`) | `sup:1069-1089`; `result:357-367`; `console-rt:1015-1025` | `(job_id, output, updated_at_ms)`; `output` = the settle output text (`sink:200-203`) | forever unless pruned | yes | `job_id` (= `act:<12hex>`) | yes (via `sp result` **only if the arg reaches the id** — see C3) | **REUSE_EXISTING_NATIVE** |
| B10 | Substrate `issue_journal` `result` entries + WorkReceipts + artifacts in `SUBSTRATE_DB` | `spub:515-683` (`publishSettlement`), `spub:246-421` (`republishSettlement`), boundary methods `workitems:750-830` | `workitems:790-829` (`findResultEntry`, `findReceiptForBinding`), `src/tools/substrate/journal.tool.ts`, `provenance.tool.ts` | `BoundedResult` (`spub:43-54`) + `SettlementExecutionContext` v1 (`spub:57-77`); bounds `SUMMARY_MAX 4000`, `RESULT_ARRAY_MAX 100`, `RESULT_ITEM_MAX 1000` (`spub:38-40`); `SETTLEMENT_RESULT_VERSION = 1` (`spub:35`) | producer-owned (Substrate) | yes | `specialist.activationId` + `specialist.attemptId` **inside the envelope**, plus flat `activationId` | yes (`substrate_journal`, `substrate_provenance`) | **MOVE_TO_CORE** — this is the migration target for result durability, but see E5 on the attempt-attribution hole |
| B11 | `specialist_forensic_events` rows for native lifecycle | `sink:181-251` (`emit`), `sink:253-294` (`sessionEvent`) | `ps:745-761` (`readForensicEvents`), `feed:493-524` (`renderForensicTrail`), `native-activation-summary.ts:82+` | `activation_*` lifecycle names + mapped `TimelineEvent`s; `event_json` redacted (Lane C §1) | forever unless pruned | yes | `job_id` (= `act:<12hex>`) | yes (`sp feed <act-id>`, `sp ps --json` `native_activations`) | **REUSE_EXISTING_NATIVE** (A8) |
| B12 | In-process `FleetRegistry` | `registry:71-104` (`Map<ActivationId, ActivationRecord>`) | `host:*` (`list`, `inspect`, `retry`, `resume`), `src/tools/specialist/specialist_status.tool.ts:62` | `ActivationRecord` (`registry:11-51`) carries the **live session** and `stepContract`; projection is `ActivationSnapshot` | process lifetime | **no** | `activationId` | no | **PRESERVE_NATIVE** (not durable by design) |

---

## C. IDENTITY MAPPING

### C1. Does the CLI `job_id` survive the cutover?

**No — a cutover `job_id` is not minted at all on the native path, and nothing aliases the
old space.**

- Legacy: `sup:1437` — `const id = crypto.randomUUID().slice(0, 6);`. Shape: **`[0-9a-f]{6}`** (12 hex chars truncated to 6). The value is also the directory name (`sup:938-940`) and the primary key of every row A1/A2/A3/A8 carries.
- Native: `host:507-508` — `const activationId = \`act:${randomUUID().slice(0, 12)}\`; const attemptId = \`att:${activationId.slice(4)}:1\`;`. Shapes: **`act:[0-9a-f]{12}`** and **`att:[0-9a-f]{12}:[0-9]+`** (`registry:81-88`, `nextAttemptId`).
- The two spaces are **disjoint by construction** (6 hex with no prefix vs. a prefixed 12-hex). There is no code path that converts one into the other, and no lookup that accepts one and returns the other. `grep` found no such mapping.
- `types.ts:19-20` declares the intended relationship in prose — `ActivationId`: *"Canonical runtime identity; maps to job_id."* — but **the mapping is a claim in a comment, not a mechanism in the code**. There is no function, table, or field that performs it. Treat that comment as intent, not as implemented behaviour.

### C2. Is `activation_id` canonical, or is `job_id` an alias?

**`activation_id` becomes canonical; the legacy `job_id` is a parallel, non-interoperable
identifier for work executed by the legacy `Supervisor`.** Evidence:

- The native runtime is the only path that mints new ids with durable work-authority meaning: the ExecutionBinding pins `activationId`/`attemptId` (`host:1247-1255`, `workitems:635-676`), the settlement record is keyed by `(activationId, attemptId)` (`sstore:168-169`), the lease record carries `activationId` (`wlease:299-307`), the authority row is keyed by `activation_id` (`authority:33-39`), and the interaction store directory is the `activationId` (`pending:205`).
- The CLI `job_id` is not consumed by any native structure. Passing one to `NativeActivationHost` is impossible: every entry point (`inspect`, `stop`, `retry`, `resume`, `list`) takes an `activationId` and returns `unknown_activation` otherwise (`src/tools/specialist/activation.tool.ts:549-558`; `src/activation/native-host.ts:1879-1892`).
- `attemptId` is the second identity axis and has **no legacy counterpart**. A legacy retry creates a *new* `job_id`; a native retry keeps the activation and advances the attempt (`registry:81-88`, `types:22-28`). Any external script that infers "N retries" from N legacy job ids has no native equivalent that preserves that inference in the same shape.

### C3. How does `sp result <old-id-shape>` keep working?

It does not keep working for native ids, and it never worked for them. Three distinct cases:

1. **`sp result <6-hex-legacy-id>` — still works, unchanged.** `result:342-353` takes the arg as `jobId`; `result:355` builds `join(jobsDir, jobId, 'result.txt')`; `result:357-367` reads `sqliteClient.readResult(jobId)` first and falls back to the file. `jobsDir` = `resolveJobsDir()` = git-common-root-anchored `.specialists/jobs` (`job-root:34-37`).
2. **`sp result <act:…>` — BROKEN BY ARGUMENT PARSING, not by missing data.** `result:94-99`:
   ```ts
   if (jobId && jobId.includes(':') && !nodeId && !memberKey) {
     const separatorIndex = jobId.indexOf(':');
     nodeId = jobId.slice(0, separatorIndex);      // "act"
     memberKey = jobId.slice(separatorIndex + 1);  // "<12hex>"
     jobId = undefined;
   }
   ```
   Every activation id contains `:`. So `sp result act:1234abcd5678` is silently reinterpreted as `node="act" member="1234abcd5678"` and dies in `resolveJobIdFromNodeMember` with `Node run not found: act` (`result:124-127`). The `specialist_results` row that B9 would have answered is never consulted. **This is a real, reproducible CLI defect on the native path and the single highest-value fix in this lane.**
3. **`sp result --node <n> --member <m>` — still works for legacy node jobs only.** Node membership is `node_members.job_id` (`result:134-138`), populated by the legacy node runner; native activations are not node members.

The correct native command today is **`sp feed <act:…>`**, which parses positionally with no colon splitting (`feed:469`) and falls back to `renderForensicTrail` when the timeline is empty (`feed:493-524, 533-545`) — printing *LAST-KNOWN* state, explicitly labelled not-live.

### C4. What can an external script depend on today?

| Surface | Shape a script persists | Today (legacy path) | After cutover (native path) |
|---|---|---|---|
| `sp run` stdout banner / `--json` | `jobId` (`[0-9a-f]{6}`) | resolvable by `sp result`, `sp feed`, `sp ps`, `sp stop`, `sp steer`, `sp resume`, `sp retry` | **not minted**; `sp run` has no native path (`01-cli-surface.md`) |
| MCP `specialist_dispatch` response | `activation_id` (`act:…`), `attempt_id`, `issue_ref`, `bead_id`, `execution_binding_id` (`src/tools/specialist/activation.tool.ts:60-115`) | n/a | resolvable by `specialist_status`, `specialist_reply`, `specialist_retry`, `specialist_stop_activation`; by `sp feed`/`sp ps` (**last-known only**); **not** by `sp result` (C3.2) |
| `~/.xtrm/state.db` `activations` row | `activation_id` | n/a | authoritative and stable across process restarts; read by the SessionStart hook (`session-start.mjs:48-68`) |
| `.specialists/jobs/<id>/status.json` | path | authoritative-ish (merged with sqlite by freshness, `status-load:90-103`) | **does not exist** |
| `.specialists/jobs/<id>/result.txt` | path | read by `sp result`, console | **does not exist** |
| `.specialists/db/observability.db` `specialist_results.job_id` | `job_id` string | populated | populated with the **native** id |
| `.specialists/ready/<id>` marker | path | never read by the runtime (A7) | does not exist |
| `.specialists/jobs/latest` | path | the `--background` job-id handoff | does not exist |
| ExecutionBinding / Journal / WorkReceipt ids | `exb_…`, receipt id, journal entry id | n/a | authoritative in Substrate |

**What survives the cutover for a script that only knows ids:** a script that captured a
**legacy 6-hex job id** keeps working as long as its data is within the GC window (A1/A2/A3,
7 days by default, `sup:67`) and it keeps calling the legacy-named commands. A script that
captures an **`act:` activation id** gets durable authority rows + forensic trail, but loses
`sp result` (C3.2) and has no `steer`/`resume` CLI equivalent.

### C5. What survives a process restart on each path?

| Path | Survives restart | Does NOT survive restart |
|---|---|---|
| Legacy job | `status.json`, `result.txt`, `events.jsonl`, `death.txt`, all `observability.db` rows, bead refs, chain identity, worktree metadata | `JobRegistry` (A9); the FIFO semantics (`steer.pipe` is re-read from `fifo_path` but the writing side is gone); the detached status watchdog's intent |
| Native activation | `activations` row (B1), settlement record (B3), lease (B4), reconcile log (B5), interaction files (B7), `observability.db` rows (B8/B9/B11), Substrate journal/receipts (B10) | **the `FleetRegistry` (B12)** — the live session, the `StepContract`, the turn-1 prompt and the `workItems` boundary are all in-memory. `ps:767` and `feed:492` say so explicitly: *"LAST-KNOWN from forensics — not live (the Fleet registry is in-process in the host session)"*. After a host restart there is **no** native `resume`/`retry`/`stop` — `src/activation/native-host.ts:1879-1892` answers `unknown_activation` |

### C6. Id shapes a script could have persisted, and what each resolves to natively

| Persisted value | Example | Producer | Resolves natively? | To what |
|---|---|---|---|---|
| `/^[0-9a-f]{6}$/` | `a1b2c3` | `sup:1437` | **No** | nothing — no native lookup accepts it; `sp result`/`sp feed` still read its `.specialists/jobs` dir and `specialist_jobs` row if present |
| `/^act:[0-9a-f]{12}$/` | `act:3f9a1c7b02d4` | `host:507` | **Yes** | `FleetRegistry` (in-process only), `activations` row, `specialist_jobs` row, `specialist_results` row, settlement dir, lease `activationId`, journal `specialist.activationId` |
| `/^att:[0-9a-f]{12}:\d+$/` | `att:3f9a1c7b02d4:1` | `host:508`, `registry:81-88` | **Yes** | settlement filename, lease `attemptId`, journal `specialist.attemptId` (envelope only — see E5) |
| `/^msg:[0-9a-f]{12}$/` | `msg:8b1d3e5a7c90` | `interaction.ts:143` | **Yes** | `.specialists/interactions/<act>/<msg>.json`; projected by `specialist_status` |
| `/^exb_/` | `exb_…` | Substrate dispatch gate (`workitems:288-295`) | **Yes** | Substrate ExecutionBinding; carried on every native record |
| `worktree_owner_job_id` / `chain_root_job_id` = `[0-9a-f]{6}` | `a1b2c3` | `sup:521-523`, `chain-id:44-46` | **No** | legacy-only lineage; native has `issueRef`-centred lineage and no chain id |
| `nodeId:memberKey` | `research-abc12345:explorer-1` | legacy node runner (`obs-sqlite` `node_runs`/`node_members`) | **No** | legacy-only. **`sp result` misparses every `act:` id into this shape (C3.2)** |
| Any string in `specialist_jobs.id` | either space | both | ambiguous | the column does not encode which runtime wrote the row |

---

## D. Crash / recovery comparison

### D1. Legacy

| Mechanism | Trigger | Action on restart | Orphan handling |
|---|---|---|---|
| `crashRecovery()` `sup:1336-1425` | called at the top of every `run()` (`sup:1434-1435`) | Scans the jobs dir (or sqlite when `SPECIALISTS_JOB_FILE_OUTPUT === 'off'`). `running`/`starting` with a **dead pid** → rewrite `status.json` to `error` / `orphaned (parent supervisor died)` (`sup:1385-1396`). Live pid but silence > `running_silence_error_ms` → `error` with a silence message (`sup:1397-1410`). `waiting` past `waiting_stale_ms` → append a `waiting_stale` warning event (`sup:1411-1421`) | yes |
| `reconcileDeadStatus()` `sup:975-1008` | every `readStatus()` of an active job (`sup:1016, 1027`) | `buildDeadJobRecovery` (`sup:811-830`) → canonical terminal `error` + `run_complete` event, persisted to sqlite **or** to the files, then `writeDeadJobArtifact` and **`emitParentNotification`** (`sup:1004-1005`) | yes — converts an orphaned row into a parent notification |
| `status-load.ts` `reconcileDeadJob` `status-load:238-264` | every `loadStatuses()` (`status-load:329`) | Same recovery, plus `persistRecoveryToFiles` so file-only deployments are repaired (`status-load:223-236`, comment `:256-258`) | yes |
| `reconcileStatusFromEvents` `status-load:266-308` | every `loadStatuses()` | A terminal `run_complete` in the event stream that the supervisor never propagated → repair the row **and** re-notify the parent (`status-load:295-300`) | yes |
| `gc()` `sup:1321-1333` | every `run()` (`sup:1434`) | Deletes job dirs with `mtime` older than `JOB_TTL_DAYS` (default **7**, `sup:67`, override `SPECIALISTS_JOB_TTL_DAYS`) | n/a — TTL expiry |
| `auditDeadJobs` `dead-audit:33-95` | `sp doctor` (`src/cli/doctor.ts:1117`) | Marks stale `specialist_jobs` rows `cancelled` with reason `container-restart-orphan` + forensic event | **only rows where `JSON_EXTRACT(status_json,'$.pid') IS NOT NULL`** (`obs-sqlite:2462-2480`) |
| tmux/liveness | `isPidAlive` `sup:781-791`, `isTmuxSessionAlive` (`isJobDead` `sup:793-798`) | `EPERM` counts as alive | yes |

### D2. Native

| Mechanism | Trigger | Action on restart | Orphan handling |
|---|---|---|---|
| Settlement republish pass `host:1394-1429` → `spub:432-486` | **once per host process**, on the first `dispatch` (`host:1394-1396`) | Enumerates `listPendingPublication()` **plus** `listRuntimeRefused()` re-tested against the current boundary (`spub:455-457`), oldest first, capped at `REPUBLISH_PASS_LIMIT = 50` (`spub:430`). Reconciles the producer before writing so a receipt is **reused, never re-minted** (`spub:280-345`) | yes for **publication**; nothing for a hung activation |
| Settlement exclusion + stale reclaim `slease:117-165, 213-244` | every `publishSettlement`/`republishSettlement` | Cross-process exclusion via `linkSync`+`/proc` startTicks. `reclaimStale` (republish only) unlinks **only** on `holder_process_gone`, under a second exclusion key to avoid two reclaimers deleting a live lease | yes — proven-absence only |
| Workspace reconcile `wreconcile:191-206` | **operator/tool invoked only** — there is no automatic caller | Re-inspects at decision time, validates the proposal against `PERMITTED` (`wreconcile:157-162`), and appends a durable record whether applied **or refused** | yes, but **manual by design**; a host that cannot read `/proc` permits only `manual_attention_required` (`wreconcile:44-55, 161`) |
| Workspace lease expiry | **none.** `acquire` throws `workspace_lease_uncertain` and `release` throws on uncertain (`wlease:293-297, 356-363`) | No TTL, no auto-expiry. `wreconcile` is the only exit | explicit, recorded |
| Interaction store `pending` | read on demand | A message that was never delivered stays `pending`/`sent_unconfirmed` — durable and readable (`pending:1-30`) | yes |
| Activation row `activations` | `save()` on every lifecycle transition (`host:2028-2038`) | A host that dies mid-activation leaves the row in `running`/`starting` **forever**; `forget()` only runs on `stop()` (`host:2195-2213`) | **NO** — see E1 |
| `FleetRegistry` | n/a | gone with the process (B12) | n/a |

### D3. Divergences that matter

1. **Legacy self-heals; native does not.** Legacy runs `crashRecovery` + `reconcileDeadStatus` + `gc` on every `run()`/`loadStatuses()` and **notifies the parent**. Native has **no equivalent activation reconciler**: no orphan scan over `activations`, no detection of a host that died, and no `gc`/TTL over `.specialists/settlements/`, `activations`, or `.specialists/interactions/` (all grow forever).
2. **`auditDeadJobs` cannot see native rows.** Its query requires a non-null `pid` (`obs-sqlite:2477`), and the native projection never writes one (`sink:96-127`). So `sp doctor`'s dead-job audit is structurally blind to the native fleet.
3. **Recovery granularity differs.** Legacy recovery is per **job** (pid + tmux + silence). Native recovery is per **publication** (did the receipt/journal land?) and per **workspace lease** (who holds it?). Native has no notion of "this activation is stalled/dead" at all.
4. **Directory anchoring is inconsistent** — three different rules for three native stores:

   | Store | Anchor | Citation |
   |---|---|---|
   | `.specialists/jobs`, `.specialists/ready` | **git common root** (all worktrees share) | `job-root:17-37` |
   | `.specialists/leases`, `.specialists/settlements` (lease half), reconcile log | **git common root** | `wlease:208-210`, `wreconcile:409-416` |
   | `.specialists/settlements` (record half), `.specialists/interactions` | **`process.cwd()`** — *not* git-common-root | `host:494` (`join(this.cwd, ...)`), `host:484` (`cwd` default `process.cwd()`); `src/server.ts:162` / `src/mcp/v2-server.ts:120` pass `repoRoot: process.cwd()` |
   | `observability.db` | resolved by its own resolver | `obs-sqlite` / `observability-db.ts:110-112` |
   | `~/.xtrm/state.db` | **HOME**, never the project | `authority:60-66` |

   Consequence: a native activation started from a worktree writes its settlement to the
   **worktree's** `.specialists/settlements/`, while the lease for the same activation lands
   in the **common root's** `.specialists/leases/`. The republish pass on first dispatch
   (`host:1394`) therefore only sees the settlements of the cwd it happens to run in.
5. **Native publication is machine-local.** `slease:50-53` states it explicitly: the exclusion is per-machine, so two hosts on different machines sharing one Substrate store are not serialised. Legacy has no equivalent claim either way; this is a new hazard introduced by the native path.

---

## E. GAPS — legacy durable behaviour with no native destination (BLOCKER LIST)

| # | Gap | Evidence | Consequence | Severity |
|---|---|---|---|---|
| E1 | **No native orphan/death reconciliation.** `activations` rows for a host that died stay `running`/`starting` permanently; nothing scans them; `dead-job-audit` requires a pid native never writes | `host:2028-2045`, `authority:123-138`, `obs-sqlite:2470-2478` (`AND pid IS NOT NULL` at `:2477`), `dead-audit:33-95` | SessionStart surfaces dead work as live; the fleet view lies; no parent notification | **BLOCKER** |
| E2 | **`sp result <act:…>` is unreachable — `:` is eaten as a node:member separator** | `result:94-99` vs. `host:507-508` | The primary result-read command cannot read a native result, even though `specialist_results` holds it (`sink:219-236`) | **BLOCKER** (one-line-ish fix) |
| E3 | **No native chain/epic identity.** `chain_kind/chain_id/chain_root_job_id/chain_root_bead_id` and `PersistedChainIdentity` have no native producer or reader; `derivePersistedChainIdentity` is legacy-only | `chain-id:11-59`, `obs-sqlite:1447`, `src/cli/epic.ts`, `src/cli/finalize.ts` | `sp epic merge`/`sp finalize` and the whole epic-readiness projection have no native path; lineage is `issueRef`-centred only | **BLOCKER** |
| E4 | **No native `resume`/`retry`/`stop` outside the originating host process.** `FleetRegistry` is in-memory (`registry:71-104`); after restart every id answers `unknown_activation` | `registry:71-104`, `src/activation/native-host.ts:1879-1892`, `ps:767`, `feed:492` | Any external script that captured an id loses control of the work after a host restart; there is no CLI equivalent of `sp stop`/`sp resume` for native ids | **BLOCKER** |
| E5 | **Journal attempt attribution is envelope-only.** `issue_journal` has no `attempt_id` column; `findResultEntry` must read `executionContext.specialist.attemptId`, and entries lacking it make reconciliation return `unavailable` → the record defers forever | `workitems:505-518` (explicit comment), `workitems:790-816`, `substrate/src/domain/journal.ts:193-211` (cited there) | A pre-cutover or partially-attributed result can never republish; the backlog is honest but permanently stuck | **HIGH** |
| E6 | **No GC / TTL on any native store.** `.specialists/settlements/`, `activations`, `.specialists/interactions/`, `.specialists/leases/*.reconcile.jsonl` grow without bound; legacy has `JOB_TTL_DAYS` | `sup:67, 1321-1333` vs. `sstore:167-207`, `authority:112-192`, `pending:137-146`, `wreconcile:308-311` | Unbounded disk growth; no operator remediation command | **HIGH** |
| E7 | **File-only legacy deployments have no native equivalent.** With `SPECIALISTS_JOB_FILE_OUTPUT != off` and no SQLite, legacy is fully functional from `status.json`/`result.txt`/`events.jsonl`. Native is SQLite-only (`specialist_jobs`) and Substrate-SQLite-only | `job-file-out:8-17` (default is `off`, `:12`), `status-load:223-236`, `sink:1-15` | Any deployment relying on the file mirror loses all native observability; the mirror is silently absent rather than emulated | **HIGH** |
| E8 | **No native `RuntimeOriginV1` capture / lineage reconstruction.** `spawn_origin`/`root_runtime_origin` are legacy-written; `reconstructLineage` keys on the `job.started` event name only | `runtime-origin.ts:17-32`, `sup:117-190`, `runtime-origin-reconstruct.ts:26-36` | Console pane→job reconstruction cannot span native activations | **MEDIUM** |
| E9 | **Inconsistent store anchoring (cwd vs. git-common-root)** for settlements/interactions vs. leases/jobs | `host:494`, `host:484`, `src/server.ts:162`, `wlease:208-210`, `job-root:17-37` | Worktree-local dispatch writes settlements into the worktree; the first-dispatch republish pass is scoped to whichever cwd happens to run it | **MEDIUM** |
| E10 | **`sp ps` double-counts native activations.** `loadStatuses()` merges the native `specialist_jobs` rows into `visibleStatuses` (`ps:1036,1182`) **and** `loadNativeActivationSummaries` renders the same ids again (`ps:890,1215`), with no `act:` filter in the visibility predicate (`ps:1186-1210`) | `ps:1036, 890, 1156-1157, 1182-1222` | Native work appears twice in one `sp ps`; `--json` carries both `jobs[]` and `native_activations[]` for the same id | **MEDIUM** |
| E11 | **No native `death.txt`/dead-cause artifact.** `writeDeadJobArtifact` has no native counterpart | `sup:836-847` | Debuggability loss only (both have forensic events) | **LOW** |
| E12 | **`sp retry <act:…>` would hand a native id to the legacy path.** `retry:88-98` reads the (native) row via `Supervisor.readStatus`, and since `status ∈ {error,cancelled}` is retryable it emits `sp run <specialist> --bead <bead> --job <act:…>` — i.e. a *new legacy* job whose `reused_from_job_id` points at a native activation | `retry:15, 52-74, 84-101`, `run.ts:182, 473-526` | Cross-runtime lineage link with no native meaning; the legacy run also reads `worktree_path` from the native row and reuses that worktree | **MEDIUM** |

---

## F. UNKNOWNs (with reasons)

| # | Unknown | Why it could not be resolved here |
|---|---|---|
| F1 | Whether the 6-hex→`act:` relationship is *planned* to be implemented anywhere (an alias table, a resolver, a migration) | `types.ts:19-20` asserts the mapping in prose only. No bead, ADR, or code found in this tree. `bd search "XTRM-93"` returns nothing (`00-capability-matrix.md` §0). Intent cannot be inferred from a comment. |
| F2 | What happens to an existing `.specialists/jobs/**` corpus at cutover | No migration code exists in this tree (`grep` for a job→activation importer found only `sp db backfill` for `status.json` → observability, `src/cli/db.ts:104`). Whether the corpus is imported, read-only-retained, or deleted is undocumented. |
| F3 | Whether any external consumer outside this repo persists a `job_id` or the `.specialists/ready/` marker | The marker is documented (`docs/background-jobs.md:174-177`, `docs/surface-ownership.md:21`) and has **zero readers in `src/`**. Consumers outside this repo (operator scripts, dashboards) cannot be enumerated from the tree. **This is the largest single unknown in the lane** — the marker is documented as a contract but nothing in-repo enforces or consumes it. |
| F4 | Whether `.specialists/settlements/` is intended to be per-worktree or per-repo | The code says `cwd` (`host:494`); the lease module says git-common-root (`wlease:208-210`); no ADR in the tree resolves the contradiction. |
| F5 | Whether `AUTHORITY_SCHEMA_VERSION` has a migration story beyond `CREATE TABLE IF NOT EXISTS` | `authority:108-121` states "`IF NOT EXISTS` is the whole migration story for E2". A real column change has no path; that is a stated assumption, not a verified capability. |
| F6 | Whether the `act:`/`att:` prefixes are frozen contract | They are literals in `host:507-508` with no exported constant, no schema, and no test pinning the regex. Nothing prevents a change. |
| F7 | Whether the republish pass actually runs in every production host | It is triggered only from the first `dispatch` (`host:1394`). A host that only ever reads (status/reply/stop) never drains the backlog. Whether read-only hosts are expected to drain it is not stated. |

---

## G. Unrelated findings (out of lane, recorded because they were seen)

1. **`Supervisor.writeReadyMarker` is dead code.** `grep -rn writeReadyMarker src/` → one hit, the definition (`sup:963`). GitNexus agreed (`impactedCount: 0`) but reported `risk: UNKNOWN` with the standard `riskNote`; the text search is what settles it. The method should be deleted or the marker contract restored — leaving a documented-but-unwired marker is worse than either.
2. **`jobRegistry.ts` self-describes as a compatibility shim** (`jobRegistry.ts:3-5`) yet is the only control path for the `steer_specialist` / `resume_specialist` MCP tools. The comment and the dependency graph disagree about whether it is legacy.
3. **`sp feed`/`sp ps` label native state correctly and honestly** (`feed:492,514`, `ps:767,1157`: *LAST-KNOWN … not live*). This is the one place the cutover's identity split is documented at the surface a user actually reads. Worth preserving verbatim.
4. **`authority-store.ts` header (`authority:4-9`) explicitly rejects per-repo `observability.db` as work authority** while `native-host` writes both. The comment is correct; the risk is a reader concluding there is one store when there are two with different lifetimes.
5. **`status-load:90-103` merges file and sqlite statuses by freshness**, so a native row and a legacy file row for the same id would silently resolve to whichever has the newer `last_event_at_ms`. Today no id exists in both spaces, so this is latent rather than live — but it is the mechanism that would hide a collision if one were ever introduced.
6. **`docs/ARCHITECTURE.md:257-286, 385, 903-907`** describe the legacy file layout as canonical. That document is now partially false for the native runtime and should be marked as describing the legacy backend only.

---

## H. Destination tally

| Destination | Legacy rows | Native rows | Total | Artifacts |
|---|---|---|---|---|
| REUSE_EXISTING_NATIVE | 6 | 3 | 9 | legacy A1, A2, A3, A8, A11, A12; native B8, B9, B11 |
| PRESERVE_NATIVE | 2 | 8 | 10 | legacy A13, A15; native B1, B2, B3, B4, B5, B6, B7, B12 |
| MOVE_TO_CORE | 2 | 1 | 3 | legacy A10 (chain identity), A14 (runtime origin); native B10 (Substrate result/journal) |
| INTENTIONAL_RETIREMENT | 5 | 0 | 5 | A4, A5, A6, A9, A16 |
| DEAD_AFTER_CUTOVER | 1 | 0 | 1 | A7 (`.specialists/ready/`) |
| FRONTEND_ONLY | 0 | 0 | 0 | — |

Counts are per row, not per file: a single artifact named in two rows (e.g. `.specialists/jobs/status.json`
and the `specialist_jobs` row it mirrors) is one legacy artifact and one native artifact, each with
its own destination.

**Every legacy durable artifact has exactly one destination.** The two entries that carry the
most migration risk are A10 (chain identity, E3) and A14 (runtime origin, E8), because both
are *durable data with no native producer* rather than merely a moved file.

## I. Exit criteria this lane contributes to the GO/NO-GO gate

Fix-or-accept before cutover:

1. E1 — native orphan reconciliation (no native destination today).
2. E2 — `sp result <act:…>` argument parsing.
3. E3 — chain/epic identity.
4. E4 — out-of-process control for native activations, or an explicit, documented acceptance that control dies with the host.
5. E5 — Journal attempt attribution (blocks republish in the pre-cutover backlog case).
6. F3 — resolve whether the `.specialists/ready/` marker is an external contract; if yes it cannot be retired silently.

Non-blocking but required for a clean record: E6–E12, and an explicit decision on F2/F4.

---

## Coordinator verification (2026-09-16)

- **Citation correction applied:** `src/tools/specialist/activation.tool.ts:1879-1892` (a 634-line
  file) → **`src/activation/native-host.ts:1879-1892`**, which is the `retry()` method and is in
  fact where `unknown_activation` is thrown. Corrected in both places.
- **False positive, no change:** `substrate/src/domain/journal.ts:193-211` is a path in the
  external Substrate package, not in this worktree. Legitimate out-of-tree reference.
- **Coordinator reproduced the headline defect independently.** `src/cli/result.ts:93-98` rewrites
  any `jobId` containing `:` into `nodeId`/`memberKey`; `src/activation/native-host.ts:507` mints
  `act:${randomUUID().slice(0,12)}`. Live run in this worktree:
  `bun run src/index.ts result act:deadbeef1234` → **`No node matching ref: act`**.
  `sp result` therefore cannot resolve *any* native activation id. This is confirmed behaviour,
  not inference, and it is a cutover blocker because `sp result` is a preserved CLI surface.

---

## Appendix Z — empirical identity grammar, measured from the canonical store at cutover-prep

> Measured directly from `<git-common-root>/.specialists/db/observability.db` (schema version 15),
> table `specialist_jobs`, resolving the common root via `resolveObservabilityDbLocation()`.
> This appendix exists because N2A must define the grammar from data, not from the two examples in
> the brief. Row counts are the population at the time of measurement.

### Observed `job_id` shapes

| Shape | Rows | Contains `:` |
|---|---|---|
| `<6 hex>` (e.g. `00270d`) — legacy dominant | 3040 | no |
| `<uuid>` 36-char (e.g. `0007c574-26ba-4817-8bbb-b2338aa7bdfb`) — legacy | 496 | no |
| `act:<12-char id>` (e.g. `act:0293a2bc-f48`) — native activation | 203 | **yes** |
| assorted odd legacy lengths (5, 8, 10–15, 18) | ~12 | no |

### Observed node id shapes

`node-1`, `node-r1`, `node-r2`, `node-rec-1`, `node-rec-2`, `research-81fc1c10`,
`research-9ce8944f`, `research-b36c6f64` — **none contains a colon.**

### Consequences that decide the fix

1. **No legacy `job_id` contains a colon, and no node id contains a colon.** The only refs that
   contain one are the native identities. The `node:member` split in `src/cli/result.ts:93-98`
   is therefore unambiguous *except* for the native forms, which it destroys.
2. **The native ids form two shapes, one of which has two colons:**
   - `act:<id>` — `native-host.ts:507` mints `` `act:${randomUUID().slice(0, 12)}` ``
   - `att:<id>:<n>` — `native-host.ts:508` mints `` `att:${activationId.slice(4)}:1` ``
   A `indexOf(':')` split yields `nodeId='att'` and `memberKey='<id>:1'` for the second form, so
   the attempt form mis-parses even more severely than the activation form.
3. **`act:` and `att:` are therefore safe to reserve as native prefixes.** Any implementation that
   exempts these prefixes from the legacy split preserves every existing legacy ref, because no
   legacy ref can begin with them.
4. **The fix is sufficient: the result data is already addressable.** `specialist_jobs` carries
   **203** rows whose `job_id` is an `act:` identity, alongside 3577 legacy rows. `src/cli/result.ts`
   resolves a job id through `readStatus(jobId)` / `readEvents(jobId)`, so once the id survives
   parsing intact the native result is retrievable. No new storage is required for N2A.
5. **`att:` is a second axis, not a second id space.** `specialist_jobs` carries both `attempt_no`
   and `attempt_id` columns, and `specialist_forensic_events` carries a dedicated nullable
   `attempt_id` column with its own partial index
   (`idx_forensic_events_job_attempt (job_id, attempt_id, seq) WHERE attempt_id IS NOT NULL`).
   Attempt resolution should use those columns rather than string-splitting the ref.

### Grammar cases N2A must test

```
00270d                      legacy 6-hex job id      -> jobId unchanged
0007c574-26ba-4817-8bbb-b2338aa7bdfb   legacy uuid   -> jobId unchanged
node-1:some-member          legacy node:member       -> nodeId+memberKey split (preserved)
act:0293a2bc-f48            native activation        -> jobId unchanged, NO split
att:0293a2bc-f48:1          native attempt           -> jobId unchanged, NO split
act:                        malformed                -> explicit error, not a node lookup
att:foo                     malformed                -> explicit error
att::1                      malformed                -> explicit error
:member                     empty node ref           -> existing error path
node-1:                     empty member key         -> existing error path
```
