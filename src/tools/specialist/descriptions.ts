// src/tools/specialist/descriptions.ts
//
// ONE SOURCE for every specialist_* tool description and parameter description.
//
// Tool descriptions existed twice — once per coordinator surface (the MCP tool
// factories under src/tools/specialist/ plus src/mcp/resume-tool.ts, and the Pi
// extension at config/pi-extensions/native-specialists/index.mjs) — and the two
// copies already disagreed (the 7-vs-8 contract-parts wording). A fix to one
// was missed by the other. Every description below is defined ONCE here,
// re-exported from src/lib.ts, and consumed by the MCP servers (through the
// factories) and the Pi extension (through dist/lib.js). The drift test
// (tests/unit/tools/specialist-descriptions.test.ts) pins the expected tool
// set per surface and fails when two surfaces emit different description text
// for the same tool.
//
// Per-runtime wording (a follow-up message on Pi instead of the Channel push
// on MCP, the legacy stop_specialist pointer on MCP only, the Pi dispatch-surface
// note on Pi only) stays a DECLARED per-runtime suffix in
// MCP_TOOL_DESCRIPTION_SUFFIXES / PI_TOOL_DESCRIPTION_SUFFIXES — never a forked
// sentence. Runtime-named parameter defaults (requested_by,
// coordinator_session_id) live in SPECIALIST_DISPATCH_RUNTIME_PARAMS for the
// same reason. Anything else that differs between surfaces beyond these
// declared suffixes is a drift failure.
//
// Schema field names are unchanged; only description strings moved here.

import { THINKING_LEVELS } from '../../activation/types.js';

/** The eleven specialist_* tools, in v2 registration order. */
export const SPECIALIST_TOOL_NAMES = [
  'specialist_status',
  'specialist_result',
  'specialist_feed',
  'specialist_dispatch',
  'specialist_reply',
  'specialist_resume',
  'specialist_retry',
  'specialist_steer',
  'specialist_stop_activation',
  'specialist_list',
  'specialist_lease_reconcile',
] as const;

export type SpecialistToolName = (typeof SPECIALIST_TOOL_NAMES)[number];

/** The v2 server (src/mcp/v2-server.ts) and the Pi extension expose all eleven. */
export const V2_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[] = SPECIALIST_TOOL_NAMES;
export const PI_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[] = SPECIALIST_TOOL_NAMES;

/**
 * The v1 server (src/server.ts) predates specialist_feed and specialist_resume
 * and exposes the other nine. A new tool fails the drift test until it is
 * classified here.
 */
export const V1_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[] = [
  'specialist_status',
  'specialist_result',
  'specialist_dispatch',
  'specialist_reply',
  'specialist_retry',
  'specialist_steer',
  'specialist_stop_activation',
  'specialist_list',
  'specialist_lease_reconcile',
] as const;

/**
 * Runtime-neutral tool descriptions. The reconciled wording keeps every
 * normative sentence both surfaces already pinned (duty to stop, persistence
 * until stopped, activation ownership, small-work-belongs-here, no CLI
 * routing) and states the contract parts ONCE: an inline 7-section contract
 * plus a SCRUTINY level — eight required parts, not seven.
 */
export const SPECIALIST_TOOL_DESCRIPTIONS: Record<SpecialistToolName, string> = {
  specialist_dispatch:
    'Dispatch a Specialist on the native in-process runtime. No CLI process is spawned. ' +
    'Provide EITHER issue_ref (a READY Substrate Issue locator) OR contract (an inline 7-section ' +
    'contract plus a SCRUTINY level) — bead_id is a permanent compatibility alias for the same ' +
    'issue_ref value. Provide exactly one work locator/contract. An inline contract is accepted ' +
    'through the SAME pipeline as an existing Issue: structural validation, Substrate Issue ' +
    'creation, readiness attestation, claim, ExecutionBinding, activation. The Issue contract IS ' +
    'the prompt and MUST be complete — PROBLEM, SUCCESS, SCOPE, NON_GOALS, CONSTRAINTS, VALIDATION, ' +
    'OUTPUT plus a SCRUTINY level: eight required parts, not seven; a draft or incomplete Issue is ' +
    'refused here, before a model turn is spent guessing at scope it does not carry — fix the Issue ' +
    '(planning skill), not the dispatch. Returns once the activation is ADMITTED and started, not ' +
    'when it completes. Answer a raised question with specialist_reply. Write-capable Specialists ' +
    '(MEDIUM/HIGH tiers) activate only when they can acquire the workspace lease (as does a read-tier ' +
    'specialist with `lease_waiver: true`, on its isolated worktree); otherwise dispatch is refused ' +
    'with a structured reason. Settlement/result is evidence and does not perform Issue Closure. Each ' +
    'dispatch creates a persistent activation YOU own: stop it with specialist_stop_activation when ' +
    'you are done with it.',

  specialist_status:
    'The Fleet: every native activation this process hosts, with its state, and every outstanding ' +
    'question or escalation it is waiting on (answer those with specialist_reply). Compact by default ' +
    '— identity, state, cost, intent per row, settled rows carrying only the result status. Pass ' +
    'full:true for the verbose shape (full ActivationView rows, whole validated results, health ' +
    'sections). Activations stay listed until stopped: a settled entry is either waiting for a ' +
    'follow-up or waiting to be stopped. Stop with specialist_stop_activation every activation you ' +
    'will not resume. No CLI background jobs are shown — this surface only hosts in-process activations.',

  specialist_result:
    "Read ONE settled activation's complete result as a single object — the drill-down " +
    'specialist_status deliberately withholds from its compact rows and projects whole only under ' +
    'full:true amidst every other result. Accepts a full activation_id or a unique short prefix (with ' +
    'or without the act: lead). Lookup reads the in-memory results of this process (the same result ' +
    'specialist_status projects); a result from before a restart is not available here. An activation ' +
    'that exists but has no result yet is answered with its state and the tool that owns it (next: ' +
    'running→specialist_steer, blocked→specialist_reply, failed→specialist_retry, ' +
    'settled→specialist_resume). An unknown or ambiguous id is a structured error naming the candidates.',

  specialist_feed:
    "Read one activation's event feed: tool calls, text, turns, status changes and completion " +
    "(view 'terminal', default), or every lifecycle event (view 'forensic'). Works on running, settled " +
    'and earlier-session activations. Pass since_seq (the last call\'s last_seq) to follow a running one.',

  specialist_reply:
    'Answer an outstanding Specialist question or escalation by its message_id (read them from ' +
    "specialist_status.pending_asks). The answer returns as that tool call's result, so the Specialist " +
    'continues with its context intact rather than being restarted with an answer pasted into a fresh ' +
    'prompt. An unknown or already answered message_id is reported, not silently accepted.',

  specialist_resume:
    'Resume a settled or waiting Specialist with a new prompt, in the SAME session. This is not a ' +
    'second dispatch: the activation_id is kept and the attempt_id advances, so the child keeps its ' +
    'CONTEXT rather than starting over. The writer lease is NOT kept across settle — it is released ' +
    'at settle and reacquired here, and a resume that loses the race to another writer is refused with ' +
    'a structured lease_denied reason. Use this after answering a question, or to give a settled ' +
    'Specialist more work. A disposed activation cannot be resumed — that is what makes ' +
    'specialist_stop_activation the irreversible one.',

  specialist_retry:
    'Re-run a FAILED native activation in place, optionally on a named model. Keeps the activation id ' +
    'and the Issue; the workspace lease is REACQUIRED for the new attempt and can be refused when ' +
    'another writer holds the workspace. Without model_override the same session is re-prompted with ' +
    'its context intact. Failed only — answer an outstanding question with specialist_reply and resume ' +
    'a settled activation with specialist_resume instead.',

  specialist_steer:
    'Redirect a RUNNING Specialist mid-run with a new instruction, keeping its session and context ' +
    'intact. Use for a quiet executor that never raised a question; answer an outstanding ask with ' +
    'specialist_reply, resume a settled activation with specialist_resume, re-run a failed one with ' +
    'specialist_retry. Refused on any non-running state with a pointer to the owning tool.',

  specialist_stop_activation:
    'Stop and dispose a native activation. This is the only ordinary path to disposal — a settled ' +
    'Specialist is waiting and resumable, not finished. There is no child process to signal; disposal ' +
    'is a method call on the in-process AgentSession. You MUST stop every activation you are unlikely ' +
    'to use again: a settled or waiting activation keeps its session and Fleet entry until YOU stop ' +
    'it — nothing expires it for you.',

  specialist_list:
    'List the resolved Specialist registry after repo and user layer overrides. Returns a COMPACT line ' +
    'per specialist by default — name, permission tier, category, and a reason only where the native ' +
    'runtime cannot dispatch it. Pass `name` for one specialist\'s full record including its description, ' +
    'or detail:"full" for every field of every specialist (large — prefer `name`). Write-capable tiers ' +
    '(MEDIUM/HIGH) still need the workspace lease at dispatch time; a read-tier specialist with ' +
    '`lease_waiver: true` is provisioned an isolated worktree and holds its lease instead of running ' +
    'in place.',

  specialist_lease_reconcile:
    "List uncertain writer leases (action 'list', default) or resolve one (action 'reconcile' with " +
    'worktree, outcome and basis). The caller states the outcome; it is never inferred, and a refusal ' +
    'returns its refusal_reason.',
};

/**
 * Declared MCP-only suffixes. The ONLY description text an MCP surface may
 * carry beyond the shared base.
 */
export const MCP_TOOL_DESCRIPTION_SUFFIXES: Partial<Record<SpecialistToolName, string>> = {
  specialist_dispatch:
    ' The Channel push is the PRIMARY wake, specialist_status is the AUTHORITATIVE read, and polling ' +
    'is the degraded fallback.',
  specialist_reply:
    ' Where the Channel is available the ask arrives as a push first; specialist_status is the ' +
    'AUTHORITATIVE read when it does not, and polling is the degraded fallback.',
  specialist_stop_activation:
    ' Use stop_specialist instead for legacy CLI-started jobs, which are separate processes.',
};

/**
 * Declared Pi-only suffixes. The ONLY description text the Pi surface may
 * carry beyond the shared base — the follow-up-message delivery wording
 * instead of the Channel push, and the Pi dispatch-surface note.
 */
export const PI_TOOL_DESCRIPTION_SUFFIXES: Partial<Record<SpecialistToolName, string>> = {
  specialist_dispatch:
    ' Continuation arrives as a follow-up message; specialist_status is the AUTHORITATIVE read when ' +
    'it does not, and polling is the degraded fallback.',
  specialist_reply:
    ' The ask also arrives as a follow-up message; specialist_status is the AUTHORITATIVE read when ' +
    'it does not.',
  specialist_list:
    ' This extension is the dispatch surface: do not shell out to the specialists CLI to run ' +
    'a Specialist.',
  specialist_lease_reconcile:
    ' Use it only when a coordinator write was refused or warned as fenced by a lease whose holder ' +
    'looks gone: the coordinator needs this because a held or uncertain lease fences its own writes ' +
    'and a dead holder is only recoverable by an operator out of band. Normally unnecessary: a lease ' +
    'whose holder is verifiably gone now heals on its own.',
};

/** The exact description text a surface emits for a tool: shared base plus its declared suffix. */
export function specialistToolDescription(
  name: SpecialistToolName,
  runtime: 'mcp' | 'pi',
): string {
  const suffix =
    runtime === 'mcp'
      ? (MCP_TOOL_DESCRIPTION_SUFFIXES[name] ?? '')
      : (PI_TOOL_DESCRIPTION_SUFFIXES[name] ?? '');
  return SPECIALIST_TOOL_DESCRIPTIONS[name] + suffix;
}

/** Compact-by-default flag, shared by every verbose tool (SPECIALISTS-142). */
export const SPECIALIST_FULL_PARAM =
  'Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.';

export const SPECIALIST_DISPATCH_PARAMS = {
  specialist: 'Specialist name, e.g. codebase-explorer',
  issue_ref:
    'Primary work locator: an EXISTING READY Substrate Issue locator for this activation\'s task ' +
    'contract — XTRM-227, XTRM-184.2.3, iss_..., a historical locator, or an imported Beads alias. ' +
    'Only a Substrate Issue locator is accepted here; any other locator is refused as unresolvable. ' +
    'The issue must be READY: a COMPLETE 7-section contract (PROBLEM, SUCCESS, SCOPE, NON_GOALS, ' +
    'CONSTRAINTS, VALIDATION, OUTPUT) plus a SCRUTINY level, which must be exactly one of LOW, ' +
    'MEDIUM, HIGH or CRITICAL. That is EIGHT required parts, not seven; SCRUTINY is the one most ' +
    'often left out. Write each section as a heading: either the section name on its own line with ' +
    'its body beneath, or `PROBLEM: the body` on one line. Both forms are accepted. A draft or ' +
    'incomplete issue is refused before any model turn. No free-form task text is accepted: a task ' +
    'that needs more definition belongs in the Issue (see the planning skill). Supply EXACTLY ONE ' +
    'of issue_ref, bead_id or contract.',
  bead_id:
    'Legacy compatibility alias for issue_ref — the same Substrate Issue locator, resolved at this ' +
    'tool boundary to the same value. Both names are accepted forever and behave identically; prefer ' +
    'issue_ref in new calls. Compatibility note: a bare `bd` id is not a Substrate Issue and is ' +
    'refused as unresolvable. Supply EXACTLY ONE of issue_ref, bead_id or contract.',
  contract:
    'An INLINE task contract, used instead of issue_ref/bead_id: the SAME readiness gate runs first, ' +
    'then a Substrate Issue is created, attested, claimed and dispatched. The contract must contain ' +
    'all seven sections — PROBLEM, SUCCESS, SCOPE, NON_GOALS, CONSTRAINTS, VALIDATION, OUTPUT — plus ' +
    'a SCRUTINY level, which must be exactly one of LOW, MEDIUM, HIGH or CRITICAL. Note that this is ' +
    'EIGHT required parts, not seven; SCRUTINY is the one most often left out. Write each section as ' +
    'a heading: either the section name on its own line with its body beneath, or `PROBLEM: the body` ' +
    'on one line. Both forms are accepted. THIS IS THE PATH FOR ALL DELEGATED WORK, including small ' +
    'and quick questions. A short contract is a fine contract — a one-line body per section is enough ' +
    'for a bounded question, and dispatching here is what gives you the Fleet view, the ask/answer ' +
    'channel, the workspace lease and forensics. Do NOT shell out to the `sp` CLI to avoid writing a ' +
    'contract; a native activation is cheaper, not dearer. Use the planning skill (/planning) for ' +
    'genuinely complex work; a contract missing any section is refused and nothing is created.',
  title:
    'Optional title for the Substrate Issue created from `contract` (default: `<specialist>: <first ' +
    'PROBLEM line>`). An explicit title wins; blank counts as absent. Ignored when issue_ref (or its ' +
    'bead_id alias) is given.',
  parent_ref:
    'Parent locator for the Substrate Issue created from `contract` — any locator the shared work ' +
    'boundary resolves. ONLY with contract: refused alongside issue_ref/bead_id, and refused without ' +
    'contract. The parent must exist and not be terminal (done/cancelled/archived; deferred is ' +
    'accepted); the check runs BEFORE anything is created, and creation-with-parent is one atomic step.',
  kind:
    'Substrate kind for the Substrate Issue created from `contract` (never epic — refused ' +
    'structurally). ONLY with contract: refused alongside issue_ref/bead_id, and refused without ' +
    'contract. Absent means the default from the Specialist output_type (research/analysis give ' +
    'research, everything else gives task).',
  model_override:
    'Override the configured model for THIS activation only. An unavailable model is refused before ' +
    'the session is created, never silently replaced.',
  thinking_override:
    `Override the definition thinking_level for THIS activation only (${THINKING_LEVELS.join('|')}). ` +
    'Absent means the definition level. An unknown value is refused before the session is created, ' +
    'never silently replaced.',
  epic_context_depth:
    'Walk the Substrate Issue parent relation UP this many hops (1 = immediate parent, 2 = parent + ' +
    "grandparent) and render each ancestor contract into the turn-1 '## Epic lineage' section. Must " +
    'be 1 or 2; anything else is refused. Omit when no lineage is requested. Honoured for an inline ' +
    'contract ONLY when parent_ref is given (a parentless auto-created Issue has no lineage); still ' +
    'dropped for parentless inline creates.',
  full: SPECIALIST_FULL_PARAM,
} as const;

/**
 * The two dispatch params that name their own runtime. One definition per
 * runtime, declared here — not a fork.
 */
export const SPECIALIST_DISPATCH_RUNTIME_PARAMS = {
  mcp: {
    requested_by:
      'ParticipantId of the requesting coordinator. Defaults to the MCP gateway participant.',
    coordinator_session_id: 'MCP session id, for lineage.',
  },
  pi: {
    requested_by:
      'ParticipantId of the requesting coordinator. Defaults to the Pi extension adapter participant.',
    coordinator_session_id: 'Pi session id, for lineage.',
  },
} as const;

export const SPECIALIST_STATUS_PARAMS = {
  full: SPECIALIST_FULL_PARAM,
  wait_for_change:
    'Block until the compact Fleet projection actually changes (activation state/result, pending ' +
    'asks) or the timeout passes, then return the same payload as a normal call. One blocking call ' +
    'replaces a poll loop: ~1 call per timeout while nothing changes, and a real transition still ' +
    'returns within ~1s. Ignored when this server hosts no native Fleet.',
  timeout_s:
    'How long wait_for_change may block, in seconds (1-60, default 25). Keep it under the client ' +
    'tool-call timeout.',
} as const;

export const SPECIALIST_RESULT_PARAMS = {
  activation_id:
    'The activation to read. Either the full activation id (act:...) or a unique short prefix — the ' +
    'leading hex of the id with or without the act: lead, e.g. `a2924153` or `act:a2924153`. ' +
    'Ambiguous prefixes are refused with the candidates named.',
} as const;

export const SPECIALIST_FEED_PARAMS = {
  activation_id:
    "Activation id: the full id or a unique short prefix, e.g. 'act:a2924153' or 'a2924153'.",
  view:
    "'terminal' (default): what the specialist did — tool calls, text, turns, status, completion — " +
    "one line each. 'forensic': every recorded lifecycle event name.",
  since_seq:
    "Only events with a sequence number above this. Pass the previous call's last_seq to follow a " +
    'running activation.',
} as const;

/** The feed limit help stays in lockstep with the numeric bounds by construction. */
export function specialistFeedLimitDescription(defaultLimit: number, maxLimit: number): string {
  return `Newest events to return (default ${defaultLimit}, max ${maxLimit}).`;
}

export const SPECIALIST_REPLY_PARAMS = {
  message_id:
    'The message_id of the outstanding ask, from specialist_status.pending_asks. Correlation is by ' +
    'message id and nothing else — there is no "answer the latest ask", because with two asks ' +
    'outstanding that is a coin flip.',
  body: 'The answer. Returned to the Specialist as its tool result.',
} as const;

export const SPECIALIST_RESUME_PARAMS = {
  activation_id: 'The settled or waiting activation to resume.',
  prompt: 'The new instruction for the resumed Specialist.',
  full: SPECIALIST_FULL_PARAM,
} as const;

export const SPECIALIST_RETRY_PARAMS = {
  activation_id: 'The failed activation to re-run in place.',
  model_override:
    'Re-run on a named model instead of the one that failed (manual switch after a quota window ' +
    'kills a run). A new session is built for the new model; without this the SAME session is ' +
    're-prompted and its context survives.',
  prompt:
    'Replacement turn prompt. Defaults to the dispatch-time render of the same Issue.',
  full: SPECIALIST_FULL_PARAM,
} as const;

export const SPECIALIST_STEER_PARAMS = {
  activation_id: 'The running activation to redirect mid-run.',
  message:
    'Steering instruction delivered into the live session — the child receives it after its current ' +
    'tool calls finish, before the next model call, with context intact.',
  full: SPECIALIST_FULL_PARAM,
} as const;

export const SPECIALIST_STOP_PARAMS = {
  activation_id: 'Activation to stop and dispose.',
  reason: 'Recorded forensically with the disposal.',
} as const;

export const SPECIALIST_LIST_PARAMS = {
  name: 'Return the full record for this one specialist instead of the compact list.',
  detail: '"compact" (default) is one line each; "full" returns every field of every specialist.',
  full: 'Alias for detail:"full" (SPECIALISTS-142 one-flag vocabulary). Default compact.',
} as const;

export const SPECIALIST_LEASE_PARAMS = {
  action:
    "'list' returns uncertain workspaces with the outcomes permitted for each; 'reconcile' records " +
    'a decision for one worktree.',
  worktree: "reconcile: the worktree whose lease is uncertain.",
  outcome: 'reconcile: the outcome the operator asserts. Never inferred.',
  basis: 'reconcile: the durable evidence consulted, one entry per source. Empty is refused.',
  superseded_by: "reconcile: required for 'superseded'; the activation that now owns the workspace.",
  note: 'reconcile: free-form note carried into the durable record.',
} as const;

/**
 * Runtime-neutral parameter descriptions per tool, for generic iteration (the
 * drift test). The two runtime-named dispatch params live in
 * SPECIALIST_DISPATCH_RUNTIME_PARAMS instead.
 */
export const SPECIALIST_TOOL_PARAM_DESCRIPTIONS: Record<SpecialistToolName, Record<string, string>> = {
  specialist_dispatch: { ...SPECIALIST_DISPATCH_PARAMS },
  specialist_status: { ...SPECIALIST_STATUS_PARAMS },
  specialist_result: { ...SPECIALIST_RESULT_PARAMS },
  specialist_feed: { ...SPECIALIST_FEED_PARAMS },
  specialist_reply: { ...SPECIALIST_REPLY_PARAMS },
  specialist_resume: { ...SPECIALIST_RESUME_PARAMS },
  specialist_retry: { ...SPECIALIST_RETRY_PARAMS },
  specialist_steer: { ...SPECIALIST_STEER_PARAMS },
  specialist_stop_activation: { ...SPECIALIST_STOP_PARAMS },
  specialist_list: { ...SPECIALIST_LIST_PARAMS },
  specialist_lease_reconcile: { ...SPECIALIST_LEASE_PARAMS },
};
