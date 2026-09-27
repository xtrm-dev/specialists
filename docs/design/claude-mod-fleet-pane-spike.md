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
| `/specialists [show\|hide\|expand\|collapse]` | band visibility; bare form prints the fleet report | `specialist_status` |

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

## Follow-up

Follow-up, after validation against a supported Claude Code build:

1. add canonical feed/log/forensics projections;
2. correlate Claude agent-loop identity with Specialist activation identity without equating them;
3. decide which classic hooks can be retired only after parity evidence (see anthropics/claude-code#96831: `classic.*` events are not dispatched to modules).

Tests: `CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 claude plugin test plugins/specialists`.

Engine constraint: `$` may be passed only to functions declared at the top level of the module, and every call site spells `$.noun.event(...)`. A closure that receives `$` makes the module fail to load.

No durable state may live only in Mod module state. Reload must reconstruct presentation from Specialists/Substrate truth.
