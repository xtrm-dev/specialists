> **ARCHIVED 2026-05-27** — content superseded by:
> - `docs/design/substrate/specialists-roadmap-revised.md` (canonical specialists roadmap; absorbed this file in §0/§3.2/§12/§13)
> - `docs/design/substrate/substrate.md` rev10 (canonical substrate design)
> - `docs/design/chain-templates/` (13 evidence-backed bd formulas)
>
> Preserved for historical context. Do not edit. Do not cite as authoritative.

---

# Substrate Review Notes

> Status: working review notes from the substrate design review.
> Source context: `docs/design/substrate.md`, `docs/design/channels.md`, recent specialists session reports, and Mercury market-data custom workflow reports.
> Purpose: capture decisions and proposed clarifications before rewriting the main substrate design.

## Contents

Grouped thematically; numbering follows write-order.

**Part I — Core model and primitives**
- §1 — Turn / tick model (Pi turns are observability, not scheduling)
- §2 — Workflow advancement (driven by workflow, not orchestrator)
- §3 — Containers, issues, channels, participants, pulses, evidence (primitives separated)
- §4 — Root issues and step issues
- §5 — Issue classes and roles
- §6 — Blocking and non-blocking semantics (edge vocabulary reconciled with substrate.md §6.7)
- §7 — Concrete nesting examples
- §11 — Channels and issue contracts together
- §12 — Concrete design patch needed in substrate.md

**Part II — Dispatch and operator surface**
- §8 — Dispatch commands
- §9 — Mid-flight ad-hoc insertion
- §10 — Pulse-driven insertion

**Part III — Cross-doc consistency and SDK**
- §13 — Cross-document consistency (substrate.md vs channels.md): cross-container channels, external connectors, pair: channels
- §14 — SDK surface (collapses §2.4's four items into two wires + reference client + schemas + credentials)
- §15 — Bound vs unbound participants
- §16 — Two activation modes (reactive vs workflow-step)
- §17 — Pulse delivery for non-coordinator consumers
- §18 — Reuse audit (what each new feature must reuse)

**Part IV — Runtime alignment (verified against pi/supervisor)**
- §19 — Pi turn alignment (decided: no separate substrate tick; event-driven on turn_end/pulse/sb)
- §20 — Daemon-observes model (decided: substrate consumes observability.db; no new hooks)
- §21 — Failure classification (decided: transient/semantic holds; preconditions are a separate §6.4 concern)

**Part V — Lifecycle and policy decisions**
- §22 — Per-issue close flow (replaces bd close + memory-ack + commit-gate + Stop hook)
- §23 — Autonomy gradient: container nesting, node nesting, dispatch_mode predicate
- §24 — Knowledge scope: rule conflict, session vs seed curator, memory pruning/promotion/identity

**Part VI — Workflow definition language**
- §25 — Workflow language + concrete workflows extracted from session reports

---

## 1. Turn / tick model

Substrate should not treat Pi's `turn_start` / `turn_end` as the container scheduler.

There are multiple clocks, each with different authority:

1. **Model turn** — Pi runtime events: `turn_start`, `turn_end`, `turn_summary`. These are observability and metric events.
2. **Job turn** — one prompt/resume cycle from input to `agent_end`. In keep-alive mode, `agent_end` usually means the job is quiescent and can enter `waiting`, not necessarily terminal `done`.
3. **Workflow step** — executor, code-sanity, reviewer, local-validation, quant-methodologist, etc. A step completes only when its required evidence is persisted.
4. **Container transition** — lifecycle movement such as `working -> converging -> ready`. This is computed from persisted step/evidence state, not from streamed text.

The design should say this directly:

> Pi turns are observability events, not scheduling authority. `agent_end` is the job-level quiescence barrier. Substrate advances containers/workflows only from persisted evidence or equivalent pulses.

A container should have an event/reducer loop. Inputs include job waiting/done/error, channel messages, pulse delivery, collision updates, timer/timeout events, and explicit operator actions. The reducer derives the next state; after-hooks perform idempotent side effects such as dispatching a step, resuming a job, or writing a `system.*` channel message.

This aligns with `channels.md`: derive first, act second; never let a message or model event bypass the single scheduler.

## 2. Workflow advancement

The substrate workflow engine should automate advancement, not judgment.

A workflow is not just a list of specialists. It is a persisted state machine of steps. Each step needs a contract:

- role/specialist to run
- input evidence required
- output evidence required
- completion predicate
- retry/remediation rule
- authority for dispatch/resume/skip
- blocking edges to other steps

The daemon may auto-advance only when the rule is deterministic and replayable: for example executor evidence exists, code-sanity step is ready, reviewer PASS is persisted, or a surface matcher requires security-auditor. Open-ended judgment still belongs to the orchestrator, seed judge, advisor, or operator.

The practical target is to remove routine manual dispatch from the orchestrator:

```text
executor -> local-validation -> code-sanity -> reviewer -> merge_ready
```

But every advancement must be based on persisted evidence, not text seen in a live stream. A PASS emitted through an initial run, a resume turn, or a channel verdict should all become the same durable `verdict` evidence.

## 3. Containers, issues, channels, participants, pulses, evidence

These are separate SDK primitives.

```text
Container   = runtime envelope: lifecycle, workflow, channel, ownership, merge/collision state.
Issue       = durable contract. Root issues and step issues are both issue contracts.
Channel     = live coordination stream for a container.
Participant = a running actor spawned from an issue contract into a channel.
Pulse       = idempotent signal that wakes, inserts, opens, or messages.
Evidence    = durable output: diff, verdict, finding, test result, checklist, decision.
```

A container is not an issue tree. A container contains issue contracts and owns the channel where their participants coordinate.

Every specialist dispatch should be issue-backed. This preserves the current useful property of beads: the prompt/contract for a code-sanity, reviewer, explorer, or methodologist run is durable and inspectable.

## 4. Root issues and step issues

A **root issue** represents the user's/project's desired change.

A **step issue** represents a workflow-generated contract for one participant or gate inside the root issue's container.

The step receives both the parent/root contract and its own precise step contract.

Example root:

```text
iss:tx92.2
class: root
role: implementation-root
title: Fix Treasury fractional rounding
contract:
  problem: Treasury prices near tick boundaries format incorrectly
  scope:
    - analytics/outright/calculation.py
    - tests/test_treasury_conversion.py
  validation:
    - python3 -m pytest tests/test_treasury_conversion.py -q
  acceptance:
    - Near-boundary ZN/ZT prices round to CME-valid fractional strings
```

Example generated code-sanity step:

```text
iss:tx92.2.5
class: gate
role: code-sanity
parent_issue: iss:tx92.2
container: chain:tx92.2
validates: iss:tx92.2.3

contract:
  problem: Validate the executor diff for the Treasury rounding fix.
  input:
    - parent contract: iss:tx92.2
    - executor evidence: diff from iss:tx92.2.3
    - methodology evidence: iss:tx92.2.2
  scope:
    - analytics/outright/calculation.py
    - tests/test_treasury_conversion.py
  non_goals:
    - no edits
    - no broad architecture review
  output:
    - OK or FINDINGS
    - findings must cite file/line and severity
```

Prompt composition for the code-sanity participant:

```text
GLOBAL RULES
ROLE RULES: code-sanity
PARENT CONTRACT: iss:tx92.2
STEP CONTRACT: iss:tx92.2.5
INPUT EVIDENCE:
  - executor diff ref
  - methodology finding ref
CHANNEL CONTEXT:
  - recent relevant channel messages
```

## 5. Issue classes and roles

Use `class` for function in the work graph and `role` for who/what performs it.

Proposed issue classes:

```text
root       = user/project work item to reach done/merged
step       = executable workflow unit, usually producing implementation/evidence
gate       = validation step whose verdict affects readiness
advisor    = context or decision-producing step; may or may not block
followup   = newly discovered future work; normally non-blocking
decision   = explicit choice required from orchestrator/operator
```

Examples:

```text
iss:tx92.2      class=root      role=implementation-root
iss:tx92.2.1    class=advisor   role=explorer
iss:tx92.2.2    class=advisor   role=quant-methodologist
iss:tx92.2.3    class=step      role=executor
iss:tx92.2.4    class=gate      role=local-validation
iss:tx92.2.5    class=gate      role=code-sanity
iss:tx92.2.6    class=gate      role=reviewer
iss:tx92.2.7    class=followup  role=cleanup
```

Global issue lists should hide workflow internals by default. Container views should show them.

```bash
sb issue ls                         # root/followup/decision by default
sb issue ls --class step,gate,advisor
sb container ps chain:tx92.2 --tree # full runtime tree
```

## 6. Blocking and non-blocking semantics

Blocking should be edge-driven, not class-driven.

An advisor may block if the executor/reviewer requires its output. A gate normally blocks, but the precise behavior still comes from workflow edges and verdict rules. A followup normally does not block unless explicitly attached as required.

Proposed edge vocabulary, reconciled against substrate.md §6.1 / §6.7 (which already defines nine relationship types):

```text
# Already in substrate.md §6.7 — keep, used unchanged:
blocks_on       = hard gate; source cannot start/complete until target completes
parent          = membership/gate; epic/wave member edge
until           = temporary gate; drops when target reaches state X
validates       = validation link; verdict affects target/root readiness
discovered_from = context; provenance edge, no gate
caused_by       = context; failure/incident provenance
relates         = soft context
tracks          = soft context (long-running watch)
supersedes      = lifecycle replacement

# Proposed additions — workflow-runtime provenance not yet in substrate.md:
informs         = context; output enters target's context pack at seed time
                  (subsumed by `relates` today; promote when context-pack rules need it)
spawned_by      = runtime provenance from a pulse / workflow event / channel after-hook
                  (subsumed by `discovered_from` today; split when replay/audit needs
                   to distinguish human creation from runtime materialization)
```

Naming convention note: substrate.md reads receiving-side (`blocks_on`, `discovered_from`). The earlier draft of this review used directional sending-side names (`requires`, `blocks X`). Use substrate.md's convention as canonical to avoid ambiguity at the DB layer; helper CLI flags (`--blocks X`) can still read directionally without changing the stored edge.

Example (receiving-side / canonical naming):

```text
iss:tx92.2.3 executor
  blocks_on iss:tx92.2.1 explorer
  blocks_on iss:tx92.2.2 quant-methodologist

iss:tx92.2.5 code-sanity
  blocks_on iss:tx92.2.3 executor
  validates iss:tx92.2.3 executor

iss:tx92.2.6 reviewer
  blocks_on iss:tx92.2.3 executor
  blocks_on iss:tx92.2.5 code-sanity
  validates iss:tx92.2 root

iss:tx92.2.7 cleanup followup
  discovered_from iss:tx92.2.5 code-sanity
  relates         iss:tx92.2 root      # promote to `informs` if context-pack rule needs it
```

A low-severity cleanup found by code-sanity becomes a non-blocking followup. A correctness issue required before PASS becomes a blocking remediation step.

## 7. Concrete nesting examples

### LOW blast chain

```text
chain:abc
  channel: chain:abc
  iss:abc          class=root   role=implementation-root
    iss:abc.1      class=step   role=executor
    iss:abc.2      class=gate   role=code-sanity
    iss:abc.3      class=gate   role=reviewer
```

### HIGH/CRITICAL Mercury quant chain

```text
chain:tx92.2
  channel: chain:tx92.2
  iss:tx92.2       class=root      role=implementation-root
    iss:tx92.2.1   class=advisor   role=explorer
    iss:tx92.2.2   class=advisor   role=quant-methodologist
    iss:tx92.2.3   class=step      role=executor
    iss:tx92.2.4   class=gate      role=local-validation
    iss:tx92.2.5   class=gate      role=code-sanity
    iss:tx92.2.6   class=gate      role=reviewer
```

### Epic with root issues, each owning chain steps

```text
epic:tx92
  iss:tx92             class=root role=epic-root

  chain:tx92.1
    iss:tx92.1         class=root
      iss:tx92.1.1     class=step role=executor
      iss:tx92.1.2     class=gate role=reviewer

  chain:tx92.2
    iss:tx92.2         class=root
      iss:tx92.2.1     class=advisor role=explorer
      iss:tx92.2.2     class=advisor role=quant-methodologist
      iss:tx92.2.3     class=step role=executor
      iss:tx92.2.4     class=gate role=code-sanity
      iss:tx92.2.5     class=gate role=reviewer
```

The `.1`, `.2`, `.3` path is a display path. Store parent/child explicitly; do not rely on string parsing for semantics.

## 8. Dispatch commands

Create a root issue:

```bash
sb issue create \
  --class root \
  --title "Fix Treasury fractional rounding" \
  --problem "Treasury prices near tick boundaries format incorrectly" \
  --scope analytics/outright/calculation.py \
  --scope tests/test_treasury_conversion.py \
  --validation "python3 -m pytest tests/test_treasury_conversion.py -q" \
  --acceptance "Near-boundary ZN/ZT prices round to CME-valid fractional strings"
```

Dispatch the root through a workflow:

```bash
sb dispatch iss:tx92.2 --workflow mercury-quant-critical
```

Internal effects:

```text
opens container chain:tx92.2
opens channel chain:tx92.2
materializes workflow step issues .1 through .6
emits workflow.step.ready pulses for .1 and .2
dispatches explorer and quant-methodologist if auto-dispatch policy allows
```

Dispatch a generated step explicitly:

```bash
sb dispatch iss:tx92.2.5
```

A single `sb dispatch <issue-id>` is enough; issue class/role tells substrate how to run it.

## 9. Mid-flight ad-hoc insertion

Operator/orchestrator inserts a quant-researcher advisor while the chain is running:

```bash
sb issue create \
  --in-container chain:tx92.2 \
  --parent iss:tx92.2 \
  --class advisor \
  --role quant-researcher \
  --title "Research CME fractional rounding convention for Treasury futures" \
  --problem "Reviewer needs external confirmation of rounding policy before PASS" \
  --scope analytics/outright/calculation.py \
  --input iss:tx92.2.3 \
  --input msg:chain:tx92.2/142 \
  --output "Evidence table with source URLs and recommended test vectors" \
  --rel informs:iss:tx92.2 \
  --rel spawned_by:pulse:reviewer-needs-methodology-abc \
  --dispatch
```

If it must block reviewer PASS:

```bash
sb issue rel add iss:tx92.2.6 iss:tx92.2.8 --type requires
```

Or during creation, with a directional helper:

```bash
sb issue create ... --blocks iss:tx92.2.6 --dispatch
```

`--blocks X` means the new issue blocks X. Keep this directional convention consistent.

## 10. Pulse-driven insertion

A reviewer posts a structured channel verdict:

```json
{
  "kind": "verdict",
  "verdict": "PARTIAL",
  "target_issue": "iss:tx92.2",
  "tags": ["needs_external_methodology"],
  "summary": "Rounding policy needs CME citation before PASS."
}
```

The channel after-hook emits an idempotent pulse:

```json
{
  "kind": "trigger",
  "key": "reviewer:iss:tx92.2.6:needs_external_methodology",
  "body": {
    "action": "insert_step",
    "container_id": "chain:tx92.2",
    "class": "advisor",
    "role": "quant-researcher",
    "blocks": "iss:tx92.2.6",
    "reason_ref": "msg:chain:tx92.2/142"
  }
}
```

Substrate deduplicates by key. Replay does not create duplicate advisors.

The workflow engine consumes the pulse, materializes the advisor step issue, wires the blocking edge, and dispatches if policy allows.

## 11. Channels and issue contracts together

Channels and issues are used at the same time.

- The issue contract is durable input: what the participant is supposed to do.
- The channel is live coordination: findings, verdicts, steer, proposals, system messages.
- Evidence is durable output: what the participant produced.

When a specialist job is spawned from a step issue, it becomes a participant in the container's channel.

```text
participant key: iss:tx92.2.5/code-sanity/job:abc123
issue_id: iss:tx92.2.5
channel_id: chain:tx92.2
subscribes: steer:me, system.*, verdict:me, finding:scope-overlap
emits: finding, verdict, note
```

Do not copy every channel message into issue notes. Issues link to important channel messages through evidence refs:

```text
verdict evidence -> msg:chain:tx92.2/142
finding evidence -> msg:chain:tx92.2/139
test evidence    -> result:...
```

## 12. Concrete design patch needed in `substrate.md`

Add a section near workflow resolution:

> Workflow steps are issue-backed contracts. When a workflow resolves, substrate materializes each executable step as a child issue contract inside the container. These step issues are durable prompts, not global backlog tasks. They are filtered out of global issue lists by default and shown in container views. Every specialist job is spawned from one step issue and joined to the container channel. The channel handles live coordination; the step issue stores mandate/prompt; evidence stores outputs and verdicts.

This removes the current ambiguity around code-sanity/reviewer beads while preserving the useful property that every specialist run has a durable contract.

## 13. Cross-document consistency — substrate.md vs channels.md

Three places where the two documents disagree. Each must resolve in one direction; otherwise the SDK story splits.

### 13.1 Cross-container channels

- substrate.md §4.2 / §14 open-Q #8: *"Peer node coordinators collaborate via cross-container channels."*
- channels.md §11 Out of scope across all versions: *"Cross-channel messaging (epic-level coordinator watching N chain channels). Deferred indefinitely."*

**Resolution: channels stay container-scoped per channels.md. Coordinator-to-coordinator collaboration is pulse-based, not channel-based.** A peer node emits a pulse on a documented key (e.g. `node:research:finding:<hash>`); the receiving node has a trigger that wakes on that pattern. This reuses the pulse primitive (substrate §2.3, §5.8) and does not extend the channel primitive. The "cross-container channels" phrase in substrate.md should be rewritten as "cross-container pulses" everywhere it appears.

### 13.2 External connectors (Discord, Gmail) and the north-star

- substrate.md §14.1: *"connectors (Discord, Gmail) that have clear `emit pulse` + SDK access."*
- channels.md §11 Out of scope: *"Bidirectional integration with external systems (Slack, GitHub comments). Channels are internal."*

**Resolution: external connectors are emitters and substrate-API consumers, never channel members.** The flow:

```text
Discord webhook  →  connector emits pulse to substrate (key: discord:msg:<id>)
                 →  pulse opens or wakes a container
container produces output  →  connector reads via §17 Change-tracking face (server-streaming)
                          →  connector posts back via Discord's own API
```

Connectors get pipeline-building power without breaking "channels are internal." channels.md does not need amending; substrate.md §14.1 should be clarified to say connectors talk *to substrate* (pulse + Change-tracking), not *to channels*.

### 13.3 Ad-hoc `pair:` channels have no container

channels.md §5.1 lists `pair:<uuid>` as a channel kind for ad-hoc pair-talk with no node config. substrate.md's five container kinds (§4) do not include `pair`. This is fine but must be **explicit**: not every channel needs a container. An ad-hoc `pair:` channel is a channels-domain entity with no substrate-side container — channels has primitives that substrate does not (and that's the point of channels being a standalone package per substrate.md §13.4).

---

## 14. The SDK surface — collapsing §2.4 into one coherent picture

substrate.md §2.4 enumerates four heterogeneous items (participant definition / pulse / channel client / command surface). They are not on the same axis. Restructure as **two wire surfaces, one reference client, N declarative schemas, one credential model**:

| Layer | What it is | Owned by |
|---|---|---|
| Wire — substrate | §17 three faces: Query, Change-tracking, Command (Unix socket) | substrate package |
| Wire — channels | `post / readSince / markSeen / capture` + subscribe (Unix socket) | channels package |
| Pulse | wire-level data type with idempotency key; submitted via substrate's Command face | substrate (table + Command) |
| Reference client library | TS client wrapping both wires; the typical SDK consumer imports this | core (depends on substrate + channels) |
| Participant definition | declarative JSON: `.specialist.json`, `.script.json`, `.service.json` | per-kind config |
| Emitter registration | credential + capability scope for any process allowed to call substrate's emit-pulse Command | substrate |

"Building a new actor" then means one of three things — be explicit which:

- *Ship a participant definition* (JSON) — for actors that live inside containers (bound).
- *Register as an emitter* (credential + capability) — for actors that only emit pulses (external webhooks, cron sources, foreign daemons).
- *Both* — for actors that participate AND emit (most specialists, all scripts that react and emit).

The SDK is **the client library wrapping both wires + the schemas you submit through them + the credential you register with**. It is not just the "command surface." Stating this once collapses the four-item list into one mental model.

---

## 15. Bound vs unbound participants

Channel subscriptions enter substrate through two distinct paths; both are needed, and the SDK should make them obviously different rather than overload one verb:

- **Bound** (in-container). The runtime writes the active-subscription row at spawn-time by resolving the spec template against the container (substrate §7.1). The participant never calls `subscribe()`. Applies to: specialists dispatched into a chain; scripts attached to a container via spec.
- **Unbound** (cross-container / external / tooling). The participant calls a channels-side subscribe verb explicitly, scoped by a capability declared at registration. Applies to: `sp tail` reading a channel as a human; a dashboard following multiple containers; a connector watching pulse outputs (via the substrate Change-tracking face, not channels).

channels.md `ChannelClient` today has `post / readSince / markSeen / capture` — no explicit `subscribe`. That is correct for the bound case (runtime writes the row). The unbound case needs an explicit subscribe verb on the SDK, gated by capability. Add it to channels.md when v3 lands; document the gap until then.

---

## 16. Two activation modes for participants

substrate.md §7.1 (channel-reactive) and §6.9 (workflow step) describe two different ways a participant gets activated; today the duality is implicit. For SDK consumers building agent-driven pipelines, a participant definition should declare both:

```jsonc
{
  "kind": "specialist",
  "name": "data-validator",

  // Reactive mode: wake on channel events
  "channel": {
    "subscribes": ["finding:scope-overlap", "system.*"],
    "emits":      ["finding", "verdict"],
    "wakes_on":   ["verdict.PARTIAL"]
  },

  // Workflow-step mode: declare which workflow positions accept me
  "workflow_role": {
    "name":            "data-validator",
    "compatible_with": ["quantitative-validation"]    // or ["*"]
  }
}
```

A participant may have only `channel` (purely reactive), only `workflow_role` (only ever dispatched as part of a workflow), or both. The mandatory Layer-2 gates of substrate.md §6.9.3 (code-sanity, obligations-scanner, security-auditor) declare `workflow_role` with `compatible_with: ["*"]` since they overlay every workflow. Today this is implicit in the specialist registry; making it declared is what lets an agent compose a new pipeline without editing config it doesn't understand.

---

## 17. Pulse delivery for non-coordinator consumers

substrate.md §5.8 specifies push to coordinators (*"the daemon delivers the queue to the coordinator"*). For unbound consumers — connectors, dashboards, tooling — delivery happens via the §17.1 Change-tracking face (server-streaming over the same Unix socket), not a separate push API. To make this implementable:

- Pulses are rows in a substrate table (`pulses` keyed by idempotency key) — already implied by §5.8 `pulse_dedup`. Make the *table* explicit so connectors know it is queryable and replayable, not just an in-memory queue.
- The Change-tracking stream emits pulse-arrival events the same way it emits container/issue/plan changes.
- A connector subscribes to `changesSince(cursor, filter={kind: "pulse", key_prefix: "discord:"})` and processes pulse rows in order. Identical mechanism for every consumer; no per-consumer push channel.

---

## 18. Reuse audit — what each new feature should reuse

A small table forcing the SDK story to stay coherent. **The substrate already has the primitive; the SDK exposes it; new use cases compose existing primitives, they do not extend the SDK.**

| New need | Reuse, don't invent |
|---|---|
| Coordinator-to-coordinator collaboration (§13.1) | pulse + trigger, not a "cross-container channel" |
| External connector input (Discord/Gmail in) (§13.2) | pulse with idempotency key, not a "webhook channel kind" |
| External connector output (Discord/Gmail out) | §17 Change-tracking stream, not a new push API |
| Unbound human/tooling readers (`sp tail`, dashboard) | §17 Change-tracking stream + unbound subscribe verb (§15) |
| Workflow gate auto-insertion (substrate §6.9.5) | pulse handler under the §5.10 non-progress counter, not new daemon code |
| Reviewer findings → next issue's context (§11 above) | dual-write to substrate `evidence` (§6.8), not channel re-read |
| Identity revocation mid-channel | `system.epoch_bump` (channels.md §10.1), not a new authority message |
| Coordinator state across kill/respawn (substrate §5.9) | journal in substrate, not channel re-replay |
| Pulse replay / connector resume after disconnect | `changesSince(cursor)` against pulses table — same cursor model as everything else |
| Workflow step "ready" detection | persisted evidence on the previous step's issue — never live channel scrape (substrate §3) |

If a proposed feature does not fit any row here, the question is not "what new SDK surface do we add" but "which existing primitive is the right composition" — and only after that exhausts itself does the SDK gain a new verb.

---

## 19. Pi turn alignment — decided

Verified against `pi/pi-rpc.md` and `src/specialist/{runner.ts,supervisor.ts}`. Pi already has the structure substrate §3 / §6.9 assumed: substrate aligns to it, does not invent a parallel tick.

**Pi's native primitives (from pi-rpc.md §Events and §Commands):**

| Pi primitive | What it gives substrate |
|---|---|
| `turn_start` / `turn_end` events on stdout | The natural per-participant beat. One turn = one assistant response + its tool calls. |
| `steer` command | Queues a message *after current turn finishes its tool calls, before next LLM call*. Idempotent injection point — exactly where a channel after-hook side-effect belongs. |
| `follow_up` command | Queues a message delivered only when the agent is fully quiescent. Maps to "resume from `waiting` after `agent_end`." |
| `agent_end` event | The quiescence barrier. In keep-alive mode the session stays open and becomes resumable — substrate's `waiting` work_state has a 1:1 mapping. |
| `auto_compaction_start/end` events | The `specialist.compacted` pulse of substrate §5.8 is literally the receipt of `auto_compaction_end`. |
| `auto_retry_start/end` events | Transient failure (substrate §5.10) is exactly the pi auto-retry envelope. Substrate's transient class is *whatever pi auto-retried*. |

**Specialists' existing wiring (already in supervisor.ts):**

- `supervisor.ts:1671` already routes `turn_start` events through the timeline.
- `supervisor.ts:1658` already detects `agent_end` in keep-alive mode and flips to `waiting`.
- `supervisor.ts:1882` already counts `auto_compactions` per run.
- `runner.ts:1361` already exposes `session.steer(msg)` as a registered callback per job.

**Design decision for substrate:**

- **No separate container "tick" clock.** The container's reducer fires *event-driven* on three triggers:
  1. A member participant's `turn_end` (live activity inside the container)
  2. A pulse arrival (external trigger)
  3. An explicit `sb` command (operator action)
- **Resume injection uses `session.steer()`.** When the channel after-hook (§7 channels.md) decides a participant should be resumed mid-flight (verdict, redirect, peer steer), it calls the steer function pi already exposes — guaranteed delivery before the next LLM call.
- **Substrate `waiting` = pi keep-alive after first `agent_end`.** No new state; reuse what supervisor.ts already implements.
- **Workflow step advancement.** When a step's participant emits `agent_end` (not just `turn_end`), substrate's daemon reads the persisted evidence on the step issue, evaluates the workflow's completeness predicate, and either fires the next step's spawn or escalates per §5.10.

**Patch to substrate.md §3 and §6.9.2:** replace "the daemon advances containers" with "the daemon advances containers on member `agent_end` events and pulse arrivals — never on a wall-clock tick." Remove §14.1's open question about the turn concept as resolved.

---

## 20. Daemon-observes model — decided

substrate.md §5.8 / §5.10 / §6.9.2 assume the daemon can observe: process termination, exit code, compaction signals, non-progress counters. supervisor.ts already plumbs every one of these through callbacks. The daemon does not need new hooks; it needs to be a *consumer* of the event bus the supervisor already writes.

Mapping from substrate §5.8 lifecycle pulses to existing pi/supervisor events:

| substrate §5.8 pulse | source today |
|---|---|
| `specialist.spawned` | `session.start()` resolves (runner.ts:1356) |
| `specialist.turn-complete` | onEvent('turn_end') (supervisor.ts:1671) |
| `specialist.waiting` | onResumeReady callback (supervisor.ts:1974) |
| `specialist.compacted` | onEvent('auto_compaction_end') (supervisor.ts:1882) |
| `specialist.stopped` | session close / non-keep-alive `agent_end` |
| `specialist.context-threshold` | derive from cumulative compaction count + token usage |

**Design decision:** the substrate daemon subscribes to the observability event stream (the same one `sp log` already reads — runtime/control/error rows in `observability.db`). Lifecycle pulses are emitted as a side effect of writing those rows. No new instrumentation; substrate becomes a second reader of the existing telemetry, alongside `sp log`.

This also closes substrate.md §14.1 "Does the daemon-observes model fit how processes are actually supervised today?" — yes, exactly.

---

## 21. Failure classification — decided against transcripts

The transient/semantic split of substrate.md §5.10 holds against observed failures in `.xtrm/reports/`. No third class emerges. The boundary is sharper than the design states:

| Observed failure | Class | Why |
|---|---|---|
| Pi `overloaded_error`, 5xx, rate-limit, OOM | transient | Pi already classifies via `auto_retry_*`. Substrate's transient class = "pi auto-retried." |
| Executor self-reported `tests_pass: false` when tests pass; executor `--no-verify` + stale file mix (mercury 2026-05-25) | semantic | Caught by reviewer/code-sanity FAIL with non-progress. The approach was wrong, not the execution. |
| Reviewer PARTIAL on same surface 3 cycles in a row | semantic | The §5.10 `semantic_after` counter detector. |
| Indefinite advance-and-regress oscillation (would consume budget) | semantic | The §5.10 `hard_cap` backstop. Not observed in transcripts yet, but the mechanism is needed. |
| Stale-base dispatch causing `--force-stale-base` (mercury 2026-05-25) | **precondition violation, not failure** | Caught by the Git State Precondition gate. This is *prevention*, not *recovery*. Belongs to a separate concern from §5.10. |

**Design decision:** keep the binary classification. Add an explicit *third concept* — **precondition violation** — that is NOT a failure class but a pre-dispatch gate. The Git State Precondition (CLAUDE.md gotchas, mercury report) is one example; a future "dependency-not-merged" check is another. The pattern: preconditions are checked at dispatch time and either pass or refuse-to-dispatch with an escalation event — they never enter the run-then-fail loop the §5.10 counters watch. This separates *we should not have started* from *we started and stumbled* cleanly.

Updates to substrate.md §5.10 and §6.4 "dispatch gate":

- §6.4 documents the dispatch-time precondition mechanism alongside the Stage-1 validator (today only validates the contract; should also validate the runtime environment).
- §5.10 stays binary (transient/semantic) and explicitly says preconditions are §6.4's responsibility, not §5.10's.

---

## 22. Per-issue close flow — replaces `bd close` + memory-ack + commit-gate + Stop hook

substrate.md §14 open-Q #7 is the main remaining design item. Decided here.

### 22.1 Core principle: close is a derivation, not an imperative

bd treats close as an *action* on an issue. The procedural shims (memory-ack hook, commit-gate hook, Stop hook) exist because bd has no model of *what makes a close valid* — they try to enforce discipline from the outside.

Substrate has the model. An issue closes when:

1. its **evidence** satisfies its **acceptance criteria** (contract fields, §6.1),
2. its **container state** permits termination of that issue's role in the container, and
3. a **close reason** is recorded, drawn from a closed enum.

The operator-facing `sb issue close <id>` evaluates eligibility, persists the close, and emits the relevant pulse. The procedural shims disappear because the model makes them unnecessary (§22.5).

### 22.2 Close as transactional consequence of container merge — the common path

In the normal case nobody runs `sb issue close` per issue. The flow is:

```
participant emits evidence (verdict PASS, diff committed, test pass)
   ↓
substrate after-hook: does this evidence satisfy issue I's acceptance predicate?
   ↓
yes → issue I marked `close_ready` (a state, not yet closed)
   ↓
container reducer: are all member issues `close_ready` AND all workflow steps complete?
   ↓
yes → container advances to `ready`
   ↓
operator runs `sb container merge` (or auto-merge per policy)
   ↓
substrate transactionally:
  - closes every member issue with close_reason matching member's outcome
  - closes the container with close_reason=merged
  - emits closed pulses for memory/dashboard consumers
```

`close_ready` is the per-issue analog of the container's `ready` state — *eligible to close but not yet closed*. The container's merge is the close event for every member at once.

This makes "close the issue" almost always a side-effect of "merge the container," and removes the per-issue close ceremony bd requires.

### 22.3 Eligibility table — when can an issue close

Read by `sb issue close` to decide allow/refuse. Same predicate used by the container reducer to derive `close_ready`.

| Issue class (§5) | Container kind | Container state | Eligible? | Allowed `close_reason` |
|---|---|---|---|---|
| `root` (single-issue chain) | `chain` | `ready` | yes — closes on container merge | `merged` |
| `root` (epic/wave member) | `epic`/`wave` | parent at `ready` | yes — closes on epic merge | `merged-as-part-of-epic` |
| `step` (workflow step) | `chain` | `working`/`converging` | yes if step's acceptance evidence present AND no downstream step requires unfinished output | `step-complete` |
| `gate` (code-sanity, reviewer, obligations-scanner) | `chain` | `working` | yes when verdict evidence written | `gate-passed`, `gate-failed` |
| `advisor` (explorer, methodologist, researcher) | `chain` | `working` | yes when advisory output evidence present | `advisory-complete` |
| `followup` (`discovered_from`, non-blocking) | any | any (incl. live) | yes any time — non-blocking by definition | `done`, `abandoned`, `superseded` |
| any | any | `escalated` | yes only with `--reason=abandoned` | `abandoned` (operator override) |
| any | any | `closed:failed` | auto-closed by cascade (§22.4) | `failed-with-container` |
| any | any | `closed:abandoned` | auto-closed by cascade | `abandoned-with-container` |
| any | any | any | yes with `--force` (operator override) | logs escalation event, requires reason |

If `sb issue close <id>` is called and eligibility is *blocked*, the response is a structured refusal:

```jsonc
{
  "ok": false,
  "error_code": "close_blocked",
  "blocked_by": [
    "container chain:7f3a is in 'working' state; step issues close on workflow completion",
    "issue iss-7f3a-005 has no verdict evidence yet"
  ],
  "next_safe_action": "wait_for_evidence | force_close | abandon_container"
}
```

Mirrors the channels.md §10.2 error envelope shape — same structured-refusal pattern across the SDK.

### 22.4 Container-failed cascade

When a container reaches `closed:failed` or `closed:abandoned` before all members are `done`:

- Non-done member issues auto-close with reason `failed-with-container` or `abandoned-with-container`.
- Their evidence is preserved per §5.10 ("never destroy work on failure").
- The §5.10 failure memory distills from the gate verdicts present at the time of failure.
- A re-seeded container can re-create issues that `supersedes` the old ones — the existing edge type (§6 in this review) carries the lifecycle replacement.

The cascade is itself a pulse handler (substrate §5.8 / §5.10 universal mechanism), not new code: container terminal pulse → cascade handler → batched close of members.

### 22.5 What replaces the three current shim gates

| Today's gate | What it was for | Replacement in substrate | Why the gate disappears |
|---|---|---|---|
| **memory-ack** (per-issue KV ack before close) | "did you save the lesson learned?" | Substrate emits the memory-distillation pulse automatically on `failed-semantic` close (§5.10). For success closes, the seed's memory-curator (§5.2) pulled relevant memories at start; there is no end-of-issue lesson to ack. | The pulse fires on the relevant close_reason; the operator is no longer the discipline-enforcer because the model defines when memory must be distilled. |
| **commit-gate** (`bd close` blocked if claim is open & no commit yet) | "did you commit before closing?" | An issue cannot reach `close_ready` until its `diff` evidence is present (§6.8 dual-write). The evidence ref binds to a commit SHA or branch ref. | The dual-write IS the commit gate — separate check unnecessary. |
| **Stop hook** (session-end with unclosed claim is blocked) | "you forgot to close before quitting" | Claims belong to *participants* (jobs), not to sessions. A session ending leaves the participant in `waiting` (pi keep-alive, §19), not the issue in `claimed`. The issue close state is independent of which orchestrator session is alive. | The session/issue coupling that made the hook necessary is removed; substrate has no per-session ownership of issues. |

The three procedural gates exist to compensate for missing model in bd. Substrate has the model, so the gates are not ports — they are *deleted*. This is the elegance §13.B of the review aims at: don't migrate procedural compensation into the new system; remove the procedural by making the model carry the constraint.

### 22.6 `done` vs `archived` — separation matters

substrate.md §6.1 puts both `done` and `archived` in the `work_state` enum without distinguishing. They serve different queries:

| State | Meaning | Default visibility | Memory distilled? |
|---|---|---|---|
| `done` | Work concluded with positive outcome (`merged`, `step-complete`, `gate-passed`, `advisory-complete`) | shown by `sb issue ls` | yes for relevant categories (e.g. an `advisor` output worth caching) |
| `archived` | Work concluded but not deserving registry presence (`abandoned`, `failed-with-container`, `superseded`, trivial `followup` skipped) | hidden by default; `sb issue ls --archived` to see | only `failed-semantic` produces lesson memory (§5.10); other archives are silent |

`close_reason` deterministically maps to `done` or `archived` — operator doesn't choose, the reason chooses:

```
merged / merged-as-part-of-epic / step-complete / gate-passed /
advisory-complete / done                                        →  done
failed-transient / failed-semantic / failed-with-container /
abandoned / abandoned-with-container / superseded               →  archived
```

### 22.7 Schema additions to substrate.md §6.1

```jsonc
{
  // existing fields...
  "work_state": "draft|ready|claimed|running|waiting|reviewing|blocked|close_ready|done|archived",
  //                                                       ^^^^^^^^^^^^ new — "all evidence in, awaiting container close"

  "close_state": {
    "eligibility":      "blocked|close_ready|forced",   // computed, denormalized for queries
    "blocked_by":       ["string", "..."],               // populated when eligibility=blocked
    "close_ready_at_ms": 0,                              // first time predicates were satisfied
    "closed_at_ms":      0,
    "close_reason":      "merged|merged-as-part-of-epic|step-complete|gate-passed|
                          gate-failed|advisory-complete|done|
                          failed-transient|failed-semantic|failed-with-container|
                          abandoned|abandoned-with-container|superseded",
    "closed_by":         "container-merge|cascaded-from:<container-id>|operator|workflow|--force"
  }
}
```

`failed`/`done`/`archived` work_state values become derivations from `close_reason` (per the §22.6 table). One source of truth — `close_reason` — drives both `work_state` and visibility.

### 22.8 Operator command surface

```bash
# Normal path — rarely needed because container merge closes members transactionally
sb issue close <id>                          # evaluates eligibility; refuses if blocked
sb issue close <id> --reason advisory-complete --evidence msg:chain:7f3a/142

# Operator-driven termination
sb issue close <id> --reason abandoned       # explicit abandon; always eligible
sb issue close <id> --force --reason <r>     # eligibility override; logs escalation event

# Archive vs close — single command, reason decides
sb issue close <id> --reason superseded      # auto-categorized as archived (§22.6)

# Reopen — only from certain close_reasons
sb issue reopen <id>                         # allowed if close_reason in
                                             #   {abandoned, failed-*, superseded}
                                             # refused for {merged, *-complete, done}
                                             # — already-shipped work cannot be reopened;
                                             #   create a follow-up instead

# Container-driven (the common case — no per-issue command at all)
sb container merge <chain-id>                # closes every member transactionally
```

### 22.9 What this preserves from bd that was useful

The valuable thing in bd was that every closed issue carried a durable, queryable record of *what was decided and why* — `bd notes` showed the closure context across sessions. Substrate keeps that property, more rigorously:

- The `close_reason` is enum-validated (no free prose drift).
- The `evidence` array (§6.1) is the canonical "what proof closed this" — diff refs, verdict refs, test results, the release checklist — all structured and re-queryable.
- The container's channel still has the verbose discussion as a stream (§7), reachable via evidence message refs (`msg:chain:7f3a/142`).

The substitution is: bd-notes-as-prose → substrate-evidence-as-structured-references. The operator's "what happened on this issue?" query returns linkable evidence, not a chronological text dump.

---

## 23. Autonomy gradient — three open questions, one pattern

substrate.md §14 #3 (container nesting), #11 (node nesting), #12 (dispatch_mode predicate) are all *autonomy* questions. They share one pattern; documenting it once prevents three inconsistent answers.

### 23.1 The pattern

Every autonomy decision in substrate has three tiers, not two:

```
allowed within policy           ←  automatic, no friction
        ↓  (exceeds policy)
escalates to operator           ←  operator approves per-instance
        ↓  (depth/reach beyond escalation)
hard-blocked / operator-only    ←  no automatic path reaches here; only `sb` command
```

This is the same shape as substrate.md §5.10 graded escalation (orchestrator → operator) and §5.8 emitter capability (within capability act, beyond escalate). Reuse it for nesting/dispatch decisions too, instead of inventing new tiers.

### 23.2 Container nesting (#3) — decided: warn at 2, hard-cap at 4

substrate.md §14 #3 picked "soft-cap at 2, deferred exact threshold." Decide the cap now.

| Depth | What it looks like | Status |
|---|---|---|
| 1 | `chain` (single issue) | normal |
| 2 | `epic` of chains, `wave` of chains | normal (the common compound case) |
| 3 | `epic` of `epic`s of chains (e.g. "platform migration" → "backend migration" + "frontend migration" → chains) | **soft-warn** — legitimate but unusual; reducer emits warning, asks operator to confirm or decompose |
| 4+ | anything deeper | **hard-block** — refused at container open; no auto path reaches here |

Why the cap is 4 (not 3 or 5): three is real (rare migration epics), four is *always* decomposition smell or automatic-spawn pathology. Hard-cap at 4 prevents a seed-that-opens-an-epic-that-opens-an-epic-that... runaway. Operator can still build depth ≥4 manually by `--force` if there is truly no decomposition path — but the `--force` logs an escalation event, so it cannot happen quietly.

Note: depth counts *live* container membership only. The `seed` that opened the root container is in provenance (`opened_by`), not membership — it transformed and closed. Seeds do not count.

### 23.3 Node nesting (#11) — decided: 1 via escalation, 2 manual-only, 3+ hard-blocked

substrate.md §4.2 / §14 #11: "A node opening a standing sub-node requires escalation; exact depth cap unsettled."

Apply the gradient:

| Node tree depth | How it gets created | Status |
|---|---|---|
| 0 | standalone node (`sb node create`) | normal, requires operator command |
| 1 (sub-node) | parent node coordinator escalates: "I need a specialized sub-node for X" | escalates to operator, operator approves per-instance via `sb node create --parent <id>` (no auto-spawn) |
| 2 (sub-sub-node) | operator manually creates with explicit `--parent <level-1-node>` | **operator-only path**; sub-node coordinator cannot escalate for grandchildren |
| 3+ | — | **hard-blocked** at `sb node create`; refused unconditionally |

Asymmetry on purpose: the *automatic* escalation path caps at depth 1, the *manual* path caps at depth 2. A grandchild-node never appears as a side effect of a great-grandparent's autonomy — that is the pathology to prevent. Below the cap, all node creation is *explicit operator action*, never cascading escalation.

The hard-block at 3+ is unconditional (no `--force`). If a use case truly needs depth 3, it is a sign the standing-node abstraction is being misused for what should be transient containers — return to design, not override.

### 23.4 `dispatch_mode` predicate (#12) — decided: flat default + optional matcher rules

substrate.md §5.8: `dispatch_mode: direct | via_seed` per node. Open: should it be a richer predicate?

Decision: keep `dispatch_mode` as a flat default *and* allow optional matcher rules that override per-pulse. **Reuse the existing matcher syntax** of seed `invite_when` (§5.2) and workflow `applies_when` (§6.9.3) — one matcher language across the system, no new DSL.

```yaml
# Node coordinator config
dispatch_mode:
  default: via_seed                # the safe default — discover shape first

  rules:
    # Known-shape pulses bypass the seed
    - when:
        pulse_kind: github_pr_opened
        labels_any: [tiny, doc-only, dependency-bump]
      then: direct

    - when:
        pulse_kind: alert
        severity: low
      then: direct

    # Explicit force-via-seed for known-ambiguous shapes
    - when:
        pulse_kind: user_request
        scope_lines_estimated_gte: 50
      then: via_seed
```

Resolution order: rules in declared order, first match wins, fallback to `default`. The flat field is the common case (one node, one shape); the rule list is the escape valve for nodes that handle mixed shapes.

This is **not** new judgment going into the coordinator. The coordinator was already doing this judgment implicitly per substrate.md §5.8 ("the coordinator does semantic scheduling"). The matcher rules just *make it visible and replayable* — same purpose as the workflow-step preheat of §6.9.2: write the decision down before it happens so it can be audited.

### 23.5 What's reused vs new

| Decision | Mechanism reused | New surface |
|---|---|---|
| Container nesting cap | container open command + reducer warning (§3) | one config: `max_container_depth = 4`, soft-warn threshold = 2 |
| Node nesting cap | `sb node create` command + capability check | one config: `max_node_depth = 2`, escalation-spawnable depth = 1 |
| `dispatch_mode` rules | seed `invite_when` / workflow `applies_when` matcher (§5.2, §6.9.3) | optional `rules` array on node config; resolution order = declared |

All three additions are *config + reuse of existing primitives*. No new daemon machinery, no new SDK verbs. The autonomy gradient pattern (§23.1) is what unifies them; once stated, the three open questions become one consistent answer applied three times.

---

## 24. Knowledge scope — three open questions, one pattern

substrate.md §14 #5 (issue-local rule conflict), #6 (session vs seed curator), #10 (memory pruning/promotion/identity scope) are all *scope of knowledge* questions. The unifying principle, extending substrate.md §10's "levels are queries not fields":

> **Substrate stores facts with metadata; queries reconstruct the relevant slice. Rules, curation, and pruning are all queries with different filters — not different stores or new entities.**

Once this principle is named, the three open questions resolve without inventing new mechanisms.

### 24.1 Rule conflict (#5) — decided: rules govern *behavior*, contract governs *evaluation*, evidence governs *facts* — they don't collide

substrate.md §14 #5: *"if a reviewer is jobbed onto issue A but reads diff from issue B, whose rules apply? Probably the reviewer's own issue (A)."*

The "conflict" only exists if you collapse three different surfaces into one. They are separate:

| Surface | Source | Governs |
|---|---|---|
| `issue_local_rules` | the issue the specialist is spawned from (owning issue) | the specialist's *own behavior* (what files I may edit, what tools I may use, scope I must not exceed) |
| `contract` (problem/scope/acceptance/non_goals) | the issue under review/work (target issue) | what *outcome* counts as success — the rubric the specialist evaluates against |
| `evidence` (diff/verdict/result) | any referenced issue | factual input — what was already produced, immutable, not a rule |

A reviewer jobbed onto issue A reviewing diff from issue B:

- Follows **A's** `issue_local_rules` for *its own behavior* (e.g., "no edits; produce JSON verdict").
- Evaluates the diff against **B's** `contract` (B's acceptance/scope/non_goals — that's what the diff was produced to satisfy).
- Reads **B's** `evidence` as factual input (the diff is the artifact under review).

No conflict possible. A's scope rule does not exclude the diff's files because A's scope governs *A's edits*, not what A may *read*. A "rule conflict" only arises if specialists try to apply *another issue's* rules to their own behavior — which is exactly what the model forbids.

**Patch to substrate.md §6.1 / §6.5:** explicitly document that `issue_local_rules` apply only to the spawning specialist's own actions, never to referenced issues' artifacts. Reviewing a diff is not "subject to the reviewer-issue's rules constraining the diff"; it is "subject to the reviewer-issue's rules constraining the reviewer's behavior."

### 24.2 Session-level memory curator (#6) — decided: no new entity, the orchestrator is a participant

substrate.md §14 #6: *"do we keep a session-level curator for 'things you should know walking in,' or is seed enough?"*

There are two cold-start cases to cover:

- **Operator opens an interactive session.** They want context: recent work, ongoing decisions, project-wide invariants. This is an explicit *query*, not a curator running. Reuse: `sb context project <name>` and `sb memory query` (the same Query face of §17.1, just with filters).
- **An orchestrator (LLM agent) starts cold.** The orchestrator is itself a participant — running inside an "orchestrator session container" (a degenerate node, or a transient container at the operator's request). Once it is a participant, it gets context the *standard* way: the seed/curator (§5.2) for its container assembles the pack and feeds it in. No special "session-level" curator.

So:
- **Cold-start before any container** → CLI query, no curator running, no LLM cost.
- **Inside a container (including the orchestrator's own)** → the seed-stage memory-curator (§5.2) is the only curator. One entity, one entry point.

This collapses two would-be entities into one. **Reuse, not duplicate.** Same primitive (memory query) at two entry points (CLI on demand, advisor inside seed).

**Patch to substrate.md §10.2:** remove the "session-level curator" as an open question; clarify that the curator is *exclusively* a seed-time advisor and that cold-start contextualization happens via CLI query against the same store.

### 24.3 Memory pruning / promotion / identity scope (#10) — decided

substrate.md §10 already states: "herd / workgroup / identity are *queries*, not fields." Carry that through to the four sub-questions of §14 #10.

#### Pruning policy

There is no "per-tier" pruning, because tiers are queries. Pruning runs on *metadata fields actually stored*. Three rules:

| Trigger | Memories affected | Action |
|---|---|---|
| `sb memory forget <id>` | one | hard-delete |
| Container terminal (`merged` / `abandoned`) | memories with `in_container=<id>` | retention per §10.3 — kept if `type ∈ {failure-lesson, decision, advisor-output}`, else demoted (see below) |
| Project retired (`sb project retire`) | memories with `in_project=<name>` | metadata-tagged `archived_at_ms`; queries default-hide unless `--archived` |

No memory is *deleted* by retirement of a parent (node, container, project) — they are *demoted* by metadata change so the default queries stop returning them. Hard-delete is operator-explicit.

#### Promotion predicate (workgroup → herd)

Memories are not stored at a tier; they get *queried* as workgroup or herd based on metadata. "Promotion" = changing metadata so the herd-level query starts catching the memory. Trigger:

- **Automatic, counter-based.** Substrate tracks `cross_workgroup_use_count` per memory: how many distinct containers' participants pulled it via curator queries. When the counter ≥ **3 distinct workgroups** in the last 90 days, the memory is auto-promoted: its `visibility` metadata flips so the herd-level query catches it. Threshold of 3 is the smallest convincing sample of cross-cutting relevance; ≥ 90-day window prevents one busy week from over-promoting.
- **Manual override.** `sb memory promote <id>` and `sb memory demote <id>` for operator judgment calls.

Promotion is logged as a memory event (memories about memories — same store) so the audit trail survives.

#### Identity scope — per-role-per-project, not per-role-global

The §14 #10 sub-question: *"whether identity is per-role-global or per-role-per-project."*

Decided: **per-role-per-project.** A `quant-methodologist`'s memories about CME treasury tick grids belong to *mercury-market-data*, not to the `quant-methodologist` role in general. Cross-project identity creates:
- Scope confusion (rules from a different project may not apply)
- Surface leakage (a memory referencing internal terms from project X arriving at project Y is noise)
- Trust collapse (a "this approach failed" memory from project X may have failed *because of X-specific reasons* not present in Y)

Implementation: every memory carries `created_by_role` AND `in_project` metadata. The identity query is `created_by_role=X AND in_project=Y`. Cross-project lookups are an explicit operator action (`sb memory query --role X --any-project`).

#### Provenance vs node retirement

When a node retires, memories created by its participants do not disappear — substrate §5.10's "never destroy work on failure" generalizes: never destroy memory on retirement either.

Mechanism:

- Memory's `in_container=node:X` metadata is preserved; an `in_container_retired_at_ms` timestamp is added.
- The node-scoped query (`in_container=node:X`) returns it only with explicit `--include-retired`.
- The herd / identity queries continue unchanged.
- The retirement itself becomes a memory event: `{type: lifecycle, body: "node X retired with N decisions, K lessons", refs: [...]}` so the chronology is in the same store.

This means retiring a node is a *bookkeeping* action, not a destructive one. The same shape as substrate §5.10 `closed:failed` — preserve the evidence, change visibility, move on.

### 24.4 What this reinforces (cross-back to §18 reuse audit)

| New need | Reuse, don't invent |
|---|---|
| Rule conflict resolution (#5) | three existing surfaces (`issue_local_rules`, `contract`, `evidence`) — clarify they govern different things, no new conflict-resolution machinery |
| Cold-start context (#6) | CLI Query face (§17.1) for cold-start; seed-time curator (§5.2) for in-container — one store, two entry points |
| Tier-aware pruning (#10) | pruning runs on stored metadata fields, not on the queries themselves — pruning machinery already exists per-field |
| Memory promotion (#10) | counter on existing memory metadata + curator query trigger — no new promotion engine |
| Node-retired memories (#10) | metadata flag + visibility filter — same pattern as `closed:failed` evidence preservation (§5.10) |

Add the row from §24.2 to §18: "Cold-start orchestrator context → CLI memory query, never a parallel session-level curator entity."

---

## 25. Workflow definition language + concrete workflows from reports

substrate.md §6.9.3 sketches a two-layer YAML (workflow = Layer 1 domain steps; mandatory gates = Layer 2 overlay). The shape is right but needs three things before it can be shipped: (a) a precise schema for the language, (b) the actual workflows the system needs out of the box (extracted from real chains in `.xtrm/reports/`, not invented), (c) clear composition / override rules.

### 25.1 The language — schema

A workflow file is YAML with this shape. **No new field types beyond what substrate.md already has** (§5.2 `invite_when` matcher, §6.9 step bookends, §6.6 scrutiny). The language *composes* existing primitives, it does not extend them.

```yaml
# Schema: workflow.v1
name:        string                      # globally unique
description: string                      # one-line
extends:     workflow-name | null        # optional inheritance (linear, not multiple)

# Layer 1 — domain-specific steps between executor/reviewer bookends.
# Each step is a role name; the role resolves to a participant definition (§16).
steps:
  - role:        string                  # e.g. "code-sanity", "quant-methodologist"
    when:        matcher | null          # optional — step runs only if matcher fires
    skip_when:   matcher | null          # optional — step skips if matcher fires
    non_skippable: bool                  # default false; true = unauthorized-skip → escalation
    timeout_ms:  integer | null
    inputs:      [evidence_ref, ...]     # what evidence from prior steps this step requires

# Auto-match: when this workflow should resolve for an issue/seed
applies_when:                            # reuses §5.2 invite_when matcher syntax
  type:           [task, bug, ...]
  scope_matches:  ["glob", "..."]
  scrutiny_gte:   low|medium|high|critical
  tags_any:       [string, ...]

# Defaults this workflow imposes on issues that resolve to it
defaults:
  scrutiny: low|medium|high|critical
  budget:
    dollars:   number
    wall_ms:   integer

# Strictness — see §6.9.4 of substrate.md
strict: bool                             # default false: workflow can be extended at seed time
```

**Bookends are implicit.** Every workflow runs inside `executor → ... steps ... → reviewer` (substrate.md §6.9.3). The `steps` list does not include them — they are always present, always last/first respectively, and `executor` may be `debugger` instead if the issue type resolves to a `debug` family workflow.

**Layer 2 gates overlay every workflow.** `code-sanity`, `obligations-scanner`, `security-auditor` (if surface) are not declared in any workflow file — they are config-shipped (`config/gates/*.yaml`) and added at resolution time per the §6.9.3 conditions. A workflow author cannot opt out (the gates are mandatory by design). The same config-shipped overlay can declare `skip_when` for the codified exceptions (test-only, new-file-only).

### 25.2 Workflow inheritance — linear, not multiple

`extends: <other>` is allowed but only linear (one parent). Multiple inheritance creates ordering ambiguity for step lists. The child can:

- Prepend steps with `steps_before: [...]`
- Append steps with `steps_after: [...]`
- Replace a step by name with `steps_replace: { <name>: <new-def> }`
- Skip a parent step with `steps_skip: [name, ...]` (allowed only if parent step is *not* `non_skippable`)

Resolution merges parent + child at workflow-load time and persists the result as the resolved workflow (§6.9.2). The merged form is what's stored on the container — children are not re-resolved per dispatch.

### 25.3 Concrete workflows — extracted from `.xtrm/reports/`

Six workflows recur in the real chains. These are the defaults substrate ships, named from actual usage in mercury 2026-05-25 and specialists 2026-05-26.

#### `code-quick` — LOW-blast trivial change

Observed in: mercury 2026-05-25 wave 1 (`98vy`, one-line sort fix).

```yaml
name: code-quick
description: Trivial change with LOW blast radius — lean chain
steps: []                                # bookends only; Layer 2 gates still apply
applies_when:
  scrutiny_gte: low
  scrutiny_lte: low
defaults:
  scrutiny: low
```

Resolves to: `executor → code-sanity → reviewer` (gates auto-attached). 3-job chain. The shortest legitimate path.

#### `code-standard` — production diff (the iron pipeline)

Observed in: specialists 2026-05-26 (entire iron epic). The default for most production work.

```yaml
name: code-standard
description: Production diff, Iron-style review pipeline
steps: []                                # bookends + Layer 2 gates do the work
applies_when:
  type: [task, bug]
  scrutiny_gte: medium
defaults:
  scrutiny: medium
```

Resolves (with Layer 2 + reviewer scrutiny auto-escalation): `executor → code-sanity → [security-auditor if surface] → obligations-scanner → reviewer`. Matches the iron-review-hardening v3.5 shape (specialists 2026-05-26 memory `using-specialists-v3-skill-v3-5-updates-1`).

#### `code-with-advisors` — HIGH/CRITICAL blast or unknown approach

Observed in: mercury 2026-05-25 waves 2-3 (`7egg`, treasury tick-grid fix; CRITICAL blast across 13 processes).

```yaml
name: code-with-advisors
extends: code-standard
description: Advisor prep before standard pipeline — for HIGH/CRITICAL blast
steps_before:
  - role: explorer
    when: { has_no_explorer_evidence_in_scope: true }
  - role: methodologist
    when: { scrutiny_gte: high }
applies_when:
  scrutiny_gte: high
defaults:
  scrutiny: high
```

Resolves: `executor → ... ` preceded by `explorer → methodologist`. Skips explorer if recent exploration evidence already exists (the `lb9s` case in mercury 2026-05-25 — HIGH blast but cause known, advisors skipped).

#### `debug` — bug fix, debugger is non-skippable

Observed in: implicit in mercury-market-data orphan worktrees (`f93g`, `fwhd` "open debugger" notes) and CLAUDE.md gotchas ("debugger-restitch loop").

```yaml
name: debug
description: Bug-fix workflow; replaces executor with debugger; restitch loop tolerated
steps:
  - role: debugger
    non_skippable: true                 # forgetting debugger on a bug chain is the laziness this fixes
# Bookend override: this workflow replaces the `executor` bookend with `debugger`
bookend_override:
  opener: debugger
applies_when:
  type: [bug]
defaults:
  scrutiny: medium
```

Resolves: `debugger → code-sanity → obligations-scanner → reviewer`. The `non_skippable: true` is what closes the substrate.md §6.9.1 concern ("orchestrator forgets the debugger").

#### `quant-validation` — analytical / numerical rigor

Observed in: mercury 2026-05-25 (custom pack `using-specialists-quant` skill mentions; the `7egg` quant-methodologist + `iohb` methodology beads).

```yaml
name: quant-validation
extends: code-with-advisors
description: Quantitative/statistical work — locks methodology before code
steps_before:
  - role: quant-methodologist
    non_skippable: true                 # methodology must precede executor on quant work
  - role: quant-researcher
    when: { tags_any: [needs-external-evidence] }
steps_replace:
  methodologist: { role: quant-methodologist }      # specialize
applies_when:
  scope_matches: ["**/analytics/**", "**/stats/**", "**/*.ipynb"]
  tags_any: [quant, statistical]
defaults:
  scrutiny: high
```

Resolves: `quant-methodologist → [quant-researcher if external evidence needed] → executor → code-sanity → obligations-scanner → reviewer`. The mercury `7egg` chain (tick-grid quantization policy locked by methodology before executor implementation) is exactly this shape.

#### `security-deep` — sensitive surface or security epic

Observed in: implied by substrate.md §6.6 + specialists 2026-05-26 SCRUTINY auto-escalation table (auth, secrets, lockfiles, config, permissions).

```yaml
name: security-deep
extends: code-standard
description: Sensitive surface — security advisor + gate, scrutiny critical
steps_before:
  - role: security-auditor              # advisory pass (recommendations before executor)
    non_skippable: true
applies_when:
  scrutiny_gte: critical
  scope_matches:
    - "**/auth/**"
    - "**/secrets/**"
    - "**/crypto/**"
    - "**/migrations/**"
    - "**/.github/workflows/**"
defaults:
  scrutiny: critical
```

Resolves: `security-auditor (advisor) → executor → code-sanity → security-auditor (gate) → obligations-scanner → reviewer`. The same role serves twice with different semantics (advisor pre-, gate post-) — the participant definition's `workflow_role` field (§16) declares which positions are valid.

### 25.4 Resolution example (matches mercury 2026-05-25 `7egg`)

Given an issue:
- `type: task`
- `scope: ["analytics/shared/treasury.py", "tests/test_treasury_format.py"]`
- `scrutiny: critical` (auto-escalated by reviewer surface check; was `high` at create time)
- `tags: [quant]`

Auto-match resolution order (first matching `applies_when` wins, else `code-standard` fallback):
1. `security-deep`? scope doesn't match security paths → no
2. `quant-validation`? scope matches `**/analytics/**` AND `tags: [quant]` → **yes**
3. (would have been `code-with-advisors` / `code-standard` otherwise)

Resolved chain (Layer-1 from `quant-validation` + Layer-2 gates from config, with scrutiny auto-escalation):
```
quant-methodologist     → quant-researcher (skipped — no `needs-external-evidence` tag)
                        → executor
                        → code-sanity
                        → security-auditor (skipped — surface doesn't trigger)
                        → obligations-scanner
                        → reviewer (scrutiny=critical → ddiff mode if PARTIAL)
                        → merge_ready
```

This matches the actual `7egg` chain from mercury 2026-05-25 (`explorer 772978 + quant-methodologist a2177e + executor 455b77 + code-sanity 8734eb + reviewer 6ef30f`), modulo the explorer that ran ad-hoc instead of by workflow — the resolved workflow would have made the explorer step explicit and persisted.

### 25.5 What this resolves and what remains

**Closed by §25:**

- substrate.md §6.9 was a sketch; §25 makes it a concrete YAML schema with composition rules.
- substrate.md §14.1 *"Which workflows are actually recurring?"* — answered with six concrete workflows mined from real chains.

**Open after §25 (next pass, not now):**

- Per-role timeout and budget defaults — calibrated against pi auto-retry behavior, needs real runs to set numbers.
- A workflow editor or visualizer (operator-facing). Out of scope for the design pass; the YAML files plus `sb container ps --tree` are sufficient for v0.

### 25.6 What gets reused

| Workflow feature | Reused from |
|---|---|
| `applies_when` matcher | substrate.md §5.2 seed `invite_when`, §6.9.3 workflow `applies_when` — same matcher syntax everywhere |
| `extends` + `steps_before/after/replace` | standard schema composition; no new mechanism |
| Bookend (executor/reviewer/debugger) | substrate.md §6.9.3 |
| Layer 2 gates auto-overlay | substrate.md §6.9.3 |
| Non-skippable + unauthorized-skip-as-escalation | substrate.md §6.9.3 (Iron pattern) |
| `workflow_role` field on participant definition | §16 of this review |

Zero new primitives. The workflow language *composes* substrate's existing matcher, role, and gate primitives — exactly what §18's reuse audit demands.
