# XTRM-93 Lane G — Secondary Execution Surfaces

Bead: `unitAI-t9iyp` (XTRM-93). Audit of the **current tree only**.

- Worktree: `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`
- HEAD: `6553ef05` (`fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch`)
- Source of truth: `git master 472b1aef` + local commit `6553ef05`
- Scope: every execution path that is **not** plain `sp run`.

## Method and evidence rules

- Structural claims use GitNexus at `repo=/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`.
  The worktree index is **present**: `.gitnexus/gitnexus.json` reports
  `lastCommit: 6553ef05877a263384d6572980cc6e4affc3952a`, `gitnexus status` reports
  `Indexed commit: 6553ef0 / Current commit: 6553ef0` with only the six `docs/migrations/xtrm-93/*.md`
  artifacts reported as added (they are untracked audit docs, not code). No fallback to the older
  `/home/dawid/dev/specialists` index was needed.
- GitNexus evidence used:
  - `gitnexus impact Supervisor --direction upstream` → `impactedCount: 113`, `risk: CRITICAL`,
    `direct: 51`, `processes_affected: 23`. First affected process `run@src/specialist/node-supervisor.ts`,
    then `spawnDynamicMember`. **This is the load-bearing graph fact of this lane: the single most
    connected construction target in the tree is the legacy engine, and the node runtime is its heaviest caller.**
  - `gitnexus impact NativeActivationHost --direction upstream` → `impactedCount: 14`, `risk: MEDIUM`,
    `direct: 11`, `processes_affected: 1` (`constructor@src/server.ts`).
  - `gitnexus context NodeSupervisor` → `Class:src/specialist/node-supervisor.ts`, lines 409–2411,
    incoming callers are tests + `src/cli/node.ts`.
  - `gitnexus query "node supervisor multi-agent coordination runtime"` → processes rooted at
    `HandleNodeRun`.
- **Graph limitation, stated up front.** Every CLI verb is loaded by *dynamic* `await import('./cli/<name>.js')`
  from `src/index.ts`; the graph records no call edge for those. Reachability of each verb below is
  therefore read from `src/index.ts` dispatch lines and the verb's source, not inferred from the graph.
  Graph evidence is used where it resolves (class impact, class construction, ownership).
- **Destination enum** (exactly one per surface):
  `PRESERVE_NATIVE` | `FRONTEND_ONLY` | `MOVE_TO_CORE` | `REUSE_EXISTING_NATIVE` |
  `INTENTIONAL_RETIREMENT` | `DEAD_AFTER_CUTOVER`.
- `d` = `.specialists/`; `obs.db` = `d/db/observability.db`. `NATIVE` =
  `NativeActivationHost` (`src/activation/native-host.ts:443`). `LEGACY ENGINE` =
  `SpecialistRunner` (`src/specialist/runner.ts`) + `Supervisor` (`src/specialist/supervisor.ts`) +
  `PiAgentSession` pi-RPC subprocess (`src/pi/session.ts:1044,1208`).

### The three runtimes in the tree

| runtime | entry | execution substrate | job state |
|---|---|---|---|
| **legacy job engine** | `sp run`, `sp chat`, `sp node`, most `sp *` control verbs | `SpecialistRunner` + `Supervisor` + `PiAgentSession` (spawns `pi --mode rpc`) | `.specialists/jobs/<id>/` + `obs.db` |
| **native activation** | MCP v2 (`src/index.ts:1462` → `serveV2Stdio`), Pi extension | `NativeActivationHost` → in-process `createAgentSession` (`src/activation/pi-sdk.ts:1-18`) | Substrate authority store + `obs.db` |
| **script/service** | `sp script`, `sp serve` (`POST /v1/generate`) | `runScriptSpecialist` → `PiAgentSession` (no `Supervisor`) | `obs.db` rows only |

`src/activation/pi-sdk.ts:14-16` states the split for the native half explicitly:
*"The legacy `sp run` path spawns the `pi` binary and speaks RPC to it, so it needs none of this.
Only the native activation host … imports the SDK."*

---

## A) Construction-site census

Complete census of `SpecialistRunner` / `Supervisor` / `NodeSupervisor` / `JobControl` /
`NativeActivationHost` constructions in the current tree. Caller-supplied list was verified complete
for `src/`; two groups the caller did **not** list are marked **NEW**.

### A.1 Legacy engine constructions (production-reachable)

| # | construction site | constructs | surface that reaches it | legacy/native | destination | evidence | blocker? |
|---|---|---|---|---|---|---|---|
| 1 | `src/specialist/launch.ts:64` | `SpecialistRunner` | `sp run` (`src/cli/run.ts:1975`), `sp chat` (`src/cli/chat.ts:158`) | legacy | MOVE_TO_CORE | `run.ts:27` imports `launchSpecialist`; `chat.ts:3` same | no |
| 2 | `src/specialist/launch.ts:71` | `Supervisor` | same | legacy | MOVE_TO_CORE | `launch.ts:144` `await supervisor.run()` | no |
| 3 | `src/specialist/control.ts:48-51` | `Supervisor` (`createFinalizeSupervisor`) | `sp finalize` (`src/cli/finalize.ts:23`) | legacy | MOVE_TO_CORE | `finalize.ts:6` imports `finalizeJob` | no |
| 4 | `src/specialist/control.ts:65` | `Supervisor` | `sp stop` (`src/cli/stop.ts:50`) | legacy | MOVE_TO_CORE | `stop.ts:3` imports `stopJob` | no |
| 5 | `src/specialist/control.ts:203` | `Supervisor` (via #3) | `sp finalize` | legacy | MOVE_TO_CORE | `control.ts:203` `createFinalizeSupervisor(jobsDir)` | no |
| 6 | `src/specialist/job-control.ts:31` | `Supervisor` (ctor) | `sp node` via `NodeSupervisor` | legacy | MOVE_TO_CORE | `node-supervisor.ts:5` imports `JobControl`; 7 `new JobControl` sites below | no |
| 7 | `src/specialist/job-control.ts:58` | `Supervisor` (per `startJob`) | `sp node` via `NodeSupervisor` | legacy | MOVE_TO_CORE | `job-control.ts:68` `this.supervisor.run()` | no |
| 8 | `src/cli/status.ts:294` | `Supervisor` (read-only) | `sp status` | legacy | FRONTEND_ONLY | `status.ts:294` guarded by `existsSync(jobsDir)` | no |
| 9 | `src/cli/result.ts:315` | `Supervisor` (read-only) | `sp result` | legacy | FRONTEND_ONLY | `result.ts:315`; uses `readStatus` only | no |
| 10 | `src/cli/resume.ts:21` | `Supervisor` | `sp resume` | legacy | REUSE_EXISTING_NATIVE | writes FIFO `{type:'resume'}` (`resume.ts:42-44`); native `specialist_resume` exists (`src/mcp/resume-tool.ts:57`) | no |
| 11 | `src/cli/run.ts:1894` | `Supervisor` (`statusReader`, read-only) | `sp run` pre-flight | legacy | FRONTEND_ONLY | `run.ts:1894-1898` only reads status | no |
| 12 | `src/cli/node.ts:480` | `SpecialistRunner` | `sp node run` | legacy | MOVE_TO_CORE | `node.ts:480-484`; passed into `NodeSupervisor` (`node.ts:507`) | no |
| 13 | `src/cli/node.ts:507` | `NodeSupervisor` | `sp node run` | node runtime | MOVE_TO_CORE | `node.ts:489` dynamic import | see §C |
| 14 | `src/cli/node.ts:725` | `Supervisor` | `sp node stop` | legacy | MOVE_TO_CORE | `node.ts:725-729` | no |
| 15 | `src/cli/node.ts:901` | `SpecialistRunner` | `sp node spawn-member/create-bead/complete` | legacy | MOVE_TO_CORE | `node.ts:899-905` `createNodeActionRunnerDependencies` | no |
| 16 | `src/cli/steer.ts:21` | `Supervisor` | `sp steer` | legacy | MOVE_TO_CORE | `steer.ts:44` writes FIFO `{type:'steer'}` | no |
| 17 | `src/cli/retry.ts:85` | `Supervisor` (read-only) | `sp retry` | legacy | REUSE_EXISTING_NATIVE | `retry.ts:100` re-invokes `sp run`; native `createSpecialistRetryTool` exists (`activation.tool.ts:586`) but is **unregistered** — see §F | **yes** |

### A.2 NEW — `JobControl` construction sites (indirect `Supervisor`), all in the node runtime

`grep -rn "new JobControl" src/` returns exactly these, all inside `src/specialist/node-supervisor.ts`:
`:265`, `:918`, `:1005`, `:1672`, `:1978`, `:2067`, `:2077`.
Each constructs a `Supervisor` (via `job-control.ts:31`/`:58`). The caller's list named
`node-supervisor.ts` only as a file, not these seven direct sites. Destination: MOVE_TO_CORE (they are
the node runtime's only way to start a member or coordinator job). Blocker: no.

### A.3 Legacy engine constructions with NO production reachability

| # | construction site | constructs | reached by | legacy/native | destination | evidence | blocker? |
|---|---|---|---|---|---|---|---|
| 18 | `src/tools/specialist/resume_specialist.tool.ts:38` | `Supervisor` | **nothing** | legacy | DEAD_AFTER_CUTOVER | factory `createResumeSpecialistTool` has zero importers in `src/`, `config/`, `plugins/`, `scripts/` | no |
| 19 | `src/tools/specialist/stop_specialist.tool.ts:17` | `Supervisor` | **nothing** (tests only) | legacy | DEAD_AFTER_CUTOVER | only `tests/unit/tools/specialist/stop_specialist.tool.test.ts` imports it | no |
| 20 | `src/tools/specialist/steer_specialist.tool.ts:31` | `Supervisor` | **nothing** | legacy | DEAD_AFTER_CUTOVER | factory `createSteerSpecialistTool` has zero importers | no |

### A.4 Native host constructions

| # | construction site | constructs | surface that reaches it | legacy/native | destination | evidence | blocker? |
|---|---|---|---|---|---|---|---|
| N1 | `src/mcp/v2-server.ts:105` | `NativeActivationHost` | product MCP entrypoint | native | PRESERVE_NATIVE | `src/index.ts:1462-1463` `serveV2Stdio()`; no-subcommand mode is the installed entry | no |
| N2 | `src/server.ts:153` | `NativeActivationHost` | **nothing** | native | DEAD_AFTER_CUTOVER | class `SpecialistsServer` has zero importers; only `emitMcpForensicEvent`/`toMcpMeta` are imported by `tests/unit/server-mcp-forensic.test.ts:2` | no |
| N3 | `config/pi-extensions/specialist-subagents/index.mjs:362` | `NativeActivationHost` (`HostCtor`) | Pi extension frontend | native | PRESERVE_NATIVE | `index.mjs:42` imports `NativeActivationHost` from the lib | no |

**Census totals:** 20 legacy-engine construction statements in `src/` (17 production + 3 dead),
7 `JobControl` construction sites (all node runtime), 3 native-host construction sites (2 in `src/`,
1 in `config/`). The caller's 17-line list was complete; the omission was the 7 `JobControl` sites.

---

## B) Per-surface table

| surface | entry file | legacy backend dependency | external consumers / proof | classification | destination | migration action | risk |
|---|---|---|---|---|---|---|---|
| `sp run` foreground | `src/cli/run.ts` | full legacy engine | operators/agents | legacy engine | MOVE_TO_CORE | Lane A scope; `launchSpecialist` must target native host | HIGH |
| `sp run --background` / detached / tmux | `src/cli/run.ts:1723-1862` | detaches a child that re-runs the legacy flow; optional tmux session `sp-<name>-<id>` | `docs/background-jobs.md:27-45` documents it as the supported agent-pane dispatch form | legacy lifetime mechanism | MOVE_TO_CORE | keep-alive/lifetime semantics need a native home (native host is in-process and survives turns); the detached-child + tmux mechanism itself has no native equivalent | HIGH |
| `sp chat` | `src/cli/chat.ts:158` | `launchSpecialist` (#1/#2) | interactive TUI | legacy-backed frontend | FRONTEND_ONLY | keep the TUI, rebind launch to native host | MED |
| `sp console` | `src/cli/console.ts:3` | none directly; reads `SupervisorStatus` from `obs.db` + job files (`src/cli/console/runtime.ts:12,958-981`) | interactive dashboard | read-only frontend | FRONTEND_ONLY | rebind data source from job dirs to the activation fleet registry | MED |
| `sp attach` | `src/cli/attach.ts` | attaches to the legacy tmux session (`docs/background-jobs.md:34-36`) | TUI | legacy mechanism | DEAD_AFTER_CUTOVER | retire with tmux detachment | LOW |
| `sp status` | `src/cli/status.ts:294` | `Supervisor.listJobs()` read-only | operators/JSON | legacy read | FRONTEND_ONLY | rebind to native fleet projection | MED |
| `sp result` | `src/cli/result.ts:315` | `Supervisor.readStatus/readResult` | operators/JSON | legacy read | FRONTEND_ONLY | rebind to `specialist_status` result projection | MED |
| `sp feed` | `src/cli/feed.ts` | none (task list did not list it; no `Supervisor` construction) | operators | legacy read | FRONTEND_ONLY | rebind to forensic stream | LOW |
| `sp ps` | `src/cli/ps.ts` | none | operators | legacy read | FRONTEND_ONLY | rebind | LOW |
| `sp stop` | `src/cli/stop.ts:50` | `stopJob` → `Supervisor` (#4) + PID/tmux kill (`control.ts:87-97`) | operators | legacy control | MOVE_TO_CORE | native `specialist_stop_activation` (`activation.tool.ts:540`) already exists; capability must be re-hosted | MED |
| `sp steer` | `src/cli/steer.ts:21` | FIFO write (#16) | operators | legacy control | MOVE_TO_CORE | native has reply/ask (`activation.tool.ts:498`); steer must map onto it | MED |
| `sp resume` | `src/cli/resume.ts:21` | FIFO write (#10) | operators | legacy control, capability already native | REUSE_EXISTING_NATIVE | point the verb at `NativeActivationHost.resume` (`src/mcp/resume-tool.ts:83`) | LOW |
| `sp retry` | `src/cli/retry.ts:85` | `Supervisor` read (#17) then `sp run` | operators | legacy control, native tool exists unregistered | REUSE_EXISTING_NATIVE | register `specialist_retry` in `src/mcp/v2-server.ts` and rebind CLI | **HIGH** |
| `sp finalize` | `src/cli/finalize.ts:23` | `finalizeJob` → `Supervisor` (#3/#5) | operators; `sp finalize <any-chain-job-id>` is the documented auto-finalize recovery (`AGENTS.md`) | legacy chain bookkeeping | MOVE_TO_CORE | no native finalize equivalence exists | HIGH |
| `sp follow-up` | `src/cli/follow-up.ts:4-9` | delegates to `sp resume` | none | deprecated alias | DEAD_AFTER_CUTOVER | remove after resume rebinding | LOW |
| `sp script` | `src/cli/script.ts:149` | `runScriptSpecialist` → `PiAgentSession` RPC, **no `Supervisor`** | **external:** darth-feedor (`handoff-feedor.md:17`) | separate runtime, frozen contract | PRESERVE_NATIVE | preserve; do not migrate onto native host | none |
| `sp serve` (+ hot reload) | `src/cli/serve.ts`, `src/cli/serve-hot-reload.ts` | `runScriptSpecialist` | **external:** darth-feedor sidecar (`handoff-feedor.md:16,29`) | separate runtime, frozen contract | PRESERVE_NATIVE | preserve | none |
| `POST /v1/generate`, `/healthz`, `/readyz`, `/metrics` | `src/cli/serve.ts:306,319,325,341` | script runtime | Python client `clients/python/specialists_client.py` | frozen HTTP contract | PRESERVE_NATIVE | preserve; see §D | none |
| `sp validate --target script` | `src/cli/validate.ts:86-96` | `compatGuard` from `script-runner.ts` | operator pre-deploy gate (`handoff-feedor.md:18`) | script-surface validator | PRESERVE_NATIVE | preserve | none |
| `sp node` | `src/cli/node.ts` | `NodeSupervisor` → `JobControl` → legacy engine | operators; 2411-line runtime | distinct orchestration over legacy engine | MOVE_TO_CORE | see §C | HIGH |
| MCP v2 server | `src/mcp/v2-server.ts:105` | none | Claude Code / MCP clients | native | PRESERVE_NATIVE | none | none |
| MCP legacy `src/server.ts` | `src/server.ts:120-177` | none since rewrite (all tools native) | **none reachable** | dead duplicate | DEAD_AFTER_CUTOVER | delete after confirming no installer references it | LOW |
| MCP legacy tools | `src/tools/specialist/{resume,steer,stop,feed,list}_specialist*.tool.ts` | `Supervisor` (#18-20 for resume/steer/stop) | **none** | dead | DEAD_AFTER_CUTOVER | see §E | LOW |
| MCP channel / request-meta | `src/mcp/channel.ts`, `src/mcp/request-meta.ts` | none | Claude Code channel push | native | PRESERVE_NATIVE | none | none |
| Claude plugin | `plugins/specialists/scripts/mcp-server.mjs`, `plugins/specialists/.mcp.json` | none (launches `dist/index.js` → MCP mode) | Claude Code plugin users | native frontend | FRONTEND_ONLY | none (already native) | none |
| Pi extension | `config/pi-extensions/specialist-subagents/index.mjs:362` | none | Pi sessions | native frontend | PRESERVE_NATIVE | none | none |
| Python client | `clients/python/specialists_client.py` | `/v1/generate` | darth-feedor | external client | PRESERVE_NATIVE | preserve taxonomy 1:1 | none |
| `pi/rpc/*` | `pi/rpc/{rpc-client,rpc-mode,jsonl,rpc-types}.ts` | pi-RPC transport (legacy) | **none** — zero importers in `src/`, `config/`, `tests/` | dead | DEAD_AFTER_CUTOVER | delete; `src/pi/session.ts` spawns `pi` directly and does not import these | LOW |
| `src/specialist/pipeline.ts` | `pipeline.ts:21` | takes a `SpecialistRunner` | **none** — only `tests/unit/specialist/pipeline.test.ts` | dead | DEAD_AFTER_CUTOVER | delete or re-host on native host if a pipeline is wanted | LOW |
| `src/specialist/source-queue.ts` | `source-queue.ts:17` | none | `sp console` (`console/components.ts:50,74,498`) | generic helper | PRESERVE_NATIVE | keep | none |

---

## C) `sp node` — legacy engine or distinct runtime?

**Verdict: a DISTINCT orchestration runtime built directly on top of the legacy job engine. It is not
the legacy engine, and it is not independent of it.** It cannot be retired as a duplicate and cannot
be preserved without migrating its substrate.

Evidence:

1. **Own state machine and contract.** `NodeSupervisor` is a 2411-line class
   (`src/specialist/node-supervisor.ts:409-2411`) with its own states, transitions and contract
   primitives imported from `src/specialist/node-contract.ts` (`node-supervisor.ts:11-21`):
   `ACTION_TYPES`, `VALID_STATE_TRANSITIONS`, `CoordinatorOutputContract`, `NodeCompletionStrategy`,
   `NodeState`. None of these exist in `Supervisor` or `NativeActivationHost`.
2. **Its own persistence.** Node runs/members/memory live in `obs.db` behind
   `readNodeMembers`/`NodeRunRow`/`NodeMemoryRow` (`src/cli/node.ts:11-15`, `node-supervisor.ts:4`),
   a schema distinct from the legacy job registry.
3. **But its execution substrate IS the legacy engine.** `NodeSupervisor` imports `JobControl`
   (`node-supervisor.ts:5`) and constructs it seven times (`:265,918,1005,1672,1978,2067,2077`).
   `JobControl` constructs a `Supervisor` and a real `SpecialistRunner` (`job-control.ts:31,58`) and
   calls `supervisor.run()` (`job-control.ts:68`). `src/cli/node.ts` itself constructs
   `SpecialistRunner` at `:480` and `:901`.
4. **The graph agrees.** `gitnexus impact Supervisor --direction upstream` returns 113 impacted
   symbols with the node runtime as the top affected process (`run@src/specialist/node-supervisor.ts`,
   10 affected process paths, 14 hits). The node runtime is the heaviest caller of the legacy engine
   outside `sp run`.
5. **Architecturally it is a control plane, not a session host.** `NodeSupervisor` reads member
   status via `spawnSync('bd', …)` (`:1474`) and shell commands (`:211,1490`), coordinates a
   coordinator specialist and workers, and runs quality gates (`:1731-1732`). It does not host an
   `AgentSession`; it delegates every actual model turn to a legacy job.

**Consequence.** The node runtime has no path to the native host except through its `JobControl` seam.
Moving it means either (a) re-implementing `JobControl` on `NativeActivationHost` (activation id in
place of job id; no FIFO, no PID, no tmux), or (b) retiring the node runtime. Option (a) is the
MOVE_TO_CORE destination recorded in §A/§B; it is a large piece of work, not a wiring change.

---

## D) `sp script` / `sp serve` — external consumer proof and contracts that must not break

### D.1 External consumer proof (it is not dead)

- `handoff-feedor.md:3-5` names the consumer: *"a one-page operator handoff for adopting
  `specialists-service` v1 in darth-feedor."*
- `handoff-feedor.md:16` — **HTTP**: `POST /v1/generate` and `GET /healthz` via `sp serve`.
- `handoff-feedor.md:17` — **CLI peer**: `sp script <name> …` *"with documented exit codes
  (0/1/2/3/4/5/6/7/75)"* for cron.
- `handoff-feedor.md:18` — **Pre-deploy validator**: `sp validate <path> --target script`.
- `docs/design/darth-feedor-migration.md:14-15` — *"the first reference migration of a real consumer
  onto `specialists-service`. The target is the darth feedor VPS stack."*
- `docs/specialists-service.md` declares itself the SSOT with
  `source_of_truth_for: src/cli/script.ts, src/cli/serve.ts, src/specialist/script-runner.ts,
  Dockerfile, .github/workflows/pi-compat.yml`.
- `clients/python/specialists_client.py` is a shipped reference client, and the migration doc cites a
  live end-to-end smoke (`handoff-feedor.md:20`).
- Closed `error_type` taxonomy is documented (`docs/specialists-service.md:85`) and mirrored 1:1 in
  the Python client (`:104`).

### D.2 Frozen contract surfaces

**Exit codes** (`src/cli/script.ts:102-119`, `mapExitCode`):

| code | condition (`error_type`) |
|---|---|
| 0 | success |
| 1 | default / internal |
| 2 | `specialist_not_found`, `specialist_load_error` |
| 3 | `template_variable_missing` |
| 4 | `auth`, `quota` |
| 5 | `timeout`, `network` |
| 6 | `invalid_json` |
| 7 | `output_too_large` |
| 75 | single-instance lock contended (`script.ts:127-131`, `flock -n` exit 1 → 75) |

**HTTP shapes** (`src/cli/serve.ts`):

| route | method | success | failure |
|---|---|---|---|
| `/healthz` | GET | `200 {ok:true}` (`:306`) | — |
| `/v1/generate` | POST | `200` with the `ScriptGenerateResult` body (`:426`) | `400 {success:false,error:'malformed_request',error_type:'invalid_json'}` (`:388,394`); `404 {error:'not_found'}` (`:341`); `429 {error:'too_many_requests',error_type:'quota'}` (`:374`); `503 {error:'shutting_down'}` (`:359`); `500 {error:'internal_error'}` (`:438`) |
| `/readyz` | GET | `200 {ready:true, db_write_failures_total}` (`:333`) | `503 {ready:false, reason, db_write_failures_total}` (`:335`) |
| `/metrics` | GET | Prometheus text (`:319-322`) | `503 observability_unavailable` |
| feed events | GET | `200 {job_id, …}` (`:313`) | `503` |

Documented behaviours that must survive any migration: failures stay **HTTP 200 with `success:false`**
for model/tool failures (`docs/specialists-service.md:85`) — only transport/validation failures use
non-200; concurrency overflow waits behind the semaphore then `429` (`:137`); the route set is
`POST /v1/generate` + `GET /healthz` per the handoff, with `/readyz` and `/metrics` already shipped.

**Runtime constraints** (`script-runner.ts` `compatGuard`, exported and enforced by
`sp validate --target script`): script-class rejects interactive, worktree, keep-alive, orchestration,
and (by default) write-capable/`skills.paths` use. `handoff-feedor.md:54` records `skills.paths` as a
forbidden prompt-injection vector and the trust flags as deferred behind `unitAI-3k6sa`.

### D.3 Dependency note (relevant to the cutover, not to this surface)

`script-runner.ts` and `runScriptSpecialist` depend on `PiAgentSession` and the pi-RPC transport
(`script-runner.ts:16,1126`), which is the same transport the legacy job engine uses. `sp script`/`sp
serve` therefore keep `PiAgentSession` alive even after the legacy job engine is retired. This is a
scheduling constraint on any "delete `src/pi/session.ts`" step, not a defect in the service surface.

---

## E) MCP tool-surface mixing

### E.1 What each server registers

| server | reachable? | entry | tools registered |
|---|---|---|---|
| MCP v2 (product) | **yes** | `src/index.ts:1462` → `serveV2Stdio()` → `buildV2Server` (`v2-server.ts:90`) | native: `specialist_status`, `specialist_dispatch`, `specialist_reply`, `specialist_resume`, `specialist_stop_activation`, `specialist_list` (`v2-server.ts:165-172`); plus `substrate_issue`, `substrate_journal`, `substrate_provenance` when Substrate resolves (`v2-server.ts:155-163`) |
| MCP legacy class | **no** | `src/server.ts:120` `SpecialistsServer` | native set **plus** `specialist_retry` (`server.ts:166-172`). Zero importers; not launched by any entrypoint, installer, plugin or test. |
| Legacy tool factories | **no** | `src/tools/specialist/*.tool.ts` | `resume_specialist`, `steer_specialist`, `stop_specialist`, `feed_specialist`, `list_specialists` — **none registered anywhere** |

### E.2 Which MCP tools still construct the LEGACY `Supervisor`

Three, and **all three are unreachable dead code**:

- `resume_specialist` — `src/tools/specialist/resume_specialist.tool.ts:38` (`new Supervisor`).
- `steer_specialist` — `src/tools/specialist/steer_specialist.tool.ts:31`.
- `stop_specialist` — `src/tools/specialist/stop_specialist.tool.ts:17`.

`grep -rn "createResumeSpecialistTool\|createSteerSpecialistTool\|createStopSpecialistTool"` across the
repo returns only their own definitions plus, for stop, one unit test
(`tests/unit/tools/specialist/stop_specialist.tool.test.ts`). Neither `buildV2Server` nor
`SpecialistsServer` imports them. They are not a live legacy surface; they are residual files.

The two remaining unregistered legacy factories do **not** construct `Supervisor`:
`feed_specialist.tool.ts` (reads `obs.db`/timeline) and `list_specialists.tool.ts` (reads the loader).
`feed_specialist` is nonetheless superseded — `specialist_status` is the documented recovery surface
(`src/mcp/channel.ts:73-76`) — and `list_specialists` is superseded by `specialist_list`.

### E.3 What a frontend actually sees

- **Claude Code (plugin)** → `plugins/specialists/.mcp.json` → `mcp-server.mjs` → local
  `dist/index.js` → no-subcommand MCP mode → `serveV2Stdio` → `buildV2Server`. A coordinator sees the
  six `specialist_*` tools plus Substrate. It never sees `resume_specialist`/`steer_specialist`/
  `stop_specialist`/`feed_specialist`/`list_specialists`/`specialist_retry`.
- **Pi session** → `config/pi-extensions/specialist-subagents/index.mjs` registers the Pi tool
  variants over the same `NativeActivationHost` (`index.mjs:42,362,1047-1538`); no MCP transport.
- **Both are native-frontends-over-native-host.** There is no frontend that reaches the legacy engine
  through MCP; the only legacy reach into MCP is the dead `src/server.ts`.
- **Consequence for the migration:** removing the legacy engine requires **no** MCP tool removals —
  the three legacy tools are already unregistered. The only real gap is that the **native
  `specialist_retry` is not registered in v2**, while the CLI `sp retry` still routes through legacy
  `sp run` (see §F).

---

## F) GAPS / blockers

1. **`specialist_retry` is registered only in the dead `src/server.ts`** (`server.ts:170`), not in the
   product server (`v2-server.ts:165-172`). The CLI `sp retry` still reconstructs `sp run` argv
   (`retry.ts:63-73`) and re-invokes the legacy path. A coordinator on the installed entrypoint has no
   retry tool. Blocker to declaring retry migrated. Destination set to REUSE_EXISTING_NATIVE.
2. **No native equivalence for `sp finalize`.** `finalizeJob`
   (`src/specialist/control.ts:201-253`) closes every waiting keep-alive member of a chain after a
   reviewer PASS, keyed by `chain_id`. Native activations have no chain identity or keep-alive wait
   state (`docs/migrations/xtrm-93/state-machine-delta.md`: native separates activation from attempt
   and has no `waiting` job state). Until a native settlement/chain model exists, `sp finalize` is
   load-bearing and cannot be retired. HIGH.
3. **`sp node` cannot follow the cutover without a `JobControl` replacement.** Its seven
   `new JobControl` sites are its only execution seam; `JobControl` is built on `Supervisor` +
   `SpecialistRunner` + FIFO + PID + tmux. A native `JobControl` equivalent (activation-id keyed,
   no FIFO/PID/tmux) does not exist. HIGH.
4. **Background/detached lifetime has no native mechanism.** `--background` re-invokes the CLI as a
   detached child (`run.ts:1763-1766`) with optional tmux; native activations live inside the MCP/Pi
   process. Any coordinator that relies on a job outliving the dispatching terminal loses that
   guarantee under the native host. Needs an explicit lifetime decision. HIGH.
5. **`PiAgentSession` / pi-RPC is shared by the script/service runtime.** Deleting the legacy engine's
   transport is gated on `script-runner` no longer needing it. `script-runner.ts:16,1126` depend on
   `PiAgentSession`. Scheduling blocker for the deletion step, not for correctness. MED.
6. **`sp console` and `sp status` read job-dir state.** `console/runtime.ts:958-981` and
   `status.ts:294` read `SupervisorStatus` from files; native activations are not written to job
   directories. Those read surfaces need a concrete new source before the job-dir mirror is removed.
   MED.

## G) UNKNOWNs

1. **Whether the node runtime has an external consumer.** No document in the tree names one; no
   `sp node` invocation was found outside the CLI and tests. Without a named consumer, the
   MOVE_TO_CORE vs INTENTIONAL_RETIREMENT choice for `sp node` cannot be decided from the repository
   alone. Reason: consumer evidence is operator-side, not in-repo.
2. **Whether darth-feedor is actually live on `specialists-service`.** The handoff is written as
   operator work not yet done (`handoff-feedor.md:24-47`, phases 1-5). The contract is real and
   shipped; whether a production consumer currently depends on it is not provable from this tree.
   Reason: external deployment state.
3. **Whether `src/server.ts` is referenced by an installer or packaging manifest outside the audited
   globs.** `grep` found zero importers in `src/`, `config/`, `plugins/`, `scripts/`, `tests/`.
   Package-surface manifests (`package.json` exports, release attestation scripts) were not exhaustively
   traced. Reason: bounded scope.
4. **Whether `pi/rpc/*` is referenced by an out-of-tree consumer** (the `pi/pi-rpc.md` doc and
   `pi/rpc/rpc-types.ts` suggest a once-intended published surface). In-tree importers are zero.
   Reason: `pi/rpc/` sits outside `src/`; packaging includes or excludes were not traced.
5. **Exact retirement order between `sp stop`/`sp steer` and the native ask/reply model.** `sp stop`
   maps onto `specialist_stop_activation`, but steer's mid-run semantics versus native `specialist_reply`
   (which answers an ask) are not a proven 1:1 mapping. Reason: the native host has no mid-turn steer
   primitive equivalent to the legacy FIFO `{type:'steer'}` message that was audited only at the CLI
   boundary.

## H) Unrelated findings

1. `src/server.ts:1-14` — the file header still claims *"`use_specialist` is the legacy path: it runs a
   Specialist through `SpecialistRunner`"*. The class no longer contains that path; every registered
   tool is native. The comment is stale and will mislead the next reader of the migration.
2. `src/cli/quickstart.ts:219-221` — the printed MCP tool list advertises `list_specialists`,
   `feed_specialist`, `steer_specialist`, `resume_specialist`, `stop_specialist` and
   `specialist_dispatch`. Most of those names are not registered on the installed entrypoint (only
   `specialist_dispatch` and `specialist_status` match). Quickstart output contradicts `v2-server.ts`.
3. `src/specialist/pipeline.ts` — `runPipeline` has no production caller; only its own test imports it.
4. `pi/rpc/{rpc-client,rpc-mode,jsonl,rpc-types}.ts` — four files, zero importers anywhere in
   `src/`, `config/`, `plugins/`, `scripts/`, `tests/`.
5. `src/tools/specialist/feed_specialist.tool.ts` and `list_specialists.tool.ts` — unregistered
   wholesale tools, reachable only from a test.
6. `src/server.ts` `SpecialistsServer` — a fully independent, unreferenced duplicate of the MCP v2
   server, still carrying the `specialist_retry` registration that v2 lacks. The dead file is the only
   place the native retry tool is wired.
