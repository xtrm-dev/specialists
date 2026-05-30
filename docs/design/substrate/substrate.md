# Substrate: Containers, Issues, and the Seed Lifecycle
> *operators_notes:
> - in fase di seed delle chain step/o durante gate coordinator (step 0) a chain running, determina set di skills da integrare (da una lista complete) negli specialist di vari step. le skill non sonon più generiche, ma ad esempio una skill "React" - o che fa da sublayer al service skills. Oppure nel caso del devops agent, per non crearne troppe varianti, se c'è da ottimizzare i containers docker, ad esempio, viene caricata la skill docker. Se si lavora con database a uno specialist viene iniettata la skill database, forniamo un template generico, ma poi viene adattata per-repo or per-stack (come nel caso di mercury con multiple repos)

> **Status:** Draft (revision 10). Consolidates rev9 plus: chain-coordinator as standing judge of a transient container (§4.3); memory access as participant capability + chain-coordinator distillation at close (§10.2, memory-curator role eliminated); chain-template declares its coordinator model (§6.9.10). Earlier consolidation (rev9): container model (abstract lifecycle, five kinds incl. seed + node), preflight-as-seed-container, new issue system (three creation paths, two-stage validator, step-issue contracts), issue-relationship system, chain templates + composition (worktree lease, two-axis git model), channels (formerly conversations, v0–v3), participant abstraction + SDK surface, emitter/pulse, failure recovery, tether (formerly shepherd), contract validator, three-axis memory, collision matrix, scrutiny/obligations/ddiff (Iron-inspired), container-channel coexistence, context-depth, provenance/ownership, single-store data model, dashboard, API surface.
>
> **Scope:** Defines the runtime architecture for agent-native work in the `xtrm` project. Replaces the orchestrator's tribal practices with named, observable, replayable entities. Designed so orchestrator, node-coordinator, and human all read the same runtime surface.
>
> **Non-goal:** Endpoint-level API spec; specialist prompt content. The design target is the runtime and its stores. The current sp + bd + GitHub materializer is **disposable** — substrate defines a clean API and consumers conform to it; we do not carry old integration debt forward.

## Project layout

`xtrm` is the umbrella project name only (not a binary). It is a **monorepo** of five packages, published as separate npm packages, importing each other within the repo where something is reused.

| Package | Binary | Owns (code + schema) |
|---|---|---|
| **core** (was `xtrm-tools`) | `xt` | Project bootstrap, worktree management, install / update / doctor |
| **substrate** | `sb` | Issues, containers, plans, collisions, validator, pulse/triggers, provenance/ownership, memory |
| **channels** | lib (+ `ch`) | The channel primitive: messages, subscriptions, reducer/after-hook, authority, participant subscription |
| **specialists** | `sp` | Specialist run, job lifecycle, tether, telemetry |
| **console** | — (web app) | The dashboard (read-only) |

Dependency direction is acyclic: console → {all}; specialists → {channels, substrate, core}; substrate → {channels, core}; channels → {} (standalone — a pure messaging primitive that knows nothing of worktrees, so it stays maximally reusable); core → {}.

**One store, one daemon, one socket.** Despite five packages, the *runtime* is a single SQLite (WAL) database served by one daemon over one Unix socket: `~/.xtrm/state.db`. The earlier multi-store design (separate `.sb`/`.sp` DBs) is dropped — xtrm exposes its own API (the console and our own tools are its first consumers), so the API is the surface of separation, not the files on disk. One db, one process, one reference is simpler to use and removes inter-daemon coordination failure modes.

The separation that matters is **ownership in code, not separation of files**: each package owns its tables' schema and is the only code that writes them. Tables are namespaced by domain (`containers`/`issues`/… are substrate's; `channel_*` are channels'; `jobs`/`runner_events`/… are specialists'). A user who doesn't use part of the system simply has empty tables — zero cost. The discipline **no foreign keys across domains; correlation by opaque ID only** is kept even though it's one db — it is what lets the stores be re-separated later (sharding, a future where specialists runs on a different machine) without redesign. Best of both: separation in code, simplicity of one store at runtime.

The CLI never surfaces the package name (`xt skills update`, not `xt core skills update`).

---

## 1. Problem

Today the runtime exposes individual jobs (`sp run`, `sp ps`, `sp feed`) but the units of work the orchestrator actually reasons about — *chains*, *epics*, *waves*, *preflight planning*, *collisions across worktrees* — are tribal practices, not entities. The orchestrator carries this state in its head. The dashboard reconstructs it by grepping events. Quality varies wildly between sessions.

Concrete failures observed in real runs:

- **Chains are implicit.** `sp run executor` creates a job and a worktree. Subsequent reviewer/sanity/security dispatches join "the same chain" only by convention. Nothing in the system names the chain. You cannot `sb container ps chain:X` to see inside it.
- **Preflight is discretion.** "Is this issue a usable contract? Should we consult overthinker first? Is there a memory worth recalling?" — all live in the orchestrator's discipline. Misses are silent.
- **Collisions surface at integration.** When 8 chains touch the same file, you discover it at cherry-pick time, ~6 hours after the conflict became inevitable.
- **Memory recall is text-match-on-issue.** FTS5 against issue content fires on token presence, not relevance. Tether's mid-run injection is too late if the relevant memory would have changed the plan.
- **Issues are prose.** Specialist quality is bounded by issue quality, and "issue quality" is whatever prose the operator typed. No structural gate.

The fix is not a better dashboard. The fix is making the missing entities **real in the runtime**, with stable IDs, lifecycles, and CLI surfaces. The dashboard then becomes a thin renderer over runtime state.

---

## 2. Conceptual model

The system is built from a small set of primitives. Containers and the things inside them, plus the signals that flow between them.

### 2.1 Entities

| Entity | What it is | ID prefix |
|---|---|---|
| **Container** | The unit of work. Five kinds (§4). Has the abstract lifecycle (§3), a channel, members, a budget. | `seed:`, `chain:`, `epic:`, `wave:`, `node:` |
| **Issue** | Structured work contract (replaces bd issue). Owned by a container. | `iss-` |
| **Participant** | A member of a container: subscribes to its channel, reacts to events. A specialist is one *kind* of participant (§2.2). | (key on container) |
| **Channel** | Append-only, subscribable message stream scoped to a container (formerly "conversation"). | same as container ID |
| **Pulse** | A signal — `trigger | job | message` — emitted by an emitter, carrying an idempotency key (§2.3). | `pulse-` (hash) |
| **Emitter** | A registered actor that emits pulses, under a declared capability (§2.3). | (registered key) |
| **Plan artifact** | Structured output of a seed container; the contract between planning and execution. | `plan-` |
| **Tether** | Always-on sidecar that injects scoped hints into a job's next prompt turn. | (per-job) |
| **Validator** | Gate on issue contract readiness: two stages plus a third moment at container start (§6.3, §4.3). | (per-issue) |
| **Memory** | A durable, cross-task fact with metadata; queried at three levels (§10). | `mem-` |
| **Node cluster** | An emergent pattern, not a new entity: ≥2 nodes collaborating via cross-container pulses (§4.5). | (graph, no own id) |

IDs use a **colon separator** (`chain:7f3a`, `node:research`) because a container's ID *is* its channel's workstream ID (§7), so they must be the same token. Hierarchical sub-streams nest with `/` (`node:n1/sub:ab12`).

### 2.2 Participants — a specialist is one kind, not the only kind

A member of a container is a **participant**: something that subscribes to the container's channel and reacts to its events. A specialist (an LLM-driven agent) is *one kind* of participant. Others:

| Participant kind | What it is | Has context window / token cost |
|---|---|---|
| `specialist` | LLM agent (executor, reviewer, …) | yes |
| `script` | Deterministic helper that reacts to channel events | no |
| `service` | Long-running deterministic process | no |
| `coordinator` | The judge/owner of a node or seed | yes (LLM) |
| `external` | An adapter for an outside source (webhook, etc.) | no |

A script helper subscribed to `verdict:*` that touches a file on every PASS is a full member of the container — it subscribes, reacts, may emit pulses — with no context window and no token cost. The subscription mechanism belongs to the **channel**, not to the specialist (§7.1), so any participant kind plugs in the same way. This is the SDK seam (§2.4): the `channel` block in a `.specialist.json` is really a *participant definition*, of which `.specialist.json` / `.script.json` / `.service.json` are per-kind variants.

### 2.3 Emitters and pulses — the signal layer

An **emitter** is a registered actor with a capability to emit **pulses**. A pulse is one of three signals: `trigger` (wake/open a container), `job` (dispatch work), `message` (post to a channel). Pulses carry an **idempotency key** (`<source>:<entity>:<event>`, e.g. `github:pr-50:opened`); substrate dedups on it (§ pulse handling), so a duplicated webhook is a no-op, not a second container.

Emitters and participants are orthogonal but often coincide: a `script` participant that reacts *and* emits is both; an `external` webhook adapter emits without being a member of any container; a `system` participant may react without emitting. An emitter's capability — `can_emit: { pulse_kinds, budget, escalate_when }` — is **the same mechanism** as a node's autonomy policy and a container's `can_open_containers` capability. One capability model, not three.

### 2.4 The SDK surface

These primitives are a reusable SDK, not specialist-specific machinery. Building a new actor means filling a schema for a new participant/emitter kind — not writing new runtime:

- **participant definition** — `{ kind, channel: { subscribes, emits, wakes_on }, capability: { can_emit, budget, escalate_when } }`. `.specialist.json` is one variant.
- **pulse** — the signal + its idempotency key.
- **channel client** — `post / readSince / markSeen / capture` + the authority procedure (§7), used identically by every participant (a script uses the same client as a specialist).
- **command surface** — query / change-feed / command (§17), what every emitter acts against.

### 2.5 What is NOT a container

There are exactly five container kinds (§4) — `seed`, `chain`, `epic`, `wave`, `node` — and **nothing else is a container.** A thing is a container only if it has the abstract lifecycle (§3) and can have members/children. Explicitly not containers: **emitter** (a registered actor), **pulse** (a signal), **job / specialist run** (an execution *inside* a chain, owned by it), **issue** (a work contract *owned by* a container), **channel** (a container's communication surface, same ID but not a recursive container), **participant** (a member, not a container), and **plan / journal / node-state** (artifacts produced by containers). This boundary matters for the SDK: it prevents a future "container:pulse."

### 2.6 Three axes on every container

bd conflated these; substrate keeps them separate because they answer different questions and have different mutability.

- **Membership** — `parent_id`. Which container do I live inside. A property; structural; can be null.
- **Provenance** — `opened_by`, `opened_reason`, `origin_chain`. Who performed the act of opening me, and why. Historical; **immutable**; the full chain back to the root is reconstructible by following `opened_by`.
- **Ownership** — `owned_by`. Who is responsible for me *right now*. **Mutable** — this is the point. A node dies, ownership of its live children transfers (default to the orchestrator) without rewriting provenance. Ownership transfer is also an explicit action: a node can `escalate ownership` of a child it can no longer handle.

Two cross-cutting facilities attach to containers: the **collision matrix** (live `git diff` cross-referenced for overlap, §9) and **memory** (§10) — accessed as a capability by every participant, distilled at close by the chain coordinator.

**Ownership note (what moved from sp to substrate).** Containers — including epics — are substrate concepts. Today `sp` owns epic orchestration (`sp epic status/merge`) because bd-parent-of-children was the only grouping primitive. With substrate the *container* is the grouping primitive. So `sp epic` is removed; substrate owns container state, edges, and merge. `sp` keeps what it is good at: running a single job and its live communication (`sp run`, `sp ps` for jobs, `sp feed`, `sp tail`, `sp tether`). The split: **substrate owns *what work exists and how it is grouped, sequenced, and merged*; specialists owns *running one job*.**

---

## 3. The container lifecycle

Every container — a one-issue chain, a long-running node, a planning seed — runs the **same abstract lifecycle**. This abstraction is deliberate: it is what makes the system adaptable to non-coding workflows and to kinds we haven't invented yet. The dashboard, CLI, and observability surfaces see one shape; the *kind* decides what each abstract state concretely means.

```
open ──► working ──► converging ──► ready ──► closed
                          │                       
                          ▼                       
                      escalated   (suspends; from any non-terminal state)
```

| Abstract state | Meaning |
|---|---|
| `open` | Container created, members/channel being wired; not yet doing its work. |
| `working` | The container is doing its kind's work. |
| `converging` | Work is wrapping up; a judge/reviewer is deciding the outcome. |
| `ready` | The container's deliverable is ready (a plan, a mergeable diff, …). |
| `closed` | Terminal. The kind decides the concrete close reason (`merged`/`abandoned`/`transformed`/`retired`/`failed` — §5.10). |
| `escalated` | Operator (or owner) decision needed; suspended; re-enters any non-terminal state. A semantic failure (§5.10) lands here first, worktree and evidence preserved. |

Each kind maps the abstract states onto concrete ones:

| Kind | `working` | `converging` | `ready` | `closed` | opens containers? | standing? |
|---|---|---|---|---|---|---|
| `seed` | advisors converse | judge synthesizes plan | plan ready | **transformed** (opened the final container) | **yes** — its purpose | no |
| `chain` | executor + review active | reviewer scoring | merge_ready | merged / abandoned | no | no |
| `epic` | child chains active | all children converging | all merge_ready | merged / abandoned | no (children are membership) | no |
| `wave` | parallel issues active | per-issue review | all PASS | merged / abandoned | no | no |
| `node` | continuous work (the normal long-term state) | (rarely reached) | (rarely reached) | retired | **yes** — opens child containers | **yes** |

Two things fall out cleanly. A **seed**'s `closed` reason is `transformed` — its "merge" *is* the act of opening the final container it produced (which carries `opened_by = seed:…`). A **node** lives in `working` for weeks and opens children from there; it doesn't "finish" — it is `paused` or `retired`. Same lifecycle, same runtime (channel, budget, escalation, members), different identity and capability.

**The PARTIAL loop is ddiff-scoped.** For task-shaped kinds, when `converging` falls back to `working` on a PARTIAL verdict, the re-review scopes to the delta since the reviewer's last verdict (diff-of-diffs); prior approvals for untouched sections carry forward. This is the Iron "ddiff" concept (§6.6) — a delta check, not a full re-audit.

**Two families.** *Transient* (`seed`, `chain`, `epic`, `wave`) reach `ready` then `closed` — they finish. *Standing* (`node`) lives in `working` and opens transient containers as part of its work — it doesn't complete, it's `paused`/`retired`. The capability `can_open_containers` (held by `seed` and `node`) is what lets a container open another; everything that "opens a container" reuses one runtime path, writing provenance on the child (§2.6) — no per-kind duplication.

**Advancement is template-driven, not orchestrator-driven.** Within a chain, the step-to-step advance (executor → gates → reviewer → merge_ready) is driven by the chain's resolved chain_template (§6.9), executed by substrate's lifecycle, *observed* by the orchestrator. The orchestrator opens the chain and watches; it does not start each step by hand. This is deliberate — step-by-step dispatch as orchestrator discretion is where the system goes lazy (skipped reviewers, forgotten debuggers). The orchestrator keeps every power to intervene (steer, pause, inject a member, override, escalate) and loses only the duty to drive routine steps.

### 3.1 What advances a container — alignment with the pi runtime

Specialists run on the pi-coding-agent runtime, which already has the structure substrate's lifecycle assumed. Verified against the runtime (`runner.ts` / `supervisor.ts` / `pi-rpc.md`), substrate aligns to pi's existing beats rather than inventing a parallel clock. Four facts settle how a container actually advances:

- **No separate "tick" clock — advancement is event-driven.** A container's reducer fires on three triggers only: a member's `turn_end` / `agent_end` (live activity inside the container), a pulse arrival (external trigger), or an explicit `sb` command (operator action). Substrate advances containers and chains **from persisted evidence or equivalent pulses — never from a wall-clock tick and never from text seen in a live stream.** A PASS emitted in an initial run, a resume turn, or a channel verdict all become the same durable `verdict` evidence before anything advances. (This is what makes the completeness contract of §6.9.2 sound: a gate is `done` only when its evidence is persisted and satisfies, not when its process happened to print "OK".) **One refinement for chains:** the dispatch of the first step waits not only for `sb chain approve` but also for the chain coordinator's `verdict: ready` (§4.3) — the coordinator is a fresh-context entry gate that can insert steps within policy before the chain runs. Subsequent steps advance on `agent_end` of the previous step as before.
  > */warning: round-3 — three mechanisms now gate a chain's first step: human `sb chain approve` (§6.9.5), node coordinator auto-approve under autonomy policy (§5.8), chain coordinator `verdict: ready` (§4.3). Specify how they compose when a node opens a chain: does the node's auto-approve double as `sb chain approve` AND substitute for `verdict: ready` (one approval, no chain coordinator)? Or does the chain coordinator spawn anyway and emit `verdict: ready` autonomously (two layers of judgment, both within autonomy policies)? Today the design suggests the latter (uniformity claim in §4.3 "always spawned") but never says so explicitly.*

- **`waiting` = pi keep-alive after `agent_end`.** Pi's `agent_end` is the job-level quiescence barrier; in keep-alive mode the session stays resumable. Substrate's `waiting` work-state maps 1:1 onto this — no new state is invented. A step's writer releasing the worktree lease (§6.9.6) on `done`/`waiting` *is* this barrier. Resume injection (a mid-flight steer/redirect) uses pi's existing `steer` command, which delivers after the current turn's tool calls and before the next model call — the idempotent injection point a channel after-hook (§7) needs.

- **The daemon is a second reader of existing telemetry — no new hooks.** Everything the daemon must observe to advance and to recover (process termination, exit codes, compaction signals, non-progress) is already plumbed through the runtime's observability stream (the rows `sp log` reads). The §5.8 lifecycle pulses (`specialist.spawned` / `turn-complete` / `waiting` / `compacted` / `stopped`) are emitted *as a side effect of writing those rows*; `specialist.compacted` is literally the receipt of pi's `auto_compaction_end`. The daemon adds no instrumentation — it subscribes to the bus the supervisor already writes.

- **`transient` failure = whatever pi auto-retried.** The transient class of §5.10 is anchored to a concrete runtime envelope: pi already classifies overload/5xx/rate-limit/OOM via its `auto_retry_*` events. Substrate's transient class *is* that envelope — not a separate judgment. Semantic failure is the orthogonal case the runtime can't self-classify, detected by the non-progress counters (§5.10).

These resolve the two runtime questions §14.1 had flagged for the next agent (the turn concept; whether daemon-observes fits) — pi's turn is the heartbeat, and aligning to it is the call.

---

## 4. Container kinds

Five kinds, in two families. Transient kinds finish; the standing kind persists.

| Kind | Family | Trigger | Shape | Outcome |
|---|---|---|---|---|
| `seed` | transient | An intent to plan (formerly "preflight") | Advisors converse, judge synthesizes a plan | Transforms into the final container it produced |
| `chain` | transient | Plan has 1 issue | Linear: exec → ?sanity → ?security → reviewer | `sb container merge` |
| `epic` | transient | Plan has N issues with dependency edges + shared parent | DAG; chains run serial / parallel per cluster strategy | `sb container merge` — batch in topo order |
| `wave` | transient | Plan has N independent issues for parallel execution | Flat; each issue spawns its own sub-chain | `sb container merge` — per-issue as each PASSes |
| `node` | **standing** | A long-running mandate (research, monitoring, maintenance, scraping, marketing, PR/issue watch…) | A coordinator runs continuously with high autonomy; opens child containers as work demands | Never "finishes" — `paused` / `retired` |

A wave is "an epic with no dependency edges" — separate kind because it permits parallel-first scheduling and per-issue merge without batching.

### 4.1 Seed — the planning container (was "preflight")

`seed` is a first-class container kind whose purpose is to **decide the shape of work and produce the real container.** It opens, its members (advisors) converse in its channel, a judge synthesizes a `plan` artifact, and on approval the seed **transforms** — it opens the final container (`chain`/`epic`/`wave`, or hands a mandate to a `node`), which carries `opened_by = seed:…`, and the seed closes with reason `transformed`. The seed is not a special prologue with its own rules; it is a container that reuses the whole runtime (lifecycle, channel, budget, escalation, members) and whose *output* is another container. Full detail in §5.

### 4.2 Node — the standing, autonomous container

A `node` spawns a **coordinator** (an LLM participant) that runs a workgroup over the long term with high autonomy and little orchestrator intervention. Unlike task-shaped containers, a node is *standing*: it lives in `working`, sleeps between triggers, wakes on events, and opens child containers under its own authority. Examples: a node watching PRs that opens a `chain` to handle each one; a research node that opens `seed`s for ambiguous sub-tasks; a maintenance node running on a schedule.

Key properties (detail in §5.8–§5.9):

- **Autonomy policy = capability.** The coordinator opens children within a declared policy (`max_open_children`, `budget_per_period`, `allowed_kinds`, `escalate_when`). Within the policy it acts alone; beyond it, it escalates instead of acting. "Little intervention" is precise: you intervene only past the policy.
- **The coordinator is the scheduler of its own children.** The daemon delivers wakes (and applies *mechanical* rate-limit / coalescing — §5.8); the coordinator decides *semantically* whether to queue, run serial, or run parallel.
- **The coordinator is stateless w.r.t. the node.** Node state lives in the container (§5.9), so a coordinator can be killed and respawned safely (it must be, for context-window reasons — §5.9).
- **`seed` vs direct dispatch is per-node.** A well-specified node opens chains directly (no deliberation overhead); an ad-hoc node handed an ambiguous mandate opens a `seed` (it must discover the shape first). Capability field `dispatch_mode: direct | via_seed` (or a predicate).
- **Node-opens-node is gated.** A node may open transient children freely within policy, but opening another *standing* node requires escalation (an auto-spawning tree of standing nodes exhausts resources silently). Depth-capped. Peer node coordinators collaborate via **cross-container pulses** (§2.3), not channels — channels are container-scoped (channels.md keeps cross-channel messaging out of scope), so a peer emits a pulse on a documented key and the receiving node wakes on it. This reuses the pulse primitive rather than extending the channel; it is the realization of the long-deferred "epic-level coordinator" idea.

### 4.3 Chain coordinator — the standing judge of a transient container

A chain has a coordinator, parallel in shape to a node's (§4.2) but scoped to one chain. It is **a participant of the chain's channel**, spawned at composition completion — after `sb chain approve` but **before the daemon dispatches step-1**. It serves four roles over the life of the chain (entry gate, borderline judge, hygiene coordinator, close-time judge) and is subordinate to the orchestrator: it acts within its `autonomy_json` policy (same shape as a node's, §5.8) and escalates beyond. Where the node coordinator is the standing brain of a long-lived container, the chain coordinator is the standing brain of a transient one — fresh context, scoped to this chain's lifetime, dies with it.

**Why it exists.** A chain advancing template-driven (§6.9.1) is observed by the orchestrator but not represented from inside. The reducer (§3.1) advances on mechanical evidence; it cannot judge ambiguity (a gate with minor findings — accept as non_goals or re-run?), cannot propose followup issues from emergent findings, cannot verify "git is clean for real" beyond a porcelain check. The coordinator fills exactly that judgment-shaped hole, and does it with **fresh context** — it just woke into this chain, unburdened by the orchestrator's session-long carry-over, seeing the issue cleanly. Two judges, distinct scopes: the orchestrator owns *vision* (cosa fare, given everything in flight); the chain coordinator owns *intra-chain mechanics and judgment* (does this chain shape make sense from inside, does this evidence satisfy, what hygiene needs doing).

**Four roles.**

1. **Entry gate (pre-execution).** With fresh context, the coordinator validates the chain shape from the inside. Does anything need to be inserted before step-1 runs — an explorer the planner missed, a methodologist for an unexpectedly insidious scope? **Within autonomy policy** it includes one or more `<insert-step role='...' before|after='<step-id>' because='...'/>` elements in its `verdict: ready` message; the dispatcher applies them as the final composition step before step-1 dispatches. Beyond policy, it escalates a `proposal`/`escalation` channel message instead. When satisfied (with or without inserts) it emits the **`verdict: ready`** message, and only then does the daemon dispatch step-1. This is the small refinement to §3.1: a chain's first step does not advance from `sb chain approve` alone — it advances from `sb chain approve` *plus* the coordinator's `verdict: ready`. Three insert paths coexist, each at its own moment: `sb chain insert` CLI (pre-approve human/operator composition, §6.9.5); coordinator `<insert-step>` XML in `verdict: ready` (post-approve, pre-step-1, autonomous within policy); mid-run insertion (§6.9.9) during execution.
2. **Borderline judge (during execution).** The reducer of §6.10 does the mechanical close-readiness check (boolean predicates on persisted evidence). The coordinator interprets the cases the reducer cannot decide alone — "this gate returned FINDINGS but they're minor and within `non_goals`," "this evidence reference is ambiguous." Within policy it decides; beyond, it escalates as a `proposal`/`escalation` channel message that the orchestrator picks up. It does not duplicate the reducer; it fills the judgment space the reducer leaves.
3. **Hygiene coordinator (cross-chain, via pulse).** Coordinators on parallel chains pulse each other (§2.3) for **mechanical hygiene** — collision alerts ("I'm touching file X"), gate-state advertisements ("code-sanity passed, evidence Y available"), wait-for-me requests. The line that must hold: **pulses are for mechanics, never for vision.** "Deciding which approach to take" or "should we abort?" stay with the orchestrator. The coordinator's pulse vocabulary is documented hygiene events, not open negotiation.
   > */warning: round-3 — the chain coordinator emits cross-container pulses (§2.3 capability model), but its emit-capability is not declared anywhere. `autonomy_json` carries `max_inserts` / `allowed_insertion_roles` / `max_followup_proposals` / `escalate_when` — nothing about `can_emit`. Either grant pulse-emit implicitly to all coordinators (and document it as a base capability) or extend `autonomy_json` with `can_emit: { pulse_kinds, budget }` per §2.3.*
4. **Close-time judge (pre-merge).** When the reducer says `close_ready`, the coordinator does the closing pass: confirms or pushes back on the derivation; verifies **git is clean *for real*** (not just `git status --porcelain` clean — every intended change committed, branch in the declared state, no stray artifacts); **distills memory** from the chain's outcome — `type:failure` for semantic failures (§5.10), `type:best_practice` for clean successes — replacing the role previously held by a dedicated curator (§10.2); **proposes `class: followup` issues** for findings that surfaced during the chain but fell outside its scope (`sb issue create --rel discovered-from:<root>`, §6.7) — these followups are ordinary root issues, free to scale into chains of their own later if the operator/orchestrator promotes them. Only after these passes does the coordinator release the chain to `sb container merge`. This is where the coordinator most clearly adds value the reducer cannot: judgment about what was learned, what's still owed, what's worth remembering.
   > */warning: round-3 — atomicity of distillation vs. container-close not specified. The coordinator dies when the chain reaches `closed`; the close pass runs distillation + followup creation + git verification + release-to-merge. The reducer (§3.1) advances state on persisted evidence — what guarantees the coordinator finishes writing memory BEFORE the state transitions to `closed` and kills it? Either declare "merge waits on the coordinator's explicit release signal" (already implied by "releases the chain to `sb container merge`") and specify what that signal is in §13.3 schema, or document the fallback if the coordinator dies mid-distillation.*

**Same access as any participant — no privileged read path.** The coordinator reads the chain's channel (live stream, §6.8) and queries `issue.evidence_json` (the durable persisted side of the dual-write, §6.8) — both views are available to every participant; the coordinator uses the channel for live coordination during execution and the persisted evidence for structured queries at close-time. This keeps the replay log canonical and gives the coordinator no special channel into substrate.

**Contracts the coordinator reads are XML** (§6.9.2 canonical serialization), parsed deterministically by the same XML reader that backs the Stage-1 validator. The coordinator's **structured outputs are XML too**: the entry-gate `verdict: ready` message can carry one or more `<insert-step>` elements proposing additions ("`<insert-step role='explorer' before='executor' because='...'/>"`); the dispatcher applies them as part of finalizing the chain's resolved shape, before step-1 dispatches. The proposal-mining at close-time (`class: followup` issues) similarly emits `<change-contract>` XML the dispatcher persists. Free-form prose stays in `<rationale>` child tags inside these elements; structure lives in the tags themselves.

**Model selection — per chain_template.** The coordinator is **always spawned** for a chain (uniformity with the node coordinator, no special-case logic), but the model is **declared on the chain_template** (§6.9.10). Sensible defaults: `code-quick` → small free-tier (or `null` to skip the coordinator entirely on trivial work); `code-standard` → mid-tier; `code-with-advisors` / `security-deep` / `quantitative-validation` → top-tier. The operator can override per-chain. This calibrates cost to value — premium judgment where it counts, lighter touch where the work is structurally bounded — without making the *presence* of a coordinator a per-chain configuration decision.
> */warning: round-3 — "always spawned" + "`null` to skip the coordinator entirely" is a direct contradiction in the same sentence. Resolve in one direction: either (a) the coordinator is always spawned and `null` model means "spawn with no LLM, only the reducer + the cheap mechanical checks fire" (then nothing is skipped, just the model call); or (b) `null` skips the coordinator entirely and "always spawned" is overstated. Pick the side and rewrite. (a) is cleaner — it preserves the uniformity claim — but commits to a coordinator entity that has no model.*

**Autonomy and escalation.** The chain container carries an `autonomy_json` policy alongside its `resolved_chain_json` (§13.3), with fields parallel to a node's (§5.8): `max_inserts`, `allowed_insertion_roles`, `max_followup_proposals`, `escalate_when`. The coordinator's actions inside policy are autonomous; beyond, it escalates to the orchestrator the same way `escalated` works for any container (§3). One escalation pattern across all coordinators — node and chain.

**Lifecycle alignment.** The coordinator's life is the chain's life. It spawns at composition completion, dies when the chain reaches `closed` (the `sb container merge` it released, or `closed:failed` / `abandoned` on a failure path — in which case the failure-distillation memory it would have written becomes the work of §5.10's existing mechanism). It does not journal across sessions (chains are transient — no long-lived state to hand off, unlike a node's `coordinator_journal_json` in §5.9). Fresh context, scoped lifetime.
> */warning: round-3 — context-window exhaustion on a long chain (many PARTIAL cycles, a debugger-restitch, many findings) is not addressed. Node coordinator has explicit kill+respawn via journal (§5.9); chain coordinator has "no journal across sessions" — implying it cannot respawn. What happens if a chain accumulates more context than one window can hold? Options: (a) declare an explicit "chain too long for one coordinator context" failure that escalates; (b) add a minimal in-chain journal (snapshot of decisions, role-3 pulse history) and allow respawn; (c) rely on close-time distillation being self-contained reading evidence_json (the coordinator's runtime context can be lossy at close because the evidence is authoritative). Pick one.*

### 4.4 Merge is substrate's, and it works

`sb container merge` is the single canonical publish path for every transient kind. It works — where the old `sp merge` / `sp epic merge` did not — *because substrate owns the container lifecycle and the worktree fork-base*. The recurring `sp merge` failure (merging to the wrong base, friction bead `xtrm-nr05`) was a symptom of merge logic living in the specialist runtime with no authority over where chains forked from. Substrate has that authority by construction: it opened the container, knows each chain's base, gates `ready`. The interim "manual cherry-pick is canonical, sp merge prohibited" workaround (Iron epic) was a response to the *broken old path*; under substrate it is unneeded. `sp merge` / `sp epic merge` are removed, not routed around. (A node has no final merge — it *opens* mergeable transient containers as part of its work.)

**Containers can nest.** `sb container ps --tree` shows the tree. Membership (`parent_id`) is distinct from provenance (`opened_by`) and ownership (`owned_by`) — §2.6.

### 4.5 Node clusters — the pulse mesh as a named pattern

When ≥2 nodes collaborate via the cross-container pulse mechanism (§2.3, §4.2 line on peer coordinators), the resulting graph of pulse-bound peers is a **node cluster**. This is not a new container kind, not a new entity, not a new schema — it is a *name for an emergent pattern* in the pulse mesh. A cluster has no `cluster_id`, no lifecycle of its own, no membership row: it is whatever subset of nodes are currently exchanging pulses on related keys, observable as a graph at query time.

**Why name it.** The pulse mechanism alone says "node A can pulse node B"; the cluster framing says "and when ≥2 nodes do that on a documented topic, they form a workgroup." This is the substrate-level analogue of a node's internal workgroup of participants, lifted one layer: workgroups inside a node, clusters between nodes. Naming it makes three things easier:

- **Observability.** `sb container ps --graph` (or the dashboard's container view, §12) can render pulse-bound peer sets as cluster overlays without inventing new state. Operators and orchestrators see "research-cluster: 3 nodes pulsing on `research:source-update`" without anyone declaring it.
- **Capability declaration.** A node's `autonomy_json` (§5.8) can carry `pulse_topics: [...]` as its public emit/listen surface — the topics it participates on. Two nodes sharing a topic are by definition in a cluster on that topic; no separate registration step.
- **Future SDK / connector vision** (§14.1, the n8n-style pipeline north star noted at §18). Connectors (Discord, Gmail, an external API) are emitters under the pulse capability model (§2.3). A connector emitting on a topic and a node listening on the same topic is the simplest cluster — node + external participant. The same primitive scales from "two nodes coordinate" to "node + connector pipeline" without new mechanics. This is what makes the SDK enough to write a connector against: pulse topics are the interop surface, clusters are how those connections become workgroups.

**What it does not introduce.** No cluster lifecycle, no cluster CLI verbs, no cluster-as-container, no cross-channel reading (channels stay container-scoped per channels.md). A cluster is *queryable, not constructable.* If a future need emerges for explicit cluster membership (e.g., billing topics or rate-limiting per cluster), that is a separate decision; today the emergent-pattern framing is enough.

> */open: cluster topology — is it a strict graph (edges are "shared topic") or a multigraph (multiple topics between the same node pair counted separately)? Defer until the first observability query needs to commit to one shape; both are renderable.*

---

## 5. Seed: planning in depth

A `seed` is the planning container — formerly called "preflight." It is **a channel among advisors**, scoped to the container, that produces a `plan.v1` artifact and then transforms into the container it planned. Because a seed is a normal container, everything here reuses the standard runtime (lifecycle §3, channel §7, budget, escalation, participants §2.2); only its members (advisors) and its outcome (a plan, then a transform) are seed-specific.

### 5.1 Entry

```
sb seed start --intent "..." [--from-issue iss-XXX]
  ↳ opens a seed: container in state `open`
  ↳ opens its channel (same ID) with topology=freeform, judge=seed-judge
  ↳ resolves advisor invite rules
  ↳ spawns invited advisors as participants → state `working`
```

Either `--intent` (free text the advisors must structure) or `--from-issue` (an existing issue to refine/decompose). A seed may also be opened by a node coordinator rather than a human (§5.8).

### 5.2 Advisor invite rules

Advisors are invited based on **rules matching the intent or proto-issue**, so the common case needs no orchestrator discretion — though the panel is tunable (below).

```yaml
# config/seed/invites.yaml
- advisor: devops-specialist
  invite_when:
    scope_matches: ["infra/**", ".github/workflows/**", "docker/**", "terraform/**"]
    or_tags_contain: ["infra", "ci", "deploy", "release"]

- advisor: security-auditor
  invite_when:
    scope_matches: ["**/auth/**", "**/secrets/**", "**/crypto/**"]
    or_intent_keywords: ["token", "credential", "permission", "auth"]

# memory access is no longer a separate advisor (§10.2) — it is a capability the
# planner and every other participant carries via the memory-query extension.

- advisor: overthinker
  invite_when:
    risk_signals: ["cross-cutting", "design", "tradeoff"]
    or_estimated_issue_count_gte: 5

- advisor: researcher
  invite_when:
    intent_mentions_library: true   # detected via NER-lite
    or_intent_keywords: ["API", "framework", "library"]

- advisor: explorer
  invite_when:
    no_existing_context_for_scope: true
```

The contract validator runs as an advisor by default (always invited; gates plan approval).

**Rules are a floor, not the whole story.** Invite rules cover the predictable cases, but we can't enumerate every scenario, so the set is adjustable at seed time:

- **The orchestrator can add advisors not invited by rule** ("this looks risky, pull in overthinker anyway") by posting `system.invite` to the channel. It can also run a seed with a *minimal* set — in the simplest case the orchestrator is effectively the sole advisor, deliberating alone — when the work doesn't warrant a full panel.
- **A few advisors are soft-mandatory** rather than rule-gated: the planner is invited by default for most seeds because its value is near-universal and cheap (memory access is now a capability the planner carries, not a separate advisor — see §10.2), but even this can be waived for a trivial seed.
- **The operator can suggest advisors** interactively; the orchestrator folds the suggestion into the invite set.

The principle: invite rules give a sensible default panel without orchestrator discretion for the common case, but the panel is not frozen — the orchestrator (and operator) tune it per seed, because no fixed rule set covers every kind of work.

### 5.3 Channel topology

A seed uses **freeform topology** (members self-elect each tick), with a **seed-judge** that:

- Subscribes to `finding`, `proposal`, `escalation`
- Posts `system.continue` while advisors are still producing useful findings
- Posts `system.done` with the plan artifact attached
- Posts `system.redirect` if a member wanders out of seed scope

### 5.4 Budget

Default: `budget:turns=15`, `budget:wall=5min`, `idle:K=4`. Judge closes hard on any breach. Breaching the budget is itself a signal — surfaces as `seed_failed` with reason, and the operator gets the partial state to decide whether to rerun with sharper intent or decompose first.

Seed expected cost: **under $0.05** on free-tier or small models. Tether-Layer-2 model chain (Groq → Nvidia NIM → local Ollama) handles advisor roles that don't need full specialist runs.

### 5.5 The plan artifact

```jsonc
{
  "schema": "seed.plan.v1",
  "id": "plan-7f3a",
  "container_id": "chain:7f3a",      // shown resolved; kind prefix tracks the draft's `topology.kind`
                                     // (filled when topology crystallizes), committed at approval (§5.7)
  "origin": {
    "trigger_issue_id": "iss-2yn4",
    "requester": "user|orchestrator|node-coordinator",
    "opened_at_ms": 1731000000000
  },

  "issue_set": [
    {
      "proposed_id": "seed-tmp-1",   // not yet committed to issue store
      "title": "...",
      "contract": {
        "problem":      "...",
        "scope":        ["cli/src/commands/install.ts", "cli/src/commands/update.ts"],
        "non_goals":    ["..."],
        "validation":   ["npm test --workspace cli", "..."],
        "acceptance":   ["observable behavior 1", "..."],
        "scrutiny":     "low|medium|high|critical",
        "constraints":  ["..."]
      },
      "depends_on":      ["seed-tmp-2"],     // internal edges
      "role":          "executor",         // on the generated step-issues
      "memory_pack":     ["mem-auth-redis-2026-03", "..."],
      "seed_risks":      [
        { "kind": "collision", "refs": {"files": ["install.ts"], "with_chains": ["chain:19e5"]} }
      ],
      "issue_local_rules": [
        "Do not touch source outside SCOPE.",
        "Preserve DB-first behavior; file fallback is legacy-only."
      ]
    }
    // ...more proposed issues...
  ],

  "topology": {
    "kind": "chain|epic|wave",
    "ordering_rule": "topological|parallel|serial",
    "rationale": "Three issues touch install.ts; serialize to avoid integration storm."
  },

  "collision_strategy": {
    "clusters": [
      {
        "files":       ["cli/src/commands/install.ts", "cli/src/commands/update.ts"],
        "chains":      ["chain:42in", "chain:19e5", "chain:9xg2.3"],
        "decision":    "serial",   // serial | unified | parallel-with-restitch
        "reason":      "3-way overlap on resolvePackageRoot; serialize per memory <key>"
      }
    ]
  },

  "total_budget_estimate": {
    "dispatches":  12,
    "dollars":     0.85,
    "wall_minutes": 35
  },

  // incrementally persisted to the seed container as findings arrive (not only at approval),
  // so they survive a closed:failed seed and feed `sb seed rerun` (§5.10)
  "advisor_findings_log": [
    { "from": "planner", "kind": "finding", "summary": "2 relevant memories found via memory-query extension", "refs": {...} },
    { "from": "devops-specialist", "kind": "finding", "summary": "Needs separate CI gate issue", "refs": {...} },
    { "from": "overthinker", "kind": "proposal", "summary": "Decompose into 3 not 1", "refs": {...} }
  ],

  "budget_spent_in_seed": {
    "turns": 11,
    "wall_ms": 187000,
    "dollars": 0.018
  },

  "approval_state": "draft|approved|rejected|superseded",
  "approval_mode":  "auto|operator-gate|re-seed",
  "approval_at_ms": 1731000187000,
  "approval_actor": "orchestrator|user|<orchestrator-rule-id>"
}
```

### 5.6 Approval

Three modes, all resolvable by the orchestrator without human intervention when rules allow:

| Mode | Trigger | Action |
|---|---|---|
| `auto` | Plan below budget threshold, no `warning+` seed risks, no active-chain collisions, no advisor escalations | Commit issues to store, open container, dispatch first wave |
| `operator-gate` | Plan exceeds budget, touches sensitive surface, contains any `blocker` risk, or rule says ask | Plan posted, dispatch blocked; orchestrator continues unrelated work |
| `re-seed` | Any proposed issue validates as `invalid`, judge fails to converge, escalation fired | Conversation reopens with explicit redirect, or container abandons |

Rules live in `config/seed/approval.yaml`. They're predicates over the plan artifact. Approval mode is itself a field on the artifact.

### 5.7 What commit-on-approval does

At approval, the runtime transactionally:

1. Creates issues in the new issue store, replacing `seed-tmp-N` with real `iss-NNNN` IDs
2. Writes dependency edges from `depends_on` fields
3. Stamps each issue with its `memory_pack`, `issue_local_rules`, and `role`
4. Decides container kind from `topology.kind` and opens it
5. Schedules first-wave dispatches per `topology.ordering_rule` and `collision_strategy`
6. Transforms the seed: opens the final container (chain/epic/wave), which carries `opened_by=seed:<id>`; the seed closes with reason `transformed`

Failure at any step rolls back; plan returns to `draft`.

### 5.8 Node autonomy, pulses, and scheduling

A node's coordinator opens and drives child containers under an **autonomy policy** — the same capability model as an emitter (§2.3). The policy lives on the node container:

```jsonc
"autonomy": {
  "max_open_children":   5,
  "budget_per_period":   { "dollars": 10, "period": "day" },
  "allowed_kinds":       ["chain", "epic", "seed"],   // NOT "node" — see below
  "dispatch_mode":       "direct" | "via_seed",        // or a predicate
  "escalate_when":       ["budget_exceeded", "ambiguous_mandate", "wants_standing_node"]
}
```

Within the policy the coordinator acts alone. Beyond it, instead of acting it **escalates** (opens an `escalated` container or posts to the orchestrator's channel). "Little intervention" is precise: you intervene only past the policy. Opening another *standing* node is never in the default policy — it requires escalation, and node nesting is depth-capped, because an auto-spawning tree of standing nodes exhausts resources silently. Peer node coordinators collaborate via **cross-container pulses** (§2.3) — a peer emits a pulse on a documented key, the receiving node wakes on it — rather than by watching each other's channels (channels are container-scoped) or by spawning each other.

**Composing the chains it opens.** When a coordinator opens a chain (directly or via a seed), that chain is composed like any other (§6.9.5): a chain_template resolves, step-issues materialize, the composition gate sits at `open → working`. The coordinator **auto-approves the composition within its autonomy policy** — this is exactly "acts alone within policy" applied to chain shape. It does not stop for human `sb chain approve`; its policy *is* the approval authority for the chains it opens, the same way `auto` plan approval (§5.6) lets a seed's first wave dispatch itself. If composition surfaces something beyond policy (an L1 nudge for a class the policy doesn't permit, a scrutiny level above its budget), it escalates rather than auto-approving — the same graded boundary as everything else a node does. So a node's chains are fully template-driven and gated (mandatory gates still overlay, §6.9.3), but their composition gate is crossed by the coordinator's policy, not by a human, in the autonomous case.

> */warning: round-3 — `dispatch_mode: direct` (this paragraph) skips the seed. But §6.9.5 composition requires step-issues materialized (the planner's role inside a seed). In `direct` mode, who produces the chain's step-issues? Three plausible answers: (a) the node coordinator acts as inline planner within its own context (taking on a planner role transiently); (b) the chain_template alone provides the full shape with no per-chain refinement (lowest fidelity but simplest); (c) a degenerate single-issue seed runs invisibly. Specify the answer — without it, the L1 nudge / memory_pack / scrutiny-escalation paths in §6.9.5 have no executor in direct mode.*

**Triggers and pulses.** A node sleeps between events and wakes on a **pulse** (§2.3) — a `trigger` from a schedule, a watch, or an external source. Substrate owns the wake: a `triggers` table (cron-like schedules, or watches on a predicate) and a per-node **FIFO pulse queue**. The daemon does **mechanical** scheduling only — rate-limit (no more than N wakes/period) and coalescing (10 identical events in a window are not 10 wakes). It then delivers the queue to the coordinator. The **coordinator does semantic scheduling**: it reads its queue and decides order, whether to run children parallel or serial, whether a new pulse waits for the current chain to finish. The daemon protects against hot loops; the coordinator makes the work decisions. No overlap.

**Idempotency.** Every pulse carries an idempotency key (`github:pr-50:opened`); substrate keeps a `pulse_dedup` map (`key → container_id`). A pulse whose key is already seen *and* mapped is a **no-op** — it returns the existing container, never opens a second. A key seen but not yet mapped (pulse in flight) coalesces rather than racing. A pulse with no key is treated as unique (the emitter owns the duplicate risk); external-event emitters (webhooks) *must* declare a key. This is what makes node autonomy safe instead of a self-duplicating machine.

**Pulse as a general primitive — including specialist lifecycle.** The daemon is itself an emitter that observes specialist runtime and emits lifecycle pulses: `specialist.spawned`, `specialist.compacted` (with a count), `specialist.stopped`, `specialist.context-threshold`. Any participant can subscribe. This means mechanisms like the coordinator respawn (§5.9) are not special-cased code — they are *handlers of a pulse*. One primitive, N uses: a webhook, a script, a coordinator decision, and a specialist compaction all flow through the same emit→react surface.

### 5.9 Coordinator context window — kill and respawn

A coordinator cannot live for weeks compacting its context indefinitely; compaction degrades until the model loses the thread. **Rule of thumb: at most two compactions, then kill and respawn a fresh coordinator.** The daemon watches the `specialist.compacted` pulse; on the second, it triggers the respawn cycle — the coordinator writes its final node-state, is terminated, and a fresh coordinator is spawned.

This is only safe because **the coordinator is stateless with respect to the node** — the node's state lives in the container (substrate), not in the coordinator's context window. This is exactly why §6.8 separates live (channels, ephemeral) from persisted (substrate, durable): if the coordinator's context were the only copy, killing it would lose everything. Because the state is in substrate, the coordinator is an interchangeable executor.

A respawned coordinator reconstructs from **three sources**, in order:

1. **The origin seed's scope — mandatory.** It walks `opened_by` back to the seed that started the node and re-reads its mandate/scope. This is "why I exist, what I must do." Without it, a respawned coordinator doesn't know its own mission.
2. **Recent channel messages — bounded.** It reads the recent tail of the node's channel (last N messages / last window) to learn the members' latest actions — what was happening just now. Not the whole history.
3. **The coordinator journal — the handoff.** A deliberately maintained artifact: key decisions, watching-list, handled-set (with idempotency keys → child containers), open children. The handoff a chef reading the order ticket gets when taking over a station.

**The journal carries a state snapshot, not just notes — for gap detection.** At each checkpoint the journal records `{ checkpoint_ms, channel_head_msg_id, open_children: [{id, state, owned_by}], handled_set, last_decision_ref, notes }`. On respawn the new coordinator compares the journal's snapshot against the *live* state it reads from substrate (channel head now, children now). The difference is the **gap** — what happened between the last checkpoint and the old coordinator's death. A large or error-containing gap tells the new coordinator the journal isn't fully current, so it reconstructs with more caution (re-read more, re-verify children) rather than trusting the journal blindly.

**Checkpoint cadence.** The journal is rewritten at frequent checkpoints — after each handled pulse, after each open/ownership-transfer decision — not only at planned respawn. A crash between checkpoints loses only the last decision, not the whole turn. Same principle as the channel reducer/after-hook (§7): persist at checkpoints, not on clean exit.

The **journal is distinct from memory** (§10): the journal is *operational state of this node* (what's in flight now) and dies with the node; memory is *durable cross-task knowledge* and outlives the task. The respawn reads both, from different places.

### 5.10 Failure recovery

A container can terminate uncleanly. The governing principle is **never destroy work on failure** — destruction of a worktree, a diff, or accumulated findings is always a deliberate decision (`abandoned`), never a side effect of something going wrong. This reuses the §5.9 insight generalized to every container: value-bearing state must live in the container (incrementally persisted), so the death of an ephemeral process is never the death of the work.

No new entity is introduced. Failure recovery is built entirely from pieces that already exist: counters are **state on the container**; the daemon **observes** process termination and emits **pulses** (the lifecycle pulses of §5.8); respawn, escalation, and teardown are **handlers** of those pulses (§5.8's universal mechanism). There is no "watchdog" object — the daemon observes what it already owns, the container holds the state, handlers react.

**Failure class.** Every unclean termination carries `failure_class`:

- **`transient`** — crash, timeout, OOM, killed child process. The *approach was valid, the execution stumbled.* The daemon classifies these mechanically from how the process died.
- **`semantic`** — the seed failed to converge, the intent is ambiguous, or a running container hit a non-progress threshold (below). The *approach itself is flawed.* The daemon never judges semantics; it detects the *pattern* (counts non-progress) and the *judgment* stays with the judge/reviewer that declared the failure. Mechanical detection, semantic interpretation — the same daemon-vs-coordinator split as §5.8.

The classification stays **binary**. A third situation that looks adjacent — a *precondition violation* (dispatching onto a stale base, a missing dependency) — is deliberately **not** a failure class: it is caught at dispatch time by the §6.4 precondition gate (*we should not have started*), never entering the run-then-fail loop these counters watch (*we started and stumbled*). Keeping preconditions out of §5.10 is what keeps the two counters measuring only genuine in-run non-progress.

**The normal review loop is not a failure.** The executor/reviewer interaction — and seconder, code-sanity, obligations — within threshold is the ddiff loop (§3): normal operation, internal to those participants, usually closes in a PASS. A semantic failure fires only at a **non-progress threshold at any gate**, counted by two counters that live as container state:

- **`semantic_after` (consecutive, resets on progress).** N consecutive non-progressing cycles at any gate → escalate. Clearing *any* gate is real progress and resets the counter to zero, so a genuinely hard chain that advances gate-by-gate (2 FAILs at the reviewer, then PASS, then 1 FAIL at obligations, then PASS) is working, not stuck. This is the primary detector: it catches *the wall* — repeatedly hitting the same gate without advancing.
- **`hard_cap` (total, generous, never resets).** N total review iterations over the chain's life, regardless of progress → escalate anyway. This is the backstop: it catches *attrition* — a chain that advances-and-regresses forever, resetting the consecutive counter each time but never closing. Without it, a chain could oscillate indefinitely (pass a gate, fail another, regress, re-pass) burning budget without tripping the consecutive threshold. Generous, so it fires only on the real pathology, not on legitimately laborious work.

> */warning: round-3 — "iteration" unit not defined. A debugger-restitch cycle runs code-sanity + obligations + reviewer FAIL → debugger → code-sanity + obligations + reviewer = 6 gate-runs or 1 logical review cycle? Per-gate-run vs per-reviewer-cycle changes the threshold 5-6x. Specify which the counter increments on.*

> */warning: round-3 — interaction with §7's `judge_timeout` backstop not specified. If a judge stays silent for N ticks the runtime auto-emits `system.continue`. Does that count as "progress" (reset `semantic_after`) or not? Reset → silent-judge masks non-progress indefinitely; no-reset → slow-but-working judge falsely trips the counter. Pick one.*

**Graded escalation (semantic).** A semantic failure does not go straight to the human. It climbs:

1. **First stop — the orchestrator.** The stuck container escalates to the orchestrator, which has options the internal loop does not: re-scope the issue, decompose the chain, add an advisor that was missing, reassign. It attempts improvement *within its policy* — autonomous, a level of judgment above the executor/reviewer interaction.
2. **Second stop — the operator.** Only if the orchestrator determines the problem exceeds its policy ("the whole scope of this chain was wrong from the start") does it escalate to the operator and wait. This is the case where no automatic re-discovery helps and a human decision on what-to-do is required.

Same graded shape as the node autonomy policy (§5.8: within policy act, beyond escalate). One escalation pattern across the system, not three.

**Transient recovery.** Identical retry within `max_retries`, then escalate. No judgment needed — the approach was not wrong, so repeating it is correct. (A seed rarely fails this way; a crashed executor is re-dispatched inheriting its worktree + evidence and resumes from where it was.)

**Recovery policy** lives on the container, parallel to the autonomy policy (§5.8), inheritable from node/orchestrator:

```jsonc
"recovery_policy": {
  "transient": { "max_retries": 2, "backoff": "exponential", "then": "escalate" },
  "semantic":  {
    "semantic_after": 3,            // consecutive non-progress at any gate; resets on progress
    "hard_cap":       12,           // total review iterations, never resets; anti-oscillation backstop
    "auto_retry":     false,        // never blind retry; recovery must change the approach
    "escalate_to":    "orchestrator"  // first rung; orchestrator escalates to operator beyond its policy
  }
}
```

**Preservation — what is kept, and for what.** On any failure the worktree and evidence are never destroyed; the container goes to `closed:failed` (with the class) or stays `escalated` while recovery is in flight — never `abandoned` automatically. The preserved material serves *different* purposes by class, the same way one memory store serves three query lenses (§10):

- **Transient** → preserved material is for *resuming*: the half-done diff, the tests already passed, the partial verdicts. Pick up where you were.
- **Semantic** → preserved material is for *improving*: what was already tried and why it didn't work, so the next attempt changes approach rather than re-hitting the same wall. A seed's findings are dual-written (§5.5) and survive `closed:failed`, so `sb seed rerun` reads them and the re-attempt builds on them — it is never a replay. (This resolves open-question #1: rejected/failed plans are not a separate cache; the failed container simply *doesn't delete its evidence*, the same "survive the close" principle as memory promotion in §10.3.)

**Failure feeds memory — the system learns from what didn't work.** A semantic failure is one of the best memory sources there is, and recovery makes the loop explicit: before a semantically-failed container closes, the **closing judge** — the chain coordinator for a chain (§4.3), the node coordinator for a node (§4.2), the operator for a seed in escalation — extracts a **`type: failure`** memory ("scope mixed auth and logging; the executor couldn't satisfy both acceptance criteria"). It is an ordinary memory with ordinary metadata (`created_by_role`, `in_container`, `reason`, body), so it is reachable through all three lenses (§10): a future executor in this project pulls "here are the approaches that fail here" (identity), this node knows "this strategy doesn't work" (workgroup), the project accumulates known anti-patterns (herd). Because the planner queries memory at seed time via the memory-query extension (§10.2), **a seed planning work similar to a past failure automatically pulls "this was tried and failed because X"** — so the plan starts already avoiding the wall. "Mind not to repeat" becomes structural, not hopeful: today's failure is tomorrow's context pack. Transient failures produce no memory — a technical stumble teaches nothing about the *approach*; only semantic failures carry a lesson, so only they are distilled.

**Teardown.** When a container reaches a terminal state (merged, closed, failed), the daemon emits the terminal pulse and a teardown handler runs: terminate still-live children, reap zombies, close the channel, take the final checkpoint. On `closed:failed` the teardown explicitly **preserves** the worktree and evidence rather than reaping them — active preservation, not hoped-for. (Daemon-level / infrastructure failure — the substrate process itself dying — is a different category, handled at the runtime/infrastructure layer; out of scope here.)

---

## 6. The new issue system

The new issue is a structured contract, not prose. Replaces bd's free-text description with named fields and machine-validated state.

### 6.1 Schema

```jsonc
{
  "id":               "iss-7f3a-001",
  "title":            "string (<= 120 chars)",
  "class":            "root|step|gate|advisor|followup",  // structural function in the work graph (§6.10)
  "type":             "task|bug|chore|spike|design|research",  // ONLY on class:root — kind of root work
  "role":             "executor|reviewer|code-sanity|<custom>",  // who executes (was specialist_hint);
                                                                 // ONLY on non-root classes; may be a user's custom specialist
  "priority":         0,                    // 0=critical, 4=backlog

  "contract": {
    "problem":      "string",               // required
    "scope":        ["glob", "..."],        // required; glob list, not prose
    "non_goals":    ["string", "..."],
    "validation":   ["command", "..."],     // required; runnable
    "acceptance":   ["observable", "..."],  // required; externally observable
    "scrutiny":     "low|medium|high|critical",  // generic review-depth dial (see 6.6)
    "constraints":  ["string", "..."],
    "context":      [
      { "kind": "previous_chain", "ref": "chain:X" },
      { "kind": "memory", "ref": "mem-key" },
      { "kind": "decision", "ref": "iss-Y" }
    ]
  },

  "contract_state": {
    "status":           "invalid|partial|ready|waived",
    "stage1_run_at":    1731000000000,       // programmatic schema-check (always)
    "stage2_run_at":    null,                 // agentic judgment (only if run; §6.3)
    "blocking_gaps":    ["Acceptance not observable", "..."],
    "thin_flags":       ["'acceptance' may need more detail"],   // advisory, non-blocking
    "dispatch_allowed": true
  },

  "issue_local_rules": [
    "Do not touch source outside SCOPE.",
    "Preserve backward-compatible CLI flags."
  ],

  "chain_template":   "debug",              // optional; named template (§6.9); else resolved from type
  "memory_pack":      ["mem-key", "..."],

  // Relationships are EDGES in the issue_dependencies table (§6.7), not stored inline.
  // This block is a denormalized read-convenience view the API may project; the edges are canonical.
  "dependencies_view": {
    "blocks_on":       ["iss-X"],            // gate
    "parent":          "iss-EPIC",           // gate / membership
    "until":           [],                    // gate (temporary)
    "discovered_from": "iss-Y",              // context
    "validates":       [],                    // context
    "caused_by":       [],                    // context
    "relates":         ["iss-Z"],            // context (soft)
    "tracks":          [],                    // context (soft)
    "supersedes":      []                     // lifecycle
  },

  "work_state":       "draft|ready|claimed|running|waiting|reviewing|blocked|close_ready|done|archived",
  "review_state":     "unreviewed|partial|pass|fail",
  "close_state": {                          // computed/denormalized for queries (§6.10)
    "eligibility":      "blocked|close_ready|forced",
    "blocked_by":       ["string", "..."],  // populated when eligibility=blocked
    "close_ready_at_ms": 0,                  // first time predicates were satisfied
    "closed_by":        "container-merge|cascaded-from:<id>|operator|--force|null"
  },

  "container_id":     "chain:7f3a",         // set when container opens
  "primary_chain":    "chain:7f3a",         // for epic/wave members

  "evidence": [
    { "kind": "diff",     "ref": "feature/iss-7f3a-001-executor", "by": "exec_7f3a", "at_ms": 0 },
    { "kind": "verdict",  "ref": "msg#142",   "by": "rev_7f3a",   "at_ms": 0 },
    { "kind": "test",     "ref": "result#88", "by": "test_7f3a",  "at_ms": 0 },
    { "kind": "checklist","ref": "msg#142",   "by": "rev_7f3a",   "at_ms": 0 }  // release checklist (6.6)
  ],

  "created_at_ms":  0,
  "updated_at_ms":  0,
  "closed_at_ms":   0,
  "close_reason":   "merged|merged-as-part-of-epic|step-complete|gate-passed|advisory-complete|decided|done|failed-transient|failed-semantic|failed-with-container|abandoned|abandoned-with-container|superseded"  // §6.10; maps deterministically to done|archived
}
```

### 6.2 Contract states (orthogonal to work state)

Two state axes, intentionally independent.

**Work state** = where the work is.
**Contract state** = whether the issue is a valid dispatch target.

A `claimed` + `invalid` issue is exactly the failure mode the dashboard surfaces in red.

#### 6.2.1 Three classifiers: class, type, role

An issue carries three classifiers that answer different questions and do not overlap. Keeping them separate is what makes the system both extensible to custom specialists and structurally resistant to orchestrator laziness.

- **`class` — the structural function in the work graph.** `root | step | gate | advisor | followup`. This is *the position*: what role this issue plays in how work flows, independent of who performs it. It is **stored, not derived** — and this is the point. A user can register a personal specialist the system has never seen (a custom `quant-researcher`); the system cannot derive that specialist's function, but the `class` tells it how to treat the step in the graph regardless — a `class: advisor` output enters the context pack and does not block; a `class: gate` verdict blocks; a `class: followup` never blocks. The class is the *structural contract toward the graph*; the system honors it without knowing anything about the role that fills it.
- **`role` — who executes.** `executor | reviewer | code-sanity | <custom> | …` (this was `specialist_hint`, now first-class). Independent of class — it may be a user's personal specialist the core has never heard of. Present only on non-root classes.
- **`type` — the kind of root work.** `task | bug | chore | spike | design | research`. **Only on `class: root`** — it sub-classifies root issues by kind of work (a `bug` root, a `design` root). Steps/gates/advisors/followups have no `type`; they have a `role`.

**class and role are independent axes — neither derives the other.** `class → role` fails (a `gate` doesn't say *which* gate); `role → class` fails (a custom role carries no class the system knows). And the *same* role can hold *different* classes by position: a `researcher` is normally an `advisor` (produces context, doesn't block), but the orchestrator may insert it as a `gate` in a specific chain (its verdict blocks the reviewer until it confirms — the `7egg` case). A `security-auditor` runs as `advisor` pre-executor (recommendations) and as `gate` post-executor (blocking verdict) — same role, two classes (§6.9.3).

**This is the structural defense against laziness.** Orchestrator laziness is skipping the steps that block. If "blocking" were a property of the role, making something mandatory would require changing the role — rigid. Because `class` is a separate, stored, system-enforced axis, gate-ness is *structural*: the system makes `class: gate` steps non-skippable on production diffs (§6.9.3) regardless of which role fills them, and the orchestrator has no lever to quietly skip them. The function-in-the-graph is declared and enforced by the system, not left to the negotiable identity of the performer.

**`root` is special.** A root carries the *change contract* (the five sections, §6.1) — it is the desired change, not something executed. It therefore has **no `role`** (nobody performs a root; it is the work), and it is **not directly dispatchable**: to be realized it must be composed into a chain that generates at least one step. A root may exist before composition (just created), but `sb chain approve` is impossible with zero steps — no steps, no shape to approve, it doesn't run (§6.9.5). Every root ends up with ≥1 step at dispatch time; even the simplest work is `root → executor-step` (two issues, the root carrying the *why*, the step carrying the *how*), never a single hybrid issue.

**`decision` is an outcome, not a classifier.** Deliberative work is `class: root, type: design` (or `research`); its *close outcome* is a documented decision rather than a `merged` diff. "decision" lives only as a `close_reason` (§22-class outcomes), never as a `class` or a `type` — this is why it was removed from the `type` enum (where earlier drafts had it, colliding with its outcome meaning).

Default visibility follows `class`: `sb issue ls` shows `root`/`followup` (the work the operator thinks about); `step`/`gate`/`advisor` are chain internals, hidden by default and shown in container views (`sb container ps <id> --tree`).

### 6.3 Validator — two stages, plus a third moment at container start

Running a model on *every* issue create/update would be overkill: it costs money and adds latency to a hot path. So validation is two stages, and only the first is universal. A **third validation moment** then runs at container start when a chain coordinator is spawned (§4.3) — not a third *stage* (it reuses Stage-1's XML parser and Stage-2's agentic judgment where applicable), but a third *moment* in the lifecycle: contract was validated at create/update time, the chain was composed and approved, and now a fresh participant re-reads the same contract from inside the container before step-1 dispatches. See §6.3.1 below for that moment's specifics.

**Stage 1 — programmatic (always, instant, free).** A schema validator runs on every create/update. It is pure code, no model. The contract is XML (§6.9.2 canonical serialization); Stage-1 parses XML deterministically — well-formedness + required tags present + attributes matching the role — never regex-on-markdown. It does two things:

- **Hard-rejects structurally incomplete issues** — required tags missing (`<problem>`, `<scope>`, `<validation>`, `<acceptance>` for `<change-contract>`; `<mandate>`, `<inputs>`, `<outputs>` for `<step-contract>`), malformed XML, contradictory states. This is a non-negotiable gate; an issue that fails it is `contract_state.status = invalid` and cannot dispatch.
- **Soft-flags thin issues** — for present tags, it measures content against configurable minimums (e.g. per-tag character floors) and emits a hint, not a block: `thin: 'acceptance' may need more detail`. This is advisory; it does not stop dispatch.

So `sb issue create` returns an immediate readiness verdict — `ready` / `incomplete: missing X` / `thin: field Y may need more detail` — with zero model cost. This is the default gate on every issue and on `sb dispatch`.

**Stage 2 — agentic (opt-in, or inside a seed).** A small free-tier model judges *quality* the schema can't: is the acceptance criterion actually observable, does scope mix unrelated surfaces, is the problem statement coherent. This does **not** run on every issue. It runs when explicitly asked (`sb validate --explain <id>`), or as a seed advisor where deliberation is already the point (§5). It outputs the richer block:

```jsonc
{
  "status": "invalid",
  "dispatch_allowed": false,
  "blocking_gaps": [
    "Acceptance criteria are not observable from outside the process",
    "Validation command missing",
    "Scope mixes two unrelated runtime surfaces"
  ],
  "suggested_rewrite": {
    "problem":    "...",
    "scope":      ["..."],
    "non_goals":  ["..."],
    "validation": ["..."]
  },
  "recommended_template": "debug",         // names a chain_template (§6.9), not an ad-hoc sequence
  "recommended_chain": ["explorer", "executor", "test-writer", "reviewer"]  // the resolved steps, for display
}
```

Both stages write the same `contract_state` shape, so consumers don't care which produced it. The split keeps the common path instant and free while reserving model judgment for when it earns its cost. Stage 1 is the structural floor everything passes through; Stage 2 is the depth check you reach for.

#### 6.3.1 The third moment — chain coordinator entry-gate at container start

Stage-1 runs at `sb issue create/update` (hot path). Stage-2 runs on demand (`sb validate --explain`) or inside a seed (where deliberation is already the point). Between approval and step-1 dispatch, however, a **third validation moment** runs as part of the chain coordinator's lifecycle (§4.3 role 1, *entry gate*): the freshly-spawned coordinator re-reads the chain's contracts (root `<change-contract>` + each step's `<step-contract>`) from inside the container, with fresh context, and emits its `verdict: ready` message before the daemon dispatches step-1.

This moment is **not** a third stage — it does not introduce new validator code. It is a third *moment* in the validation lifecycle, at which the existing validators may be re-applied with fuller context:

- **What it adds.** The contract was structurally valid at create-time (Stage-1) and may have been depth-checked once (Stage-2). The third moment asks a different question: *given the resolved chain shape (§6.9.2) and the fresh in-container perspective, does this contract still make sense for the chain about to run?* The coordinator can: (a) confirm readiness as-is and emit `verdict: ready`; (b) propose `<insert-step>` additions within `autonomy_json` policy (§4.3 line on three insert paths); (c) escalate as `proposal`/`escalation` if the contract still looks inadequate from inside, returning the chain to operator/orchestrator judgment.
- **Why it cannot collapse into Stage-1 or Stage-2.** Stage-1 has no knowledge of the resolved chain shape (the chain is composed *after* the contract is approved). Stage-2 runs against the contract in isolation. The third moment is the only point where the contract, the resolved chain shape, and a fresh-context judge all coexist — and the coordinator's `<insert-step>` outputs require exactly that conjunction.
- **What it shares.** The coordinator reads contracts via the **same XML reader** that backs Stage-1 (§6.9.2 canonical serialization). When the coordinator escalates a contract-quality concern, the orchestrator can route that to a Stage-2 agentic re-validation if useful — same surface, same `contract_state` shape, no parallel path.
- **Lifecycle position.** `sb chain approve` no longer suffices alone to advance the chain's first step; advancement requires `sb chain approve` **plus** the coordinator's `verdict: ready` (§4.3 role 1 makes this explicit; the reducer in §3.1 reads both signals before dispatching step-1).

> */open: when chain_template declares `coordinator: null` (§4.3 model-selection clause that needs the contradiction resolved per its round-3 warning), what fills the third validation moment? Two paths: (a) skip it (small/trivial templates accept the validity already established at Stage-1/2); (b) run a minimal mechanical check (porcelain-equivalent of Stage-1, no LLM) as the coordinator's stand-in. Defer until that contradiction is resolved.*

An issue can be born **three ways**, all first-class. bd had effectively one (create a bead, `bd dep add` to link it, `sp run --bead X` — three manual acts the orchestrator wired by hand). Substrate names three distinct birth paths and none is privileged over the others:

1. **From a seed's plan approval** — the planning path.
2. **Inline from the CLI into an existing container** — the direct path (operator or orchestrator).
3. **Materialized mid-flight from a `proposal`/`escalation`** — the discovery path.

**Path 1 — plan approval (the planning path).** A seed produces an `issue_set` of N proposed issues with their relationships already declared; on approval substrate commits them all in one transaction — real IDs, dependency edges, container opened, each stamped with `container_id`, `memory_pack`, `issue_local_rules` (§5.7). The epic→child relationships exist *before any dispatch* because they are part of the plan. This is the path for net-new work that needs deliberation. It is **not** the only path — it is the one for when you don't yet know the shape of the work.

**Path 2 — inline creation into an existing container (the direct path).** When the work is already understood — the orchestrator or a human knows exactly what the issue is — there is no reason to route through a seed. Create it directly in a formed container, with the full contract inline, and optionally dispatch in the same breath:

```bash
sb issue create --in-container <id> \
  --title "..." --type task \
  --problem "..." --scope "src/**" --validation "npm test" --acceptance "..." \
  [--rel discovered-from:<id>] [--rel blocks:<id>] \
  [--dispatch]
# → Stage-1 validator runs immediately (programmatic, free); returns readiness
# → sets container_id, writes parent-child toward the container head + any --rel edges
# → if --dispatch and Stage-1 passes: opens the chain for it inside the container
```

Every contract field is a flag; relationships are `--rel <type>:<target>` and may repeat. `--in-container` implies the parent-child edge (putting an issue in a container *is* that relationship — no separate `bd dep add`). `--dispatch` fuses create-and-run for the common case where the operator knows the work is ready. This path is how the orchestrator drives work into a container it already opened, and how a human adds a known task without ceremony.

**Path 3 — mid-flight discovery (the discovery path).** A specialist that finds new work *while running* does **not** create the issue itself — it emits a `proposal` or `escalation` into its container's channel. Substrate (or the orchestrator) materializes it:

```bash
sb issue create --in-container epic:9xg2 --intent "..." --rel discovered-from:<source-id>
# → creates iss-..., sets container_id, writes parent-child toward the epic head,
#   AND the discovered-from edge toward the issue that surfaced it — one act, Stage-1 runs
```

Mid-flight issues should carry a relationship that records *why they appeared* — beyond the implicit parent-child, a `discovered-from` or `caused-by` toward the issue/work that surfaced them — so the graph stays traceable rather than accumulating context-free orphans. (Strength of that requirement — advisory vs. enforced — is an open question, §14.)

**The dispatch gate.** Dispatch applies to a **root** (a step-issue is never dispatched on its own — it is materialized into a chain by composition, §6.9.5). Whichever path created the root, dispatch is the same gate, and dispatching *composes the root's chain*: the issue already knows its container and relationships, so dispatch carries neither.

```bash
sb dispatch <root-id>
# → Stage-1 validator runs, returns dispatch_allowed
# → if false: refuses, prints what's missing (and suggested_rewrite if Stage 2 was run)
# → if true: resolves a chain_template (type-default, --chain-template, or auto-match),
#            materializes the step-issues into a chain in `open` (the composition, §6.9.5),
#            then the composition gate: `sb chain approve` (auto under policy) → `working`
#            (a chain already part of an approved seed plan is composed at approval time)

sb dispatch <root-id> --allow-unready --reason "emergency hotfix; manual validation only"
# → permitted with persisted override; review confidence flagged reduced
sb dispatch <root-id> --chain-template <name> [--strict]   # override the type-default template
```

`sb dispatch <root-id>` takes **no container and no parent** — the root carries both. The chain's steps are not hand-dispatched; substrate advances them template-driven (§6.9.1). Under `auto` approval (§5.6) a seed's first wave composes and dispatches itself, so you may type nothing at all. A freshly created in-container root (Path 2 or 3) enters `work_state=draft` and passes the same Stage-1 gate before it can dispatch — no path bypasses the structural floor. Ad-hoc shape changes happen during composition: `sb chain insert` before `sb chain approve` (the common path), or a fully inline on-the-run shape passed at dispatch (§6.9.4) — never via `sb issue create --class step`, which is not how steps are born.

**Preconditions are a dispatch-time gate, distinct from failure recovery.** Stage-1 validates the *contract*; a parallel check validates the *runtime environment* before dispatch — e.g. the git-state precondition (is the chain about to fork from a stale base because a sibling chain is unmerged?), or a future "dependency-not-merged" check. A precondition violation is **not** a failure class (§5.10): it is *we should not have started*, caught before the run, not *we started and stumbled*, counted during it. The gate either passes or **refuses to dispatch** with a structured envelope (the channels.md §10.2 shape) naming what's blocking and the safe next action; it never enters the run-then-fail loop the §5.10 counters watch. The override is deliberate and audit-traceable — `sb dispatch --allow-unready --reason "..."` — never a silent default. This cleanly separates the two concerns: §6.4 prevents bad starts, §5.10 recovers bad runs.

### 6.5 Issue-local mandatory rules

Each issue may carry `issue_local_rules` that **append into every specialist prompt** spawned from it. These flow alongside global mandatory rules and role rules.

```
GLOBAL_MANDATORY_RULES (from project)
ROLE_MANDATORY_RULES (from specialist config)
ISSUE_LOCAL_RULES     (from this issue's `issue_local_rules`)
```

This means the same `executor` specialist behaves differently across issues — same role, same model, different invariants — without per-run prompt engineering.

### 6.6 Scrutiny, obligations, ddiff, release checklist (Iron-inspired, domain-neutral)

These four concepts come from Jane Street's Iron review model. They are folded in **generically** — substrate stays domain-neutral, because a user's specialists might do legal review, trading research, or prose editing, not just code. The mechanisms live in substrate; the *code-specific* policy (which file paths escalate scrutiny) lives in shipped config, never in substrate core. This section defines the *concepts* (what scrutiny/obligations/ddiff mean); §6.9's mandatory-gate layer is *where they are enforced as non-skippable chain steps* (code-sanity, obligations-scanner, security-auditor) on production diffs and sensitive surfaces.

**Scrutiny — a generic chain-structure dial, not a per-specialist quality dial.** `contract.scrutiny: none|low|medium|high|critical` is a **required field on every root contract** (the old `risk` field is replaced — one axis, one name, two would drift). It says how much *structural defense* the chain has around this work, in domain-neutral terms. **Crucially, scrutiny does NOT mean "lower tier = lower-quality work."** Every participant always does the highest-quality work possible. What scrutiny modulates is **chain structure**: how many independent advisors fire pre-impl, which conditional gates activate, whether a second-opinion turn runs, how strictly the final reviewer enforces the Release Checklist. The work itself is always max-quality; the amount of structure around the work is what changes.

| Level | Meaning (generic) — what changes structurally |
|---|---|
| `none` | Design / read-only chains only (planning, premortem, research, doc-sync, memory-hygiene, triage). No code diff produced; no mandatory layer applies. |
| `low` | Floor for any chain that produces a diff. Cheap pre-QA gates skippable with reason; seconder advisory not blocking; final review minimal Release Checklist pass. |
| `medium` | Default. Full mandatory layer applies (cheap pre-QA gate as PASS-pre-condition; seconder gate; behavioral-validation gate; obligations gate; reviewer with Release Checklist). |
| `high` | + Item-by-item sign-off in Release Checklist; impact evidence required at reviewer; pre-QA UNCLEAR verdicts escalate to chain coordinator (§4.3 role 2 borderline judge) BEFORE expensive QA fires. |
| `critical` | + Independent second opinion (or premortem); conditional gates (e.g., domain-specific auditors) run twice — advisor pre-impl and gate post-impl. |

The chain (its participants and its mandatory layer) **all read `scrutiny` and tier the chain's structure accordingly** — it is not a private input to the reviewer alone. Step issues inherit `scrutiny` from their root container; they do not redeclare it (single source of truth). Absent field defaults to `medium` only as backward-compat fallback for pre-existing data; new contracts hard-fail validation if scrutiny is missing (seed-phase validator, §5; also §6.4 dispatch gate). `none` is hard-denied when the seed produces a `class:root` contract whose scope contains code-touching paths.

**Auto-escalation is shipped config, not substrate.** A reviewer may raise the scrutiny floor based on what the diff touches — but the surface→floor table (`auth/*` → high, `migrations/**` → high, `src/permissions/*` → critical, …) is **code-oriented policy** that ships with a code specialist set, in `config/scrutiny/surfaces.yaml`. This parallels how seed advisor-invite rules live in config (§5.2). A legal-review specialist set ships its own surface table (`**/contracts/*` → high) or none. Substrate only knows the generic dial; it never hardcodes a path pattern. The author's stated level is a floor, not a ceiling; config can raise it.

**Obligations — a generic gate, wired through tether.** In-work markers that must be cleared or explicitly accepted before merge (in code: `TODO/FIXME/HACK/XXX`; in other domains, whatever the specialist set defines). Two integration points:
- A tether matcher (`obligations`, §8) fires when a marker is introduced outside accepted scope.
- The reviewer treats production-surface obligations as a PARTIAL unless the issue's `non_goals` explicitly accepts them as a follow-up. A dedicated cheap `obligations-scanner` advisor/specialist can pre-scan and post a `finding`. What counts as a "marker" is specialist-set config, not substrate core.

**Ddiff — already in the lifecycle.** The PARTIAL re-review loop (§3) scopes to the delta since the last verdict; prior approvals carry forward. This is the Iron ddiff concept; substrate gets it by making the reviewing→running loop delta-scoped rather than full-re-audit.

**Release checklist — machine-readable reviewer output feeding evidence.** Every verdict carries a structured checklist (review pass, obligations cleared, impact-analysis ran, scrutiny level applied, scrutiny auto-escalated). It lands as a `kind=checklist` entry in the issue's `evidence` and informs `contract_state`. Today it is evidence the orchestrator reads; a future `sb container merge` can parse and hard-gate on it. The *fields* are generic; a code specialist set may add code-specific rows (security-auditor ran, gitnexus ran) via its reviewer config.

### 6.7 Issue relationships

Issues relate to each other in nine distinct ways. bd collapses all of these into `bd dep add --type X` with no behavioral difference between them — a `blocks` edge and a `discovered-from` edge are stored and treated identically, and the runtime consequence lives only in the orchestrator's head. Substrate separates them **by effect on the runtime**: some relationships *gate* (they change what can start), some carry *context* (they change what an agent knows), some are *lifecycle* (they change what exists), and some are *tracing* (they record what happened). The validator and seed read the gating edges to decide dispatchability; the planner's memory-query extension (§10.2) reads the context edges to build the memory pack; the dashboard reads all of them for the graph view.

| Relationship | Class | Runtime effect |
|---|---|---|
| `blocks` | **gate** | B cannot leave its `seed` until A is `merged`. The hard precondition. |
| `parent-child` | **gate / membership** | Child lives inside the parent (epic); the parent's `merge_ready` depends on all children. Also implied by `container_id` (§6.7.1). |
| `until` | **gate (temporary)** | Like `blocks`, but dissolves when a named event/condition lands rather than on merge. A precondition with an expiry. |
| `discovered-from` | **context / provenance** | No gate. Records *why* the issue exists; feeds context-depth (§6.8). |
| `validates` | **context / topology** | The verifier (reviewer/test/sanity/security) is a node in the implementation's chain, not a separate blocker. Records the verification link. |
| `caused-by` | **context / diagnostic** | No gate. Links a failure symptom to its root cause for tracing. |
| `supersedes` | **lifecycle** | Closes the old issue, redirects references to the new one. Pairs with `sb issue supersede`. |
| `relates` | **context (soft)** | No gate. Surfaces in the context pack only if judged relevant. |
| `tracks` | **context (soft)** | No gate. Watches an external/upstream issue; soft overlap. |

The behavioral contract is explicit: **only `blocks`, `parent-child`, and `until` gate dispatch.** Everything else is read for context or recorded for tracing, never blocks dispatch. This is the thing bd left implicit and substrate makes a property of the relationship `kind` itself.

**Two future edges, deliberately not added yet.** A review pass proposed `informs` (output enters a target's context pack) and `spawned_by` (runtime provenance from a pulse / template event). Both are *subsumed today* — `informs` by `relates`, `spawned_by` by `discovered_from` — so per the discipline of not creating variants until a use distinguishes them, they stay folded in. The split paths are recorded for the next agent: promote `informs` out of `relates` when context-pack rules need to distinguish pack-feeding context from soft context; split `spawned_by` from `discovered_from` when replay/audit needs to distinguish human creation from runtime materialization. Until then, nine relationships, not eleven.

#### 6.7.1 Membership vs. relationship

Two levels that bd conflates, kept separate here:

- **Container membership** — `container_id` on the issue. "This issue lives inside `epic:9xg2`." A *property* of the issue, not an edge. Answers "which container am I in."
- **Issue relationship** — a row in `issue_dependencies` (`parent-child`, `blocks`, …). "iss-A is parent of iss-B." A semantic *edge* between two issues, independent of container. Answers "what is my parent issue."

They usually coincide (an epic's child has `container_id=epic:9xg2` *and* a `parent-child` edge toward the epic head), but not always: an issue can have a semantic parent or a `tracks` edge into a *different* container (e.g. an upstream issue). Keeping membership as a property and relationship as an edge is exactly what lets a child be "child of any issue," not only of its own epic's head.

#### 6.7.2 CLI

```bash
sb issue rel add <issue> <other> --type blocks|until|discovered-from|validates|caused-by|relates|tracks
sb issue rel rm  <issue> <other> --type <t>
sb issue supersede <old> --with <new>        # writes supersedes + closes old + redirects refs
sb issue rel ls  <issue>                      # all edges, grouped by class (gate/context/lifecycle/tracing)
# parent-child is normally created implicitly by `sb issue create --in-container` (§6.4)
```

### 6.8 Context-depth: live (channels) vs. persisted (substrate)

How does context pass between specialists — does it inherit from channels, work like bd notes do today, or get passed some other way? The answer is **two distinct flows, deliberately separated**, and conflating them is what makes bd notes awkward.

**Live / reading → channels.** While a job runs, it reads its container's channel: the prior verdict, a steer, a finding, the tether's hints. This is "what do I need to know *right now*." Ephemeral, lives in the channels domain of `state.db`, gone when the channel closes. Channels is the *reading surface for the specialists themselves* — a reviewer reads the previous verdict in the channel; an executor reads the steer.

**Persisted / tracing → substrate.** When a job finishes, its result — diff ref, verdict, release checklist — is persisted as `evidence` on the issue in substrate. This is the durable record. When issue B (which `discovered-from` A, or `blocks`-on A) enters its seed, the context pack is built by **reading A's persisted evidence from substrate**, not by re-scraping A's channel.

So context-depth is not a recursive walk over prose notes (the bd model). It is structured: substrate knows the relationship (B depends on A), pulls A's structured evidence (diff, verdict, checklist), and the participant's memory-query extension (§10.2) judges it for relevance. The relationship *class* (§6.7) decides what gets pulled — `blocks`/`parent-child`/`discovered-from` edges feed the pack; `tracks`/`relates` only if judged relevant.

**The dual-write that makes this safe.** A specialist's result is written to the channel (live, for peers reading now) *and* persisted to `issue.evidence` (durable, for future context). This mirrors how the tether already dual-writes hints (§8) and how the plan artifact dual-writes (§5.5, §13.5). The principle: **channels is where specialists read the present; substrate is where the past is persisted to be re-read as context.** Tracing never depends on a channel surviving, because the durable copy is the issue's evidence, not the channel message. The same persisted evidence is what failure recovery (§5.10) preserves on `closed:failed` — the dual-write is not only the context mechanism, it is the preservation mechanism: work is recoverable precisely because its value was already persisted incrementally, never living only in the ephemeral process.

### 6.9 Chain templates and composition — the shape a chain runs

A chain is the minimal unit of specialist work — even a single-member chain is a chain. Its *shape* (which steps, in what order, with which gates) is defined by a **chain_template**: a named, reusable definition from which a concrete chain is instantiated. This section settles, once and for all, how a chain advances, how its steps come to exist as durable contracts, who composes its shape, and how its worktree is shared — the questions everything downstream depends on.

A note on naming: earlier drafts called this a "workflow." That word is generic (it evokes BPM/n8n pipelines) and doesn't say what the thing *is* in this system. The unit here is the **chain**; a `chain_template` is its reusable form. "Workflow" does not appear in this design.

#### 6.9.1 The advancement model — chains advance by template, not by orchestrator

The old implicit model: the orchestrator dispatches an executor, waits, dispatches a reviewer, waits, decides the chain is done. Advancement is the orchestrator's step-by-step discretion. This is exactly where it goes lazy under context pressure — it skips the reviewer, forgets the debugger on a debug chain, uses the overthinker only when explicitly asked. Discipline that depends on a model's diligence is discipline that erodes.

So advancement is **driven by the chain's resolved template, executed by substrate, observed by the orchestrator.** When a chain enters `working`, its template is resolved into an explicit ordered plan of step-issues (§6.9.2); the chain's lifecycle (§3) advances through them — a step's participant completes and persists its evidence → substrate starts the next step → … → all steps cleared → `merge_ready`. The orchestrator does not start each step by hand. It **composes the chain, approves its shape, and watches**; it intervenes only on exceptions (steer, pause, override, escalation).

This is the orchestrator's role correctly drawn — and it is the role of the orchestrator generally: **the technical extension and judge of the operator's vision.** The operator brings the *what* and *why* (the vision, possibly non-technical: "fix the Treasury rounding"); the orchestrator is the technical judgment that translates that vision into correct work structure (the *how*: this is quant work, critical blast, it needs a methodologist before the executor). It keeps every power to *intervene* — inject a member, redirect, pause, override — and loses only the *duty to drive every routine step*. We are not removing its judgment; we are removing the mechanical execution of judgment, which frees it to do more judging, not less. Less serial job-launching, more composing. This **reduces** friction rather than adding it.

#### 6.9.2 Step-issues — every dispatch is contract-backed

A chain is made of **step-issues**: each gate, advisor, reviewer, or executor run inside a chain is backed by a durable issue contract. This recovers a property of bd that the early substrate drafts had quietly dropped — in bd, every run had a bead, an inspectable record of *what it was asked to do*. A code-sanity run had its bead; a reviewer had its bead. Making only the root issue a contract and the steps mere "roles" would lose that. So: **every specialist dispatch is issue-backed**, its prompt/mandate, state, origin, and evidence persisted and inspectable.

Two kinds of issue, two kinds of contract — not one mould forced onto both:

- A **root issue** carries a **change contract** — the five sections (§6.1): `problem`, `scope`, `non_goals`, `validation`, `acceptance`. It describes *a desired change in the world*. This is the work in the sense the operator cares about; it is what `sb issue ls` shows.
- A **step-issue** carries a **step contract** — a different shape, fit to what a step does (which is produce a *judgment* or an *artifact*, not describe a change): `mandate` (what this participant must do), `inputs` (evidence it reads — the executor's diff, a prior finding), `outputs` (what it produces — a verdict, findings citing file:line), `scope` (what it operates on, inheritable from the root), `non_goals`. Forcing the five change-contract sections onto a gate produces empty or tautological fields ("the problem is to do your review"); the step contract is honest about a step being a task-over-inputs-toward-outputs.

Both are durable and inspectable (the bd property); they differ in structure because they describe different things. `sb issue show` on a root renders the change contract; on a step, the step contract.

**Canonical serialization — XML semantic tags.** Contracts are stored as **XML inside the issue's `contract` field** (§13.3 schema: `contract_xml`), not as markdown-with-headers and not as JSON. Two consumers depend on this: (a) the Stage-1 validator (§6.3) parses XML deterministically — well-formed structure, required tags present, attributes matching the role — with no regex-on-markdown fragility (header-level confusion, typo-renamed sections, ordering); (b) every specialist that reads the contract as task context parses XML more reliably than markdown headers (Anthropic prompt-improving research). Tag shapes are fixed and small:

```xml
<change-contract issue-id="iss-7f3a-001" type="bug" scrutiny="high">
  <problem>...</problem>
  <scope>
    <path>...</path>
  </scope>
  <non-goals>
    <item>...</item>
  </non-goals>
  <validation>
    <criterion>...</criterion>
  </validation>
  <acceptance>
    <criterion>...</criterion>
  </acceptance>
</change-contract>

<step-contract role="reviewer" root="iss-7f3a-001">
  <mandate>...</mandate>
  <inputs>...</inputs>
  <outputs>...</outputs>
  <scope>...</scope>
  <non-goals>...</non-goals>
</step-contract>
```

The §6.1 issue schema shows the *parsed* / in-memory / API shape (an object with named fields); XML is the *on-disk* serialization the field stores. The split keeps the storage parse-deterministic for the validator and human-and-LLM-legible for everyone reading the contract, while the API surface stays object-shaped for code.

**Serialization choices across the system — XML for human-and-LLM-read structured text, JSON for machine-to-machine schemas.** Contracts (read by specialists as task context, by humans inspecting work) are XML. Final outputs of specialists (verdicts, findings, planner Pass-2 output — consumed by orchestrator code via existing schema validators), channel messages (`body_json` discriminated-union, §7), and `evidence_json` (per-type schemas) stay **JSON**. `system_prompt` of a specialist stays **free-form** for model-flexibility — though this carries weaker rationale than the rest (see warning below). One serialization rule per consumer kind: a code-only consumer gets JSON; a text-context consumer gets XML; a prompt-tuning surface stays free-form.
> */warning: round-3 — "system_prompt stays free-form for model flexibility" (per roadmap D30) is the thinnest justification in the serialization split. The XML-improves-LLM-compliance argument applies to any text the model reads; the system_prompt is read deepest. D28 applies XML to SKILL.md content for exactly this reason. Plausible unstated reasons: (a) refactoring cost across all package-tier specialists outweighs the marginal compliance gain on a once-per-session read; (b) system_prompt is *content* (the role identity), not *scaffolding* (a wrapper) — XML is for the wrapper; (c) compatibility with non-Claude models that handle heavy XML system prompts worse. None of these is stated. Either tighten the rationale, narrow the exemption (e.g. action-sections inside system_prompt can be XML per D28's SKILL.md treatment), or measure with/without before treating it as settled.*

**Prompt composition is explicit and layered — a participant receives its role, never infers it.** A step-issue's specialist is not handed an undifferentiated blob to puzzle out. It receives labelled layers (extending §6.5):

```
GLOBAL RULES
ROLE RULES: <role>            ← "you are the executor; you implement; you do not review"
PARENT CONTRACT: <root-id>    ← the root's change contract: problem/scope/acceptance — the why
STEP CONTRACT: <step-id>      ← this step's mandate/inputs/outputs — the precise task
INPUT EVIDENCE: <refs>        ← what prior steps produced (diff, finding, verdict)
CHANNEL CONTEXT: <recent>     ← live coordination
```

The executor does not infer that it is the executor (ROLE RULES says so), nor guess which is the root (PARENT CONTRACT is labelled), nor deduce its narrow task (STEP CONTRACT). The "narrow" step contract is safe precisely because the parent contract carries the surrounding context. For a *known* role the ROLE RULES already exist in its participant definition (§2.2); for a genuinely one-off role, the step contract's `mandate` must be richer, since there is no role-rules to lean on — known role → generated contract; new role → explicit mandate required, else substrate refuses to materialize the step.

**Resolved as persisted state.** When a chain's shape is resolved (its step-issues materialized), that *is* the explicit forward plan. Three things follow from one fact — the future is written, not emergent:

- **Overview / preheat.** The dashboard shows what the chain *will become* before it unfolds — the step-issues exist, with reached/pending status — because they are recorded.
- **Completeness contract.** The daemon knows which steps the chain *must* pass. `merge_ready` is not a declaration — it is "every step-issue the resolved chain requires is `done`." And for a gate, `done` means **satisfied, not merely run**: a `code-sanity` that returns FINDINGS or a reviewer that returns FAIL/PARTIAL has *executed* but is not `done` — the chain does not advance past it. A gate is non-negotiable in two senses, both enforced by the system: it cannot be **skipped** (the mandatory layer is not waivable, §6.9.3), and an executed-but-unsatisfied gate **blocks** — the chain cannot progress until the gate's verdict satisfies its condition (findings resolved or explicitly accepted in non_goals, §6.6), looping back to `working` for remediation (the ddiff loop, §3) in the meantime. A missing mandatory step (someone tried to reach `merge_ready` skipping `code-sanity` on a production diff) is a structural non-completion the daemon detects by comparing reached-state against the resolved shape — the same daemon-observes machinery as the non-progress counters (§5.10). Unauthorized skip = escalation, programmatically. And an unsatisfied gate that never clears across remediation cycles is exactly what increments those non-progress counters: either the gate is satisfied (the chain advances) or it stays unsatisfied long enough to trip `semantic_after` and escalate (§5.10) — never an advance past an unsatisfied gate, never an infinite loop on one that won't clear.
- **Pre-allocation.** Knowing the next step, substrate may warm it (model warm-up, prefetch the next role's context pack).

#### 6.9.3 The two-layer template definition

A `chain_template` lives in `config/chains/` — defaults shipped with a specialist set, plus per-repo custom mixing defaults with the user's own specialists. There are **two layers**, and keeping them separate is what stops every template from re-declaring the gates:

**Layer 1 — the template** defines the *domain-specific* steps for a kind of work. Custom roles nest *inside* the default bookends (executor opens, reviewer closes), they don't replace them:

```yaml
# config/chains/quantitative-validation.yaml
name: quantitative-validation
description: "Data/statistical work needing numerical rigor"
steps:                          # domain-specific roles, between the default bookends
  - quant-methodologist
  - statistician
applies_when:                   # optional auto-match, same matcher as seed invite rules (§5.2)
  type: [spike, task]
  scope_matches: ["**/analysis/**", "**/*.ipynb"]
  scrutiny_gte: high
defaults:                       # optional, overridable by the issue
  scrutiny: high
```

So `quantitative-validation` resolves to `executor → quant-methodologist → statistician → reviewer`, not the domain roles alone.

**Layer 2 — mandatory gates** are a separate layer that applies to *every* template by risk/surface condition, independent of which template was chosen. They are not part of any one template; they overlay all of them. This is the Iron-style gate set, shipped as config:

```
production diff      → code-sanity + obligations-scanner ALWAYS (mandatory, non-skippable)
sensitive surface    → security-auditor ALWAYS (auth, secrets, input handling, lockfiles,
                       agent/MCP/config, token storage, migrations, permissions/hooks)
reviewer             → auto-escalates scrutiny by diff content (§6.6 surfaces table)
```

The chain shape for a substantive production diff is therefore the template's domain steps *with the mandatory layer overlaid*:

```
executor → contract-coverage → code-sanity → test-engineer → test-runner → security-auditor (if surface) → obligations-scanner → reviewer → merge
```

- `contract-coverage` is a **cheap, hard-scoped scope/compliance gate** that runs immediately post-executor. It answers one question — *did the writer's diff satisfy the bead's contract enough to justify expensive QA?* — with PASS / FAIL / UNCLEAR + a scope-coverage map. Hard token budget (5–20k). Extracted in the foreground runtime (chain-templates.md §2.3, roadmap Opp 15) from the reviewer's pre-existing two-phase audit, separating phase-1 compliance-check (now `contract-coverage`) from phase-2 adversarial deep audit (now reviewer alone). This is not a fourth composition moment (§6.9.5) — it is an evidence gate using the §6.10 close-as-derivation pattern applied at intermediate-step granularity. Reads forward to `class:gate, role:contract-coverage` with evidence in `issue.evidence_json` per §6.8. Mandatory at medium+ scrutiny; skippable with reason at low; not applicable at none.
- `code-sanity` (Iron seconder gate) and `obligations-scanner` are **mandatory on production diffs**. Reviewer treats their `OK` as a precondition for PASS and returns PARTIAL if missing.
- `test-engineer` + `test-runner` form the behavioral-validation gate at medium+ scrutiny (the QA portion of the mandatory layer). Cross-reference: chain-templates.md §2.5 (behavioral-validation contract) and roadmap Opp 14 (`unitAI-sfwe1`).
- **Skip permitted only** for codified exceptions: test-only diffs (entirely under `test/`, `__tests__/`, `*.spec.*`, `*.test.*`, `*.fixture.*`) or new-file-only diffs (no modification to existing symbols). **Any other skip is an escalation event** — small diffs hide the worst regressions.
- Gates run READ_ONLY on the executor's job (they do not acquire the worktree lease, §6.9.6), in order; on a debugger-restitch they re-run after the restitch turn, before the reviewer; their JSON output is consumed by the reviewer directly via the job feed and is citable evidence in reviewer rebuttals.

The two layers compose at resolution: the resolved chain is *Layer-1 domain steps + Layer-2 mandatory gates applicable to this diff's risk/surface*. A template author never re-declares the gates; the gate layer attaches itself by condition, and the mandatory layer is never waived (§6.9.5).

#### 6.9.4 Three origins of a template, and the promotion cycle

A chain always has a defined shape — there is no dispatch without one (the template is a structural requirement). But the shape need not be pre-built; it can be born three ways, a gradient that keeps the requirement from becoming a pre-configuration burden:

- **Pre-built (shipped or custom).** A named template in `config/chains/` — the six shipped defaults (§6.9.10) or ones the user has formalized. Referenced explicitly: `sb dispatch <issue> --chain-template quantitative-validation`.
- **Resolved by issue-type (zero input).** Each issue type carries a default template: `bug` → `debug` (with `debugger` non-skippable — this fixes "debugger forgotten on an obvious debug chain"), `task` → `code-standard`, a deliberative type like `design` → a deliberative template (§6.9.8). Most dispatches name no template — it is inferred. This is configuration-zero to start.
- **Defined on-the-run (ad-hoc, ephemeral).** When no pre-built template fits, the orchestrator/operator builds the chain shape for *this instance* — "this chain is explorer → executor → security-auditor → reviewer." An ephemeral template, existing only for this chain.

The cycle is **ad-hoc → repeated → formalized → engineered**: an on-the-run shape that proves useful and recurs is *promoted* — written into `config/chains/`, named, made reusable — exactly as a workgroup memory promotes to herd (§10.3): "it survives because it proved useful." An agent-guided skill assists the crystallization (taking a chain that worked and proposing it as a formalized template). The user does not configure everything in advance; they crystallize, after the fact, what they have seen work. The mandatory gate layer (§6.9.3) overlays even an ad-hoc template, so an on-the-run shape can never escape the mandatory gates.

#### 6.9.5 Composition in two moments, with growing information

Composition — deciding the shape of work — happens at two distinct granularities, in two moments, and the same judgment may be refined a third time mid-run. These are not redundant; they are the *same kind of decision made with growing information.*

**Moment 1 — container composition (seed-time, coarse grain).** The seed deliberates and produces the *container's form*: how many root-issues, how they relate, and therefore the container kind — `epic` (dependent roots), `wave` (independent roots), or `chain` (a single root). This is §5.7 ("decides the kind from topology, opens it"). The judgment: how the operator's vision decomposes into work units and how they relate. The **planner advisor's role is extended** here to also propose each root's chain shape — not just "here are the 10 roots" but "here are the 10 roots, and for each, the proposed chain_template + the extra classes its scope seems to need." So Moment 2 has a *first draft* already at seed-time.

**Moment 2 — chain composition (pre-dispatch of each root, fine grain).** When a single root-issue is about to dispatch, its *internal chain* is decided: which step-issues. The planner's seed-time proposal is the starting point, but the orchestrator's judgment at dispatch has **more information than the planner had** — it knows what sibling chains in the container already produced, what patterns emerged, what collisions surfaced. So it can refine: "the planner proposed executor+reviewer for this root, but the sister chain just revealed this area is treacherous — I add an explorer."

**Moment 3 — mid-run insertion.** When information emerges *during* the chain, a member is inserted into the live chain (§6.9.9). Information: + what is emerging in this chain itself.

Three moments, growing information, one kind of judgment (what shape must the work have):

| Moment | Who | Information available |
|---|---|---|
| seed-time | planner proposes | vision + memory + static scope |
| dispatch-time | orchestrator judges | + what sibling chains already produced |
| run-time | orchestrator / operator / daemon | + what is emerging in this chain |

In all three the *judgment* is the model's (a trillion-parameter model's judgment is far better than a programmatic guess); the programmatic layer only ever **raises the question** so it cannot be forgotten. Three nudge levels feed Moment 2:

- **L1 — programmatic nudge (deterministic).** Exactly as the scrutiny→gate table (§6.6) auto-adds security-auditor on a sensitive surface, a **composition-nudge table** flags extra classes by deterministic condition (reusing the `applies_when`/`invite_when` matcher — one matching language): scope touches an area with no recent explorer-evidence → nudge `explorer`; problem cites an external-library keyword → nudge `researcher`; scrutiny=critical → nudge `overthinker`. The nudge *raises the question*, it does not decide it — it appears as "consider an explorer (reason: no explorer-evidence in scope)" and the orchestrator must actively accept or reject it with a recorded reason. L1 makes the question inevitable; it never becomes an automatic stamp.
- **L2 — issue-type nudge.** The root's `type` nudges the default template (above). Deliberative types (`design`, `research`) default to deliberative templates.
- **L3 — orchestrator judgment.** What no rule captures ("this looks simple but I know this code is insidious"). Pure model judgment, and rightly the orchestrator's — the value it brings as technical judge.

**The composition gate — judgment is forced by the lifecycle, like seed approval.** A composed chain sits in `open` — its step-issues materialized, the planner's proposal and any unresolved L1 nudges present, but **not yet dispatched**. It cannot enter `working` without an explicit shape evaluation, the analog of `sb seed approve`:

```bash
sb chain review <chain-id>      # show the proposed shape: step-issues, order, overlaid gates,
                                #   planner-proposed classes + unresolved L1 nudges
sb chain insert <chain-id> --role explorer \
  --before <step-id>            # POSITION in the graph (before/after an existing step)
  --because "sister chain revealed this area is treacherous"   # reason, tracked
                                # → materializes the explorer step-issue
                                # → generates its step contract from the role template (known role)
                                # → recomputes edges: what followed <step-id> now also blocks_on explorer
                                # → chain stays `open` until approved
sb chain approve <chain-id>     # "shape is correct" → open transitions to working, dispatches first step
```

`sb chain insert` takes a *semantic position* (`--before`/`--after` a step), and substrate derives the dependency edges from it — you do not hand-write edges (that was the review's 11-flag line). Known role → contract generated from its template + chain context; new role → explicit mandate required. A chain cannot enter `working` without passing `approve` — but under `auto` policy (§5.6) `approve` may be automatic, exactly as plan approval can be `auto`: the gate always exists, it may be crossed automatically when policy permits, so no friction in the smooth case and the gate is there when it matters.

#### 6.9.6 The worktree lease — one active writer at a time

A chain has one worktree (§13.3). The right to *write* it is a **lease** — a temporary write right a step acquires and releases, not owns. (Lease, not "lock": the semantics are a right granted for a time that returns, matching the executor→debugger handoff, and it is the write-side sibling of the container's mutable `owned_by`, §2.6.)

```text
worktree_lease (on the container):
  held_by:        <step-issue-id> | null    (which writer-step holds the right now)
  state:          leased | free
  acquired_at_ms: <when>
```

- A **writer-step** (executor, debugger — steps that produce a diff) **acquires** the lease when dispatched *and* the lease is `free`, and **releases** it on `done`/`waiting` (the pi quiescence of §3.1: `agent_end` → `waiting` → lease released).
- **Read-only steps** (gates, advisors) **do not touch the lease** — they read the worktree without acquiring it, so they can coexist (code-sanity and obligations-scanner run on the same diff together).
- The **daemon enforces serialization** (§3.1, already the observability-bus consumer): it does not dispatch a writer-step while the lease is `leased`; it queues it until `free`.

This formalizes "one active writer at a time": at most one non-null `held_by`. A second writer is the normal case, not an edge — the **debugger-restitch**: the executor produces a diff and goes quiescent (releasing the lease), a gate finds a regression, the debugger acquires the now-free lease and produces a patch. More writers *over time* on one chain, one writer *at a time*. The discriminant from §6.9.5 becomes concrete: *simultaneous* writers → separate chains on separate worktrees (a wave/epic, collision-watched); *sequential* writers → one worktree, the lease handed off. "Writer-step vs read-only-step" is now a defined property: does it acquire the lease.

#### 6.9.7 The git model — two axes: container kind and chain shape

Two things were being conflated and must be kept as separate axes, because confusing them loses work:

- **Container kind (Moment 1) — how roots relate.** `epic` (dependent), `wave` (independent), `chain` (single root). This is the "many roots" level.
- **Chain shape (Moment 2) — the form of a single root.** Its step-issues. This is the "one root, many steps" level.

They are different granularities decided in different moments; an `epic` contains roots, a chain contains steps. The display path (`tx92.2.5`) is convenience — the truth is explicit membership on the container (`parent_id`, §2.6), never string-parsing.

The fork-base model follows from the axes, and substrate owns the fork-base (resolving the old `xtrm-nr05` "merge on wrong base" failure, §4.3):

```text
standalone chain:   fork from main         → wt/chain-<id>
epic:               fork from main         → branch epic/<id>  (shared integration base)
  └─ child chain:   fork from epic/<id>    → wt/epic-<id>/chain-<id>   (sees siblings already merged)
wave:               (no shared base required)
  └─ child chain:   fork from main         → wt/wave-<id>/chain-<id>   (parallel, collision-watched)
```

The essential distinction between epic and wave is right here at the git layer: an **epic has a shared integration base** (`epic/<id>`, forked from main) and its child chains fork from *that branch*, so dependent roots **see each other's merged work** as they progress; the epic merges to main as a unit when all children are integrated. A **wave has no shared base** — its child chains fork independently from main, run in parallel, and the collision matrix (§9) watches that their worktrees don't clash. Epic = progressive shared base (children see each other); wave = independent bases (children don't, parallel).

**Worktree names inherit the higher level**, so you can tell where you are and where you came from: `wt/epic-tx92/chain-tx92.2`, branch `epic/tx92/chain-tx92.2`. The name is derived *from* the container's membership (it mirrors `parent_id`), not parsed *to* deduce structure — same discipline as §7 (the name is not the semantics). This makes the layout legible to both a human (`git worktree list`) and the daemon (which polls worktrees for the collision matrix, §9.1, and can now group by epic/wave).

#### 6.9.8 Deliberative issue types

Not all roots are implementation work. A `type` like `design` or `research` produces not a diff but a *documented decision* — its default template is deliberative, not implementation-centric: overthinker + explorer + (an executor that writes a design doc, not code), closing with a `decision` outcome rather than `merged`. The type nudges the template (L2, §6.9.5), the template nudges the classes. So the type→template→classes gradient gives sensible defaults before the orchestrator adds judgment, and a deliberative root never gets force-fitted into an implementation chain.

#### 6.9.9 Live mutation — members entering mid-run

The resolved chain is container state, and state mutates: the chain's actual shape is *the resolved shape as modified along the way*. A member entering mid-run is one action — materialize a step-issue into the live chain, and (if a writer) queue it for the worktree lease — reachable from three sources, every mutation a tracked event on the container (who, when, why — traceable like provenance):

- **Operator, by hand.** "This needs a researcher here." `sb chain insert <chain> --role researcher --because "..."` — the light surface with inferred defaults (class from role, edges from position).
- **Orchestrator, by judgment.** After a natural escalation, "this decision needs a researcher." Injects within its policy.
- **Daemon, programmatically.** A reviewer verdict matches a rule → a member enters automatically. The powerful one, deliberately constrained to stay rock-solid:
  - **Only deterministic, codified rules** (`verdict FAIL tagged needs-security → insert security-auditor`), exactly like the SCRUTINY auto-escalation table. Open judgment stays with the orchestrator or operator — the daemon never guesses.
  - **Inside the non-progress guardrail.** A programmatically-inserted member counts as a step against the §5.10 counters; if the chain doesn't progress despite insertions, `semantic_after` fires and it escalates — automatic insertion lives *inside* the failure-recovery guardrail, so it cannot loop.

A read-only insertion (researcher, overthinker, an advisor adding fundamental value the standard template didn't foresee) **does not acquire the lease**, so it enters freely without disturbing the active writer; its output evidence enters the context pack of the step that needed it. A writer insertion (a second debugger) **queues for the lease** (§6.9.6). If a given insertion recurs, it is a candidate for formalization into the template (§6.9.4) — the ad-hoc→formalized cycle. The discriminant is uniform: writer touches the lease, read-only does not.

#### 6.9.10 The six shipped default templates

These are the default `chain_template`s shipped with the specialist set — the concrete instances of the §6.9.3 two-layer mechanism. They were **extracted from real chains** in the runtime reports (mercury 2026-05-25, specialists 2026-05-26) by the specialists-runtime review, not invented — which is what makes them a sound default floor (the floor is what everyone gets when they configure nothing, §6.9.4, so it must reflect what actually worked). They are written **flat** — each lists its own Layer-1 domain steps — rather than via template inheritance: `extends` is deliberately deferred (the same "don't add variants until repetition hurts" discipline as the future relationship edges, §6.7). Layer-2 mandatory gates (§6.9.3) overlay all of them; none re-declares the gates.

| Template | When it resolves (`applies_when`) | Layer-1 domain steps (gates overlay) | Extracted from |
|---|---|---|---|
| `code-quick` | `scrutiny: low`, ≤1 file in scope | *(none — bookends + gates only)* | mercury 2026-05-25 wave 1 (`98vy`, one-line fix) |
| `code-standard` | `type: [task, bug]`, `scrutiny_gte: medium` | *(none — the mandatory layer does the work)* | specialists 2026-05-26 (the Iron review pipeline) |
| `code-with-advisors` | `scrutiny_gte: high` | `explorer`, `methodologist` (prepended) | mercury 2026-05-25 waves 2–3 (`7egg`, critical blast) |
| `debug` | `type: [bug]` | `debugger` (replaces the executor bookend; **non-skippable**) | mercury orphan-worktree debug notes + the "debugger-restitch loop" gotcha |
| `quantitative-validation` | `scope_matches: **/analytics/**, **/*.ipynb`; `tags: quant` | `quant-methodologist` (**non-skippable**), `quant-researcher` (if `needs-external-evidence`) | mercury 2026-05-25 (`7egg` methodology-before-executor) |
| `security-deep` | `scrutiny_gte: critical`; sensitive surface globs | `security-auditor` as a pre-executor **advisor** (recommendations before code) | substrate §6.6 + the specialists SCRUTINY auto-escalation table |

Two things these make concrete:

- **The resolved shape is Layer-1 + Layer-2.** E.g. `code-standard` on a production diff resolves to `executor → code-sanity → [security-auditor if surface] → obligations-scanner → reviewer` — the template contributes no domain steps, the mandatory layer contributes the gates. `quantitative-validation` resolves to `quant-methodologist → [quant-researcher?] → executor → code-sanity → obligations-scanner → reviewer`, matching the actual `7egg` chain (methodology locked before the executor implemented).
- **The same role at two classes.** `security-deep` runs `security-auditor` as a pre-executor `advisor` (class:advisor — recommendations, non-blocking) *and* the §6.9.3 mandatory layer adds it again as a post-executor `gate` (class:gate — blocking verdict) on the sensitive surface. Same role, two classes by position (§6.2.1) — the participant definition declares both positions valid (§2.2). This is why class and role are independent axes: the template/layer decides the class, the role just executes.

`debug`'s `non_skippable: true` on the `debugger` step is what structurally closes the "orchestrator forgets the debugger on an obvious bug chain" laziness (§6.9.1) — the step cannot be quietly dropped, only skipped via a logged escalation. `quantitative-validation`'s non-skippable `quant-methodologist` does the same for "methodology must precede the executor on quant work."

These six are a starting floor, not a closed set — they are the conceptual archetypes that illustrate the mechanism. The runtime ships a larger, evidence-backed catalog (currently thirteen) as `bd formula` files — the six archetypes plus deliberative and maintenance chains (planning, premortem, research-only, triage, doc-sync, memory-hygiene, release-prep, restitch) extracted from a wider transcript corpus; the deliberative ones realize the §6.9.8 deliberative-type path, and the catalog's `security-deep` realizes the same-role-two-classes point above. New templates arrive by the promotion cycle (§6.9.4): an on-the-run shape that recurs is formalized into `config/chains/` (today, a `bd formula`). The next agent, mining more run transcripts, is expected to find others worth shipping (§14.1).

**Canonical pipeline + roster — see `docs/design/chain-templates.md`.** The full canonical pipeline (every production-diff chain runs the same shape, severity-modulated), the thirteen templates catalog, the severity-tiered depth rules, and the per-template resolved chains live in the cross-cutting design canon `docs/design/chain-templates.md`. That document is the *philosophy* substrate and the pre-substrate runtime share; substrate's §6.9.10 (this section) describes the *primitive shape* substrate executes; the chain-templates canon describes *what the canonical pipeline is and which templates exist*. When this section and the canon disagree, the canon wins for pipeline/catalog semantics; this section wins for substrate primitive mechanics. Notably, **`test-engineer`** — a post-implementation role that reads the actual diff and writes/updates tests, fixtures, smoke scripts, and telemetry assertions, MEDIUM permission — is established in the canon §2 (Roles in the canonical pipeline) as a canonical step (not an opt-in addition). Substrate models it as a `class:step`, `role:test-engineer` issue within the mandatory layer (§6.9.3). Two new channel message kinds (`qa_plan_and_tests`, `test_verdict`) join the chain channel when channels v0 ships; channel-flow shape and failure-routing matrix are in the canon §2.5. Implementation lives in the foreground runtime (epic `unitAI-sfwe1`) — substrate inherits the resolved-shape semantics when it lands. The one currently-pending piece of the canonical pipeline is **DevOps gates** (canon §4) — operational validation for ops-shaped diffs (Dockerfile, compose, hooks, deploy, agent-orchestration); design fill is sequenced in the canon's revision history.

### 6.10 Closing an issue — close is a derivation, not an imperative

bd treats close as an *action* on an issue. Its three procedural shims — a memory-ack hook, a commit-gate hook, a Stop hook — exist because bd has no model of *what makes a close valid*; they enforce discipline from the outside. Substrate has the model, so the shims are not ported, they are **deleted** — the same move as the eliminated watchdog (§5.10) and the same pattern the specialists-runtime audit names "compensation for missing model." An issue closes when three conditions hold: its **evidence satisfies** its acceptance (a root's change-contract) or its step-contract (a step/gate/advisor); its **container state** permits terminating that issue's role; and a **close_reason** from a closed enum is recorded.

#### 6.10.1 The close hierarchy — `close_ready` → `ready` → merge

There is a clean nesting between issue state and container state:

- A member issue reaches **`close_ready`** (work-state: "all evidence in, satisfied, awaiting container close") when its evidence satisfies — and for a gate, satisfied means *cleared*, not merely *run* (the completeness contract, §6.9.2). A gate returning FINDINGS/FAIL is **not** `close_ready`; it blocks and re-runs (the ddiff loop, §3).
- The container reaches **`ready`** when *all* member issues are `close_ready` **and** the completeness contract is satisfied (every step the resolved shape requires is `done`).
- **`sb container merge`** is the close event: it transactionally closes the root (`merged`) and every member step-issue in one pass.

So `close_ready` is the per-issue analog of the container's `ready`, and per-member close is a *consequence of merge*, not a per-issue ceremony. **In the common case nobody types `sb issue close`** — the reducer derives `close_ready` as evidence arrives, the merge closes everything. This is the chain the specialists-runtime `sp finalize` reads forward to: reviewer writes PASS evidence → reducer derives close_ready → container ready → merge closes all members. `sp finalize` disappears, not migrated.

**Members close transactionally at merge, not the moment they're individually satisfied.** A chain's steps reach `close_ready` mid-run but their terminal `closed`+close_reason happens *all together* at merge. This keeps a chain's close as *one* event and means a chain that fails later never leaves orphaned `closed:gate-passed` steps behind. The sole exception is `followup` (non-blocking, not part of the completeness contract) — it closes independently, any time.

> */warning: round-3 — chain coordinator (§4.3 role 4) creates `class: followup` issues AT close-time, before `sb container merge`. A newly-created followup is `work_state=draft` with no evidence yet. Specify: do draft followups block the merge (chain stalls until each followup is at least dispatched or explicitly accepted), or does the close pass merge regardless of their state (followups are pure annotations, no gating)? Today the "non-blocking, not part of the completeness contract" line suggests the latter — make it explicit.*

**Where the chain coordinator fits in the close.** The reducer's `close_ready` derivation is mechanical (boolean predicates on persisted evidence). Between the container reaching `ready` and `sb container merge` actually running, the chain coordinator (§4.3, role 4) does its close-time pass: confirms or pushes back on the derivation (interpreting borderline cases the reducer cannot decide, §4.3 role 2 carried to close); verifies git is clean *for real* beyond porcelain; distills `type:failure` / `type:best_practice` memory from the chain's outcome (§5.10, §10.2); and proposes `class: followup` issues for findings outside scope via `sb issue create --rel discovered-from:<root>` (§6.7) — **these followups are ordinary root issues**, available to scale to future chains of their own by the normal promotion path (§5: a followup can later seed its own chain if its scope warrants one). Only after this pass does the coordinator release the chain to `sb container merge`. On a chain that fails-then-cascades (§6.10.3), the coordinator's would-be distillation is taken over by the existing §5.10 mechanism (closing judge, generic); the followup proposals are skipped (failure cascade preserves evidence; followup mining is for clean closes).

#### 6.10.2 Two paths, kept distinct

- **Automatic (the norm).** Transactional at container merge. The reducer derives `close_ready`; the merge closes. Zero per-issue commands.
- **Explicit (rare).** `sb issue close <id>`, governed by an eligibility table (class × container-kind × container-state → eligible? + allowed close_reason). If blocked, it returns the **same structured-refusal envelope** as the §6.4 precondition gate and channels.md §10.2 — one refusal shape across the system, not a third format:

```jsonc
{ "ok": false, "error_code": "close_blocked",
  "blocked_by": ["container chain:7f3a is 'working'; step issues close on chain completion",
                 "issue iss-7f3a-005 has no verdict evidence yet"],
  "next_safe_action": "wait_for_evidence | force_close | abandon_container" }
```

Eligibility, in brief: a `root` closes `merged` (single chain) or `merged-as-part-of-epic` (epic member) when the container is `ready`; a `step` closes `step-complete` when its acceptance evidence is present and no downstream step needs unfinished output; a `gate` closes `gate-passed` when its verdict evidence is *satisfied* (there is no routine `gate-failed` close — an unsatisfied gate blocks per §6.9.2, or the whole chain dies and the gate cascades, §6.10.3); an `advisor` closes `advisory-complete` when its output evidence is present; a `followup` closes any time (`done`/`abandoned`/`superseded`). A deliberative root (`type: design/research`, §6.9.8) closes `decided` — the documented-decision outcome, the only place "decision" lives (§6.2.1). `--force --reason "..."` overrides eligibility, logging an escalation event.

#### 6.10.3 Container-failed cascade

When a container reaches `closed:failed`/`abandoned` before all members are `done`: non-done members auto-close with `failed-with-container`/`abandoned-with-container`, their **evidence preserved** (§5.10 — never destroy work on failure), and a re-seeded container can create issues that `supersedes` the old ones (the existing edge, §6.7). The cascade **is itself a pulse handler** (§5.8, the universal mechanism), not new code: container terminal pulse → cascade handler → batched member close.

> */warning: round-3 — `owned_by` on cascade-closed members not specified. §2.6 transfers ownership to the orchestrator on node death; a failed-cascade is structurally similar (container alive but failed, children auto-close). Specify whether cascade-closed children keep their previous `owned_by` (stable provenance for inspection) or transfer to the orchestrator (consistent with §2.6 default). The chosen behavior matters for who reads the preserved evidence later.*

#### 6.10.4 The three shims, deleted by reuse

Each bd shim dissolves into a mechanism substrate already has — no new machinery:

- **memory-ack** ("did you save the lesson?") → **already §5.10.** Before a semantically-failed container closes, the judge/reviewer distills a `type:failure` memory; the close flow *triggers that existing mechanism*, it adds no new pulse. Success closes have no end-of-issue lesson to ack (the curator pulled relevant memory at seed-time, §10.2). The shim vanishes because the model defines *when* memory is distilled.
- **commit-gate** ("did you commit before closing?") → an issue cannot reach `close_ready` until its `diff` evidence is present (the dual-write of §6.8). **The dual-write *is* the commit gate** — a separate check is unnecessary.
- **Stop hook** ("you forgot to close before quitting") → claims belong to *participants* (jobs), not sessions. A session ending leaves the participant in `waiting` (pi keep-alive, §3.1), not the issue in `claimed`. The session/issue coupling that made the hook necessary is gone.

#### 6.10.5 `done` vs `archived`, and reopen

`close_reason` maps deterministically to a visibility class — the operator doesn't choose, the reason chooses:

```
merged · merged-as-part-of-epic · step-complete · gate-passed · advisory-complete · decided · done   → done      (shown by default)
failed-transient · failed-semantic · failed-with-container · abandoned · abandoned-with-container · superseded → archived  (hidden; --archived to see)
```

Only `failed-semantic` produces lesson memory (§5.10); other archives are silent. The `failed`/`done`/`archived` work-states are therefore *derivations* of `close_reason` — one source of truth drives both state and visibility (which is why `failed` was removed from the work_state enum: an issue isn't "failed" as a state, it's `archived` with a `failed-*` reason).

`sb issue reopen <id>` is allowed only from `{abandoned, failed-*, superseded}`; refused for `{merged, *-complete, decided, done}` — already-shipped work is not reopened, a `followup` is created instead (tying reopen-refusal to the followup class, §6.2.1).

#### 6.10.6 What this preserves from bd

bd's valuable property was that every closed issue carried a durable, queryable record of *what was decided and why* (`bd notes` across sessions). Substrate keeps it, more rigorously: `close_reason` is enum-validated (no prose drift); the `evidence` array (§6.1) is the canonical "what proof closed this" — diff refs, verdict refs, test results, the release checklist — all structured and re-queryable; the channel still holds the verbose discussion, reachable via evidence message refs (§7). The substitution is bd-notes-as-prose → substrate-evidence-as-structured-references: "what happened on this issue?" returns linkable evidence, not a text dump.


---

## 7. Channels (recap)

Cross-reference: full design in `channels.md` (the renamed, hardened successor to the old conversations design). A **channel** is one primitive — an append-only, subscribable, multi-party message stream (mental model: a Slack channel; bilateral pair-talk is the degenerate N=2 case). Substrate-relevant facts:

- Every container has at least one channel: a seed's **planning channel**, then per-chain channels during execution. A container's ID *is* its channel's workstream ID (`chain:7f3a`), so the two never drift.
- Channels live in the **channels domain** of the single `state.db` (`channel_messages` / `channel_subscriptions`), owned by the channels package (§13.4). Messages are runtime traffic, distinct from substrate's work-tracking tables. Messages are typed: `turn | finding | verdict | proposal | steer | ack | escalation | hint | system.* | note | error`.
- Subscriptions are declared in each specialist's `.specialist.json`. Members wake on matching messages without orchestrator round-trips.
- **Two identifiers per message:** a channel-local `seq` (autoincrement — ordering and the cursor) **and** a globally-unique `msg_id` hash (Slack/Discord-style). The `seq` only means something inside its channel; the `msg_id` is the stable global handle for referencing a message from outside — another channel, an issue's evidence, a coordinator journal, provenance (§13.4).
- **Single-scheduler invariant:** inside a node/container, channel writes targeted at a member do NOT directly resume them; the runner reads the message, validates the sender, and posts *intent* into the container's supervisor inbox. The supervisor is the sole scheduler that converts intent into a resume. This collapses the dual-control-plane risk.
- **Reducer / after-hook split:** each tick derives channel state via a pure, replayable reducer (no I/O), then performs side effects (resumes, `system.*` writes) in a deduped after-hook keyed on `(channel_id, msg_id)`. A crash between "enqueue resume" and cursor-advance re-reads from `last_seen_id` and never double-fires.
- **Read/ack separation (cursor-through-N):** `readSince` is pure observation and never moves the cursor; `markSeen(processed)` advances only to the highest *successfully processed* message. A message that fails to enqueue does not advance the cursor.
- **Body-text authority is always rejected:** a message whose body claims an elevated role or identity is downgraded to `kind=note` at write time and triggers no wakeups. Authority is verified from DB participant state only.
- **`error` is a stream message kind**, not just an API envelope — rejections are written to the channel so a replay is self-contained for post-mortem.
- **`judge_timeout` backstop:** if a judge stays silent for N ticks, the runtime auto-emits `system.continue` so members are never stalled behind a blocking judge.
- **Tether dual-writes hints** to the channel as `kind=hint, author_kind=tether`, so `sp tail` shows them in the same stream as verdicts and steers.
- **Plan artifact also dual-writes** to the seed channel as `kind=system.done body={plan}` so the whole channel history is one replayable stream (canonical copy stays the `plans` row — §13.5).

### 7.1 Container-channel coexistence — specialists slip in naturally

The goal is to move communication wiring **out of the orchestrator's head and into the runtime**. Today the orchestrator carries the topology of who-talks-to-whom: it must tell the runtime "put job X and job Y in the same channel, subscribe X to verdicts from Y." With substrate owning containers, that state moves to the container.

**Opening a container opens its channel.** When substrate opens `chain:7f3a`, it opens the channel as part of the same act — same ID, no separate step the orchestrator must remember. The channel is simply there, for the lifetime of the container.

**A dispatched specialist slips into the channel automatically — via its spec, at spawn time.** This needs precision, because "subscribed per its `.specialist.json`" is doing a lot of work:

- The `.specialist.json` `channel` block is a **static subscription template** — design-time, the same for every instance of that specialist. It declares *what this role reacts to and emits* (e.g. executor `subscribes: ["steer:me","verdict:me","finding:scope-overlap","system.*"]`). It is a template, not an active subscription.
- The **active subscription** is a row in `channel_subscriptions` (`channel_id`, `participant_key`, `last_seq_seen`, `paused`) binding *this specific job* to *this specific channel* with a cursor. Runtime, per-job, ephemeral.
- The wiring: when substrate dispatches a specialist into a container, **the act of spawning the job inside the container reads the static template from the spec, resolves it against the container, and writes the active-subscription row.** The specialist does not subscribe itself; the orchestrator does not subscribe it. "Already subscribed" means *the moment the job exists, its subscription exists*, because spawn-into-container is the act that creates it.

So the specialist never "joins a channel." It is spawned into a container; the container has a channel; the spawn does the wiring by resolving the spec template. Static template (config) → automatic resolution (spawn-time) → live state (in the container). The orchestrator touches none of the three — the topology of who-talks-to-whom is now an emergent property of "who is inside which container, with which templates," not orchestrator-held state.

**Resolving relational filters needs a cross-store read.** Self-addressed filters (`steer:me`, `verdict:me`) resolve trivially against the job's `participant_key`. But relational filters — `finding:scope-overlap` ("wake me on findings whose files intersect *my* scope"), `turn:peer` — need the job's scope, which comes from the issue contract (`contract.scope`) of the issue this job is executing. So spawn-time resolution does one cross-store read: specialists asks substrate "what is the scope of this container's issue?" to resolve the filter. This is the §13.1 opaque-ID join-in-the-reader pattern, where the "reader" is the spawn-time runtime.

---

## 8. Tether (recap, renamed from shepherd)

Cross-reference: full design in `tether.md` (previously `shepherd.md`).

- Always-on by default. Per-job sidecar. PostToolUse-style hook on the runner.
- Layer 1 = deterministic matchers (free, runs every tool call): scope-drift, repeat-mistake, relevant-memory (FTS5), tool-pattern, gitnexus-impact, budget-threshold, forbidden-action, stale-claim, **collision-overlap** (fires when this worktree's diff hunks overlap another active chain's), **obligations** (fires when a marker like `TODO/FIXME/HACK` is introduced on a production surface outside accepted `non_goals` — §6.6; the marker vocabulary is specialist-set config, not hardcoded).
- Layer 2 = small free-tier model (Groq → Nvidia NIM → local Ollama → skip), fires only when Layer 1 is quiet for K events.
- Hints prepend to the next prompt turn — forced, not opt-in.
- Suppression: dedupe by id, per-pattern cooldown, per-job hint cap, severity tiers (`info|warning|blocker`).
- Substrate-relevant addition: tether **reads from the plan artifact** at job spawn. If the plan said "preserve `runInstall` calling convention," that becomes a forced hint anchored to any edit near `runInstall`.

---

## 9. Collision matrix

Cross-cutting facility attached to containers, populated by polling each active worktree.

### 9.1 Data source

Per worktree, every 8–15 seconds:

```bash
git -C <worktree> diff <fork_base>...HEAD    # committed since branch; <fork_base> from the container
                                             # (§6.9.7 / §13.3: `main` for standalone/wave-children,
                                             # `epic/<id>` for epic-children). Using `main` uniformly
                                             # produces false positives on epic-base commits no child touched.
git -C <worktree> diff                         # uncommitted on top
```

Concatenate. Parse `+++` headers for files, `@@` headers for hunk ranges, count added/removed lines per hunk.

### 9.2 Cross-reference

For each file appearing in ≥2 active worktrees:

1. **File-level collision** (amber): same file, no range overlap. Worth watching, often safe.
2. **Range-level collision** (red): same file, overlapping line ranges. Will conflict at merge.
3. **Semantic collision** (red, with caveat): non-overlapping ranges, but one chain edits a symbol the other chain calls (resolved via cached `gitnexus_impact`). Git would merge cleanly; behavior may break.

### 9.3 Surfacing

- **In the main dashboard:** compact matrix (files × worktrees, cells = hunk markers).
- **As tether hints:** fires `blocker:collision-overlap` to the offending chains immediately on detection.
- **In the plan artifact:** `seed_risks` and `collision_strategy.clusters` are populated from a *predicted* matrix at seed time, then reconciled against the *live* matrix once chains start running.
- **In CLI:** `sb collisions list [--container <id>]`, `sb collisions show <file>` (per-file diff overlap view).

### 9.4 Resolution commands

```bash
sb container serialize <chain:a> <chain:b>
  # chain:b waits in its seed until chain:a reaches merge_ready

sb container unify <chain:a> <chain:b> --new-issue <intent>
  # spawn fresh seed that collapses both chains into one issue/executor

sb container pause <chain:b>
  # keep-alive but stop dispatching new jobs

sb reconcile <chain:a> <chain:b>
  # dispatch reconciler specialist to read both branches and produce a merge plan
```

---

## 10. Memory

Memory is **durable, cross-task knowledge** — distinct from the coordinator journal (operational state of one node, §5.9) and from channel messages (ephemeral live traffic, §7). Today this is bd memories + FTS5: flat, anyone writes, everything lands in one generic project pool, retention is "whenever you run the memory-processor." Substrate keeps the generic write-and-FTS5 idea but adds **metadata**, and from that metadata three levels of memory emerge — *as queries, not as a field*.

### 10.1 A memory is facts + metadata; levels are queries

A memory entry records facts and the context in which they were learned. It does **not** carry a "scope" field — forcing the writer to classify would be a false choice, because the same memory is simultaneously all three levels seen through different queries.

```jsonc
{
  "id":              "mem-7f3a",
  "type":            "bug | hint | best_practice | failure",  // classifies for sharper queries
  "created_by_role": "executor",        // who, as a role
  "created_by_job":  "exec_7f3a",       // who, as an instance
  "in_container":    "node:research",   // where it was learned
  "project_id":      "proj-abc",        // which project
  "reason":          "why this is worth remembering",
  "created_ms":      0,
  "body":            "FTS5-able text"
}
```

`type` is an orthogonal classifier (not a level — levels are still the three queries below). It sharpens retrieval: `type: failure` memories are the "what didn't work, don't repeat" set distilled from semantic failures (§5.10); a seed planning similar work pulls them so the plan avoids known walls.

The three levels are *consumer queries* over that metadata:

| Level | Query | Example |
|---|---|---|
| **herd** (project total) | `project_id = X` | known issues, do/don't, architectural decisions — the whole project's learned knowledge |
| **workgroup** (e.g. node) | `in_container = node:Y` (or up its provenance) | what *this* node has learned ("source X is unreliable") |
| **identity** (specialist type) | `created_by_role = R AND project_id = X` | what executors learned to be here ("this project's reviewer prefers style X"); what reviewers learned ("this executor's common error patterns") |

The levels **cross**: one memory written by `exec_7f3a` inside `node:research` in `proj-abc` appears in *all three* queries — it is herd (in the project), workgroup (in the node), and identity (written by an executor). It isn't classified as one; it's one fact, three lenses. This means: the writer can't mis-classify (every memory is reachable by every lens that includes it), and new levels are added as new *queries* (e.g. "what does an executor know about working with *this specific* reviewer") without migrating any field.

The identity level is the powerful one: the tenth executor spawned in a project inherits what the previous nine learned about working well *with this project's specific reviewer* — an accumulated role identity, not a blank slate.

### 10.2 Memory access is a capability, not a role

Earlier drafts had a dedicated `memory-curator` specialist — invited at seed-time, fired ad-hoc as a tether check, doing relevance judgment with a small free-tier model. The role is eliminated: **memory query is a capability every participant carries, not a participant kind.** The decoupling matches §10.1's principle that levels are queries — if levels are queries, *access* is also query-shaped, and access belongs to whoever has the query to ask. Three places this concretely changes:

- **At seed/plan-time, the planner queries memory itself.** The pi-runtime already carries light memory-fetch instructions; substrate formalizes this as a mandatory **memory query extension** that prepends to the planner's prompt (analog to the `ISSUE_LOCAL_RULES` injection of §6.5 — structural, not opt-in). The planner runs the three-lens queries (herd / workgroup / identity) as part of its own reasoning, decides what's relevant from the inside, and the approved plan stamps each issue's `memory_pack` from the planner's own findings. One less advisor in the seed, no translation layer between issue-shape and memory-relevance.
- **At run-time, the specialist queries memory itself.** Same extension, same three-lens queries, surfaced ad-hoc by the participant when its own work calls for "have we seen this before?" — not pre-fetched by a curator that doesn't know yet what the specialist will hit. A senior practitioner looks up what they need when they need it; the runtime models that, not a pre-mastication step.
- **At close-time, the chain coordinator distills new memory** (§4.3). This is the productive half the eliminated curator handled implicitly: writing `type:failure` memories when a semantic failure declares "this approach was tried and didn't work, the wall is X" (§5.10), and `type:best_practice` memories when a chain clean-closes with something worth carrying forward. Distillation is judgment over what just happened — the close-time judge is the right actor; the chain coordinator has just observed the whole chain and has the cleanest read on what's worth remembering.

The tether's Layer-2 relevance check (§8) stays as it is — a sidecar matcher with a small local model that fires on quiet jobs. That mechanism is independent of "the participant queries memory itself"; the tether is observing tool calls, not reasoning. No change there.

Net: the dedicated memory-curator role disappears from both ends — planner advisor and tether check — replaced by an extension-injected capability that every participant carries, and a close-time distillation by the chain coordinator. Cheaper (no extra dispatch per seed) and structurally cleaner (memory access matches memory storage — both query-shaped, neither role-bound).

### 10.3 Retention is per-query, not per-field

Pruning becomes a query too. "Prune a retired node's memory" = delete `WHERE in_container = node:Y AND <not promoted>`. **Promotion** workgroup→herd is not a field rewrite — it is simply *not deleting* the row when the node dies, leaving it reachable by the herd query (which filters only by project). So promotion = "survive the container's pruning," demotion never needed. What makes "a good memory" worth keeping, and the pruning cadence, stay as today's memory-processor policy — but now the policy can act per-level via these queries instead of on one flat pool.

**Open (deferred):** exact per-level pruning policy; the promotion predicate (what makes a workgroup memory worth keeping project-wide); whether identity is per-role-global or per-role-per-project; how memory provenance (a memory written under `node:Y` by `exec_7f3a`) interacts with node retirement. These are the next memory-design questions, not yet closed.

---

## 11. CLI surface

Commands belong to the binary that owns the data. **substrate (`sb`)** owns seeds, containers, issues, dispatch, collisions, memory, validation. **specialists (`sp`)** owns the job/event/channel/tether surfaces. The console reads both; the orchestrator reads both.

### 11.1 Container lifecycle — `sb`

```bash
sb seed start --intent "..."                # opens a seed container, runs the planning channel
sb seed start --from-issue iss-X            # refines/decomposes an existing issue
sb seed status <seed-id>                     # advisor state + budget + plan draft
sb seed approve <seed-id>                    # commit plan; transform seed into final container
sb seed reject <seed-id> --reason            # close seed (abandoned)
sb seed rerun <seed-id> --redirect "be more specific about scope"

sb container ps                              # list active containers (seed/chain/epic/wave/node)
sb container ps <container-id>               # show inside: issues, jobs, worktrees, channel
sb container ps --tree                       # nested view (epic > chains)
sb container ps --all-projects               # lift project scope (shared store)

sb container serialize <a> <b>
sb container unify <a> <b> --new-issue "..."
sb container pause <id>
sb container resume <id>
sb container merge <id>
sb container abandon <id> --reason "..."
sb container chown <id> --to <owner>         # transfer ownership (orphan handling / escalation)

# nodes (standing containers)
sb node start --mandate "..." [--policy <file>]   # open a standing node + coordinator
sb node ps <node-id>                          # node state, children, queue, journal head
sb node pause <node-id> | sb node retire <node-id>

# emitters & pulses (the signal layer)
sb emitter register --kind script|service|external --def <file>
sb pulse emit --kind trigger|job|message --key "<idempotency-key>" --body <json>
sb pulse queue <node-id>                      # inspect a node's FIFO pulse queue
```

### 11.2 Issue lifecycle — `sb`

```bash
# create a ROOT (issue create defaults to class=root; steps are NOT created here —
# they are born from chain composition / `sb chain insert`, §6.9.5) — three forms (§6.4)
sb issue create --intent "..."               # bare draft root; Stage-1 schema-check runs (free)
sb issue create --in-container <id> \        # inline full contract into an existing container
  --title "..." --type task \
  --problem "..." --scope "src/**" --validation "npm test" --acceptance "..." \
  [--rel discovered-from:<id>] [--rel blocks:<id>] [--chain-template <name>] [--strict] [--dispatch]
sb issue show <id>                           # full contract + state
sb issue update <id> --field <path> <value>  # schema-validated update; re-runs Stage-1
sb issue ls [--all-projects]                 # root/followup by default (§6.2.1)
sb issue ls --class step,gate,advisor        # show chain internals

sb dispatch <issue-id>                       # gate; opens container if Stage-1 passes
sb dispatch <issue-id> --allow-unready --reason "..."
sb dispatch <issue-id> --chain-template <name> [--strict]  # override the type-default template (§6.9)

sb validate <issue-id>                       # Stage-1 (programmatic) on one issue
sb validate --explain <issue-id>             # Stage-2 (agentic): judgment + suggested_rewrite
sb validate --plan <plan-id>                 # run across a whole plan

# chain templates (§6.9)
sb chain-template ls                         # list defined templates (shipped defaults + per-repo custom)
sb chain-template show <name>                # steps, applies_when, defaults
sb chain review <chain-id>                   # proposed shape: step-issues, order, overlaid gates, unresolved nudges
sb chain insert <chain-id> --role <r> --before|--after <step-id> --because "..."   # add a step (§6.9.5)
sb chain approve <chain-id>                  # shape is correct → open transitions to working, dispatches

# issue close (§6.10) — rarely needed; container merge closes members transactionally
sb issue close <id> [--reason <r>] [--evidence <ref>]   # evaluates eligibility; structured refusal if blocked
sb issue close <id> --force --reason "..."   # eligibility override; logs escalation event
sb issue reopen <id>                         # only from abandoned|failed-*|superseded; else create a followup
sb issue ls --archived                       # show archived issues (hidden by default)

sb collisions list [--container <id>]
sb collisions show <file>

sb memory propose --container <id>           # manually invoke memory query/distillation
```

### 11.3 Observability — `sp` (specialists) + `sb` (substrate)

```bash
# specialists — jobs, events, channels, tether
sp feed -f                                   # job/lifecycle/channel/tether stream
sp feed -f --kind channel,tether
sp feed -f --workstream <conv:id>

sp tail <conv:id> [-f] [--kind verdict,finding] [--jq '.body.severity']
sp msg  <conv:id> "..."                      # human posts a steer into a channel
sp ch open a b [--topology reactive] [--stop-on pass]   # ad-hoc channel, no node config
sp ch list [--workstream <id>] [--status open]
sp ch show <conv:id>

sp tether hints <job-id>                     # all hints injected so far
sp tether hints <job-id> --pending           # currently sticky blockers
sp tether stats <job-id>
sp tether clear <job-id> [--id <hint-id>]

# substrate — container/issue/contract/collision/plan stream
sb feed -f                                   # container/issue/contract/collision/plan stream
sb feed -f --container <id>
```

### 11.4 The unified stream

The console's single "unified event stream" (LIFE / CHAN / TETH / COLL / CTRC / PLAN) is the **merge of `sp feed -f` and `sb feed -f`**, interleaved by timestamp. Neither binary owns all six classes: LIFE / CHAN / TETH come from `sp`; COLL / CTRC / PLAN come from `sb`. The console (or `xt feed -f`, a thin convenience wrapper in core) multiplexes the two. There is no single fat feed command in one module — each module streams what it owns.

---

## 12. Dashboard

The dashboard is a renderer over runtime state. Every panel maps to a CLI command; no UI-only knowledge.

### 12.1 Top-level layout

```
┌─────────────────────────────────────────────────────────────┐
│ Header: container count · collision count · open conv count │
├──────────────────────────┬──────────────────────────────────┤
│ Active issues            │ File-touch matrix                │
│ (contract state visible) │ (live git diff cross-reference)  │
├──────────────────────────┼──────────────────────────────────┤
│ Unified event stream     │ Focus pane: selected job          │
│ (lifecycle + channel     │ - tether hints                    │
│  + tether + collision    │ - channel subscriptions            │
│  + contract)             │ - budget/turn/token meter        │
│                          │ - lineage path                   │
├──────────────────────────┴──────────────────────────────────┤
│ Conversation surface for selected container                  │
│ (seed, chain conv, or epic-channel)                      │
└─────────────────────────────────────────────────────────────┘
```

### 12.2 Container card

For every active container:

```
seed:7f3a · working · 47s elapsed · budget 11/15 turns
├─ overthinker      · evaluating risk surface
├─ researcher       · checking publish.yml conventions
├─ devops-spec      · ✓ posted finding (3 recommendations)
├─ planner          · ✓ posted finding (2 relevant memories pulled via extension)
└─ seed-judge       · waiting on overthinker

draft plan: 3 issues · est $0.85 · est 35min wall · 1 cluster (serial)
```

Once container advances to `working`, the card flips to show the chain's resolved shape — step-issues with reached/pending status, the overlaid mandatory gates, and which step currently holds the worktree lease (§6.9.6):

```
chain:7f3a · working · executor holds lease · scrutiny: high
├─ ✓ explorer         (advisor)  done
├─ ✓ quant-method.    (advisor)  done
├─ ▶ executor         (step)     running · holds worktree lease
├─ ○ code-sanity      (gate)     pending
├─ ○ obligations      (gate)     pending
└─ ○ reviewer         (gate)     pending
```

The pending steps are the preheat/overview (§6.9.2): the chain's future is visible because the resolved shape is recorded. A gate shows `blocked` (not `done`) if it ran but returned FINDINGS/FAIL.

### 12.3 Event class palette

| Class | Color | Source |
|---|---|---|
| `LIFE` | gray | runner events |
| `CHAN` | violet | channel messages between participants |
| `TETH` | amber | tether hints |
| `COLL` | pink | collision detection events |
| `CTRC` | blue | validator events |
| `PLAN` | green | seed plan artifacts |

### 12.4 Reader/orchestrator parity

The dashboard reads the merged `sp feed -f` + `sb feed -f` streams. The orchestrator reads the same two streams. Differences are pure rendering (color, grouping, sparklines vs. text). Anything the dashboard can show, the orchestrator can query.

---

## 13. Data model / storage

### 13.1 One store, ownership by domain in code

There is **one database**, one daemon, one socket: `~/.xtrm/state.db` (SQLite WAL). The earlier two-store design (`~/.sb/state.db` + `~/.sp/observability.db`) is dropped — since xtrm exposes its own API (§17) and the console/our tools are its first consumers, the API is the surface of separation, not the files. One db, one process is simpler to use and removes inter-daemon coordination failure modes.

Separation is by **domain ownership in code**: each package owns its tables' schema and is the only code that writes them. Tables are namespaced by domain:

| Domain owner | Tables |
|---|---|
| **substrate** | `projects`, `containers`, `plans`, `issues`, `issue_dependencies`, `collision_events`, `validator_runs`, `pulse_dedup`, `pulse_queue`, `triggers`, `memories` |
| **channels** | `channel_messages`, `channel_subscriptions` |
| **specialists** | `jobs`, `runner_events`, `tether_hints`, `telemetry_samples` |
| **core** | `<repo>/.xt/` markers (worktree registry, hook config) — still on disk, not in the db |

A user who doesn't use part of the system just has empty tables — zero cost.

**Correlation is by opaque ID, never foreign key — even though it's one db.** Substrate's `chain:7f3a` is a string the other domains treat as an identifier; no domain enforces an FK across the boundary. Specialists writes `workstream_id='chain:7f3a'` on its job rows and trusts substrate knows what it means; substrate writes `iss-7f3a-001` and trusts specialists tags jobs with it. The join ("all sp events for this container") happens in the *reader*, now a trivial same-db query. Keeping the no-cross-domain-FK discipline even in one db is deliberate: it is what lets the domains be re-separated later (sharding, or specialists on a different machine) without redesign. Separation in code, simplicity of one store at runtime.

This keeps specialists **project-agnostic**: the `project_id` concept lives entirely in substrate's domain.

### 13.2 The store: shared by default

`state.db` is **shared across all projects on a machine**, served by a single daemon. This is deliberate, and it inherits a hard lesson from bd's drift to per-project Dolt servers: when each project (or worktree) spawns its own daemon, you get the "9 servers found, expected 1" failure, journal corruption from concurrent writes, and bd-inside-worktree "database not found" errors. One daemon, many projects, routed by `project_id`, avoids all three.

```
~/.xtrm/
├── state.db              # the single canonical store (SQLite, WAL mode)
├── state.db-wal
├── state.db-shm
├── daemon.sock           # Unix socket (named pipe on Windows)
├── daemon.pid
└── daemon.log

<repo>/.xt/
└── project.json          # { id: "proj-abc123", name: "xtrm", created_at_ms: ... }
```

Design rules for the daemon, each addressing a specific bd failure mode from real runs:

- **Lazy launch with a file lock.** The first `xt`/`sb`/`sp` command starts the daemon; a launch lock prevents two simultaneous invocations from both starting one. (bd's "9 servers" came from missing this.)
- **PID-aware lock cleanup.** A stale lock whose named PID is dead is detected and cleared on next launch, not left to block forever.
- **Unix socket, not TCP port.** No port conflicts; OS-level permission handling; reachable from any worktree on the machine. (Fixes bd's worktree "database not found" — friction bead `xtrm-hhiu`.)
- **SQLite + WAL, not Dolt.** WAL handles concurrent readers and serialized writers cleanly and is far more crash-resistant than the Dolt journal that corrupted mid-session (`xtrm-yb0u`). The "daemon" is a thin service wrapper that owns the file, holds prepared statements, runs migrations, and serves the streaming feed endpoints — not a full DBMS.
- **Single owner, all domains.** The daemon runs as the invoking user and hosts every domain's tables (substrate, channels, specialists). Each domain's package is the only code that writes its own tables; the daemon just owns the file and the socket.
- **Project identity is first-class.** `xt init` registers the repo with the daemon: writes a `projects` row and drops `.xt/project.json` in the repo. Any command thereafter walks up from cwd to find `project.json` (like git finding `.git/`) and scopes implicitly. `--all-projects` lifts the scope.

### 13.3 Substrate-domain tables

Every row is scoped by `project_id`; the daemon adds the predicate to every query automatically.

```sql
CREATE TABLE projects (
  id            TEXT PRIMARY KEY,           -- proj-abc123
  name          TEXT NOT NULL,
  root_path     TEXT NOT NULL,              -- canonical absolute path on this machine
  created_at_ms INTEGER NOT NULL
);

CREATE TABLE containers (
  id             TEXT PRIMARY KEY,          -- seed:X | chain:Y | epic:Z | wave:W | node:N
  project_id     TEXT NOT NULL,
  kind           TEXT NOT NULL,             -- 'seed' | 'chain' | 'epic' | 'wave' | 'node'
  state          TEXT NOT NULL,             -- abstract lifecycle: open|working|converging|ready|closed|escalated
  -- three axes (§2.6)
  parent_id      TEXT,                      -- MEMBERSHIP: which container I live in (nullable, mutable)
  opened_by      TEXT,                      -- PROVENANCE: who opened me (immutable)
  opened_reason  TEXT,                      -- PROVENANCE: plan-approval|node-trigger|manual|escalation
  origin_chain   TEXT,                      -- PROVENANCE: cached chain to root (e.g. "node:r/seed:y/chain:z")
  owned_by       TEXT,                      -- OWNERSHIP: responsible actor right now (mutable)
  -- node-only
  autonomy_json  TEXT,                      -- coordinator policy: node = autonomy + can_open_containers (§5.8);
                                            --   chain = max_inserts, allowed_insertion_roles,
                                            --   max_followup_proposals, escalate_when (§4.3)
  chain_coordinator_model TEXT,             -- chain-only: model the chain coordinator runs on, declared by
                                            --   chain_template (§6.9.10); null means no coordinator
  coordinator_journal_json TEXT,            -- node-only: coordinator handoff state for respawn (§5.9):
                                            -- { checkpoint_ms, channel_head_msg_id, open_children, handled_set, ... }
  -- failure recovery (§5.10)
  recovery_policy_json TEXT,                -- transient/semantic recovery policy; inheritable from node/orchestrator
  failure_class  TEXT,                      -- null unless failed: 'transient' | 'semantic'
  nonprogress_consecutive INTEGER NOT NULL DEFAULT 0,  -- resets on any gate cleared (semantic_after counter)
  nonprogress_total       INTEGER NOT NULL DEFAULT 0,  -- never resets (hard_cap backstop)
  -- chain template (§6.9)
  resolved_chain_json     TEXT,             -- the chain's explicit forward plan: Layer-1 steps + Layer-2 gates,
                                            -- with reached/pending status per step; the completeness contract
  worktree_lease_json     TEXT,             -- { held_by, state: leased|free, acquired_at_ms } (§6.9.6)
  -- general
  plan_id        TEXT,
  conv_id        TEXT,                      -- OPAQUE ref to the channel workstream; == id by convention
  worktree_path  TEXT,                      -- nullable; epics/nodes may have none of their own
  fork_base      TEXT,                      -- branch this container forked from (§6.9.7): main, or epic/<id>
                                            -- for an epic child; substrate owns this (resolves xtrm-nr05)
  opened_at_ms   INTEGER NOT NULL,
  closed_at_ms   INTEGER,
  close_reason   TEXT,                      -- merged|abandoned|transformed|retired|failed
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX idx_containers_project_state ON containers(project_id, state);
CREATE INDEX idx_containers_owned ON containers(owned_by);
CREATE INDEX idx_containers_opened_by ON containers(opened_by);

CREATE TABLE plans (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL,
  container_id   TEXT NOT NULL,
  schema_version TEXT NOT NULL,             -- 'seed.plan.v1'
  body_json      TEXT NOT NULL,             -- full plan artifact
  approval_state TEXT NOT NULL,
  approval_mode  TEXT,
  approval_at_ms INTEGER,
  approval_actor TEXT
);

CREATE TABLE issues (
  id                     TEXT PRIMARY KEY,
  project_id             TEXT NOT NULL,
  container_id           TEXT,              -- set on creation (plan commit, --in-container, or mid-flight)
  class                  TEXT NOT NULL,     -- root|step|gate|advisor|followup (§6.2.1)
  title                  TEXT NOT NULL,
  type                   TEXT,              -- only on class=root: task|bug|chore|spike|design|research
  role                   TEXT,              -- only on non-root: executor|reviewer|<custom> (was specialist_hint)
  priority               INTEGER NOT NULL,
  contract_xml           TEXT NOT NULL,     -- canonical serialization is XML (§6.9.2): <change-contract> if
                                            -- class=root (problem/scope/non-goals/validation/acceptance child tags);
                                            -- <step-contract> if class=step|gate|advisor|followup
                                            -- (mandate/inputs/outputs/scope/non-goals child tags) — keyed by class (§6.2.1)
  contract_state_json    TEXT NOT NULL,
  work_state             TEXT NOT NULL,
  review_state           TEXT NOT NULL,
  chain_template         TEXT,              -- optional named template (§6.9); else resolved from type
  memory_pack_json       TEXT,
  issue_local_rules_json TEXT,
  evidence_json          TEXT,
  created_at_ms          INTEGER NOT NULL,
  updated_at_ms          INTEGER NOT NULL,
  closed_at_ms           INTEGER,
  close_reason           TEXT,
  FOREIGN KEY (project_id) REFERENCES projects(id)
);
CREATE INDEX idx_issues_project_workstate ON issues(project_id, work_state);

CREATE TABLE issue_dependencies (
  project_id  TEXT NOT NULL,
  issue_id    TEXT NOT NULL,
  depends_on  TEXT NOT NULL,
  kind        TEXT NOT NULL,                -- gate: 'blocks'|'parent-child'|'until'
                                            -- context: 'discovered-from'|'validates'|'caused-by'|'relates'|'tracks'
                                            -- lifecycle: 'supersedes'   (see 6.7)
  PRIMARY KEY (project_id, issue_id, depends_on, kind)
);

CREATE TABLE collision_events (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id      TEXT NOT NULL,
  detected_at_ms  INTEGER NOT NULL,
  container_id    TEXT,
  severity        TEXT NOT NULL,            -- 'file' | 'range' | 'semantic'
  file            TEXT NOT NULL,
  worktrees_json  TEXT NOT NULL,            -- ["wt-A", "wt-B", ...]
  hunks_json      TEXT,                     -- per-worktree hunk ranges
  resolved_at_ms  INTEGER,
  resolution      TEXT                      -- 'serialize' | 'unify' | 'restitch' | 'merged-clean'
);

CREATE TABLE validator_runs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id     TEXT NOT NULL,
  issue_id       TEXT NOT NULL,
  ran_at_ms      INTEGER NOT NULL,
  contract_state TEXT NOT NULL,             -- invalid | partial | ready | waived
  body_json      TEXT NOT NULL              -- gaps, suggested_rewrite, recommended_template + display steps (§6.3)
);

-- pulse / trigger / node-scheduling (§5.8)
CREATE TABLE pulse_dedup (
  project_id      TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,            -- '<source>:<entity>:<event>', e.g. 'github:pr-50:opened'
  pulse_id        TEXT NOT NULL,
  container_id    TEXT,                      -- the container this pulse mapped to (null while in flight)
  first_seen_ms   INTEGER NOT NULL,
  PRIMARY KEY (project_id, idempotency_key)
);

CREATE TABLE pulse_queue (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,  -- FIFO order
  project_id    TEXT NOT NULL,
  node_id       TEXT NOT NULL,              -- which node's queue
  pulse_kind    TEXT NOT NULL,              -- trigger | job | message
  body_json     TEXT NOT NULL,
  enqueued_ms   INTEGER NOT NULL,
  delivered_ms  INTEGER                     -- null until the coordinator has taken it
);
CREATE INDEX idx_pulse_queue_node ON pulse_queue(node_id, id);

CREATE TABLE triggers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id    TEXT NOT NULL,
  node_id       TEXT NOT NULL,
  trigger_kind  TEXT NOT NULL,              -- 'schedule' | 'watch' | 'event'
  spec_json     TEXT NOT NULL,              -- cron expr, or watch predicate, or event matcher
  coalesce_window_ms INTEGER,               -- mechanical de-dup window
  max_wakes_per_period_json TEXT,           -- mechanical rate-limit
  enabled       INTEGER NOT NULL DEFAULT 1
);

-- memory (§10): facts + metadata; levels are queries, not a column
CREATE TABLE memories (
  id              TEXT PRIMARY KEY,         -- mem-7f3a
  project_id      TEXT NOT NULL,
  type            TEXT,                     -- 'bug'|'hint'|'best_practice'|'failure' (orthogonal classifier)
  created_by_role TEXT,                     -- 'executor' | 'reviewer' | ... (identity-level query)
  created_by_job  TEXT,
  in_container    TEXT,                     -- 'node:research' (workgroup-level query)
  reason          TEXT,
  body            TEXT NOT NULL,            -- FTS5-indexed
  created_ms      INTEGER NOT NULL
);
CREATE INDEX idx_memories_project ON memories(project_id);
CREATE INDEX idx_memories_container ON memories(in_container);
CREATE INDEX idx_memories_role ON memories(created_by_role, project_id);
CREATE INDEX idx_memories_type ON memories(type, project_id);
-- + FTS5 virtual table over memories.body
```

### 13.4 Channels-domain and specialists-domain tables

Both live in the same `state.db`, owned by their packages.

**channels domain** — `channel_messages`, `channel_subscriptions` (typed messages per channels.md). Each message carries **two identifiers**: a channel-local `seq` (`INTEGER AUTOINCREMENT`, the ordering + cursor for cursor-through-N) **and** a globally-unique `msg_id` hash (Slack/Discord-style, e.g. `msg_a1b2c3…`). The `seq` only makes sense inside its channel; the `msg_id` is the stable global handle used to reference a message from outside it — from another channel, from an issue's evidence, from a coordinator journal (§5.9), from provenance. Both are needed: `seq` for order/cursor, `msg_id` for identity/reference.

**specialists domain** — `jobs`, `runner_events`, `tether_hints`, `telemetry_samples`. No `project_id` column; `workstream_id` strings look like `chain:7f3a` because substrate named them, but specialists treats them as opaque. (Full schemas in channels.md / tether.md.)

Neither domain holds a foreign key to substrate's tables (§13.1) — correlation is by opaque ID even though it's the same db.

### 13.5 Plan artifact storage

Plans store as JSON blobs (the v1 artifact) in substrate's `plans` table. Schema versioning is explicit via `schema_version`; old plans render under whatever schema they were written. The plan also dual-writes to the seed channel as a `system.done` message body, so the channel history is one replayable stream — but the canonical copy is the `plans` row.

### 13.6 Multi-machine sync

Out of scope for v0. Each machine has its own shared `state.db`; data does not follow you between laptop / desktop / CI. `project_id` is a UUID specifically so a future sync layer (Dolt, LiteFS, or a backend service) is feasible without schema redesign. Don't promise portability until it's built.

### 13.7 Migration from bd

The current sp + bd + GitHub materializer is **disposable** (§17). We are not carrying it forward, so bd → substrate is **not** a coexist-via-shim exercise. It is a one-time data migration: read existing bd issues, map them into substrate's issue schema (best-effort — bd's prose `description` becomes `contract.problem`, with `contract_state` scored `partial`/`invalid` by the validator so gaps surface), write them into `state.db`, then repoint consumers at substrate's API. Legacy bd issues that don't yet meet the contract bar are imported as `work_state` unchanged with a `contract_state` that flags what's missing; nothing is silently dropped. After cutover, bd is read-only archival or removed entirely. No long-lived shim, no dual-write debt.

---

## 14. Open questions

**Resolved since revision 0:** module names pinned (core/substrate/channels/specialists/console, binaries `xt`/`sb`/`sp`); correlation by opaque ID across domains (§13.1); substrate's store is shared-by-default via a single daemon (§13.2); module names pinned (core/substrate/specialists/console, binaries `xt`/`sb`/`sp`); tether is the confirmed name; the unified feed is a merge of `sp feed -f` + `sb feed -f`, not one fat command; multi-machine sync is explicitly deferred to post-v0 (§13.6).

**Resolved in revision 2:** conversations renamed to **channels** (colon IDs so container ID = channel workstream ID, §7); **substrate owns epics** — `sp epic` removed, `sb container merge` is the single canonical merge and works because substrate owns the fork-base (§2, §4); `scrutiny` (generic, domain-neutral) replaces `risk`, with the code-specific auto-escalation table living in shipped config not core (§6.6); obligations/ddiff/release-checklist folded in generically; the sp+bd+GitHub materializer is **disposable** so bd→substrate is a clean data migration, not a coexist-shim (§13.7); API shape drafted (§17).

**Resolved in revision 3:** the **issue-relationship system** is first-class — nine relationship types classified by runtime effect (gate / context / lifecycle / tracing), with only `blocks`/`parent-child`/`until` gating dispatch (§6.7); membership (`container_id`, a property) is kept distinct from relationship (an edge); **issue creation is decoupled from dispatch** — issues are born at plan approval or via `sb issue create --in-container` (including mid-flight `discovered-from`), and `sb dispatch <id>` carries no container/parent because the issue already does (§6.4); **container-channel coexistence** is spelled out — opening a container opens its channel, and a dispatched specialist slips in automatically via spec-template→active-subscription resolution at spawn time, moving who-talks-to-whom out of orchestrator state (§7.1); **context-depth is two flows** — channels for live reading, substrate `evidence` for persisted context, with specialist results dual-written so tracing never depends on a channel surviving (§6.8).

**Resolved in revision 4:** the container model is now an **abstract lifecycle** (`open → working → converging → ready → closed`, + `escalated`) specialized per kind, which is what makes the system adaptable to non-coding workflows (§3); **preflight became the `seed` container kind** — a planning container that transforms into the container it produced (§4.1, §5); **`node` is the fifth, standing kind** — a long-running autonomous coordinator that opens child containers within an autonomy policy, with mechanical scheduling in the daemon and semantic scheduling in the coordinator (§4.2, §5.8); **three axes** separate membership / provenance (immutable) / ownership (mutable), the last resolving orphan handling and ownership escalation (§2.6); **emitter + pulse** are the signal layer, with idempotency-key dedup, and the node autonomy policy = emitter capability = `can_open_containers` (one capability model, §2.3, §5.8); **specialist lifecycle is itself pulses**, so coordinator respawn is a pulse handler not special code (§5.8); **coordinator context-window** is bounded (max ~2 compactions → kill+respawn), the coordinator is stateless w.r.t. the node, and a respawn reconstructs from origin-seed scope + recent channel + a **journal with a state snapshot for gap-detection** (§5.9); **participant** is the membership abstraction (specialist is one kind; scripts/services/coordinators/external are others), exposing a reusable **SDK surface** (participant definition, pulse, channel client, command surface) so new actors are filled-in schemas not new runtime (§2.2, §2.4); **what is NOT a container** is stated explicitly (§2.5); **single store** — one `~/.xtrm/state.db`, one daemon, domains namespaced, ownership in code, no cross-domain FK (§13.1); channels became a **standalone package** with its own domain tables, and messages carry a global `msg_id` hash beside the channel-local `seq` (§13.4); **memory** is facts+metadata with herd/workgroup/identity as **consumer queries not a field**, retention per-query (§10).

**Resolved in revision 5:** three explicit issue-creation paths are first-class from the top of §6.4 — plan-approval (planning), inline CLI into an existing container with full contract + optional `--dispatch` (direct), and mid-flight materialization from a proposal/escalation (discovery); "issues are born at plan approval" was demoted from *the* path to *one* path (§6.4); the **validator is two-stage** — programmatic schema-check always (free, hard-rejects incomplete, soft-flags thin), agentic model judgment only on demand or inside a seed, so the hot path is never gated by a model (§6.3); the **advisor panel is tunable** — orchestrator can run a minimal/sole-advisor seed or `system.invite` extras, planner and memory-curator are soft-mandatory not rule-gated, operator can suggest (§5.2, resolves old open-Q #2).

**Resolved in revision 6:** **failure recovery** is a named mechanism (§5.10) built from existing pieces only — no new entity, no "watchdog": counters are container state, the daemon observes and emits lifecycle pulses (§5.8), handlers react. Every unclean termination carries `failure_class: transient | semantic`; the normal review loop within threshold is *not* a failure (it's ddiff, §3); semantic failure fires at a non-progress threshold — `semantic_after` consecutive (resets on progress) plus a generous `hard_cap` total (anti-oscillation backstop) — counted at *any* gate; semantic failures escalate **graded** (orchestrator first, operator only beyond policy); transient failures retry identically within policy; **work is never destroyed on failure** (`closed:failed`/`escalated`, never auto-`abandoned`; worktree + evidence preserved); preserved material *resumes* (transient) or *improves* (semantic); and a semantic failure **distills a `type: failure` memory** so future seeds pull "this was tried and failed because X" (§10) — failure recovery is generative, not just defensive. Schema gains `failure_class`, `recovery_policy_json`, the two non-progress counters, `close_reason=failed` (§13.3); memory gains a `type` classifier (§10.1). Resolves old open-Q #1.

**Resolved in revision 7:** **workflows** are a named mechanism (§6.9) that settles, once and for all, how a chain advances — the previously-ambiguous question of who drives step-to-step dispatch. **Advancement is workflow-driven, executed by substrate, observed by the orchestrator** (§3, §6.9.1): the orchestrator opens a chain and watches, intervening only on exceptions, rather than starting each routine step by hand (which is where it went lazy — skipped reviewers, forgotten debuggers). A workflow's **resolved form is persisted container state** (§6.9.2), giving overview/preheat, a completeness contract the daemon verifies before `merge_ready`, and pre-allocation. Workflows are **two layers** (§6.9.3): Layer 1 = domain-specific steps in `config/workflows/` (defaults + per-repo custom, nesting inside executor/reviewer bookends, with `applies_when` auto-match); Layer 2 = mandatory gates (code-sanity + obligations-scanner on production diffs, security-auditor on sensitive surface) overlaid by risk/surface independent of the chosen workflow, with codified skip exceptions and unauthorized-skip = escalation. Resolution is by issue-type default (`bug` → `debug` with non-skippable debugger), explicit `--workflow`, or auto-match (§6.9.4); a workflow **suggests unless `--strict`**, but the mandatory layer is never waived. The resolved workflow is **mutable in flight** (§6.9.5): members enter mid-run via operator (by hand), orchestrator (judgment within policy), or daemon (deterministic codified rules only), with daemon insertions living inside the §5.10 non-progress counters so they cannot loop. Schema gains `resolved_workflow_json` on containers and `workflow` on issues (§13.3); `recommended_chain` becomes `recommended_workflow` (§6.3).

**Resolved in revision 8:** minor open questions with clear leanings closed — container nesting **soft-capped at 2 levels** (warning/escalation beyond, not hard-block; exact threshold deferred, #3); daemon lifecycle is **lazy-launch** on first command with `sb daemon status/stop` (#9). Questions where the honest answer is "real runs decide" were explicitly flagged **deferred to the next agent** rather than guessed (#5 issue-local conflict, #6 session-level curator, #11 node nesting depth tied to desired autonomy, #12 dispatch_mode predicate). Added **§14.1 Questions for the next agent** — organized by what the next agent will have that this design pass did not: code visibility (`runner.ts`/`coordinator.ts`, the pi-runtime turn concept, the daemon-observes hooks, cross-container coordination protocol), past run transcripts (which workflows actually recur, where the orchestrator actually goes lazy, whether the transient/semantic failure split holds), and external exploration (database engine choice, the beads repo, issue-system domain-neutrality). The main remaining *design* item, #7 (per-issue close flow against container state), is flagged for a dedicated pass.

**Resolved in revision 9:** the workflow concept is renamed **chain_template** and substantially deepened (§6.9, formerly "Workflows" → "Chain templates and composition") — "workflow" no longer appears, the unit is the chain. **Every dispatch is step-issue-backed** (§6.9.2): a root carries a *change contract* (the five sections), a step carries a *step contract* (mandate/inputs/outputs/scope) — two honest shapes, not one forced mould — recovering bd's durable-inspectable-contract property; prompt composition is explicit and layered so a participant receives its role rather than inferring it. **Composition happens in two moments with growing information** (§6.9.5): container composition at seed-time (epic/wave/chain kind; planner extended to propose each chain's shape) and chain composition pre-dispatch (orchestrator refines with sibling-chain information), plus mid-run insertion as a third; the **composition gate** (`sb chain review` / `insert` / `approve`) forces shape evaluation before a chain enters `working`, the analog of seed approval, auto under policy. Three nudge levels feed it — L1 programmatic (raises the question), L2 issue-type, L3 orchestrator judgment (decides) — the model judges, the programmatic layer only makes the question inevitable. The **orchestrator is formalized as the technical extension and judge of the operator's vision** — micro-management removed, composition judgment increased. A **chain_template has three origins** (§6.9.4): pre-built, type-resolved, on-the-run, with the ad-hoc→formalized→engineered promotion cycle. The **worktree lease** (§6.9.6) formalizes one-active-writer-at-a-time: writer-steps acquire/release, read-only steps don't touch it, the daemon serializes, and the executor→debugger handoff is sequential writers on one worktree. The **git model is two axes** (§6.9.7): container kind (how roots relate) vs. chain shape (a root's steps); epic has a shared integration base (children fork from `epic/<id>`, see each other), wave has independent bases (children fork from main, collision-watched); worktree names inherit the hierarchy (`wt/epic-<id>/chain-<id>`). **Deliberative issue types** (`design`, `research`) default to deliberative templates closing with a `decision` outcome (§6.9.8). The issue gains **three non-overlapping classifiers** (§6.2.1): `class` (structural function: root/step/gate/advisor/followup — stored not derived, so the system treats even unknown custom specialists correctly and gate-ness is structurally enforced against laziness), `type` (kind of root work, only on `class:root`, `decision` removed as it is an outcome not a classifier), `role` (who executes, was `specialist_hint`, may be a custom specialist; same role can hold different classes by position — researcher-as-gate). A root is not directly dispatchable — it needs ≥1 step, enforced by the `sb chain approve` gate. The nine relationships (§6.7) stay unchanged; two proposed edges (`informs`, `spawned_by`) are recorded as future splits, subsumed by `relates`/`discovered_from` until a use distinguishes them. Schema: `resolved_chain_json` + `worktree_lease_json` on containers, `class`/`type`/`role`/`chain_template` on issues (`specialist_hint`→`role`); `recommended_workflow` → `recommended_template`; CLI gains `sb chain-template ls/show`, `sb chain review/insert/approve`, `sb issue ls --class`. A grounding pass reconciled the older node sections to the new structure: **cross-container collaboration is by pulse, not channel** (§4.2, §5.8, channels stay container-scoped, resolves the channels.md contradiction); **a node coordinator composes and auto-approves the chains it opens within its autonomy policy** (§5.8, the node adaptation of the composition gate); `sb dispatch` is clarified to dispatch a *root* and *compose its chain* (§6.4); schema gains `fork_base` (substrate owns it, §6.9.7), `coordinator_journal_json` (node respawn state, §5.9), and `contract_json` is noted to hold either contract kind by class; the dashboard card shows chain shape with reached/pending steps and lease holder. **Runtime alignment** (§3.1, verified against the pi runtime by the specialists-runtime review) settles how a container actually advances: event-driven on member `agent_end`/pulse/`sb` command, never a wall-clock tick and never live-stream text; `waiting` = pi keep-alive after `agent_end`; the daemon is a second reader of the existing observability stream (no new hooks); `transient` failure = pi's `auto_retry_*` envelope. A **precondition gate** (§6.4) is added as a dispatch-time check distinct from §5.10 recovery (*we should not have started* vs *we started and stumbled*), refusing with a structured envelope and an audit-traceable `--allow-unready --reason` override. This resolves the §14.1 turn-concept and daemon-observes questions and fixes the dangling §19/§20 references in §6.9.6. **The per-issue close flow** (§6.10, resolving open-Q #7) makes close a *derivation*: `close_ready` (new work-state) is the per-issue analog of the container's `ready`; members close transactionally at `sb container merge`, not the moment they're individually satisfied (the sole exception is non-blocking `followup`); the container-failed cascade is a §5.8 pulse handler preserving evidence. The three bd shims are **deleted by reuse** — memory-ack → §5.10's `type:failure` distillation, commit-gate → §6.8 dual-write, Stop hook → §3.1 participant-`waiting` (claims belong to jobs, not sessions). `done`/`archived` derive deterministically from `close_reason` (so `failed` leaves the work_state enum); `decided` is the close_reason for deliberative roots; reopen is allowed only from `abandoned|failed-*|superseded`. There is no routine `gate-failed` close — an unsatisfied gate blocks (§6.9.2) or cascades. The structured refusal envelope is shared with §6.4 and channels.md §10.2. **Six shipped default chain_templates** (§6.9.10) are catalogued — `code-quick`, `code-standard`, `code-with-advisors`, `debug`, `quantitative-validation`, `security-deep` — extracted from real chains by the specialists-runtime review (not invented), written flat (no `extends`, deferred), with Layer-2 gates overlaying all of them; `debug`'s non-skippable `debugger` and `quant-validation`'s non-skippable `quant-methodologist` structurally close the corresponding laziness modes, and `security-deep` demonstrates the same role at two classes (advisor pre-, gate post-). This partially resolves the §14.1 "which templates recur" question (six found, more await a wider transcript corpus). §6.9.10 frames the six as conceptual archetypes/floor and notes the runtime ships a larger evidence-backed `bd formula` catalog (currently thirteen) reconciled with the specialists-runtime roadmap.

**Resolved in revision 10:** the **chain coordinator** (§4.3) becomes a first-class participant of every chain — a standing judge of a transient container, parallel in shape to the node coordinator (§4.2) but scoped to one chain's lifetime. It spawns at composition completion (after `sb chain approve`, before step-1 dispatches) and plays four roles: **entry gate** (with fresh context, validates the chain shape from inside; inserts steps within `autonomy_json` policy; emits `verdict: ready` and only then does the daemon dispatch step-1 — small refinement to §3.1); **borderline judge** during execution (interprets cases the §6.10 reducer cannot decide alone: ambiguous gate findings, borderline evidence); **cross-chain hygiene coordinator** via pulse (collision alerts, gate-state advertisements, wait-for-me requests — mechanics not vision; vision stays with the orchestrator); **close-time judge** (confirms `close_ready`, verifies git-clean *for real*, distills `type:failure` / `type:best_practice` memories, proposes `class: followup` issues for out-of-scope findings via `--rel discovered-from:<root>`, releases the chain to `sb container merge`). Subordinate to the orchestrator (same escalation pattern as node coordinator, §5.8). **No privileged read path**: reads the channel like any participant (§6.8) for live coordination and queries `issue.evidence_json` for structured close-time tracing — both are public surfaces. **Model selection per chain_template** (§6.9.10): `code-quick` → small free-tier (or `null`); `code-standard` → mid-tier; `code-with-advisors` / `security-deep` / `quantitative-validation` → top-tier; operator can override per-chain. Lifecycle bounded to the chain's lifetime — no journal across sessions (chains are transient, unlike nodes' §5.9). **Memory access is reshaped** (§10.2): the dedicated `memory-curator` specialist role is **eliminated** at both ends. Memory access becomes a **capability every participant carries** via a mandatory memory-query extension (analog to `ISSUE_LOCAL_RULES` injection, §6.5) — the planner queries at seed-time during planning, specialists query at run-time when their work calls for it, no pre-mastication advisor in between. **Memory distillation moves to the closing judge**: the chain coordinator at chain close, the node coordinator at node close, the operator on escalated seeds; one actor per container kind, the one with full read on what just happened (§5.10 updated to name the closing judge generically). The tether's Layer-2 relevance check is untouched (independent mechanism, §8). Two §14 open questions are also resolved by rev10: **#5 (issue-local rule conflict)** is now **moot under rev9's step-issue model** — a reviewer is a step of one chain, sees only that chain's evidence, cross-chain reading does not occur (channels container-scoped, channels.md §15.2), so conflict-by-construction is impossible; **#6 (session-start memory curator)** is **superseded by the §10.2 rewrite** — no curator exists, every participant queries directly. The summary (§16), the §2 cross-cutting facilities note, the §5.2 advisor-invite list, the §5.7 seed example, the §6.7 / §6.8 references, and the dashboard card are updated accordingly. Schema gains `autonomy_json` and `chain_coordinator_model` on chain containers (§13.3, parallel to node fields).

Still open:

1. *(Resolved in rev6, §5.10.)* Seed/container failure never discards work — a failed seed preserves its incrementally-persisted findings, and `sb seed rerun` builds on them rather than starting cold; failed running containers preserve worktree + evidence.

2. *(Resolved in rev5, §5.2.)* Advisor panel tunability — orchestrator can add advisors by `system.invite`, run a minimal/sole-advisor seed, planner + memory-curator are soft-mandatory, operator can suggest.

3. *(Resolved in rev8, soft cap.)* Container nesting is **soft-capped at 2 levels** (wave-of-chains, epic-of-chains). Deeper nesting is not hard-blocked but raises a warning/escalation like an unauthorized gate skip — "nesting beyond 2 levels is unusual, confirm or decompose." Forces clean decomposition in the common case (nested epics are usually a scope smell) without walling off a rare-but-legitimate case. **Exact threshold deferred to the next agent**, who can see from real runs whether 2 holds or 3 emerges naturally.

4. **Plan-as-channel-message vs. plan-as-table.** Resolved toward dual-write (canonical copy in substrate's `plans` table; replay copy as `system.done` body in the channel). Tracking in case the duplication causes drift.

5. *(Resolved in rev10, moot under rev9 step-issue model.)* **Issue-local rule conflict.** The scenario that motivated this question — "reviewer jobbed onto issue A reads diff from issue B; whose rules apply?" — does not arise under rev9's step-issue model. A reviewer is a step-issue of one chain, reads only its chain's evidence, never another chain's diff (channels are container-scoped per channels.md §15.2; cross-chain reading does not happen). Conflict-by-construction is impossible. The rule scope is settled: a participant's prompt carries the rules of the issue that spawned it, period.

6. *(Resolved in rev10, superseded by §10.2.)* **Memory curator at session start vs. seed.** Superseded: there is no dedicated curator anymore. Memory access is a capability every participant carries (§10.2); each pulls what it needs when its own work asks for it. A session-level curator is unnecessary — the orchestrator and any participant query memory directly via the extension when context calls for it.

7. *(Resolved in §6.10.)* **What replaces `bd close` semantics.** Close is a *derivation*, not an imperative: an issue reaches `close_ready` when its evidence satisfies, the container reaches `ready` when all members are `close_ready`, and `sb container merge` closes every member transactionally. The three bd shims (memory-ack, commit-gate, Stop hook) are deleted by reuse of §5.10 / §6.8 / §3.1, not migrated. `done` vs `archived` derive from `close_reason`.

8. **Cross-container coordination.** *(Resolved in direction, protocol deferred.)* Peer node coordinators collaborate via **cross-container pulses** (§2.3, §4.2), not by watching each other's channels — channels stay container-scoped per channels.md. A peer emits a pulse on a documented key; the receiver wakes on it. The exact key conventions and cross-container authority for pulses are the remaining detail, resolved against the pulse/trigger implementation.

9. *(Resolved in rev8, lazy.)* Daemon lifecycle is **lazy-launch on first command** (no friction), with `sb daemon status` / `sb daemon stop` for control, and the file-lock + PID-aware cleanup rules (§13.2). Matches git's index-process model; no explicit start step required.

10. **Memory detail (§10.3).** Per-level pruning policy; the promotion predicate (what makes a workgroup memory worth keeping project-wide); whether identity is per-role-global or per-role-per-project; how a memory's provenance interacts with node retirement. The model is set; these tuning decisions are the next memory-design pass.

11. **Node nesting depth cap.** *(Open — deferred to next agent; tied to how much autonomy proves useful in real runs.)* A node opening a standing sub-node requires escalation (§4.2); the exact depth cap and whether sub-nodes may themselves escalate for grandchildren is unsettled. The right depth is a function of desired autonomy, which is discovered by watching what nodes actually do — not decidable from the armchair. Current rule (sub-node requires escalation) holds in the meantime.

12. **`dispatch_mode` predicate.** *(Open — deferred to next agent; real runs will show which task shapes recur.)* Per-node `direct | via_seed` is decided; whether it should be a richer predicate (direct for known task shapes, via_seed for ambiguous ones, evaluated per pulse) is open.

### 14.1 Questions for the next agent (code + run-transcript visibility)

This design was developed at the architecture level, deliberately *without* reading the specialist codebase or past run transcripts. The next agent will have both. These questions are the ones that need exactly that — code reality and observed run behavior — to answer well; answering them from the armchair would be guessing. They are grouped by what they require.

**Requires reading the runtime code (`runner.ts`, `coordinator.ts`, the pi-coding-agent runtime):**

- **The "turn" concept.** *(Resolved in §3.1.)* Pi's turn is the runtime's heartbeat; substrate aligns to it rather than inventing a separate tick. A container's reducer is event-driven on member `turn_end`/`agent_end`, pulse arrival, or `sb` command — never a wall-clock tick. `waiting` = pi keep-alive after `agent_end`. (Was verified against `runner.ts`/`supervisor.ts`/`pi-rpc.md` by the specialists-runtime review.)
- **The daemon-observes model.** *(Resolved in §3.1.)* Yes — the daemon is a second reader of the observability stream the supervisor already writes (the rows `sp log` reads); lifecycle pulses are emitted as a side effect of those rows, no new instrumentation.
- **Cross-container pulse conventions (open-Q #8).** Peer node coordinators collaborate via cross-container pulses (§2.3, §4.2), not channel-watching — channels stay container-scoped. The key conventions and cross-container pulse authority are the remaining detail; resolve against the pulse/trigger implementation and channels.md.

**Requires reading past run transcripts (what emerged naturally over time):**

- **Which chain_templates recur beyond the first six?** *(Partially resolved in §6.9.10.)* Six default templates were extracted from real chains (mercury 2026-05-25, specialists 2026-05-26) and shipped. They are a floor, not a closed set — mining more transcripts is expected to surface others worth formalizing (§6.9.4 promotion cycle). The remaining task is finding the next batch from a wider transcript corpus.
- **Where does the orchestrator actually go lazy?** §6.9.1 asserts the orchestrator skips reviewers and forgets debuggers under pressure. The transcripts should confirm *which* steps get skipped most, which validates (or corrects) which gates need to be mandatory (Layer 2) vs. merely default.
- **Do the failure classes (§5.10) match observed failures?** The transient/semantic split is a hypothesis. Real failures in transcripts will show whether that binary is sufficient or whether a third class emerges, and whether `semantic_after`/`hard_cap` thresholds are calibrated right.
- **Open-Qs #5, #6, #12** — each was left open precisely because real runs answer them better than design: does issue-local rule conflict (#5) ever actually occur; is context missing at session start such that a session-level curator (#6) is warranted; which task shapes recur often enough to justify a richer `dispatch_mode` predicate (#12).

**Requires external exploration (other codebases / infrastructure decisions):**

- **The database choice (§13).** Dolt vs. sqlite vs. dolt:sqlite (commits/push, doltlab), bun as framework, an automatic per-project versionable JSON backup. The global store will grow fast, which argues for versioning-native storage — but this is an infrastructure decision needing real benchmarks (what holds up under the growing global db), not an armchair pick. The design only commits to "single store, one daemon, opaque-ID correlation so it can be re-separated later" (§13.1); the concrete engine is open.
- **Explore the beads repo.** To avoid reinventing mechanics (especially dependency handling) that beads already solved. The nine-relationship model (§6.7) and the issue_dependencies edge table should be checked against how beads actually manages dependencies before implementation.
- **Issue-system domain-neutrality.** The issue `contract.scope` is a glob-list, which is code-specific; the system is meant to serve non-coding work too. Decide whether contract fields become generic or gain per-domain variants, and design the agent-guided per-repo config skill (`config/substrate/`, with an update mechanism) that §6.6 already implies. Part design, part a tooling decision that touches the codebase.

**The big-picture direction (not a question, a flagged ambition):** the n8n-style pipeline vision (§18 operator notes) — nodes + pulse + a complete SDK enabling agent-created automated pipelines, with connectors (Discord, Gmail) that have clear `emit pulse` + SDK access. This is the north star the SDK surface (§2.4) is being shaped toward; the next agent should keep it in view when evaluating whether the SDK is complete enough to write a connector against.

---

## 15. Sequencing

Not a migration plan; just dependency order for design completeness.

| Stage | What ships | Depends on |
|---|---|---|
| 0 | Substrate store + shared daemon (`state.db`, Unix socket, project registration, file-lock launch) | — |
| 1 | New issue schema + Stage-1 programmatic validator (schema gate) | 0 |
| 2 | Channels v0 (channel_messages table, `sp tail`/`sp msg`) | — |
| 3 | Tether v0 (Layer 1 matchers, forced injection) | — |
| 4 | Container entity (chain only) + lifecycle states | 0, 1, 2 |
| 5 | Seed channel (planner with memory-query capability §10.2 + validator advisor) | 1, 2, 4 |
| 6 | Plan artifact + approval modes | 4, 5 |
| 7 | Collision matrix (file-level) + tether collision-overlap matcher | 3, 4 |
| 8 | Epic / wave container kinds | 4, 7 |
| 9 | Advisor invite rules + full advisor set | 5 |
| 10 | Tether Layer 2 (small-model relevance check on quiet jobs, §8) | 3, 9 |
| 11 | Reconciler specialist | 7, 8 |
| 12 | Console renders against merged `sp feed -f` + `sb feed -f` | 1–7 (minimum) |
| 13 | bd → substrate data migration (§13.7, not a shim) | 1, 4 |

Each stage is independently shippable and reversible per the channels.md/tether.md philosophy. Stage 0 (the daemon + store) now leads because every substrate entity needs somewhere to live; it inherits bd's hard-won failure-mode lessons (§13.2) rather than rediscovering them.

---

## 16. Summary

The substrate names what the orchestrator currently carries in its head. Every unit of agent work is a **container** that goes through a **seed** (a structured **channel** among **advisors**) to produce a **plan artifact** that commits **issues** to the new issue store and dispatches a **chain | epic | wave** of specialist work. Every chain has a **chain coordinator** (§4.3) — a fresh-context standing judge that gates entry, judges borderline evidence, coordinates cross-chain hygiene by pulse, and distills memory at close; every node has its own coordinator (§4.2). Every running job is decorated by **tether** with always-on context. Cross-worktree edits are watched by a live **collision matrix**. **Memory** is queried as a capability by every participant (no dedicated curator) and distilled at close by the coordinator. The **dashboard** is a renderer over runtime state; the **CLI** exposes the same state.

The runtime models the entities. The dashboard reveals them. The orchestrator and node-coordinator drive them via the same CLI a human would. There is one source of truth and three readers.

---

## 17. API surface & consumers (draft)

> **Status: draft.** Endpoint-level shapes deferred. But the *shape* below — three faces, a native monotonic cursor, opaque correlation, a read-live bias for substrate — is decided enough to build against.

substrate is a **local long-running daemon**, one per machine, sole owner and sole writer of `state.db` (§13.2). It is authoritative and read-write for its domain (issues, containers, plans, collisions, validator). This is what distinguishes it from a *projection*: a projection is a rebuildable read-only copy; the engine *owns the truth*. Authoring is native to substrate, not write-through to some other store. Its three clients read the same surface: the `sb` CLI, the xtrm console, and the orchestrator. One source of truth, three readers.

### 17.1 Three faces

The API has three faces because they have different consumers and different guarantees.

**Query (read).**
- Issues: get by id; list with filters (project, work_state, contract_state, container); issue + dependencies.
- Containers: get; list; tree view (for nesting); "inside a container" (issues + plan + channel ref).
- Plans: get; list by container.
- Collisions: list; per-file.
- Validator: latest run per issue.
- **Snapshot:** complete current state of a project, for cold-start / resync.

**Change-tracking (the headline face).**
- A **native monotonic cursor**: `changesSince(cursor) → { created, updated, deleted, newCursor }`. Because substrate owns its store, it can guarantee a clean monotonic change sequence (a `seq` or `updated_at_ms` watermark on its rows). This is *why* substrate is a better backing source than bd: there is no Dolt commit-vs-working-set ambiguity (the recurring friction in the old system) because there is no Dolt — there is a store you control that hands you the cursor for free.
- A **stream** (`feed`, server-streaming over the socket): emits change events as they happen. This is the realtime channel.

**Command (write).**
- Issue: create (runs Stage-1 validation), update (re-validates), validate (Stage-2 on demand), dispatch (the gate).
- Seed: start, status, approve, reject, rerun.
- Container: serialize, unify, pause, resume, merge, abandon.
- Commands mutate `state.db` and emit events on the feed.

### 17.2 No inherited adapter — substrate defines, consumers conform

The current sp + bd + GitHub materializer is **disposable**. We are designing a new system; we do not bend substrate to fit old integration code. So the relationship inverts from the usual backward-compat story: **substrate defines the clean API, and whatever consumes it — a new console, a rewritten materializer, or direct readers — conforms to substrate.**

The three-method read shape (`cursor()` / `changesSince()` / `snapshot()`) is kept because it is the *correct* design for a store that owns a monotonic cursor — not because any existing adapter requires it. The design earns those methods; it does not inherit them. Consequently the bd→substrate path is a straight data migration plus repointing consumers (§13.7), not a long-lived compatibility shim.

### 17.3 The fork: materialize substrate, or read it live?

For GitHub and observability, materialization clearly wins — GitHub is remote and rate-limited, observability is N scattered files. But substrate is **a single local store behind a daemon that already serves fast queries and a feed.** Materializing it would mean copying SQLite→SQLite on the same machine. The job↔issue join that would justify a copy is exactly the §13.1 "join in the reader" pattern (ask substrate for containers, ask specialists for the jobs behind those IDs, stitch) — trivial at single-user, tens-to-hundreds-of-issues volume.

So for substrate specifically, the bias is **read live + join in the reader**, the opposite of the right call for GitHub/observability. The cost is resilience: with a copy, the console survives an `sb` daemon restart; with direct read it needs a small client-side last-successful cache to ride out a restart. That cache is far cheaper than a full projection layer. Each source chooses independently — substrate need not inherit a uniform "materialize everything" policy just because the old system had one. **This is the one genuinely open decision in this section; it shapes half the API and is left to the operator.**

### 17.4 Transport & correlation

- **Transport:** Unix socket, request/response *plus* streaming. CLI and console are peer clients of the same socket.
- **Versioned payloads:** `seed.plan.v1`, a versioned issue schema. The engine will evolve; old plans must render under the schema they were written with.
- **Correlation stays §13.1:** the API returns `conv_id`, `container_id` as opaque strings. substrate never joins with specialists. The reader stitches.

### 17.5 Naming caveat

Two distinct things share the word "substrate." This document means the **engine**: the `sb` package, the authoritative read-write store. That is different from any `substrate_*` *projection tables* that may exist in the old gitboard refactor — those are a rebuildable read-only copy and are part of what is disposable. Same word, two referents; don't collide them.