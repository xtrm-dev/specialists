---
name: using-specialists
description: >
  Use Specialists as a governed XTRM execution backend for tracked implementation,
  debugging, review, testing, security, documentation, research, and other role-shaped
  work. Use when work already has a durable Substrate Issue contract and benefits from a distinct
  specialist role, native activation lifecycle, review/fix loop, retained evidence, or an
  advanced Specialists surface such as node/script execution, KPI analysis, or specialist
  definition authoring. Read live `specialists list --full` and `sp help` before relying
  on remembered roles or flags.
version: 4.4
---

# Using Specialists

Specialists is one execution backend inside XTRM. XTRM owns the work contract,
continuity, and system-level coordination. Specialists owns specialist selection,
job execution, retained results, role boundaries, and specialist-specific review loops.

Do not use this skill as a substitute for `/using-xtrm`, `/planning`, or
`/multiplexing`.

## Start from live truth

Before a substantial dispatch:

```bash
specialists list --full
sp help
```

Use subcommand help before exact invocation when a flag matters. The installed CLI and
registry are authoritative. Static examples in this skill are shapes, not a promise that
an old flag still exists.

Two runtimes exist. Native activation (below) is the primary flow for Substrate-backed
work; the `sp` CLI is the operator/frontend surface, transitional under XTRM-93.

## Contract precondition

A specialist receives a durable Substrate Issue. The Issue must already be a usable
contract (attested, ready) before dispatch.

- Read it with `sb issue show <ref>` (pinned revision + readiness).
- If it is a draft, incomplete, stale, or contradicted by current code, repair it through
  the XTRM planning/contract workflow before dispatch.
- Do not use an ad-hoc prompt to smuggle missing requirements around the Issue.
- The same contract-quality rule applies to every XTRM worker, not only Specialists.

The detailed contract-writing doctrine belongs to `/planning`; Specialists consumes it.

## Choose a specialist when the role adds value

Use a specialist when the task benefits from a bounded role, independent context,
explicit permissions, retained evidence, or a review/test/security gate. Resolve the
actual list from the live registry. Do small, obvious work locally; multi-agent by
design does not mean every edit needs a child agent.

## Dispatch lifecycle (both runtimes)

```text
Issue ready (attested)
  -> select live specialist
  -> dispatch: `specialist_dispatch(issue_ref=...)` native,
     or `sp run <name> --bead <id>` operator surface
     (`bead_id`/`--bead` are permanent aliases for the Issue ref)
  -> observe activation/job state (specialist_status / sp ps|feed)
  -> answer asks (specialist_reply) / steer or resume same session
  -> consume settlement / persisted result
  -> verify findings against current tree/state
  -> run required review/test/security follow-up
  -> record Journal result; explicit Closure elsewhere
     (settled != published != closed)
```

For exact commands and specialized surfaces, load only the relevant reference:
`references/chain-recipes.md` (role/gate recipes), `references/monitoring.md`
(wait/feed/result, keep-alive, failures), `references/merge-and-integration.md`
(integration/publication), `references/registry-and-locations.md` (registry),
`references/dispatch-preconditions.md` (git/worktree prerequisites),
`references/kpi.md` (cost/stall analysis), `references/nodes.md` (NodeSupervisor),
`references/script-class.md` (`sp script`/`sp serve`), `references/specialist-definitions.md`
(definition authoring; helpers under `scripts/specialist-definitions/`).

## Evidence rules

A specialist result is a claim, not live truth. Prefer persisted result evidence and
verify load-bearing claims against tree/tests/runtime before acting. Terminal state is
not correctness; a valid failing gate needs a fix loop, not reinterpretation.

## Production changes

Preserve the required review and validation gates: implementation evidence, tests,
independent/security review as warranted, no unresolved findings hidden by the summary.

## Dependent waves

Before dependent dispatch, re-derive the base: clean tree, prior results present,
correct branch/worktree, no stale ownership. Stale-base dispatch is a coordination
defect — fix the state before adding another worker.

## Monitoring and continuation

Do not busy-poll. Use the wait/feed/result mechanisms and continuation facilities; near
context ceiling, persist state and hand off. Inter-agent messaging → `/multiplexing`.

## Native activation — primary flow (not the `sp` surface above)

Native activation hosts a Specialist on an in-process Pi `AgentSession`, consuming
Substrate Issues through the WorkItemStore boundary — never a Beads client, a `bd`
subprocess, or a second readiness derivation. Authority (what work exists, who owns it,
readiness) belongs to Substrate: read its `using-substrate` skill. Six tools, names
exact: `specialist_dispatch` / `specialist_status` / `specialist_reply` /
`specialist_resume` / `specialist_stop_activation` / `specialist_list`.
Full operator procedure: `plugins/specialists/skills/supervising-activations/SKILL.md`.

- **The Substrate Issue is the prompt; there is no task-text field.** Exactly one of
  `issue_ref` (primary; `bead_id` is a permanent alias) or `contract` (inline 7-section
  contract + SCRUTINY, validated/created/attested/claimed before dispatch).
- **Readiness is the dispatch gate.** The read-only check refuses draft, unready,
  blocked, terminal, and scope-expanding Issues; `bind` pins the immutable
  ExecutionBinding (issue/revision/hash/claim/participant/activation/session/workspace).
- **Writers share the coordinator's worktree under a lease.** MEDIUM/HIGH tiers take
  the workspace writer lease at admission (re-checked per mutating call); contention
  refuses. The lease releases at settle/completion/disposal; `specialist_resume`
  re-acquires it. A settled activation is resumable, not lease-holding.
- **A child asks and resumes.** Asks via `ask_coordinator`/`escalate_to_coordinator`,
  answered by `specialist_reply` on `message_id`; `specialist_resume` continues the
  SAME session; `specialist_stop_activation` is the only ordinary disposal path.

Settlement is evidence: record a Journal result, verify, then close explicitly —
Closure lives elsewhere. Do not cite `docs/native-activation.md` (stale; rewrite
tracked separately). Live schemas: `src/tools/specialist/activation.tool.ts`.

## Advanced surfaces are references, not separate skills

KPI analysis, NodeSupervisor, script-class execution, and definition authoring stay
discoverable through this root without extra active triggers, keeping the catalog small.

## What this skill deliberately does not own

- Generic Issue/contract authoring -> `/planning` and `/using-xtrm`.
- Session cold-start, context-pressure handoff, resume -> `/starting-and-resuming-work`.
- Native peer/subagent communication -> `/multiplexing`.
- Generic code exploration strategy -> `/gitnexus`.
- Future ChainRun semantics that are not released yet -> current XTRM runtime canon.

The boundary is intentional: one system doctrine, one contract doctrine, and one
Specialists-specific execution doctrine.
