# The Claude Code route (pi-claude-bridge)

Opt-in backend that serves a Specialist's Claude models through the Claude Code CLI and the Claude
Agent SDK, on the operator's own Claude subscription login rather than an API key.
Evidence and measurements: [spike-4403-claude-bridge.md](./spike-4403-claude-bridge.md)
(SPECIALISTS-4403). Integration: SPECIALISTS-4405.

## What it is

[`pi-claude-bridge`](https://github.com/elidickinson/pi-claude-bridge) (MIT) is a Pi extension that
registers a `claude-bridge` provider. It drives the **unmodified Claude Code binary** through the
Anthropic Agent SDK, and Claude Code runs with no tools of its own: every tool call comes back to
Pi. So the tool contract, the permission tiers and the READ_ONLY bubblewrap guard behave exactly as
they do on a built-in provider — Pi executes the tools, not Claude Code.

## Enabling it

The flag is per definition and OFF everywhere by default:

```json
{ "specialist": { "execution": { "claude_bridge": true, "model": "claude-bridge/claude-sonnet-5-5" } } }
```

Set it in your own layer, never in a shipped definition:

```bash
sb specialist override <name> execution.claude_bridge=true    # or edit .specialists/user/<name>.json
```

Requirements:

1. the `pi-claude-bridge` package installed where Pi resolves global packages, or
   `SPECIALISTS_CLAUDE_BRIDGE_PATH=/abs/path/to/entry` for a source checkout;
2. Claude Code logged in as the operator (`claude auth login`; `claude auth status` to check) — the
   agent never logs in and never reads credentials;
3. a model whose provider is `claude-bridge`. Do not use `anthropic/...` for this route: that is
   Pi's own API-key provider and does not go through Claude Code.

Flag off: the extension is not loaded, the gate refuses `claude-bridge/...` with `no model matches`,
and the package need not be installed at all. Flag on with the package missing: the dispatch is
refused with `claude_bridge_unavailable` rather than quietly running on another provider.

## Limits

- **One operator, one login.** The route exists for the operator's own machine and their own
  subscription. Do not copy credentials anywhere, and do not share one login across a fleet.
- **Not for fleet-scale or unattended bulk runs.** Subscription limits assume ordinary individual
  use, and a fleet multiplying turns against one login is exactly the case they do not assume.
- **Billing is clear, permission is a separate question.** Anthropic documents that the Agent SDK
  and `claude -p` draw from a subscription plan's limits
  ([support article](https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan)),
  and its Claude Code legal page reserves plan OAuth for "ordinary use of Claude Code and other
  native Anthropic applications" while directing SDK developers to API keys
  ([legal and compliance](https://code.claude.com/docs/en/legal-and-compliance); see also the
  [consumer terms](https://www.anthropic.com/legal/consumer-terms) §3 on automated access). The
  operator's permission for this machine is a recorded decision on SPECIALISTS-4403.
- **The route can change under us.** Anthropic announced and then paused a change to how the Agent
  SDK bills against subscription plans (June 2026). Nothing in this repository can compensate for
  such a change: expect the route to need re-approval, or to fail, if billing or OAuth policy moves.
  The sanctioned alternative is Pi's built-in `anthropic` provider with an API key.

## How the gate admits a bridged model

The model gate resolves patterns on a `ModelRuntime` it creates before the session exists, and an
extension registers its provider only when the session binds its extensions. So a bridged model
always resolves `no-match` there. With the flag on, the host names `claude-bridge` as an *extension
provider*: the gate admits the model **provisionally**, the session is created on the same runtime,
and the host re-resolves the pattern on the live session before the first turn. If the provider did
not register, the session is disposed and the dispatch is refused with `model_unavailable`. A
registered-but-unauthenticated provider still fails the gate's auth half — the carve-out covers only
the provider that is not there yet.
