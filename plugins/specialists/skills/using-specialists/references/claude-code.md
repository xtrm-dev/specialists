# Claude Code runtime notes

Claude Code notes for `/using-specialists`. The root skill stays runtime-shared;
what is specific to running under the `specialists` Claude Code plugin lives
here. Tool semantics stay in the tool descriptions — live schemas:
`src/tools/specialist/activation.tool.ts`. Authority stays with Substrate —
read its `using-substrate` skill; nothing here restates it.

## Store resolution

Dispatch needs the Substrate work store, resolved in this order: an explicit
`XTRM_SUBSTRATE_DIR` checkout, then normal module resolution of the installed
`@jaggerxtrm/substrate`, then the npm global prefix. Set `XTRM_SUBSTRATE_DIR`
only to point at a local checkout; an override must be in the environment the
session was launched with — a value exported afterwards never reaches the
already-running MCP server. If none of the three sources resolves,
`specialist_dispatch` is refused before any model turn with
`work_item_store_unavailable`, while `specialist_status` and `specialist_list`
keep working.

The store file is resolved from `SUBSTRATE_DB`, else `XTRM_STATE_DB`, else
`~/.xtrm/state.db`. `SUBSTRATE_DB` is the owner-defined variable and wins;
`XTRM_STATE_DB` is this runtime's older name for the same path and is still
honoured. It is overridden only by an explicit operator or test variable in the
environment — never by a value this plugin ships.

## Wakes

The channel push is the primary wake: an actionable transition (settled result,
pending ask, escalation) arrives as a channel frame naming the activation with
a bounded brief — run cost and the first result lines, the failing model and
error, or the ask body. The brief tells you what to do next; it is never the
full result. `specialist_status` is the authoritative read for asks and
escalations; `specialist_result` is the authoritative read for the settled or
failed result the push names. A missed push degrades to reading the same object
late, never to a different object. The wake-watch hook is the fallback wake.
Every outcome carries a build-identity line — if it names staleness, say so.

To watch a fleet without busy-polling, call `specialist_status` with
`wait_for_change: true` (and a `timeout_s` of 1–60, default 25): the call parks
server-side until the fleet actually changes — an activation settles, is added,
disposed, or answered — then returns the same payload, normally within ~1 s of
the transition. Volatile fields (elapsed, token usage, turn count) do not count
as a change. Keep one parked call per interval, never a fast poll loop: every
request costs the host ~21 ms of CPU even when the answer is empty.

## Headless runs

**Channel wake registration is interactive-TUI-only.** `claude -p` (headless
automation) has no channel path at any gate setting: a headless run gets the
hook-only wake, which is silent — nothing tells the operator the channel push
never registered. When you must watch for a transition headlessly, use
`specialist_status` with `wait_for_change: true` (and a `timeout_s` under your
tool timeout) and re-issue it as it times out.

## Stop duty

Before ending a session, read `specialist_status` and stop what you own with
`specialist_stop_activation`. Settled activations stay resumable until stopped.
