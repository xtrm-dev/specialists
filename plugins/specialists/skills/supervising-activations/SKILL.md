---
name: supervising-activations
description: >
  Dispatch and supervise specialist activations from inside Claude Code: run a specialist
  against a READY Substrate Issue or an inline 7-section contract, read live activation state, answer
  asks, resume the same session, and stop. Use when work already has a durable contract and
  needs a supervised activation rather than direct edits.
version: 0.2
---

# Supervising specialist activations from Claude Code

## What owns what

Specialists is the execution runtime. It CONSUMES the Substrate work authority; it is not
Substrate, and this skill does not restate Substrate's doctrine.

For the authority model — what work exists, who owns it, how the Journal and Provenance
behave — read Substrate's own `using-substrate` skill. That block is contractually frozen on
Substrate's side and kept byte-identical across its surfaces; a paraphrase here would be a
fourth unpinned copy that drifts silently, which is exactly what the integration spec
forbids.

What is local to THIS plugin, and therefore stated here:

- A tool result is evidence, not a decision. A dispatch admission is not a result.
- **Dispatch needs the Substrate work store, which supplies the contract.** It is resolved
  without an environment variable, in this order: an explicit `XTRM_SUBSTRATE_DIR`, then normal
  module resolution of the installed `@jaggerxtrm/substrate`, then the npm global prefix. Set
  `XTRM_SUBSTRATE_DIR` only to override that with a local checkout.
  This paragraph previously said `XTRM_SUBSTRATE_DIR` "must be set ... or dispatch does not
  work at all". That is false, and it is the kind of false instruction that gets a coordinator
  to export a path it does not need (README.md documents module resolution as sufficient).
  What IS true: if none of the three sources resolves, `specialist_dispatch` is refused before
  any model turn with `work_item_store_unavailable`, while `specialist_status` and
  `specialist_list` keep working — so the surface looks healthy right up until you dispatch.
  And an override must be in the environment the session was LAUNCHED with; a value exported
  afterwards does not reach the already-running MCP server.
- The store this plugin reads is resolved from `SUBSTRATE_DB`, else `XTRM_STATE_DB`, else
  `~/.xtrm/state.db`. `SUBSTRATE_DB` comes first because the store belongs to Substrate,
  which defines that variable and shares the file with sb and Pi; `XTRM_STATE_DB` is this
  runtime's own older name for the same path and is still honoured. It is overridden only by
  an explicit operator or test variable in the environment — never by a value this plugin
  ships.

## Tool surface

Ten tools are always registered on the Specialists MCP server (plus the three `substrate_*`
tools when Substrate resolves), and the names are exact. A separate
section below documents the REMOVED `use_specialist` path so no reader mistakes it for live.

### specialist_dispatch
Creates an activation. Supply an existing issue ref OR an inline contract — never both:
- `issue_ref` — a Substrate issue ref (for example `XTRM-240`), already READY. NOT a `bd`
  bead id: Substrate's issue store and the `bd` board are separate stores, so passing a `bd`
  id such as `unitAI-ucpcy` is refused with `issue_unresolvable`. To run a specialist against
  work that only exists in `bd`, pass its contract inline instead.
- `bead_id` — permanent compatibility alias for `issue_ref`: same value, same gate.
  Prefer `issue_ref` in new calls.
- `contract` — an inline contract: seven sections (PROBLEM, SUCCESS, SCOPE, NON_GOALS,
  CONSTRAINTS, VALIDATION, OUTPUT) plus a SCRUTINY level (LOW | MEDIUM | HIGH | CRITICAL).
  Eight required parts. SCRUTINY is the level, never an eighth section.

The text gate runs BEFORE anything is created: an inline contract missing a section is
refused and the board is unchanged. A contract that passes is created, attested and
claimed as a real Substrate Issue through the work boundary then bound at activation
start. A draft or otherwise non-dispatchable Issue is refused before any model turn —
fix the Issue, never route around the gate.

Optional: `title`, `model_override`, `thinking_override`
(`off|minimal|low|medium|high|xhigh`), `requested_by`, `coordinator_session_id`,
`epic_context_depth` (1 walks to the parent epic, 2 also the grand-epic).

**Returns identity and admission only — never a result.** Read the result later from
`specialist_result`. Never substitute a result for an interaction message.

**Overrides fail closed.** `model_override` and `thinking_override` are refused before
session creation when unavailable, and are never silently replaced. Report the refusal;
do not retry with a substitute model.

### specialist_status
Live projection of every activation. COMPACT by default — per row: `activation_id`,
`specialist`, `bead_id` (the issue ref), `state`, `access`, `resolved_model`,
`thinking_level` (omitted when unset — never fabricate it), `elapsed_s`, `turn_count`,
`token_usage`, `purpose` (a one-line SCOPE-then-SUCCESS excerpt captured once at dispatch,
omitted when absent), and `result_status` on settled rows only. Pass `full: true` for the
verbose shape (full rows, whole validated results, health sections). Asks keep their `body`
in both modes — it is what you answer.

`wait_for_change: true` (with `timeout_s`, 1-60, default 25) blocks SERVER-SIDE until the
fleet actually changes — an activation settles or is added or disposed, a result status
lands, an ask is raised or answered — then returns the same payload. Watching a fleet this
way costs one MCP request per `timeout_s` while nothing changes and still returns within
~1 s of a real transition (SPECIALISTS-4218). Volatile fields (elapsed, token usage, turn
count) do not count as a change. Never replace it with a fast poll loop: every request
costs the host ~21 ms of CPU even when the answer is empty.

Forensic IDs never appear in rows. Token usage is a row budget, never a window-context
percentage.

### specialist_result
Reads ONE activation's complete result. Input: `activation_id` — the full id or a unique
short prefix (`a2924153` or `act:a2924153`). A settled activation returns `activation_id`,
`specialist`, `issue_ref`, `status`, `output` (complete, never truncated), `validation`,
`resolved_model`, `completed_at` and `source` (`memory` for this server's live results,
`observability_db` for the durable `specialist_results` row). An activation that has not
settled returns `state` and `next` (the tool to use instead). An unknown id or an ambiguous
prefix returns `status: "error"`; an ambiguous prefix lists the candidates. If
`observability.db` is absent, results older than this server process are unreadable — run
`specialists db setup` (`specialists doctor` reports it).

### specialist_reply
Answers a waiting activation by message ID. An unknown ID is reported, never silently
passed.

### specialist_resume
Resumes a settled or waiting activation in the SAME session with a new prompt. Not a second
dispatch: the `activation_id` is kept and the `attempt_id` advances, so the child keeps its
context. The workspace lease is not kept across settle — it is released at settle and
reacquired on resume, so a resume that loses the race to another writer is refused with
`lease_denied`. A disposed activation cannot be resumed. Compact view by default;
`full: true` for verbose.

### specialist_steer
Redirects a RUNNING activation mid-run with a new instruction — the channel for a quiet
executor that never raised a question. Same session, same attempt, context intact. Refused
on any non-running state with a pointer: resume for settled/waiting, retry for failed,
reply for outstanding asks, stop for disposal. Which tool when: running → steer, waiting on
you → reply, done-but-more-work → resume, died → retry.

### specialist_retry
Retries a FAILED activation in place. The activation identity is retained and a new attempt
is created; do not use retry as a substitute for resume or steer. An optional model override
must pass the same fail-closed availability checks as dispatch. Compact view is returned by
default; use `full: true` only when the verbose state is needed.

### specialist_stop_activation
Disposes an activation explicitly. This is the irreversible one. Settled activations stay
resumable until stopped — stopping is a duty, not a cleanup afterthought. There is no
cascade: stop each activation you are done with.

### specialist_list
The specialist registry, one compact line per specialist with a dispatchability verdict per
row. `name` returns one full record; `detail: "full"` (or `full: true`) returns every field.
Read this before relying on a remembered role name.

### specialist_lease_reconcile
Lists uncertain writer leases (`action: "list"`, the default) or resolves one
(`action: "reconcile"` with `worktree`, `outcome` and `basis`). A lease is uncertain when its
holder's liveness cannot be established, typically after a crash; every write dispatch into
that workspace is refused with `workspace_lease_uncertain` until it is reconciled. You state
the outcome (`safe_free`, `superseded`, `manual_attention_required`) and the evidence; the tool
never infers either, and a refused outcome returns its `refusal_reason`. CLI equivalent:
`specialists lease list` / `specialists lease reconcile`.

### use_specialist — removed
`use_specialist` no longer exists; calling it returns an unknown-tool error. Use
`specialist_dispatch` and read the result with `specialist_result`.

It ran a specialist synchronously and, unlike `specialist_dispatch`, accepted a work item the
readiness gate would refuse — draft, closed, or missing a contract section — returning a
warning instead of refusing. That divergence is why it was removed: one entry point that
enforces the contract and one that does not is how ungated work gets dispatched. The gate now
always applies, so a refused contract must be fixed rather than routed around.

## Working rules

- Never shell out to the `specialists` CLI from a session that has these tools. The MCP
  path is in-process; spawning `sp` defeats the native host.
- Dispatch returns admission, not a result. The Channel push is the primary wake: an
  actionable transition (settled result, pending ask, escalation) arrives as a channel
  frame naming the activation, with a bounded brief: run cost and the first result lines,
  the failing model and error, or the ask body. The brief helps you decide what to do next;
  it is never the full result. `specialist_result` is
  the authoritative read for a settled or failed result the push names; `specialist_status`
  covers asks and escalations. A missed push degrades to reading the same object late,
  never a different object. Do not block waiting for a result.
- Every outcome carries a build-identity line. If it names staleness, say so — the runtime
  was rebuilt after load.
- Stop duty: before ending a session, `specialist_status` and stop what you own.
- **Channel wake registration is interactive-TUI-only.** `claude -p` (headless automation)
  has no channel path at any gate setting. A headless run gets hook-only wake — correct, but
  silent: nothing tells the operator the channel push never registered. Do not expect a
  channel notification to reach a `-p` session. When you must watch for a transition, call
  `specialist_status` with `wait_for_change: true` (and a `timeout_s` under your tool
  timeout) and re-issue it as it times out — ONE parked call per interval, never a fast
  poll loop; every MCP request costs the host ~21 ms of CPU (SPECIALISTS-4218).

## Non-goals

This skill is not a scheduler, not a merge path, and not a second work doctrine. Merge is
manual. Substrate Issues are the durable work authority — see the `using-substrate` skill,
which owns that doctrine and is not restated here. Git remains the integration authority.
For CLI-side workflow, see the `using-specialists` skill; it is not restated here.
