---
name: using-specialists
description: >
  Use Specialists as a governed XTRM execution backend for tracked implementation,
  debugging, review, testing, security, documentation, research, and other role-shaped
  work. Use when work already has a durable Substrate Issue contract and benefits from a distinct
  specialist role, native activation lifecycle, review/fix loop, retained evidence, or an
  advanced Specialists surface such as node/script execution, KPI analysis, or specialist
  definition authoring. Dispatch and supervise through the native tools of your runtime
  (Pi extension or Claude Code plugin); read live `specialist_list` before relying on
  remembered roles.
version: 5.0
---

# Using Specialists

Specialists is one execution backend inside XTRM. XTRM owns the work contract,
continuity, and system-level coordination. Specialists owns specialist selection,
activation, retained results, role boundaries, and specialist-specific review loops.

Do not use this skill as a substitute for `/using-xtrm`, `/planning`, or
`/multiplexing`.

## Use the native surface of your runtime

An agent dispatches and supervises Specialists through native tools that run in-process.
It does not shell out to the `sp` CLI for that.

| Runtime | Surface | Operator guidance |
|---|---|---|
| Pi | the `native-specialists` extension | the tool descriptions |
| Claude Code | the `specialists` plugin MCP server; channel push wakes you | `/specialists:supervising-activations` |

Two execution paths remain during XTRM-93. Native activation (below) is the primary flow for Substrate-backed work; legacy `sp run`/Supervisor behavior is a compatibility path for operators. Agent work authority comes from the typed Substrate service.

## Native activation — the primary flow

Native activation hosts a Specialist on an in-process Pi `AgentSession`, consuming
Substrate Issues through the WorkItemStore boundary — never a Beads client, a `bd`
subprocess, or a second readiness derivation. Authority (what work exists, who owns it,
readiness) belongs to Substrate: read its `using-substrate` skill.

Eleven tools, names exact: `specialist_list` / `specialist_dispatch` / `specialist_status` /
`specialist_result` / `specialist_feed` / `specialist_reply` / `specialist_resume` /
`specialist_retry` / `specialist_steer` / `specialist_stop_activation` /
`specialist_lease_reconcile`. Only `specialist_lease_reconcile` is Claude
Code only (the CLI has `specialists lease`); the Pi extension has the other ten, including
`specialist_feed` with the same lines as the MCP tool. Live schemas: `src/tools/specialist/activation.tool.ts`.

Live truth comes from the tools, not from memory: `specialist_list` is the resolved
registry with a dispatchability verdict per role; `specialist_status` is the live
activation projection. The installed runtime and
registry are authoritative. Static examples in this skill are shapes, not a promise that
an old field still exists.

```text
Issue ready (attested)
  -> specialist_list: choose a dispatchable role
  -> specialist_dispatch(issue_ref=...)   (bead_id is a permanent alias; or an inline contract)
  -> wait for the wake: channel push (Claude Code) or a follow-up message (Pi);
     specialist_status is the authoritative read
  -> asks: specialist_reply; running: specialist_steer; settled/waiting: specialist_resume;
     failed (e.g. provider quota): specialist_retry, optionally with model_override
  -> specialist_result: the full output of the settled activation
  -> verify findings against the current tree/state
  -> run the required review/test/security follow-up
  -> specialist_stop_activation when done; record the Journal result; Closure elsewhere
     (settled != published != closed)
```

- **The Substrate Issue is the prompt; there is no task-text field.** Exactly one of
  `issue_ref` (primary; `bead_id` is a permanent alias) or `contract` (inline 7-section
  contract + SCRUTINY, validated/created/attested/claimed before dispatch).
- **Readiness is the dispatch gate.** The read-only check refuses draft, unready,
  blocked, terminal, and scope-expanding Issues; `bind` pins the immutable
  ExecutionBinding (issue/revision/hash/claim/participant/activation/session/workspace).
- **Writers share the coordinator's worktree under a lease.** MEDIUM/HIGH tiers take
  the workspace writer lease at admission (re-checked per mutating call); contention
  refuses. The lease releases at settle/completion/disposal; `specialist_resume` and
  `specialist_retry` re-acquire it. A settled activation is resumable, not lease-holding.
  A lease left uncertain by a crash is resolved with `specialist_lease_reconcile`; the
  outcome and basis are stated, never inferred.
- **Control is state-specific.** Asks via `ask_coordinator`/`escalate_to_coordinator`
  are answered by `specialist_reply` on `message_id`; `specialist_stop_activation` is
  the irreversible ordinary disposal path.

## Contract precondition

A specialist receives a durable Substrate Issue. The Issue must already be a usable
contract (attested, ready) before dispatch.

- Read it through the live typed Substrate issue surface (`substrate_issue_get <ref>` on Pi; the equivalent Substrate MCP service on Claude). Never shell out to `sb` from an agent to reconstruct authority.
- If it is a draft, incomplete, stale, or contradicted by current code, repair it through
  the XTRM planning/contract workflow before dispatch.
- Do not use an ad-hoc prompt to smuggle missing requirements around the Issue.

The detailed contract-writing doctrine belongs to `/planning`; Specialists consumes it.

## Choose a specialist when the role adds value

Use a specialist when the task benefits from a bounded role, independent context,
explicit permissions, retained evidence, or a review/test/security gate. Do small,
obvious work locally; multi-agent by design does not mean every edit needs a child agent.

## Evidence rules

A specialist result is a claim, not live truth. Read it with `specialist_result` and
verify load-bearing claims against tree/tests/runtime before acting. Terminal state is
not correctness; a valid failing gate needs a fix loop, not reinterpretation.

## Production changes and dependent waves

Preserve the required review and validation gates: implementation evidence, tests,
independent/security review as warranted, no unresolved findings hidden by the summary.
Before dependent dispatch, re-derive the base: clean tree, prior results present, correct
branch, no stale lease or ownership. Stale-base dispatch is a coordination defect.

## Monitoring and continuation

Do not busy-poll. The wake (channel push on Claude Code, a follow-up message on Pi) names the activation;
read it with `specialist_status`/`specialist_result`. Near the context ceiling, persist
activation ids and pending asks, then hand off. Inter-agent messaging → `/multiplexing`.

## The `sp` CLI — operator surface

The CLI is for humans, scripts, debugging, and the legacy `sp run`/Supervisor
compatibility path. An agent that has the native tools does not use it to dispatch or
monitor. Legitimate operator commands include `specialists doctor`, `specialists lease
list|reconcile`, `sp config show <name> --resolved`, and the advanced surfaces below; read
`sp help` for exact syntax.

## Advanced surfaces are references, not separate skills

Load only the one you need: `references/chain-recipes.md` (role/gate recipes),
`references/monitoring.md` (wakes, results, failures), `references/merge-and-integration.md`
(integration/publication), `references/registry-and-locations.md` (registry),
`references/dispatch-preconditions.md` (git/workspace prerequisites). Operator surfaces:
`references/kpi.md` (cost/stall analysis), `references/nodes.md` (NodeSupervisor),
`references/script-class.md` (`sp script`/`sp serve`), `references/specialist-definitions.md`
(definition authoring; helpers under `scripts/specialist-definitions/`). They stay
discoverable through this root without extra triggers, keeping the catalog small.

## What this skill deliberately does not own

- Generic Issue/contract authoring -> `/planning` and `/using-xtrm`.
- Session cold-start, context-pressure handoff, resume -> `/using-xtrm` (Continuity).
- Native peer/subagent communication -> `/multiplexing`.
- Generic code exploration strategy -> `/gitnexus`.
- Future ChainRun semantics that are not released yet -> current XTRM runtime canon.

The boundary is intentional: one system doctrine, one contract doctrine, and one
Specialists-specific execution doctrine.
