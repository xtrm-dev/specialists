# Claude Code as a Specialists backend — pi-claude-bridge spike (SPECIALISTS-4403)

> **Historical record.** This is the spike as it was written on 2026-11-08, before the operator's
> ruling and before the integration landed. The current enablement is **two switches** (the
> definition selector plus the operator switch in `~/.config/specialists/user.json`), not the
> definition flag alone — see [claude-bridge.md](./claude-bridge.md). The probe scripts named below
> are not shipped in this repository; they were scratch files on the spike branch `xt/o9c0`.
> Kept verbatim otherwise, because the measurements are the evidence for the integration.

Date: 2026-11-08. Status: **stopped at the terms question (Q4) for the operator's ruling.** No
authenticated run was performed, so no subscription quota was spent and no Claude session was
opened. Everything below is either a local run or a cited primary source.

Environment used for every run: throwaway worktree on `xt/o9c0`, scratch `HOME=/tmp/spike-4403/home`
with its own `PI_CODING_AGENT_DIR` and `CLAUDE_CONFIG_DIR` (Claude Code created an empty config there
and no credentials), `pi` 1.4.0, Claude Code CLI 2.1.319, `bwrap` present. The bridge was cloned to
`/tmp/spike-4403/src/bridge` (`elidickinson/pi-claude-bridge`, MIT, v0.12.6, 195 stars) and its
`npm install` completed (`@anthropic-ai/claude-agent-sdk` 0.3.308, `engines.node >= 20.19.0`).

## Q1 — end-to-end specialist run through the host

Not performed. Two independent reasons, in order:

1. **Terms (Q4) are not clear enough to spend the operator's quota.** The Issue says to stop there.
2. **A native dispatch cannot name a bridged model today.** The gate that admits every native
   activation builds its own `ModelRuntime` and asks it to resolve the model:

   - `src/activation/native-host.ts:1631` — `const modelRuntime = await createGateModelRuntime(sdk)`
   - `src/activation/model-gate.ts:57` — `ModelRuntime.create({ allowModelNetwork: false })`
   - Pi registers an extension's provider on that **session's** runtime
     (`dist/core/extensions/loader.js` `pendingProviderRegistrations` → `bindCore`), not on a
     process-global registry, so a standalone `ModelRuntime` never sees `claude-bridge`.

   Run (scratch HOME, `ANTHROPIC_API_KEY=spike-dummy-not-a-secret`, no network):

   ```
   {"pattern":"claude-bridge/claude-opus-5-5","ok":false,"reason":"No models match pattern \"claude-bridge/claude-opus-5-5\"","diagnostics":["no-match"]}
   {"pattern":"anthropic/claude-sonnet-4-5","ok":true,"provider":"anthropic","diagnostics":[]}
   ```

   The control case proves the runtime itself is fine and the refusal is about the provider, not
   about auth. The same bridge checked out alongside does register its fourteen models on the real
   Pi path:

   ```
   $ HOME=<scratch> pi --no-extensions -e /tmp/spike-4403/src/bridge/src/index.ts --list-models
   claude-bridge  claude-opus-5-5    1M    128K   yes  yes
   claude-bridge  claude-sonnet-5-5  1M    128K   yes  yes
   … (14 rows)
   ```

So the blocker is one function: the gate's model runtime must learn the bridged provider (see Q6).

## Q2 — who executes the tools? Answered with runs: Pi does, under the guard.

Evidence from the bridge source:

- `src/index.ts` builds `queryOptions` with `tools: []` and `permissionMode: "bypassPermissions"` —
  Claude Code runs with **no tools of its own**. All tools are offered over an in-process MCP server
  (`buildMcpServers`, `src/mcp-server.ts`).
- The MCP `tools/call` handler does not execute anything: it records the request and waits for Pi's
  result, then answers Claude Code (`src/mcp-server.ts:158` pairs `_meta["claudecode/toolUseId"]`).
  The bridge's own comment: *"Since pi executes tools (not CC), those are pure token overhead"*
  (`src/index.ts`, `--strict-mcp-config` block).
- Consequences that only hold if Pi executes: `pi.on("tool_call")` handlers fire, so the bridge
  monkey-patches `event.input.timeout` there (`src/index.ts` `tool_call` handler, "the execution
  copy pi hands tool_call handlers").

Local run (`docs/spike-4403/claude-bridge-tool-exec-probe.mjs`, real `createAgentSession`, real
bridge provider, real Pi tool loop, Claude Code query replaced by a fake stream — no network, no
login, no quota):

| mode | active tools | `tool_call` handler saw | bash result | marker on host fs |
|---|---|---|---|---|
| no guard | `["bash"]` | `bash` | `isError:false`, `PWD=/home/dawid/dev/specialists` | `bash-noguard.txt` written |
| guard, `PI_SPECIALIST_PERMISSION_TIER=READ_ONLY` | `["bash"]` | `bash` | `isError:false`, `/tmp/.../bash-guard.txt: No such file or directory` → `write refused` | absent |

The second row is the guard working exactly as designed on the Claude backend: bash runs inside the
bubblewrap sandbox (private `/tmp`, read-only `/`), the write never reaches the host, and the model
still gets a tool result. Tool tiers therefore bind unchanged, because the tool path is Pi's.

Incidental defect found, unrelated to the bridge: the guard's `--chdir <cwd>` fails when the
workspace lives under `/tmp` (the sandbox's `/tmp` is a fresh tmpfs), and bash then does not start
at all. A `/tmp` worktree plus a READ_ONLY tier is broken today.

## Q3 — remote work-item path: unchanged.

`src/activation/workitem-remote.ts` (SPECIALISTS-4398 / XTRM-693) supplies the same `WorkItemPorts`
over Substrate's typed service; it contains no model, provider or session reference of any kind. The
backend choice sits strictly downstream of claim/readiness/settlement, so a bridged model cannot
change it. (Native dispatch would still be refused by the gate of Q1 before that path is entered.)
Verified by reading the module and grepping it for `model|provider`: no hits.

## Q4 — terms: billing is clear, permission is not.

Primary sources:

1. Anthropic, *Use the Claude Agent SDK with your Claude plan*
   <https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan>
   (updated 2026-10-07): "when you're signed in with your Claude plan, the Claude Agent SDK and
   `claude -p` still draw from your subscription limits." The 2026-06-15 note records that the
   announced billing change was "paused … nothing has changed: Claude Agent SDK, `claude -p`, and
   third-party app usage still draw from your subscription limits."
2. Anthropic, *Claude Code — Legal and compliance*
   <https://code.claude.com/docs/en/legal-and-compliance>:
   - "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Ultra,
     Team, and Enterprise subscription plans and is designed to support ordinary use of Claude Code
     **and other native Anthropic applications**."
   - "Developers building products or services that interact with Claude's capabilities, **including
     those using the Agent SDK, should use API key authentication** through Claude Console or a
     supported cloud provider."
   - "Anthropic does not permit third-party developers to offer Claude.ai login into their own
     applications, or to route requests through Free, Pro, Max, or Ultra plan credentials on behalf
     of their users."
   - "Nor does it prevent **an end user from signing in to the unmodified Claude Code binary with
     their own Claude subscription**."
   - "Advertised usage limits for Pro, Max, and Ultra plans assume ordinary, individual usage of
     Claude Code and the Agent SDK."
3. Anthropic Consumer Terms §3 <https://www.anthropic.com/legal/consumer-terms>: prohibited to
   "access the Services through automated or non-human means, whether through a bot, script, or
   otherwise", "except when you are accessing our Services via an Anthropic API Key or where we
   otherwise explicitly permit it."

Plain reading: **billing** — a bridged turn spends the operator's subscription quota exactly like
Claude Code; nothing is free, and an API key is not required. **Permission** — the docs sanction
"ordinary use of Claude Code and other native Anthropic applications" and tell SDK *developers* to
use API keys, while explicitly not preventing an end user from signing in to the unmodified binary
with their own subscription. Pi is not a native Anthropic application, and a Specialists fleet is a
harness, not Claude Code.

Verdict: **unclear for a fleet or third-party deployment. Plausibly covered for a single operator,
on their own machine, with their own login, using the unmodified binary.** That is the operator's
call, not the agent's. If the sanctioned route is wanted instead, the bridge also works on an
`ANTHROPIC_API_KEY` — but then it buys nothing over Pi's built-in `anthropic` provider, which is
simpler and explicitly sanctioned.

## Q5 — cost, latency, failure modes

- Cost: charges land on the subscription, not a per-token bill; the bridge reconstructs Claude
  Code's unified rate-limit headers from `rate_limit_event` (`src/rate-limit.ts`) so Pi's
  `after_provider_response` consumers see usage windows like a built-in provider. Token counts are
  Claude Code's, so the observability row would record `provider_usage` rather than an estimate.
- Latency: every turn spawns/reuses a Claude Code process through the SDK; expect process overhead
  and a full Claude Code system preset in the prompt on top of Pi's own.
- Missing or expired login, observed (scratch HOME, no credentials):

  ```
  $ pi … --model claude-bridge/claude-haiku-4-5 -p "Reply with exactly: OK"
  EXIT=1
  stderr: Not logged in · Please run /login
  ```

  i.e. it fails fast and legibly at the first turn. On the native host that surfaces as a failed
  activation; the message is the actionable part for the operator.
- Mid-run expiry: each turn is a fresh query, and CC reports API failures as `is_error` on an
  otherwise success-shaped result (`src/cc-child.ts:97` `resultErrorText`), which the bridge turns
  into a turn error. So an expiring login fails the in-flight turn and the job settles as failed;
  re-login then resume. Inferred from the code path, **not** observed live (no credentials used).
- Cancellation: Pi's abort reaches the bridge; `tests/unit-continuation-abort.mjs` pins that an
  abort ends a parked query and closes it. The host's stop/abort path is unchanged.
- Quota exhaustion: CC emits `rate_limit_event` (status/reset/overage), surfaced as headers; the
  turn itself fails with CC's error text.
- Operational couplings worth naming: `~/.claude/settings.json` hooks fire inside bridged turns
  (repo-level `.claude` settings do not), and the bridge needs write access to the Claude config dir
  for `--resume`.

## Q6 — recommendation: **adopt behind a flag, conditional on the Q4 ruling**

Reasons for: tools stay Pi's (Q2, run-proven), so the permission guard, the tool contract and the
lease are unchanged; the remote work-item path is untouched (Q3); the integration is one extension
plus one gate change; the bridge is a single-purpose MIT extension already tracking Pi 1.4.x.

Reasons against, in order of weight: the subscription route is not explicitly sanctioned (Q4), and
Anthropic has already announced and then paused a change to exactly this billing path — a durability
risk no integration can fix; the native gate must be taught about the provider; and the bridge is a
third-party dependency on the credential-holding path.

Smallest integration, if the operator rules the route acceptable:

1. **Gate (blocker).** Make `validateModelAvailable` aware of extension-registered providers. Two
   shapes: pass the session's `ModelRuntime` into the gate, or let the host construct the gate
   runtime and register the bridge's provider config on it before resolving. The second also fixes
   retries and `model_override` (`native-host.ts:3167`, `:3314`), which call the gate again.
2. **Flag.** `specialist.execution.claude_bridge: true` (or an `execution.extensions` source plus a
   provider-neutral gate), mapped to `resolveCuratedExtensionPaths` so both the native loader and the
   legacy argv see it. Note the legacy route changes tool enforcement: any extension source swaps
   `--tools` for `--no-builtin-tools` + the tool-policy extension (`src/pi/session.ts:1279`,
   `applyExtensionToolPolicyGate`), so a spike on that route does not test the production surface.
3. **Definition.** A read-only specialist with `model: "claude-bridge/claude-sonnet-5-5"`.
4. **Proof run.** One explorer activation on a real Issue, recording job id, telemetry row and the
   tool-call log; one READ_ONLY write refusal on the same backend.
5. **Docs.** Amend `docs/pi-session.md` (it still describes the legacy subprocess only) with the
   provider, the credential owner, and the login-expiry behaviour.

Follow-up Issue should be drafted only after the operator's Q4 ruling; it must carry the residual
risks (billing change re-announced, hooks from `~/.claude`, config-dir write requirement) in
CONSTRAINTS, and the gate change in SCOPE.

## Reproducing the runs

Scratch only; nothing in this repo, the operator's `~/.pi`, `~/.claude` or the server was modified.

The probe sources are not in this repository (scratch files on `xt/o9c0`); the commands record what
was run and in which mode, not a runnable harness.

```bash
# provider registration on pi 1.4.0
HOME=<scratch> pi --no-extensions -e <bridge>/src/index.ts --list-models

# gate refusal (control: an authed built-in provider resolves)
HOME=<scratch> ANTHROPIC_API_KEY=<dummy> bun gate-probe.ts

# tool execution and guard binding (fake Claude Code query, no quota)
cd <bridge> && HOME=<scratch> PI_SPECIALIST_PERMISSION_TIER=READ_ONLY \
  node --import tsx claude-bridge-tool-exec-probe.mjs guard
```
