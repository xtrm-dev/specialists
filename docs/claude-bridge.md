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

One operator surface selects the route: the reserved `claude_bridge` block in
`~/.config/specialists/user.json` (or `$XDG_CONFIG_HOME/specialists/user.json`). The block asks for
consent once, names every Specialist that may use the route, and may name a bridge model per
Specialist. There is no per-Specialist `~/.specialists/user/<name>.specialist.json` copy to keep, and
no wildcard: consent names a Specialist.

```json
{
  "claude_bridge": {
    "enabled": true,
    "default_model": "claude-bridge/claude-sonnet-5-5",
    "specialists": ["advisor", "reviewer", "explorer"],
    "models": { "advisor": "claude-bridge/claude-opus-5-5" }
  }
}
```

| Key | Meaning | Default |
| --- | --- | --- |
| `enabled` | machine consent for the route; `false` disables it for every Specialist | `false` |
| `default_model` | bridge model for a listed Specialist with no entry in `models` | absent |
| `specialists` | the allow list. Explicit kebab-case Specialist names, no wildcard | absent (legacy) |
| `models` | per-name bridge model; wins over `default_model` | absent |

The CLI writes the block, so it never has to be hand-edited:

```bash
sp edit --global claude_bridge.enabled true
sp edit --global claude_bridge.default_model claude-bridge/claude-sonnet-5-5
sp edit --global claude_bridge.specialists '["advisor","reviewer","explorer"]'
sp edit --global claude_bridge.models.advisor claude-bridge/claude-opus-5-5
```

`sp init --global` preserves the block: it is machine configuration, not a Specialist entry, and it
is never reported as a removed Specialist. Every model in the block must be a `claude-bridge/...`
id; `anthropic/...` is Pi's own API-key provider and does not go through Claude Code.

### How the block resolves

The block is applied **after every other layer** (package canonical, `user.json`, the home layer,
the repository layer) and is authoritative **both ways** for exactly two fields:
`execution.claude_bridge` and `execution.model`. One exported resolver in the loader produces the
decision, and every runtime reads the merged spec, so the native host (dispatch and retry), `sp run`,
`sp script`, `sp list`, `sp view` and session start cannot disagree.

For Specialist `N`:

1. `enabled !== true`: no injection, the route is off for every Specialist.
2. `specialists` absent: **legacy rule** — the merged definition flag decides and the machine
   switch is the gate. Nothing changes for an existing home-layer setup; `sp doctor` reports this
   shape as legacy once an allow list exists.
3. `specialists` present (including `[]`): the list is authoritative both ways. A listed `N` gets
   `execution.claude_bridge = true` and `execution.model = models[N] ?? default_model`; an unlisted
   `N` gets `execution.claude_bridge = false` even when a home or repository layer set it.
4. A listed `N` that resolves no `claude-bridge/...` model is **invalid input**: the schema refuses
   the block at write time and `sp doctor` reports it for a hand-edited file. At dispatch the run is
   **refused** with `claude_bridge_route_model_mismatch` — naming the Specialist, the resolved model
   and the block — never admitted and then billed to another provider.
5. When the block changes a value a lower layer set, the loader records a provenance warning that
   `sp doctor` and the loader's stderr line show, so an operator sees that the selection shadowed a
   layer rather than silently observing a different model.
6. An explicit `--model` override keeps its meaning: it replaces the candidate chain for that run.
   It does not grant the route.

This precedence exception is the point: a repository can write `execution.claude_bridge` and
`execution.model` (both are override-allowed), and it can ship a Specialist whose definition becomes
the merge base. Consent for a subscription-billed route is not repository content, so the operator
block wins for the two fields it names, and a repository layer can neither enable the route nor
redirect a listed Specialist.

`fallback_models` is not rewritten. A bridged primary already suppresses the walk (see the no-fallback rule
later in this section), so a fallback on a listed Specialist is inert; `sp doctor` warns and suggests removing it.

`sp doctor` reports each shape it can see: legacy without an allow list; a listed Specialist whose
block resolves no bridged model; a definition flag on an unlisted Specialist; a bridged primary with
fallbacks; a malformed block (through the same reader the route decision uses); and a per-Specialist
`execution.claude_bridge` entry the allow list now owns.

### The legacy definition flag

`execution.claude_bridge: true` in a definition is still read when the block carries no allow list,
and it is the documented way to keep an existing home-layer setup during a rollout. Keep it out of
shipped definitions, and prefer the allow list: a per-Specialist entry in `~/.specialists/user/`
that the list supersedes is redundant surface, which `sp doctor` reports as such.

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

### Where the extension is resolved from

The host resolves the bridge itself; the operator does not pass `-e`. Search order:

1. `SPECIALISTS_CLAUDE_BRIDGE_PATH`, when set. Absolute only — a relative value would be resolved
   against whatever directory the dispatch happens to run in.
2. Pi's own package store, user scope: `<agentDir>/npm/node_modules/pi-claude-bridge`, where
   `agentDir` is `PI_CODING_AGENT_DIR` (with `~` and `~/` expanded) or `~/.pi/agent`. This is where
   `pi install npm:pi-claude-bridge@0.12.0` writes, so the documented install needs no environment
   variable.
3. npm/bun global prefixes: `PI_NPM_GLOBAL_DIR`, `NPM_CONFIG_PREFIX` / `npm_config_prefix`
   (+ `lib/node_modules`), `NVM_BIN` (+ sibling `lib/node_modules`), `BUN_INSTALL`
   (`install/global/node_modules`), `~/.bun/install/global/node_modules`, the running interpreter's
   own `<prefix>/lib/node_modules`, and `~/.nvm/versions/node/<version>/lib/node_modules`.
   Roots that do not exist are skipped; only the ones that exist are candidates.

Every root must be absolute; a relative one (`BUN_INSTALL=.`) is dropped and reported once, because
it would let a checkout supply the extension. `SPECIALISTS_CLAUDE_BRIDGE_PATH` is **exclusive**: when
it is set but not an absolute existing entry, resolution returns nothing and does not fall through to
the stores, so a typo there looks like "not installed" rather than silently using a different copy. **Project scope is never searched** (`<cwd>/.pi/npm`,
`<cwd>/.pi/agent/npm`, `<cwd>/node_modules`). A candidate counts as the bridge only when it has both
a `package.json` and a loadable entry (`src/index.ts` for the published package, which ships neither
`main` nor `exports`); a half-finished install therefore falls through to the next store instead of
shadowing a working one.

Route off — `enabled: false`, an allow list that does not name the Specialist, or (in the legacy
shape) a definition flag that is not `true`: the extension is not loaded, and a dispatch whose
primary model is `claude-bridge/...` is refused with `model_unavailable` **before any session
exists** — it is never walked to another provider, because a run on a model the definition did not
ask for is not attributable. The note names the switch that is off, including the allow list and the
Specialist it does not name. So the package need not be installed at all, and a repo-selected flag
changes nothing. The one exception is a `claude-bridge/...` pattern that the gate
itself accepts: that happens only when the operator's own `~/.pi/agent/models.json` defines a
provider named `claude-bridge`, in which case the run uses that endpoint and not Claude Code.
Route on with the package missing: the dispatch is refused with `claude_bridge_unavailable` rather
than quietly running on another provider, and the note lists the paths searched. Route on, but the
extension fails to register its provider on the live session: the session is disposed and the
dispatch is refused with `model_unavailable`. A listed Specialist whose block cannot supply a
`claude-bridge/...` model is refused earlier still, with `claude_bridge_route_model_mismatch`.

**The refusal holds for the whole run, not only at admission.** If an admitted bridged primary fails
mid-run — a subscription rate limit, a timeout, a transient error, a closed session — the activation
ends `failed` on that model and `fallback_models` is **not** walked, because the next model would
bill a different surface and answer a question the definition did not ask. The `model_fallback`
event records `terminal: true`, `skipped: true`, the cause, and `not_started_model` for the model
that was never started, so a durable row or a feed line cannot read as a hop. Non-bridged primaries
keep today's fallback behaviour, including the retryable classes (`rate_limit`, `timeout`,
`transient`). The rule is about the walk, not the provider: a bridged primary is not walked even to a
second `claude-bridge/...` model. All three walk paths enforce it through one shared predicate
(`isBridgedModel`): the native host, the legacy `sp run` runner, and the script runner behind
`sp script` / `runScriptSpecialist` (whose candidates include `options.fallbackModel` as a separate
route). The two Pi-session runtimes emit the same payload through `bridgedFallbackSkipEvent`; the
script runner writes the same fields onto its `model_change` row, and only when a next candidate
exists.

### The trust boundary (stated, not enforced)

The block — `enabled` plus the allow list — is exactly as trustworthy as the environment of the
process that reads it: `HOME` and `XDG_CONFIG_HOME` decide **which** `user.json` is read. A process whose `XDG_CONFIG_HOME` points
into a repository would read that repository's file, and a repository cannot set the environment of
the operator's own process — so this is still not a repository-controlled route. It becomes one only
if the operator, a wrapper script or a service unit hands a checkout control of those variables. Do
not start the host with `HOME`/`XDG_CONFIG_HOME` inherited from untrusted content, and treat the
block as an operator consent record, not as a sandbox boundary. The allow list is what makes the
consent specific: a repository can write `execution.claude_bridge` and a repository-defined name
can become the merge base, but a name does not enter the list unless the operator writes it.

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

## Operating it

- **The bridge speaks for Claude Code, not for Pi.** Claude Code runs with no tools of its own
  (`tools: []`, `bypassPermissions`); tool calls come back to Pi over a local MCP bridge, which is
  why tiers and the READ_ONLY bubblewrap guard still apply. Steering reaches the model at the next
  tool boundary, and bash calls gain Claude Code's 120-second default timeout where Pi would have
  none.
- **Session history is per Pi session.** The bridge keeps its own session pointers under
  `<agentDir>/claude-bridge/sessions/`. Its README states that running the same Pi session in two
  bridge processes is unsupported, and that its integration tests need write access to `~/.claude`
  for `--resume` — both are the bridge's own statements, quoted, not guarantees we enforce.
  Observed in our runs, not guaranteed by any contract: one Claude Code child per query and no queue
  or lock, so N concurrent activations mean N children. Treat the route as one or two sequential
  runs, not a fan-out backend.
- **Inherited Anthropic variables win.** An exported `ANTHROPIC_BASE_URL`, `ANTHROPIC_API_KEY` or
  `ANTHROPIC_AUTH_TOKEN` redirects the Claude Code child and every turn fails with its auth error
  (upstream issue #107). Unset them for the host process.
- **Usage arrives as provider usage.** A bridged run reports `usage_source: provider_usage` in
  `specialist_job_metrics` because the provider payload carries usage, which the host normalises
  (`asProviderUsage` in `src/specialist/session-metrics-contract.ts`). The host does not read the
  bridge's `anthropic-ratelimit-unified-*` headers, so no quota display comes from them here.
- **This repository runs `dist/`.** `sp`, the `specialists` MCP server and the Pi extension execute
  the built bundle, so a source change to the route reaches a running host only after `dist/` is
  rebuilt and the checkout pulled.

## Troubleshooting

`claude_bridge_unavailable` is emitted only when **both** switches are on and the extension lookup
then fails; a route that is merely off never produces it (it refuses with `model_unavailable`). The
refusal note names `SPECIALISTS_CLAUDE_BRIDGE_PATH`, the install command, the store it lands in, and
lists every path searched. The common
causes are a bridge installed into a project directory (never searched), a `pi install` that landed
in a different `agentDir`, or a relative `SPECIALISTS_CLAUDE_BRIDGE_PATH`.

`model_unavailable` with "No models match pattern" means the route is off on this machine, or the
model id is not in the bridge's catalogue. Run `pi --list-models` with the extension loaded to see
the exact ids; a dated snapshot id (for example `claude-sonnet-4-5-20250929`) is not listed.

`model_unavailable` with "did not register" means the extension loaded but its provider never bound
to the session; the session is disposed rather than allowed to run on the gate's placeholder.

## How the gate admits a bridged model

The model gate resolves patterns on a `ModelRuntime` it creates before the session exists, and an
extension registers its provider only when the session binds its extensions. So a bridged model
always resolves `no-match` there. With the flag on, the host names `claude-bridge` as an *extension
provider*: the gate admits the model **provisionally**, the session is created on the same runtime,
and the host re-resolves the pattern on the live session before the first turn. If the provider did
not register, the session is disposed and the dispatch is refused with `model_unavailable`. A
registered-but-unauthenticated provider still fails the gate's auth half — the carve-out covers only
the provider that is not there yet.
