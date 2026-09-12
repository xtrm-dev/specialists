---
title: Native Activation Runtime
scope: native-activation
category: guide
version: 1.0.0
updated: 2026-09-12
synced_at: SPECIALISTS-13
description: Primary reference for the native Specialist activation runtime: Substrate work authority, admission order, run-in-place workspaces, the writer-lease lifecycle, and the lease's tool-path-only boundary.
source_of_truth_for:
  - "src/activation/native-host.ts"
  - "src/activation/workitem-store.ts"
  - "src/activation/workspace-lease.ts"
  - "src/activation/guarded-tools.ts"
  - "src/activation/step-contract.ts"
  - "src/activation/types.ts"
  - "src/activation/registry.ts"
domain:
  - activation
  - specialists
---

# Native Activation Runtime

This document is the primary reference for the native runtime. It describes
only the executing code listed in `source_of_truth_for` above. For the MCP
tool contract (tool names, input schemas, refusal envelopes), see
`docs/mcp-tools.md` — this document does not restate it.

## What it is

`NativeActivationHost` hosts a real Specialist on an in-process Pi
`AgentSession`. The Pi extension and the Claude Code MCP server are frontends
over this class; neither invokes the legacy `sp run` CLI.

Writers are admitted: a `MEDIUM` or `HIGH` permission tier resolves to
`access: 'write'` and must hold the workspace lease before an `AgentSession`
exists. Readers are admitted without a lease and are refused on every
mutating tool call.

## Work authority

Work authority is Substrate Issues, consumed through the `WorkItemStore`
boundary. The host opens the canonical store (`~/.xtrm/state.db`,
`XTRM_STATE_DB` override) and refuses dispatch fail-closed when the store is
absent or unopenable — it never falls back to another authority.

There is no Beads client and no `bd` subprocess on the native path. The
readiness gate lives in the Substrate dispatch service; the host only renders
its refusals. (`src/activation/bead-gate.ts` still shells out to
`bd state <id> contract`, but that module serves the legacy CLI surface, not
this host.)

`bead_id` is compatibility vocabulary only. The host dispatch request names
the work item `issueRef` (mutually exclusive with an inline `contract`). The
MCP dispatch tool still names its work parameter `bead_id`; every projection
carries both `bead_id` and `issue_ref` keys with the same value, alongside
`issue_id`, `issue_revision`, `contract_hash`, and `execution_binding_id`.

## Admission order

Every rejection below happens before an `AgentSession` exists, and each
leaves forensic evidence. The order is fixed:

1. **Specialist resolution.** Unknown specialist refuses as
   `unknown_specialist`.
2. **Workspace resolution.** The workspace is resolved before the work gate.
   It defaults to the coordinator's own working directory: a writer does not
   get a new worktree, and there is no per-activation worktree provisioning
   on the native path.
3. **Work gate.** Inline `contract` and `issueRef` are mutually exclusive
   (`contract_and_ref` when both are given; `no_work_ref` when neither is).
   An inline contract is validated as text, then created through the
   boundary (validate → create → attest → claim) with this activation's id,
   before any session exists. An existing issue is resolved with `view`,
   checked read-only with `check`, then re-read: if the revision or contract
   hash moved under the check, dispatch refuses with
   `issue_revision_diverged` instead of prompting against a stale contract.
   A non-dispatchable issue (draft, unattested, blocked, deferred,
   terminal, scope-expanding) refuses as `issue_not_dispatchable`.
4. **Tool contract and preflight.** An empty resolved tool contract refuses
   as `empty_tool_contract`. `validateBeforeRun` failures (missing skill
   path, absent external command, required tool the tier does not grant)
   refuse as `preflight_failed`. Required `pre`-phase scripts run locally
   before the session exists; a nonzero exit refuses as
   `required_pre_script_failed`, and `inject_output` script stdout reaches
   the prompt as `$pre_script_output`.
5. **SDK and model gate.** The session requires the real Pi SDK resource
   loader (`DefaultResourceLoader` + `getAgentDir`); a stale SDK refuses
   rather than falling back to auto-discovery. The model gate has two
   halves — the pattern must match a real model (a `no-match` diagnostic
   refuses) and its provider must have configured auth. An explicit
   `modelOverride` replaces the chain with a chain of one and, when
   unavailable, refuses as `model_unavailable` rather than substituting
   silently. Without an override, an unavailable primary is skipped with
   forensics and the winner is recorded on the snapshot.
6. **Lease acquisition.** A writer acquires the workspace lease before the
   session exists, so contention is refused without spending a model turn.
   A denied or uncertain lease refuses; the refusal names the holder.
7. **StepContract compilation.** Compiled from the pinned issue revision —
   the contract the worker sees is the contract the gate admitted, not a
   later "latest". Derived and in-memory only: compiling creates no issue,
   chain, or graph.
8. **Session creation and binding.** The session is created with the
   resolved model, the declared-skills resource loader, and the fail-closed
   tool set (below). The `ExecutionBinding` mutation then pins
   issue / revision / hash / claim / participant / activation / attempt /
   session / workspace. A concurrent contract edit between the read-only
   check and this binding refuses here via the gate's divergence check.

Epic lineage comes from Substrate `parent_child` edges
(`epicAncestors(ref, depth)` with depth 1 or 2, anything else yields none),
rendered into the turn-1 prompt. The seven-section work contract is the
prompt's task source; a missing or empty section set refuses at the gate,
and inline-contract text is validated against the 7-section + `SCRUTINY`
shape before anything is created.

## Workspaces: run in place

Writers run in the coordinator's own working directory. The session `cwd`
and the resource-loader `cwd` are the workspace's worktree path, and the
mutation domain is the worktree path itself: two linked worktrees sharing
one repo are distinct workspaces. The lease directory lives under the git
common directory so every worktree of one repository is discoverable in one
place, while the key still separates them.

The resource loader admits only declared resources (`noSkills` plus the
definition's skill paths, curated plus declared-local extension paths, no
ambient context files / prompt templates / themes), and it is reloaded once
before the first attempt so every later attempt sees the same resources.
The session takes `noTools: 'builtin'` with `tools` set to exactly the
resolved contract's tools plus the two ask tools; omitting `tools` would
admit every builtin, and `tools: []` would also empty `customTools`.

## The writer lease

The lease provides single-writer exclusion over the worktree path, and it is
wired at three points: acquisition before the session exists, a per-call
check on every mutating tool call, and release at settle and teardown.

**Lifecycle.** A writer acquires before the session exists. The lease is
released at settle — the `agent_settled` handler releases unconditionally,
whether the turn succeeded, failed, or aborted, and completion releases
again (a no-op when already free). `stop` releases on the only ordinary
disposal path. `resume` and `retry` reacquire with the same `activationId`
and the next `attemptId`; reacquiring one's own lease advances the attempt
rather than contending. Acquisition while another writer holds the workspace
refuses (`workspace_held_by_another_writer`, surfaced as `lease_denied`
forensics on dispatch, resume, and retry). An uncertain lease — holder
process gone, PID reused, liveness unverifiable, or unreadable record — is
never stolen and never released by the holder path; it refuses
(`workspace_lease_uncertain`, `lease_uncertain` evidence) until Phase 9
recovery resolves the previous holder. Only the holding activation may
release; releasing a free workspace is a no-op.

**Per-call enforcement.** The mutating builtins (`edit`, `write`, `bash`,
`powershell`, reconstructed from the SDK factories) are wrapped so the only
mutating tool the child can reach consults `admitToolCall` against live
lease state on every call. A refusal returns as a tool RESULT naming the
reason — never a throw — so the child can react instead of retry-looping.
A mutating tool the runtime cannot reconstruct is `unguardable`, and the
dispatch is refused rather than passing it through unfenced. The check is a
per-call block, never `setActiveToolsByName`: within a turn the agent loop
runs against a tool snapshot taken at turn start, so revoking tools cannot
cancel an already-planned call. Unknown tools are treated as mutating; the
known-read-only names (`read`, `grep`, `glob`, `ls`, `list`, `search`,
`view`, `todowrite`, `websearch`, `webfetch`, …) always pass. A read-only
activation holds no lease and is refused on every mutating call — that is
the capability grant being enforced, not an error state. The coordinator
uses the mirror predicate: a free workspace is its to write, and only an
active holder or an uncertain lease takes it away.

**Boundary: the lease guards the LLM tool path only.** `pi.exec` and
`AgentSession.executeBash` do not fire the `tool_call` handler, so a child
reaching the filesystem that way is not fenced; extension code running
in-process (`node:fs`, `child_process`, `fetch`) bypasses the gate the same
way. The host holds this line by discipline — it never calls
`executeBash`, and shell work is routed through prompt-induced tool calls
rather than RPC `bash`. Do not describe writers as fenced without this
qualifier.

## StepContract

A `StepContract` bounds one activation. It is compiled from the resolved
issue revision plus the `SpecialistDefinition`, is reproducible from those
inputs, and persists nothing. Fields: `rootWorkRef` (always the issue ref,
never a synthetic id), `mandate` (the issue's `SUCCESS` narrowed by
`SCOPE`), `inputs` (today exactly the dispatch issue), `outputs` (the
contract's output artifacts with the specialist's response format),
`scope` (`inScope`), `nonGoals`, optional `constraints` and `validation`,
and `provenance` (`specialist`, `generatedAt`, `sourceIssueRevision` — the
revision the `ExecutionBinding` pinned). Compilation is total: a missing
field yields an empty projection, never a throw on an admitted activation.

## Session lifetime, resume, retry

Reaching `agent_settled` makes a Specialist waiting and resumable, never
disposed. Disposal is an explicit act: `stop` aborts, unsubscribes,
disposes, removes the Fleet record, releases a writer's lease, and emits
`activation_disposed`. Session lifetime deliberately exceeds turn lifetime,
and `agent_end` (per-turn boundary, carries `willRetry`) must not be
confused with `agent_settled` (governed quiescence).

`resume` keeps the `activationId` and advances the `attemptId`; it accepts
`settled`, `waiting`, `needs_reply`, and `escalated` states and re-runs on
the live session with a new prompt. `retry` re-runs a `failed` activation
in place — failed only, mirroring the CLI gate — reusing the same session
unless a validated model override requires a new one. Both reacquire a
writer's lease and both refuse while another writer holds it.

A settled session is not necessarily a successful one: a last assistant
message with `stopReason` `error` or `aborted` reports `failed` with the
provider detail, never `completed` with empty output. A settled activation
with empty or whitespace-only output fails output validation. Retryable
provider failures (`rate_limit`, `timeout`, `transient`, per the classifier
shared with the CLI runner) advance the model-chain walk on a fresh session
under the same activation and attempt; auth, unknown, and abort classes
settle failed immediately. The winner lands on the snapshot and the result
(`resolvedModel`, `fallbackUsed`), so attribution answers what actually ran.

`turnCount` starts at 0 at dispatch and increments exactly once per raw Pi
`turn_end`, cumulative for the logical activation across attempts. Token
spend accumulates on `message_end` only, handling both delta-shape and
cumulative-shape providers, and is absent until the first usage event —
never zero-filled. Window-context % is coordinator-owned and never computed
here.

## Asking without restarting

The ask/escalate tools are custom tools admitted alongside the resolved
allowlist: a read-only specialist gains the ability to ask without gaining
any mutation capability. Asking suspends the asker; the child stays alive
and resumable. Correlation is by `messageId` only — there is no "answer the
latest ask". Without a configured coordinator address the host is
polling-only and every ask reads as `pending` through `specialist_status`;
supplying a peer channel is an optimisation on delivery, never a
prerequisite, and delivery is only ever marked on a real receipt. Answering
returns the reply as the outstanding tool call's result, so the same session
continues with its context intact.

## Results and projections

`ActivationResult` is the validated outcome (`completed` / `failed` /
`uncertain`, with `output`, `validation`, the pinned
`issueId` / `issueRef` / `issueRevision` / `contractHash` /
`executionBindingId`, model attribution, `fallbackUsed`, and
`completedAt`); an interaction message is not a result and performs no state
transition. The MCP surface projects snapshots and results without
restating them: the progress projection carries the activation identity,
`issue_id` / `issue_ref` / `issue_revision` / `contract_hash` /
`execution_binding_id`, state, access, worktree path, model attribution,
`turn_count`, `token_usage`, `purpose`, and activity timestamps; the result
projection carries the same identity plus `status`, `output` (explicitly
`null` when absent), `validation`, and `fallback_used`; pending asks carry
`message_id`, kind, activation/attempt, participants, body, delivery, and
`asked_at`. Native activations write the same `observability.db` as the
legacy runner — there is no native-subagent telemetry database — and the
test-only sink interface exists so tests can observe the stream without one.
Every dispatch refusal renders through the single shared rejection renderer
with build identity attached, so a stale-build refusal can never again read
as a broken contract.
