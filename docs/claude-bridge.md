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

Two independent switches must both be on. The definition selects the route for one Specialist; the
operator grants it for the machine. **The definition flag alone is never enough**, because a
repository can write the definition layer — a repo-shipped `.specialists/user/<name>.json`, a
repo-defined specialist name that becomes the merge base, or a repo layer that is a symlink into
the home layer. Nothing inside a repository can write the operator switch.

1. Operator, once per machine — `~/.config/specialists/user.json` (or `$XDG_CONFIG_HOME`):

   ```json
   { "claude_bridge": { "enabled": true } }
   ```

2. Definition, per Specialist (in your own layer, never in a shipped definition):

   ```json
   { "specialist": { "execution": { "claude_bridge": true, "model": "claude-bridge/claude-sonnet-5-5" } } }
   ```

   ```bash
   sb specialist override <name> execution.claude_bridge=true
   ```

Requirements:

1. the bridge package installed into **Pi's own package store** as the user scope:

   ```bash
   pi install npm:pi-claude-bridge@0.12.0
   ```

   Pi writes it to `<agentDir>/npm/node_modules/pi-claude-bridge`, where `agentDir` is
   `PI_CODING_AGENT_DIR` or `~/.pi/agent`. The resolver searches that store first and then the
   npm/bun global prefixes; it never searches project scope (`<cwd>/.pi/npm`), so a repository
   cannot supply this extension. `SPECIALISTS_CLAUDE_BRIDGE_PATH=/abs/path/to/entry` names an entry
   directly for a source checkout (absolute only), and the refusal note lists every path searched;
2. Claude Code logged in as the operator (`claude auth login`; `claude auth status` to check) — the
   agent never logs in and never reads credentials;
3. a model whose provider is `claude-bridge`. Do not use `anthropic/...` for this route: that is
   Pi's own API-key provider and does not go through Claude Code.

Either switch off: the extension is not loaded, and a dispatch whose primary model is
`claude-bridge/...` is refused with `model_unavailable` **before any session exists** — it is never
walked to another provider, because a run on a model the definition did not ask for is not
attributable. The note names which switch is off. So the package need not be installed at all, and a
repo-selected flag changes nothing. The one exception is a `claude-bridge/...` pattern that the gate
itself accepts: that happens only when the operator's own `~/.pi/agent/models.json` defines a
provider named `claude-bridge`, in which case the run uses that endpoint and not Claude Code.
Both on with the package missing: the dispatch is refused with
`claude_bridge_unavailable` rather than quietly running on another provider, and the note lists the
paths searched. Both on, but the
extension fails to register its provider on the live session: the session is disposed and the
dispatch is refused with `model_unavailable`.

### The trust boundary (stated, not enforced)

The switch is exactly as trustworthy as the environment of the process that reads it: `HOME` and
`XDG_CONFIG_HOME` decide **which** `user.json` is read. A process whose `XDG_CONFIG_HOME` points
into a repository would read that repository's file, and a repository cannot set the environment of
the operator's own process — so this is still not a repository-controlled route. It becomes one only
if the operator, a wrapper script or a service unit hands a checkout control of those variables. Do
not start the host with `HOME`/`XDG_CONFIG_HOME` inherited from untrusted content, and treat the
switch as an operator consent record, not as a sandbox boundary.

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
