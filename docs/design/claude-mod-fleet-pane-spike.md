# Claude Mod fleet pane spike

Status: experimental / early access

This spike adds a Claude-native Specialists fleet pane using Anthropic's early-access Function Hooks / Claude Mods surface.

## Intent

The Mod is a provider-native renderer and controller over the existing Specialists runtime.

It does not own:

- activation identity;
- scheduling;
- Channels semantics;
- Substrate work authority;
- persistence;
- execution state.

The Mod is the Claude-native twin of the Pi `specialist-subagents` footer section. It draws the live fleet of the current session in the `AbovePrompt` band: a header (`N running • N waiting • ! N blocked`), two-line rows (blocked first), and an inline control area for the selected row. It polls `specialist_status` every 2 s through `$.mcp.call('plugin:specialists:specialists', …)`; the session's own MCP server hosts the activations this session dispatched.

Controls go through the existing MCP operations, never a second vocabulary:

| Surface | Action | MCP tool |
|---|---|---|
| band: blocked row | reply input | `specialist_reply` |
| band: running row | steer input | `specialist_steer` |
| band: settled/waiting row | resume input | `specialist_resume` |
| band: any row | `stop` button (hotkey `x`) | `specialist_stop_activation` |
| `/specialists reply <message_id> <answer>` | | `specialist_reply` |
| `/specialists steer\|resume\|stop <activation> …` | activation by full id or unique prefix | as above |
| `/specialists` | toggles the fleet pane | `specialist_status` |
| `/specialists status` | prints the fleet report (every surface) | `specialist_status` |
| `/specialists [show\|hide\|expand\|collapse]` | band visibility | — |

With more than `COLLAPSE_AT` (3) activations the band folds to its header, an `open` button (hotkey `o`) and the blocked rows; an ask never hides behind a count. `open` or `/specialists` opens the `specialists-fleet` pane with the full list and the same controls (one shared renderer). The surface places the pane: docked beside a fullscreen transcript, else inline above the prompt; the API has no overlay. The pane opens with `focus` and `closeOnEscape`; while it is open the band shows only its header.

The command is `immediate`, so it runs while a model turn is streaming. Command-driven actions record a hidden `context` note, so the model knows the operator acted on its fleet. A failed read (`isError`, a `{ status: 'error' }` payload, or a rejected call) shows `status unavailable`; it is never drawn as an empty fleet.

## Runtime boundary

```text
Specialists runtime / MCP
        |
        v
specialist_status
        |
        v
Claude Mod register.tsx
        |
        v
AbovePrompt band + /specialists
```

Classic command hooks remain enabled. They are the compatibility path while Claude Mods are early access.

## Transcript rows

A companion plugin, `specialists-ui` (`plugins/specialists-ui`), redraws three specialist events that otherwise reach the coordinator as raw machine text. It is a separate plugin because Claude Code never runs a plugin's own `ui.render` hooks on a row that plugin raised: the debug log says `specialists@xtrm ui.render skipped: re-entry (the plugin's own code raised it; origin specialists)`, and the channel wake comes from the `specialists` plugin's own MCP server. The mod reference does not document this rule (Claude Code 2.1.288). Hooks in a hot-reloaded dev-mods folder are a different plugin, so they draw the row; that is why a dev copy worked while the installed plugin did not.

- a channel wake (`UserMessage`, `origin.kind: 'channel'` from `plugin:specialists:specialists`): the frame `buildChannelFrame` writes is parsed and drawn as a teammate-style row — a `●` coloured by event (`completed` green, `failed` red, `escalation`/`needs_reply` yellow), `Specialist`, a bold `@<specialist>:<short activation id>` in the band accent, the event word and the Issue ref when the frame carries one, then a dim italic `use specialist_status for full result` line. Text that does not parse keeps the engine's row;
- the wake-watch fallback (`UserMessage`, `origin.kind: 'task-notification'`, text exactly `Specialist activation needs attention`): drawn as one line naming the Specialists fallback wake and the same status hint;
- Specialists MCP tool calls (`/^mcp__(plugin_specialists_)?specialists__/`): a `ToolGroup` holding one is unfolded in place (`isExpanded: true`), so each call draws as a `ToolUse` row labelled natively (`Dispatch @<specialist> → <issue_ref|bead_id|'inline contract'>`, `Status`, `List specialists`, `Reply → <message_id>`, `Steer`/`Resume`/`Stop`/`Retry @<activation>`, `Issue`, `Journal`, `Provenance`). Running, errored and interrupted states stay visible.

Presentation only: the stored row, and everything the model reads, is untouched — ctrl+o (`props.isExpanded`) always shows the engine's own row. Groups with no Specialists call, and every other row, pass through unchanged.

## Follow-up

Follow-up, after validation against a supported Claude Code build:

1. add canonical feed/log/forensics projections;
2. correlate Claude agent-loop identity with Specialist activation identity without equating them;
3. decide which classic hooks can be retired only after parity evidence (see anthropics/claude-code#96831: `classic.*` events are not dispatched to modules).

Tests: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/specialists` and `... plugins/specialists-ui`.

Engine constraint: `$` may be passed only to functions declared at the top level of the module, and every call site spells `$.noun.event(...)`. A closure that receives `$` makes the module fail to load.

No durable state may live only in Mod module state. Reload must reconstruct presentation from Specialists/Substrate truth.
