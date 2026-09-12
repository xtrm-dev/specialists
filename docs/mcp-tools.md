---
title: MCP Tools Reference
scope: mcp-tools
category: reference
version: 3.0.0
updated: 2026-09-12
description: MCP tool contract for the Specialists server, regenerated from the live registration surface.
source_of_truth_for:
  - "src/mcp/v2-server.ts"
  - "src/mcp/channel.ts"
  - "src/mcp/resume-tool.ts"
  - "src/tools/specialist/activation.tool.ts"
  - "src/tools/specialist/specialist_status.tool.ts"
  - "src/tools/specialist/specialist_list.tool.ts"
  - "src/tools/substrate/issue.tool.ts"
  - "src/tools/substrate/journal.tool.ts"
  - "src/tools/substrate/provenance.tool.ts"
  - "src/activation/rejection.ts"
  - "config/pi-extensions/specialist-subagents/index.mjs"
domain:
  - mcp
  - tools
---

# MCP Tools Reference

The server (`src/mcp/v2-server.ts`, `buildV2Server`) registers its tools
explicitly in one array. There are two surfaces:

- **Core Specialists activation tools (always registered, 6):**
  `specialist_status`, `specialist_dispatch`, `specialist_reply`,
  `specialist_resume`, `specialist_stop_activation`, `specialist_list`.
- **Specialists-hosted Substrate service tools (conditional, 3):**
  `substrate_issue`, `substrate_journal`, `substrate_provenance`. Admitted
  only when Substrate resolves (`resolveSubstrate()` reports available) or
  when `XTRM_SUBSTRATE_TOOLS=1` is set for inspection. On an install without
  Substrate they are absent from `tools/list` by design, not by failure.

No `sp` child process is spawned by any of these tools. All activation tools
call the in-process `NativeActivationHost` directly.

## Active tool inventory

| Tool | Purpose |
|---|---|
| `specialist_status` | authoritative read: health plus native Fleet (activations, pending asks, recorded results) |
| `specialist_dispatch` | admit-and-start a Specialist on the native runtime (async; returns on admission) |
| `specialist_reply` | answer an outstanding ask by `message_id` |
| `specialist_resume` | resume a settled or waiting activation in the same session (id kept, attempt advances) |
| `specialist_stop_activation` | stop and dispose a native activation |
| `specialist_list` | resolved Specialist registry with per-row dispatchability |
| `substrate_issue` | read and write XTRM work items through Substrate IssueService (op-discriminated; conditional) |
| `substrate_journal` | Substrate journal service (conditional) |
| `substrate_provenance` | Substrate provenance service (conditional) |

Inventory derived from the `tools` array in `src/mcp/v2-server.ts`: six core
factories plus three Substrate factories behind the availability gate.

## `specialist_status`

The authoritative read. Reports backend circuit-breaker states, loaded
specialist count, the native Fleet (`activations`, `pending_asks`), recorded
completions (`activation_results`), outstanding peer-channel interactions
(`pending_interactions`), and workspaces needing reconciliation
(`uncertain_workspaces`).

Source: `src/tools/specialist/specialist_status.tool.ts` (inline schema; the
tool takes no arguments).

```ts
z.object({})
```

### Behavior highlights

- `activations` projects the host's own snapshots (`toActivationView`), so an
  MCP-dispatched activation reads back identically to a Pi-dispatched one.
- `pending_asks` projects outstanding questions (`toPendingAskView`) — answer
  them with `specialist_reply`.
- `activation_results` projects the same validated `ActivationResult` the push
  channel serialises (`toActivationResultView`); see "Notification model".
- `specialist_status` is the authority. A pushed completion is a projection of
  the same object readable here; a coordinator that never received the push
  reads the identical result here.

## `specialist_dispatch`

Dispatch a Specialist onto the in-process runtime. Provide EITHER a work
locator OR `contract` (an inline contract: the same readiness gate runs
first, then a work record is created and dispatched). Never both.

### Input schema

Source: `src/tools/specialist/activation.tool.ts`
(`specialistDispatchSchema`).

```ts
z.object({
  specialist: z.string().describe('Specialist name, e.g. codebase-explorer'),
  issue_ref: z.string().optional().describe(
    'The locator of an EXISTING READY issue — a Substrate Issue locator such as ' +
    'XTRM-227, XTRM-184.2.3, an iss_... id, a historical locator, or an imported ' +
    'Beads alias. This is NOT an address on the live bd board. Mutually exclusive ' +
    'with contract: provide exactly one of a locator or contract, never both.',
  ),
  bead_id: z.string().optional().describe(
    'Permanent compatibility alias for issue_ref: the same locator value under ' +
    'its historical name. Prefer issue_ref in new calls.',
  ),
  contract: z.string().optional().describe(
    'An INLINE task contract, used instead of a locator: the SAME readiness gate ' +
    'runs first, then a work record is created from it and dispatched. The contract ' +
    'must contain all seven sections — PROBLEM, SUCCESS, SCOPE, NON_GOALS, ' +
    'CONSTRAINTS, VALIDATION, OUTPUT — plus a SCRUTINY level, which must be exactly ' +
    'one of LOW, MEDIUM, HIGH or CRITICAL. Note that this is EIGHT required parts, ' +
    'not seven; SCRUTINY is the one most often left out. Write each section as a ' +
    'heading: either the section name on its own line with its body beneath, or ' +
    '`PROBLEM: the body` on one line. Both forms are accepted. ' +
    'A contract missing any section is refused and nothing is created.',
  ),
  title: z.string().optional().describe(
    'Optional title for the record created from `contract` (default: derived from PROBLEM). ' +
    'Ignored when a locator is given.',
  ),
  epic_context_depth: z.number().optional().describe(
    'Walk issue.parent UP this many hops (1 = immediate parent epic, 2 = epic + ' +
    "grand-epic) and render each ancestor contract into the turn-1 prompt as an '" +
    "'## Epic lineage' section. Must be 1 or 2; anything else is refused. Omit for " +
    'single-issue dispatch with no lineage. Dropped for records auto-created from an ' +
    'inline contract (a fresh record has no parent).',
  ),
  model_override: z.string().optional().describe(
    'Override the configured model for THIS activation only. An unavailable model is refused before the session is created, never silently replaced.',
  ),
  thinking_override: z.enum(THINKING_LEVELS).optional().describe(
    'Override the definition thinking_level for THIS activation only. Absent means the definition level. An unknown value is refused before the session is created.',
  ),
  requested_by: z.string().optional().describe(
    'ParticipantId of the requesting coordinator. Defaults to the MCP gateway participant.',
  ),
  coordinator_session_id: z.string().optional().describe('MCP session id, for lineage.'),
})
```

`THINKING_LEVELS` (`src/activation/types.ts`) is
`['off', 'minimal', 'low', 'medium', 'high', 'xhigh']`.

### Behavior highlights

- Admit-not-block: returns once the activation is ADMITTED and started, NOT
  when it finishes — learn about completion and questions through the
  notification model below, and answer with `specialist_reply`.
- The issue is the prompt and MUST be a complete 7-section contract plus a
  SCRUTINY level; a draft or incomplete issue is refused before a model turn
  is spent. If the issue is not dispatchable, fix the issue (planning skill),
  not the dispatch.
- An inline `contract` that passes the gate creates a durable work record;
  the result carries `created_bead_id` plus a `created_bead_note` — track it,
  it is not cleaned up automatically.
- `epic_context_depth` must be 1 or 2; anything else is a structured refusal
  (bare `z.number()` deliberately, so range errors return the refusal envelope
  instead of an opaque zod throw).
- Write-capable Specialists (MEDIUM/HIGH tiers) activate only when they can
  acquire the workspace lease; otherwise dispatch is refused with a structured
  reason.

## `specialist_reply`

Answer an outstanding question or escalation by its `message_id` (read them
from `specialist_status.pending_asks`). The answer returns as that tool
call's result, so the Specialist continues with its context intact. An
unknown or already-answered `message_id` is reported, not silently accepted.

Source: `src/tools/specialist/activation.tool.ts`
(`specialistReplySchema`).

```ts
z.object({
  message_id: z.string().describe(
    'The message_id of the outstanding ask, from specialist_status.pending_asks. Correlation is by message id and nothing else — there is no "answer the latest ask", because with two asks outstanding that is a coin flip.',
  ),
  body: z.string().describe('The answer. Returned to the Specialist as its tool result.'),
})
```

## `specialist_resume`

Resume a settled or waiting activation in the SAME session. Not a second
dispatch: the `activation_id` is kept and the `attempt_id` advances, so the
child keeps its CONTEXT rather than starting over. The writer lease is NOT kept
across settle — it is released at settle and reacquired here, and a resume that
loses the race to another writer is refused with a structured `lease_denied`
reason.
Use this after answering a question, or to give a settled Specialist more
work. A disposed activation cannot be resumed — that is what makes
`specialist_stop_activation` the irreversible one.

Source: `src/mcp/resume-tool.ts` (`specialistResumeSchema`; mirrors the Pi
extension tool of the same name field-for-field).

```ts
z.object({
  activation_id: z.string().describe('The settled or waiting activation to resume.'),
  prompt: z.string().describe('The new instruction for the resumed Specialist.'),
})
```

## `specialist_stop_activation`

Stop and dispose a native activation. This is the only ordinary path to
disposal — a settled Specialist is waiting and resumable, not finished. For
legacy CLI-started jobs, which are separate processes, use the CLI surface
instead (see "Retired and out-of-scope surfaces").

Source: `src/tools/specialist/activation.tool.ts`
(`specialistStopSchema`).

```ts
z.object({
  activation_id: z.string().describe('Activation to stop and dispose.'),
  reason: z.string().optional().describe('Recorded forensically with the disposal.'),
})
```

## `specialist_list`

List the resolved Specialist registry after repo and user layer overrides.
Compact one line per specialist by default; pass `name` for one full record
or `detail: "full"` for everything (large — prefer `name`). The loader is
authoritative; dispatchability reuses the shared admission checks, never a
second resolver.

Source: `src/tools/specialist/specialist_list.tool.ts`
(`specialistListSchema`).

```ts
z.object({
  name: z.string().optional().describe('Return the full record for this one specialist instead of the compact list.'),
  detail: z
    .enum(['compact', 'full'])
    .optional()
    .describe('"compact" (default) is one line each; "full" returns every field for every specialist.'),
})
```

### Behavior highlights

- Every row carries the native-only note: dispatch through
  `specialist_dispatch`; do not shell out to the specialists CLI.
- Write-capable tiers (MEDIUM/HIGH) still need the workspace lease at dispatch
  time.

## Substrate service tools

These tools are hosted by this server but served by Substrate: this server is
transport, Substrate is the authority. They appear in `tools/list` only when
Substrate resolves or `XTRM_SUBSTRATE_TOOLS=1` is set.

- `substrate_issue` — one op-discriminated tool over IssueService (`op`:
  `resolve`, `get`, `create`, `update_contract`, `project_resolve`,
  `project_create`, `link_checkout`, `list_links`). `create` and
  `update_contract` mutate. Source:
  `src/tools/substrate/issue.tool.ts` (`substrateIssueSchema`).
- `substrate_journal` — Substrate journal service. Source:
  `src/tools/substrate/journal.tool.ts`.
- `substrate_provenance` — Substrate provenance service. Source:
  `src/tools/substrate/provenance.tool.ts`.

When Substrate is unresolvable the tools answer with the shared unavailable
payload rather than failing at registration; see `src/substrate/services.ts`.

## Retired and out-of-scope surfaces

- **`use_specialist` (retired).** The legacy synchronous specialist run was
  removed: its module (`src/tools/specialist/use_specialist.tool.ts`) no
  longer exists and the name is not registered by `buildV2Server`. There is
  no synchronous dispatch path; use `specialist_dispatch` plus the
  notification model below.
- **Legacy `sp` CLI job tools.** The CLI-managed job tools (`stop_specialist`,
  `resume_specialist`, `feed_specialist`, `steer_specialist`,
  `list_specialists`, `specialist_init`) are not registered on this MCP
  server. They are documented with the CLI in
  [cli-reference.md](cli-reference.md).
- **Pi extension tools.** The Pi extension
  (`config/pi-extensions/specialist-subagents/index.mjs`) exposes its own
  `specialist_*` tools over the same `NativeActivationHost`, including a
  `specialist_retry` verb this MCP server does not register. That surface is
  documented with the Pi integration, not here.

## Notification model

Primary, authority, fallback — in that order:

1. **Channel wake (primary).** Actionable transitions (settled, failed,
   escalation, clarification) push a `notifications/claude/channel` frame.
   The frame is a REFERENCE, never the payload: it names the activation and
   tells the coordinator to call `specialist_status`. Delivery is
   unacknowledged and gated (capability, protocol era, provider, flags); only
   a legacy-era connection can carry it. Source: `src/mcp/channel.ts`
   (`withChannelPush`, `buildChannelFrame`).
2. **`specialist_status` (authoritative read).** The push can be unroutable,
   held, or refused without ever reporting delivery — so the validated result
   must be readable without one. `activation_results` projects the SAME
   object the push serialises. A coordinator that never received the push
   reads the identical result here; the notification is a projection, never
   the authority.
3. **Polling (degraded fallback).** Reading `specialist_status` on a loop is
   the path taken when no coordinator is listening — suppressed wake
   (`--no-specialist-wake` on Pi), unroutable push, or a client with no
   notification path. An ask with no notification stays `pending` and stays
   readable here. Polling is what remains when the first two lanes fail, not
   the normal discovery mechanism. The Pi extension wakes via `sendMessage`
   with `triggerTurn` instead of polling; see
   `config/pi-extensions/specialist-subagents/index.mjs`.

Provider limits on this transport (preview status, platform availability,
untrusted inbound, no-ack delivery) are stated in
[claude-channel-constraints.md](claude-channel-constraints.md).

## Refusal shape

Refusals are returned tool results, never thrown errors — throwing would reach
the coordinator as an opaque MCP error string. All gate refusals render
through the single shared renderer. Source: `src/activation/rejection.ts`.

```ts
export interface RejectionInput {
  reason: string;
  detail?: DispatchRejectedError['detail'];
  missing?: string[];
}

export function renderRejection(input: RejectionInput, build?: string) {
  return {
    status: 'rejected' as const,
    reason: input.reason,
    ...(input.detail ? { detail: input.detail } : {}),
    ...(input.missing?.length ? { missing: input.missing } : {}),
    ...(build ? { build } : {}),
  };
}
```

- `status` is always `'rejected'`; `reason` names the gate outcome.
- `missing` lists the absent contract sections at the top level when the gate
  reports them — and is never stripped from `detail` where the host put it.
- `build` carries the loaded-vs-on-disk build identity
  (`describeBuildIdentity`), so a stale-build refusal is distinguishable from
  a broken-contract refusal.

## Coordinator behavior notes

- Admit-not-block: `specialist_dispatch` returns on admission. The handle's
  `result` promise is observed server-side (settling records the validated
  result, then the notification is pushed); the dispatching call never blocks
  on it, because a coordinator blocked waiting on completion cannot answer the
  clarification that would unblock it.
- Wake-first: Channel wake is the primary discovery mechanism and
  `specialist_status` is the authority. Poll only when the wake lane is known
  dead (suppressed, unroutable, or unsupported); a reader that cannot see the
  ask leaves the Specialist stuck forever.
- Push-as-projection: a pushed completion serialises the SAME validated
  `ActivationResult` that `specialist_status.activation_results` projects.

## See also

- [cli-reference.md](cli-reference.md) — legacy `sp` CLI job tools
- [workflow.md](workflow.md)
- [background-jobs.md](background-jobs.md)
- [claude-channel-constraints.md](claude-channel-constraints.md)
