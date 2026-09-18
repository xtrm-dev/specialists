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

The first slice exposes a `/specialists` command that opens a native Claude pane, reads `specialist_status` through the packaged Specialists MCP server, renders live activation rows, and exposes a bounded activation inspector.

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
native Pane
```

Classic command hooks remain enabled. They are the compatibility path while Claude Mods are early access.

## Follow-up

After the read-only pane is validated against a supported Claude Code build:

1. add canonical feed/log/forensics projections;
2. add reply/resume/stop controls through existing MCP operations;
3. correlate Claude agent-loop identity with Specialist activation identity without equating them;
4. add provider-native tests with `claude plugin test`;
5. decide which classic hooks can be retired only after parity evidence.

No durable state may live only in Mod module state. Reload must reconstruct presentation from Specialists/Substrate truth.
