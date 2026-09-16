# XTRM-93 — Native Execution Graph (GitNexus)

**Lane:** I (architecture maps and cut-line overlay)
**Source of truth:** git `master` `472b1aef` + one local commit (`unitAI-rx1bu`); worktree HEAD `6553ef05`.
**Audited tree:** `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh` (branch `xt/akkh`).
**Index used:** `repo="/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh"` — a **fresh worktree index**
(`Indexed commit: 6553ef0 == Current commit: 6553ef0`, 742 files / 22 207 symbols / 54 636 edges, CLI 1.6.11).
Not the repo-wide `ce33c31` index.

**Conventions:** identical to `gitnexus-legacy-graph.md` — `live execution` = `CALLS` with `confidence >= 0.80` or a
non-type `IMPORTS`; `type-only` = `import (type-only)`; `INFERRED` = the graph could not resolve the edge and a
`file:line` is given with the reason.

---

## 1. Node inventory

| uid | file:line | layer | role |
|---|---|---|---|
| `fe.pi-ext` | `config/pi-extensions/specialist-subagents/index.mjs:357` | F0 frontend | Pi coordinator extension: createCoordinatorHost constructs NativeActivationHost |
| `fe.mcp.v2` | `src/mcp/v2-server.ts:89` | F0 frontend | MCP v2 server: builds host, registers activation + substrate tools |
| `fe.mcp.resume` | `src/mcp/resume-tool.ts:68` | F0 frontend | specialist_resume MCP tool |
| `fe.mcp.channel` | `src/mcp/channel.ts:138` | F0 frontend | primary Claude wake: `withChannelPush` (notifications/claude/channel) |
| `fe.server.legacy` | `src/server.ts:144` | F0 frontend | legacy MCP server; use_specialist (legacy) + activation tools (native) |
| `fe.tool.dispatch` | `src/tools/specialist/activation.tool.ts:330` | F0 frontend | specialist_dispatch tool factory |
| `fe.tool.execute` | `src/tools/specialist/activation.tool.ts:354` | F0 frontend | calls getHost().start()/inspect() |
| `fe.tool.reply` | `src/tools/specialist/activation.tool.ts:497` | F0 frontend | specialist_reply |
| `fe.tool.stop` | `src/tools/specialist/activation.tool.ts:539` | F0 frontend | specialist_stop |
| `fe.tool.retry` | `src/tools/specialist/activation.tool.ts:585` | F0 frontend | specialist_retry |
| `fe.tool.issue` | `src/tools/substrate/issue.tool.ts:81` | F0 frontend | substrate_issue |
| `fe.tool.journal` | `src/tools/substrate/journal.tool.ts:110` | F0 frontend | substrate_journal |
| `fe.tool.provenance` | `src/tools/substrate/provenance.tool.ts:64` | F0 frontend | substrate_provenance |
| `host.NativeActivationHost` | `src/activation/native-host.ts:442` | N1 host | the shared runtime seam both frontends construct |
| `host.start` | `src/activation/native-host.ts:506` | N1 host | admission: loader, lease, work gate, session, bind, registry, save |
| `host.retry` | `src/activation/native-host.ts:1879` | N1 host | same activation/snapshot, new attempt id, re-acquire lease |
| `host.resume` | `src/activation/native-host.ts:2245` | N1 host | re-acquire lease, re-bind session, continue same activation |
| `host.stop` | `src/activation/native-host.ts:2191` | N1 host | release lease if writer, forget snapshot, remove from registry |
| `host.answer` | `src/activation/native-host.ts:2008` | N1 host | routes an MCP reply into InteractionTransport |
| `host.inspect` | `src/activation/native-host.ts:2137` | N1 host | snapshot projection from the Fleet |
| `host.liveStats` | `src/activation/native-host.ts:2145` | N1 host | aggregate live stats from Fleet projections |
| `host.list` | `src/activation/native-host.ts:2182` | N1 host | registry list |
| `host.runToSettled` | `src/activation/native-host.ts:1517` | N2 turn loop | prompt -> waitForIdle -> validate -> settle/fail |
| `host.runWithFallback` | `src/activation/native-host.ts:1732` | N2 turn loop | model-chain walk on retryable failures |
| `host.publishTerminalSettlement` | `src/activation/native-host.ts:1672` | N5 settlement | builds SettlementSubject and calls publishSettlement |
| `host.createVerifiedSession` | `src/activation/native-host.ts:1191` | N3 session | creates session and fails closed on missing promised tools |
| `host.releaseIfWriter` | `src/activation/native-host.ts:2059` | N4 lease | release on settle/completion/stop; uncertainty -> evidence |
| `host.admitToolCall` | `src/activation/native-host.ts:2106` | N4 lease | per-mutating-call lease re-check |
| `host.save` | `src/activation/native-host.ts:2027` | N6 telemetry | persists the Fleet projection via AuthorityWriter |
| `host.resolveWorkItems` | `src/activation/native-host.ts:1367` | N5 substrate | lazily opens the canonical Substrate work boundary |
| `host.onSessionEvent` | `src/activation/native-host.ts:1437` | N6 telemetry | maps session events to forensic emits and token usage |
| `sdk.loadPiSdk` | `src/activation/pi-sdk.ts:167` | N3 session | resolves and caches the in-process Pi SDK |
| `sdk.piSdkCandidates` | `src/activation/pi-sdk.ts:150` | N3 session | candidate resolution incl. global node_modules |
| `fleet.FleetRegistry` | `src/activation/registry.ts:54` | N6 fleet | in-memory activation registry |
| `fleet.register` | `src/activation/registry.ts:57` | N6 fleet | registers ActivationRecord |
| `fleet.projection` | `src/activation/registry.ts:74` | N6 fleet | projects a live ActivationSnapshot |
| `work.openWorkItemBoundary` | `src/activation/workitem-store.ts:892` | N5 substrate | dynamically opens the Substrate store/boundary |
| `work.createWorkItemBoundary` | `src/activation/workitem-store.ts:550` | N5 substrate | boundary impl over issue/journal/provenance ports |
| `work.inlineCreate` | `src/activation/workitem-store.ts:677` | N5 substrate | validate -> create issue -> attest -> claim |
| `work.check` | `src/activation/workitem-store.ts:627` | N5 substrate | dispatchability gate |
| `work.bind` | `src/activation/workitem-store.ts:634` | N5 substrate | ExecutionBinding pin (issue/revision/hash/claim/session) |
| `work.view` | `src/activation/workitem-store.ts:569` | N5 substrate | issue view (contract text, state) |
| `lease.acquire` | `src/activation/workspace-lease.ts:276` | N4 lease | workspace write lease acquisition |
| `lease.release` | `src/activation/workspace-lease.ts:347` | N4 lease | lease release with holder verification |
| `lease.admitToolCall` | `src/activation/workspace-lease.ts:475` | N4 lease | mutating-tool admission check |
| `lease.inspect` | `src/activation/workspace-lease.ts:228` | N4 lease | read-only lease status projection |
| `settle.publishSettlement` | `src/activation/settlement-publication.ts:514` | N5 settlement | deferred->published settlement write + receipt/artifact |
| `settle.republishPendingSettlements` | `src/activation/settlement-publication.ts:431` | N5 settlement | once-per-process backlog drain |
| `settle.republishSettlement` | `src/activation/settlement-publication.ts:245` | N5 settlement | single-record republish with reconciliation |
| `settle.createFileSettlementStore` | `src/activation/settlement-store.ts:166` | N5 settlement | file store under .specialists/settlements/ |
| `settle.withSettlementExclusion` | `src/activation/settlement-lease.ts:116` | N5 settlement | cross-process settlement exclusion + holder reclaim |
| `tel.createActivationForensicSink` | `src/activation/forensic-sink.ts:157` | N6 telemetry | activation events -> observability.db status/forensic rows |
| `ctr.compileStepContract` | `src/activation/step-contract.ts:138` | N2 turn loop | compiles the StepContract from the issue contract |
| `ctr.extractPurposeExcerpt` | `src/activation/contract-sections.ts:146` | N2 turn loop | purpose excerpt for the snapshot |
| `interaction.InteractionTransport` | `src/activation/interaction.ts:129` | N2/N6 | ask/answer transport between specialist and coordinator |
| `peers.createPeerDelivery` | `src/activation/peer-bridge.ts:60` | N6 transport | push asks/replies over the peer channel |
| `gate.createGateModelRuntime` | `src/activation/model-gate.ts:56` | N3 session | model availability gate runtime |
| `guard.createGuardedTools` | `src/activation/guarded-tools.ts:92` | N4 lease | wraps pi mutating builtins with lease admission |
| `ask.createAskTools` | `src/activation/ask-tool.ts:83` | N2/N6 | ask/escalate tools for the specialist |

## 2. Edge inventory (GitNexus `CALLS`, confidence >= 0.80)

| from | kind | to | edge class | evidence |
|---|---|---|---|---|
| `host.resolveWorkItems` | CALLS | `work.openWorkItemBoundary` | live execution | `src/activation/native-host.ts:1366` -> `src/activation/workitem-store.ts:892` |
| `host.onSessionEvent` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:1437` -> `src/activation/native-host.ts:2027` |
| `host.onSessionEvent` | CALLS | `host.releaseIfWriter` | live execution | `src/activation/native-host.ts:1437` -> `src/activation/native-host.ts:2059` |
| `host.runToSettled` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:1516` -> `src/activation/native-host.ts:2027` |
| `host.runToSettled` | CALLS | `host.releaseIfWriter` | live execution | `src/activation/native-host.ts:1516` -> `src/activation/native-host.ts:2059` |
| `host.runToSettled` | CALLS | `host.publishTerminalSettlement` | live execution | `src/activation/native-host.ts:1516` -> `src/activation/native-host.ts:1672` |
| `host.publishTerminalSettlement` | CALLS | `settle.publishSettlement` | live execution | `src/activation/native-host.ts:1671` -> `src/activation/settlement-publication.ts:514` |
| `host.runWithFallback` | CALLS | `host.releaseIfWriter` | live execution | `src/activation/native-host.ts:1731` -> `src/activation/native-host.ts:2059` |
| `host.runWithFallback` | CALLS | `host.runToSettled` | live execution | `src/activation/native-host.ts:1731` -> `src/activation/native-host.ts:1517` |
| `host.runWithFallback` | CALLS | `host.onSessionEvent` | live execution | `src/activation/native-host.ts:1731` -> `src/activation/native-host.ts:1437` |
| `host.runWithFallback` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:1731` -> `src/activation/native-host.ts:2027` |
| `host.runWithFallback` | CALLS | `lease.acquire` | live execution | `src/activation/native-host.ts:1731` -> `src/activation/workspace-lease.ts:276` |
| `host.retry` | CALLS | `gate.createGateModelRuntime` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/model-gate.ts:56` |
| `host.retry` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/native-host.ts:2027` |
| `host.retry` | CALLS | `host.onSessionEvent` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/native-host.ts:1437` |
| `host.retry` | CALLS | `host.runToSettled` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/native-host.ts:1517` |
| `host.retry` | CALLS | `host.releaseIfWriter` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/native-host.ts:2059` |
| `host.retry` | CALLS | `lease.acquire` | live execution | `src/activation/native-host.ts:1878` -> `src/activation/workspace-lease.ts:276` |
| `host.releaseIfWriter` | CALLS | `lease.release` | live execution | `src/activation/native-host.ts:2059` -> `src/activation/workspace-lease.ts:347` |
| `host.admitToolCall` | CALLS | `host.admitToolCall` | live execution | `src/activation/native-host.ts:2106` -> `src/activation/native-host.ts:2106` |
| `host.inspect` | CALLS | `fleet.projection` | live execution | `src/activation/native-host.ts:2136` -> `src/activation/registry.ts:74` |
| `host.liveStats` | CALLS | `fleet.projection` | live execution | `src/activation/native-host.ts:2144` -> `src/activation/registry.ts:74` |
| `host.stop` | CALLS | `host.releaseIfWriter` | live execution | `src/activation/native-host.ts:2190` -> `src/activation/native-host.ts:2059` |
| `host.resume` | CALLS | `host.onSessionEvent` | live execution | `src/activation/native-host.ts:2244` -> `src/activation/native-host.ts:1437` |
| `host.resume` | CALLS | `host.runToSettled` | live execution | `src/activation/native-host.ts:2244` -> `src/activation/native-host.ts:1517` |
| `host.resume` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:2244` -> `src/activation/native-host.ts:2027` |
| `host.resume` | CALLS | `lease.acquire` | live execution | `src/activation/native-host.ts:2244` -> `src/activation/workspace-lease.ts:276` |
| `host.NativeActivationHost` | CALLS | `fleet.FleetRegistry` | live execution | `src/activation/native-host.ts:442` -> `src/activation/registry.ts:54` |
| `host.start` | CALLS | `ask.createAskTools` | live execution | `src/activation/native-host.ts:505` -> `src/activation/ask-tool.ts:83` |
| `host.start` | CALLS | `guard.createGuardedTools` | live execution | `src/activation/native-host.ts:505` -> `src/activation/guarded-tools.ts:92` |
| `host.start` | CALLS | `gate.createGateModelRuntime` | live execution | `src/activation/native-host.ts:505` -> `src/activation/model-gate.ts:56` |
| `host.start` | CALLS | `host.createVerifiedSession` | live execution | `src/activation/native-host.ts:505` -> `src/activation/native-host.ts:1191` |
| `host.start` | CALLS | `host.runWithFallback` | live execution | `src/activation/native-host.ts:505` -> `src/activation/native-host.ts:1732` |
| `host.start` | CALLS | `host.resolveWorkItems` | live execution | `src/activation/native-host.ts:505` -> `src/activation/native-host.ts:1367` |
| `host.start` | CALLS | `host.save` | live execution | `src/activation/native-host.ts:505` -> `src/activation/native-host.ts:2027` |
| `host.start` | CALLS | `fleet.register` | live execution | `src/activation/native-host.ts:505` -> `src/activation/registry.ts:57` |
| `host.start` | CALLS | `ctr.compileStepContract` | live execution | `src/activation/native-host.ts:505` -> `src/activation/step-contract.ts:138` |
| `host.start` | CALLS | `work.inlineCreate` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workitem-store.ts:677` |
| `host.start` | CALLS | `work.view` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workitem-store.ts:569` |
| `host.start` | CALLS | `work.bind` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workitem-store.ts:634` |
| `host.start` | CALLS | `work.check` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workitem-store.ts:627` |
| `host.start` | CALLS | `lease.acquire` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workspace-lease.ts:276` |
| `host.start` | CALLS | `lease.release` | live execution | `src/activation/native-host.ts:505` -> `src/activation/workspace-lease.ts:347` |
| `sdk.loadPiSdk` | CALLS | `sdk.piSdkCandidates` | live execution | `src/activation/pi-sdk.ts:167` -> `src/activation/pi-sdk.ts:150` |
| `settle.withSettlementExclusion` | CALLS | `lease.release` | live execution | `src/activation/settlement-lease.ts:116` -> `src/activation/workspace-lease.ts:347` |
| `settle.republishSettlement` | CALLS | `settle.withSettlementExclusion` | live execution | `src/activation/settlement-publication.ts:245` -> `src/activation/settlement-lease.ts:116` |
| `settle.republishPendingSettlements` | CALLS | `settle.republishSettlement` | live execution | `src/activation/settlement-publication.ts:431` -> `src/activation/settlement-publication.ts:245` |
| `settle.publishSettlement` | CALLS | `settle.withSettlementExclusion` | live execution | `src/activation/settlement-publication.ts:514` -> `src/activation/settlement-lease.ts:116` |
| `work.openWorkItemBoundary` | CALLS | `work.createWorkItemBoundary` | live execution | `src/activation/workitem-store.ts:892` -> `src/activation/workitem-store.ts:550` |
| `lease.acquire` | CALLS | `lease.inspect` | live execution | `src/activation/workspace-lease.ts:276` -> `src/activation/workspace-lease.ts:228` |
| `lease.release` | CALLS | `lease.inspect` | live execution | `src/activation/workspace-lease.ts:347` -> `src/activation/workspace-lease.ts:228` |
| `lease.admitToolCall` | CALLS | `lease.inspect` | live execution | `src/activation/workspace-lease.ts:475` -> `src/activation/workspace-lease.ts:228` |

### 2a. INFERRED edges (graph could not resolve them)

| from | kind | to | edge class | why the graph could not confirm it | evidence |
|---|---|---|---|---|---|
| `fe.tool.execute` (all four activation tools) | CALLS | `host.start` / `host.inspect` / `host.stop` / `host.retry` / `host.answer` | live execution (INFERRED) | The host is reached through a `getHost: () => NativeActivationHost` **callback parameter**; the call target is `getHost().start(...)`. A raw graph trace confirms the gap: `gitnexus trace createSpecialistDispatchTool NativeActivationHost` -> `status: "no_path"`, `suggestion: "The call chain likely breaks at dynamic dispatch…"`. | `src/tools/specialist/activation.tool.ts:330` (`getHost: () => NativeActivationHost`), `:408` (`getHost().start(`), `:448` (`getHost().inspect(`), `:528`, `:547`, `:599` |
| `fe.pi-ext` | CALLS | `host.NativeActivationHost` | live execution (INFERRED) | The Pi extension imports the **built** entry `../../../dist/lib.js` by relative path; the graph has **no** IMPORTS or CALLS rows for `config/pi-extensions/specialist-subagents/index.mjs` into `src/`. Verified: `MATCH (a:File)-[:CodeRelation {type:'IMPORTS'}]->(b:File) WHERE a.filePath='config/pi-extensions/specialist-subagents/index.mjs'` -> 0 rows. | `config/pi-extensions/specialist-subagents/index.mjs:42` (`NativeActivationHost,`), `:57` (`from '../../../dist/lib.js'`), `:362` (`const HostCtor = Host ?? NativeActivationHost`) |
| `fe.mcp.v2` / `fe.server.legacy` | CALLS | `host.NativeActivationHost` | live execution | **Present** in the graph as a `CALLS` edge to the `Class` node (`v2-server.ts:89`, `server.ts:144`) — listed here only to contrast with the Pi-extension gap. | `gitnexus cypher "MATCH (a)-[:CodeRelation {type:'CALLS'}]->(b) WHERE a.filePath='src/mcp/v2-server.ts' …"` |
| `host.start` | CALLS | `sdk.createAgentSession` (Pi SDK) | live execution (INFERRED) | `loadPiSdk()` returns an external SDK handle; the session is created on `sdk.createAgentSession(...)`, an external API boundary. | `native-host.ts:1195` (`await sdk.createAgentSession({...})`) |
| `host.start`/`retry`/`resume` | CALLS | `session.prompt` / `session.subscribe` | live execution | **Present** in the graph (`pi-sdk.ts:88 prompt`, `:93 subscribe`, `:96 waitForIdle` are `Method` nodes called from `native-host.ts`). | edge table |
| `host.save` | CALLS | `authority.record` | live execution | Present: `native-host.ts:2027 -> authority-store.ts:151 record`. The default writer is a **no-op**; production MCP servers inject `createFileAuthorityWriter()`. | edge table; `native-host.ts:389-395`, `mcp/v2-server.ts:89` |
| `work.openWorkItemBoundary` | USES | external Substrate package modules | live execution (INFERRED) | The boundary is loaded by **runtime dynamic import** from `XTRM_SUBSTRATE_DIR`; the package is not in the repo graph. Fail-closed when absent. | `workitem-store.ts:869-876` (`SUBSTRATE_REQUIRED_MODULES`), `:948-1010` (`load()`), `:965-976` |
| `settle.publishSettlement` | CALLS | `boundary.appendResult` / `allocateReceipt` / `attachArtifact` | live execution (INFERRED) | Calls are property accesses on the injected boundary port object (`boundary.appendResult(...)`, `boundary.allocateReceipt(...)`, `boundary.attachArtifact(...)`), so the graph records no `CALLS` edges. | `settlement-publication.ts:268,277,278,350,355,357,365,574,588,589,603,608,609,629`; port methods declared at `workitem-store.ts:399,400,401,522,523` |
| `tel.createActivationForensicSink` | CALLS | `observability-sqlite.upsertStatus` / `upsertStatusWithEvents` | live execution | Present in the graph: `forensic-sink.ts:164 -> observability-sqlite.ts:2002/2046`. This is the native stack writing the **legacy job tables**. | edge table |

## 3. Mermaid — native execution graph

```mermaid
flowchart TD
  PIEXT["config/pi-extensions/specialist-subagents/index.mjs:357<br/>createCoordinatorHost (Pi plugin)"]
  MCPV2["src/mcp/v2-server.ts:89 buildV2Server<br/>(Claude MCP)"]
  SERVER["src/server.ts:144 Server ctor<br/>(legacy + native MCP)"]
  CHANNEL["src/mcp/channel.ts<br/>notifications/claude/channel"]
  T_DISPATCH["tools/specialist/activation.tool.ts:330<br/>createSpecialistDispatchTool"]
  T_REPLY["createSpecialistReplyTool :497"]
  T_STOP["createSpecialistStopActivationTool :539"]
  T_RETRY["createSpecialistRetryTool :585"]
  T_ISSUE["tools/substrate/issue.tool.ts:81"]
  T_JOURNAL["tools/substrate/journal.tool.ts:110"]
  T_PROV["tools/substrate/provenance.tool.ts:64"]

  HOST["activation/native-host.ts:442 NativeActivationHost"]
  START["start :506"]
  RETRY["retry :1879"]
  RESUME["resume :2245"]
  STOP["stop :2191"]
  ANSWER["answer :2008"]
  INSPECT["inspect :2137 / liveStats :2145 / list :2182"]
  R2S["runToSettled :1517"]
  RWF["runWithFallback :1732"]
  PUB["publishTerminalSettlement :1672"]
  VSESS["createVerifiedSession :1191"]

  SDK["pi-sdk.loadPiSdk :167"]
  PISESS["pi/session.PiAgentSession :1044"]
  PISTART["PiAgentSession.start :1089 -> spawn('pi', --mode rpc) :1208"]

  FLEET["registry.FleetRegistry :54"]
  LEASE["workspace-lease acquire :276 / release :347 / admitToolCall :475"]
  WORK["workitem-store.openWorkItemBoundary :892"]
  SUBDB[("Substrate state.db<br/>issues / execution_bindings<br/>journal(result) / provenance receipts+artifacts")]

  SPUB["settlement-publication.publishSettlement :514"]
  SSTORE["settlement-store.createFileSettlementStore :166<br/>.specialists/settlements/&lt;act&gt;/&lt;att&gt;.json"]
  SLEASE["settlement-lease.withSettlementExclusion :116"]

  SINK["forensic-sink.createActivationForensicSink :157"]
  OBSDB[("observability.db<br/>specialist_jobs / specialist_events")]
  AUTHOR["authority-store.record :151 (no-op default)"]

  PIEXT -.->|INFERRED dist/lib.js| HOST
  MCPV2 --> HOST
  SERVER --> HOST
  MCPV2 --> T_DISPATCH
  MCPV2 --> T_REPLY
  MCPV2 --> T_STOP
  SERVER --> T_RETRY
  MCPV2 --> T_ISSUE
  MCPV2 --> T_JOURNAL
  MCPV2 --> T_PROV
  MCPV2 --> CHANNEL
  T_DISPATCH ==>|INFERRED getHost().start| START
  T_REPLY ==>|INFERRED getHost().answer| ANSWER
  T_STOP ==>|INFERRED| STOP
  T_RETRY ==>|INFERRED| RETRY
  HOST --> START
  HOST --> INSPECT
  START --> WORK
  START --> LEASE
  START --> VSESS
  START --> RWF
  START --> FLEET
  RETRY --> LEASE
  RESUME --> LEASE
  STOP --> LEASE
  INSPECT --> FLEET
  RWF --> R2S
  VSESS --> SDK --> PISESS --> PISTART
  R2S --> PUB
  PUB --> SPUB --> SLEASE
  SPUB --> SSTORE
  R2S --> LEASE
  HOST --> SINK --> OBSDB
  HOST --> AUTHOR
  WORK --> SUBDB
```

## 4. Frontends (the surfaces that own UX/transport over the service boundary)

| frontend | file | how it reaches the native core | evidence |
|---|---|---|---|
| Pi plugin (coordinator extension, "PRIMARY coordinator surface") | `config/pi-extensions/specialist-subagents/index.mjs` | constructs `NativeActivationHost` from `dist/lib.js`; renders the fleet rail, asks, settlements | `:42`, `:57`, `:357 createCoordinatorHost`, `:362` |
| Claude Code plugin (MCP launcher + hooks + skill) | `plugins/specialists/scripts/mcp-server.mjs`, `hooks/hooks.json`, `skills/supervising-activations/SKILL.md`, `scripts/{session-start,wake-watch,lease-warn}.mjs` | launcher imports `dist/index.js`; hooks read the Substrate DB and the workspace lease read-only | `mcp-server.mjs:24-30`; `wake-watch.mjs:1-20`; `lease-warn.mjs:20-38`; `session-start.mjs:14-30` |
| MCP v2 server | `src/mcp/v2-server.ts` | builds the host, registers 6 tools + resume, wires channel push | `:89 buildV2Server`; `gitnexus calls v2-server.ts -> native-host.ts:NativeActivationHost` |
| MCP legacy server | `src/server.ts` | `use_specialist` (legacy `SpecialistRunner`) **and** the native activation tools in one server | `:1-13` header comment; `:144 constructor` |
| MCP tool adapters | `src/tools/specialist/activation.tool.ts`; `src/tools/substrate/*.ts` | thin adapters; the only place `getHost()` is dereferenced | `activation.tool.ts:330-482`, `:497-526`, `:539-560`, `:585-633`; `issue.tool.ts:81`, `journal.tool.ts:110`, `provenance.tool.ts:64` |
| MCP resume tool | `src/mcp/resume-tool.ts` | `specialist_resume` (same session, attempt advances) | `:68 execute (68-116)`; v2-server.ts:14-19 header |
| Claude channel | `src/mcp/channel.ts` | primary wake push; degrades to polling | `wake-watch.mjs:3-7`; `v2-server.ts` imports `withChannelPush` |

## 5. Terminal side effects

### 5.1 Subprocesses

**None.** This is the architectural point of the native path: the host runs the Pi `AgentSession` **in process**
via `loadPiSdk()` (`native-host.ts:76`, `pi-sdk.ts:167`). `src/server.ts:6-9` states the native activation tools
"call `NativeActivationHost` in-process — no `sp` child process is spawned … asserted against the process table".
`Session.prompt()` is an in-process call on the SDK session, not an RPC spawn.
(Tool-level `pi.exec` / `executeBash` inside the agent turn can still run commands, but those are the agent's
tools, not host-spawned processes.)

### 5.2 Files written

| artifact | writer | evidence |
|---|---|---|
| `.specialists/settlements/<activationId>/<attemptId>.json` | `createFileSettlementStore.save` | `settlement-store.ts:166-176` (`pathFor`, `save`) |
| settlement store readdir on republish | `createFileSettlementStore.readAll` | `settlement-store.ts:213-243` |
| workspace lease file(s) under the lease dir | `workspace-lease.acquire/release/rewrite` | `workspace-lease.ts:187-219` (`workspaceKey`, `leaseDir`, `leasePath`), `:276,329,347` |
| settlement exclusion lock + `take`/`reclaimIfHolderGone` | `settlement-lease.withSettlementExclusion` | `settlement-lease.ts:116-243` |
| `.specialists/interactions/` pending-ask store | `transport/pending-store` | `pending-store.ts` (`create`, `recordAttempt`, `recordReceipt`, `writeAtomic`) |
| fleet projection (when a file `AuthorityWriter` is injected) | `host.save` -> `authority.record` | `native-host.ts:2027`; `authority-store.ts:151` |
| Pi extension writes nothing to the repo itself | — | plugin scripts are read-only except the lease file it deliberately never touches (`lease-warn.mjs:20-27`) |

### 5.3 Database rows written

| store | table/record | writer | evidence |
|---|---|---|---|
| Substrate `state.db` (`SUBSTRATE_DB` / `XTRM_STATE_DB` / `~/.xtrm/state.db`) | issue (create + claim) | `work.inlineCreate`, `boundary.check/bind` | `workitem-store.ts:677,627,634`; `native-host.ts:657,709,1245` |
| Substrate `state.db` | `execution_bindings` row (issue/revision/hash/claim/participant/activation/attempt/workspace/session) | `boundary.bind` | `workitem-store.ts:634-675`; `native-host.ts:1245` |
| Substrate `state.db` | journal entry `kind=result` | `boundary.appendResult` -> `journalService.appendEntry` | `settlement-publication.ts:365,629`; `workitem-store.ts:751-764` |
| Substrate `state.db` | provenance receipt + artifact | `boundary.allocateReceipt` / `attachArtifact` -> `provenanceService.*` | `settlement-publication.ts:350,355,603,608`; `workitem-store.ts:765-784` |
| `observability.db` | `specialist_jobs`, `specialist_events` | `forensic-sink.writeProjection` -> `client.upsertStatus` / `upsertStatusWithEvents` | `forensic-sink.ts:164`; `observability-sqlite.ts:2002,2046` |

**Beads:** the native path deliberately does **not** shell out to `bd`.
`native-host.ts:629-631`: "No Beads client, no bd subprocess, no second readiness derivation".

### 5.4 Settlement state model (publication is best-effort by contract)

`publishSettlement` (`settlement-publication.ts:514-682`) is guarded twice: it degrades internally and the caller
(`host.publishTerminalSettlement`) swallows throws, "because settlement evidence must never alter the result the
activation reports" (`native-host.ts:1668-1670`). Deferred/refused records are re-driven by
`republishPendingSettlements` on the next dispatch via `republishOncePerProcess` (`native-host.ts:605,1393`).

## 6. Graph coverage notes

- The native graph is **complete inside `src/activation`** but has three hard gaps: frontend `getHost()` dispatch,
  the Pi extension's `dist/lib.js` import, and the external Substrate port calls. `gitnexus query
  "activation start lease workitem settlement publication"` returned only generic
  `Emit → CreateRunCompleteEvent`-style processes, so this map is built from raw `CALLS`/`IMPORTS` edges.
- `gitnexus detect_changes` was not run for this artifact because the lane writes documentation only and does not
  modify source; the reviewed tree is exactly the indexed tree (`6553ef0`).
