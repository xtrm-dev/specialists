---
name: using-specialists
description: >
  Use Specialists as a governed XTRM execution backend for tracked implementation,
  debugging, review, testing, security, documentation, research, and other role-shaped
  work. Use when work already has a durable XTRM contract and benefits from a distinct
  specialist role, supervised job lifecycle, review/fix loop, retained evidence, or an
  advanced Specialists surface such as node/script execution, KPI analysis, or specialist
  definition authoring. Read live `specialists list --full` and `sp help` before relying
  on remembered roles or flags.
version: 4.3
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

The current released product supports supervised specialist jobs plus advanced node/script
surfaces. The programme is moving toward the XTRM
`ChainSource -> ChainDefinition -> ResolvedChain -> ChainRun` architecture, but that
generic native chain runtime is not yet a released contract. Do not pretend it is.

## Contract precondition

A specialist receives a durable XTRM work item. The bead must already be a usable
contract before dispatch.

- Read it with `bd show <id>`.
- If it is a draft, incomplete, stale, or contradicted by current code, repair it through
  the XTRM planning/contract workflow before dispatch.
- Do not use an ad-hoc prompt to smuggle missing requirements around the bead.
- The same contract-quality rule applies to every XTRM worker, not only Specialists.

The detailed contract-writing doctrine belongs to `/planning`; Specialists consumes it.

## Choose a specialist when the role adds value

Use a specialist when the task benefits from a bounded role, independent context,
explicit permissions, retained execution evidence, or a review/test/security gate.
Typical roles include explorer, debugger, executor, reviewer, seconder, test roles,
security-auditor, researcher, and documentation/release roles. Resolve the actual list
from the live registry.

Do small, obvious work in the current XTRM agent when delegation would create more
coordination than value. XTRM is multi-agent by design; that does not mean every edit
requires a child agent.

## Basic job lifecycle

```text
contract ready
  -> select live specialist
  -> dispatch against the bead
  -> observe job state/evidence
  -> consume the persisted result
  -> verify findings against current tree/state
  -> run required review/test/security follow-up
  -> publish or hand back through the owning XTRM workflow
```

For exact commands and specialized surfaces, load only the relevant reference:

- `references/chain-recipes.md` — role selection and production-diff review shapes.
- `references/monitoring.md` — waiting, feed/result semantics, keep-alive and failure handling.
- `references/merge-and-integration.md` — current integration/publish behavior.
- `references/registry-and-locations.md` — live registry and source locations.
- `references/dispatch-preconditions.md` — git/worktree prerequisites for dependent work.
- `references/kpi.md` — runtime cost, token/payload, waiting/stall and role/model analysis.
- `references/nodes.md` — NodeSupervisor coordination when `sp node` is intentionally selected.
- `references/script-class.md` — bounded read-only `sp script` / `sp serve` execution.
- `references/specialist-definitions.md` — author/validate Specialist definitions; deterministic
  helpers are under `scripts/specialist-definitions/`.

## Evidence rules

A specialist result is a claim, not live truth.

- Prefer persisted job/result evidence over terminal scraping.
- Verify important claims against the current tree, tests, runtime state, or external
  system before acting on them.
- A terminal state tells you the job stopped; it does not tell you the result is correct.
- Reviewer/seconder findings require a fix loop when valid. Do not reinterpret a failing
  gate as advisory because the implementation looks plausible.
- Classify test failures as in-scope regression, pre-existing failure, or infrastructure
  failure before changing unrelated code.

## Production changes

For a production diff, preserve the project-required review and validation gates. The
current role registry and XTRM chain doctrine decide the exact set; do not reconstruct a
frozen pipeline from memory.

At minimum, make sure the work has implementation/debug evidence, appropriate tests or
explicit test evidence, independent review when required, security review when warranted,
and no unresolved findings hidden by the final summary.

## Dependent waves

Before dispatching work that depends on earlier work, re-derive the base:

```text
working tree clean enough for the next lane
prior required commits/results present
correct branch/worktree selected
no stale job or ownership assumption
```

Stale-base dispatch is a coordination defect. Fix the state before adding another worker.

## Monitoring and continuation

Do not busy-poll. Use the runtime's supported wait/feed/result mechanisms and XTRM
continuation facilities. If the parent session is near its context ceiling, persist the
state and hand off rather than keeping a half-understood specialist swarm alive inside a
failing context window.

General inter-agent messaging and wake/reply semantics belong to `/multiplexing`, not
this skill.

## Native activation — the second runtime (not the `sp` lifecycle above)

Everything above describes the supervised `sp` job lifecycle. None of its vocabulary
carries into this section: native activation hosts a Specialist on an in-process Pi
`AgentSession` rather than spawning `pi` as a subprocess, and it consumes Substrate
Issues through the WorkItemStore boundary (`src/activation/workitem-store.ts`) — never
through a Beads client, a `bd` subprocess, or a second readiness derivation. The work
authority model belongs to Substrate; for what work exists, who owns it, and how
readiness is decided, read Substrate's own `using-substrate` skill. This section states
only the Specialists side of the boundary.

Six tools, names exact (`src/mcp/v2-server.ts:172-180`): `specialist_dispatch` /
`specialist_status` / `specialist_reply` / `specialist_resume` /
`specialist_stop_activation` / `specialist_list`. The `substrate_issue` /
`substrate_journal` / `substrate_provenance` surfaces are separate Substrate tools,
admitted only when Substrate is resolvable. The former `use_specialist` foreground path
has been removed.

The two runtimes differ in ways that change how you dispatch:

- **The Substrate Issue is the prompt; there is no task-text field.**
  `specialist_dispatch` takes exactly one of `issue_ref` (primary; `bead_id` is kept
  as a permanent alias for the same locator) or `contract` (an inline 7-section
  contract plus SCRUTINY level, which the host validates, creates, attests and claims
  through the boundary before dispatching against it — `src/activation/native-host.ts:434-468`).
  Never both, never neither.
- **Readiness is the Substrate dispatch gate, not `bd state`.** The read-only `check`
  refuses draft, unready, blocked, terminal, and scope-expanding Issues before any
  mutation exists, and `bind` pins the immutable ExecutionBinding over
  issue/revision/hash/claim/participant/activation/attempt/session/workspace at
  activation start (`src/activation/workitem-store.ts:315-363`,
  `src/activation/native-host.ts:483-513,854-870`). A refused contract must be fixed
  and re-dispatched; there is no second entry point that skips the gate.
- **A write-capable Specialist gets no worktree of its own.** It shares the
  coordinator's, and a MEDIUM/HIGH tier takes a workspace writer lease at admission;
  contention or an uncertain lease is a refusal, and the lease is re-checked on every
  mutating tool call (`src/activation/native-host.ts:616-640`, `guarded-tools.ts`).
  The lease is released at settle, at completion and at disposal, so a writer holds its
  workspace for the duration of its turn and no longer; `specialist_resume` re-acquires it
  and can be REFUSED with `lease_denied` when another writer holds the workspace
  (`src/activation/native-host.ts:1033-1036,1121-1124,1600,1655-1672`). A settled activation
  is resumable, not lease-holding.
- **A child asks and resumes** rather than restarting. The child asks through
  `ask_coordinator` / `escalate_to_coordinator`, answered by `specialist_reply`
  correlating on `message_id`; `specialist_resume` continues the SAME session with a new
  prompt (activation id kept, attempt advances), and `specialist_stop_activation` is the
  only ordinary path to disposal (`src/activation/ask-tool.ts`,
  `src/activation/interaction.ts`, `src/mcp/resume-tool.ts`).

Current reference for the native surface:
`plugins/specialists/skills/supervising-activations/SKILL.md`, plus the live tool schemas
in `src/tools/specialist/activation.tool.ts` and `src/mcp/resume-tool.ts`. Do not cite
`docs/native-activation.md` — it is stale and its rewrite is tracked separately.

## Advanced surfaces are references, not separate skills

KPI analysis, NodeSupervisor, script-class execution and Specialist definition authoring
are specialized parts of one Specialists execution backend. They remain discoverable
through this root and retain deterministic helper assets, but they do not need four more
active skill triggers. This keeps the default/optional catalog small without deleting the
capabilities.

## What this skill deliberately does not own

- Generic bead/contract authoring -> `/planning` and `/using-xtrm`.
- Session cold-start, context-pressure handoff, resume -> `/starting-and-resuming-work`.
- Native peer/subagent communication -> `/multiplexing`.
- Generic code exploration strategy -> `/gitnexus`.
- Future ChainRun semantics that are not released yet -> current XTRM runtime canon.

The boundary is intentional: one system doctrine, one contract doctrine, and one
Specialists-specific execution doctrine.