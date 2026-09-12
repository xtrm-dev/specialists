---
name: supervising-activations
description: >
  Dispatch and supervise specialist activations from inside Claude Code: run a specialist
  against a ready Bead or an inline 7-section contract, read live activation state, answer
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
- **`XTRM_SUBSTRATE_DIR` must be set in the session environment, or dispatch does not work
  at all.** It points at an `@xtrm/substrate` checkout, which supplies the work-item store
  that holds the contract. Without it `specialist_dispatch` is refused before any model turn
  with `work_item_store_unavailable`; the read tools (`specialist_status`, `specialist_list`)
  keep working, so the surface looks healthy right up until you try to dispatch. It has to be
  exported into the environment the session was launched with — a value exported after launch
  does not reach the already-running MCP server.
- The store this plugin reads is resolved from `SUBSTRATE_DB`, else `XTRM_STATE_DB`, else
  `~/.xtrm/state.db`. `SUBSTRATE_DB` comes first because the store belongs to Substrate,
  which defines that variable and shares the file with sb and Pi; `XTRM_STATE_DB` is this
  runtime's own older name for the same path and is still honoured. It is overridden only by
  an explicit operator or test variable in the environment — never by a value this plugin
  ships.

## Tool surface

Seven tools. The names are exact.

### specialist_dispatch
Creates an activation. Supply EXACTLY ONE of:
- `bead_id` — a Substrate issue ref (for example `XTRM-240`), already READY. NOT a `bd`
  bead id: Substrate's issue store and the `bd` board are separate stores, so passing a `bd`
  id such as `unitAI-ucpcy` is refused with `issue_unresolvable`. To run a specialist against
  work that only exists in `bd`, pass its contract inline instead, or
- `contract` — an inline contract: seven sections (PROBLEM, SUCCESS, SCOPE, NON_GOALS,
  CONSTRAINTS, VALIDATION, OUTPUT) plus a SCRUTINY level (LOW | MEDIUM | HIGH | CRITICAL).
  Eight required parts. SCRUTINY is the level, never an eighth section.

The readiness gate runs BEFORE anything is created. An inline contract creates its bead
first. Do not dispatch against a `contract:draft` bead — promote it first.

Optional: `title`, `model_override`, `thinking_override`
(`off|minimal|low|medium|high|xhigh`), `requested_by`, `coordinator_session_id`,
`epic_context_depth` (1 walks to the parent epic, 2 also the grand-epic).

**Returns identity and admission only — never a result.** Read the result later from
`specialist_status`. Never substitute a result for an interaction message.

**Overrides fail closed.** `model_override` and `thinking_override` are refused before
session creation when unavailable, and are never silently replaced. Report the refusal;
do not retry with a substitute model.

### specialist_status
Live projection of every activation. Per row: `activation_id`, `specialist`, `bead_id`,
`state`, `access`, `model_override`, `thinking_override`, `thinking_level` (omitted when
unset — never fabricate it), `purpose` (a one-line SCOPE-then-SUCCESS excerpt captured once
at dispatch, omitted when absent), `elapsed_s`, `token_usage`, `last_activity_at`, and the
validated `result` object on settled activations only.

Forensic IDs never appear in rows. Token usage is a row budget, never a window-context
percentage.

### specialist_reply
Answers a waiting activation by message ID. An unknown ID is reported, never silently
passed.

### specialist_resume
Resumes a settled or waiting activation in the SAME session with a new prompt. Not a second
dispatch: the `activation_id` is kept and the `attempt_id` advances, so the child keeps its
context and its workspace lease. A disposed activation cannot be resumed.

### specialist_stop_activation
Disposes an activation explicitly. This is the irreversible one. Settled activations stay
resumable until stopped — stopping is a duty, not a cleanup afterthought. There is no
cascade: stop each activation you are done with.

### specialist_list
The specialist registry, one compact line per specialist with a dispatchability verdict per
row. `name` returns one full record; `detail: "full"` returns every field. Read this before
relying on a remembered role name.

### use_specialist (deprecated for contract-gated work)
Runs a specialist synchronously and returns its final output. A `bead_id` that
`specialist_dispatch` would REFUSE — draft, closed, or missing a contract section — still
runs here and returns a `readiness_warning` naming what is missing. That divergence is why
it is deprecated: prefer `specialist_dispatch`.

## Working rules

- Never shell out to the `specialists` CLI from a session that has these tools. The MCP
  path is in-process; spawning `sp` defeats the native host.
- Dispatch admission, then poll `specialist_status`. Do not block waiting for a result.
- Every outcome carries a build-identity line. If it names staleness, say so — the runtime
  was rebuilt after load.
- Stop duty: before ending a session, `specialist_status` and stop what you own.
- **Channel wake registration is interactive-TUI-only.** `claude -p` (headless automation)
  has no channel path at any gate setting. A headless run gets hook-only wake — correct, but
  silent: nothing tells the operator the channel push never registered. Do not expect a
  channel notification to reach a `-p` session; poll `specialist_status` instead.

## Non-goals

This skill is not a scheduler, not a merge path, and not a second doctrine for beads or
git. Merge is manual. Beads and git remain the durable work and integration authority.
For CLI-side workflow, see the `using-specialists` skill; it is not restated here.
