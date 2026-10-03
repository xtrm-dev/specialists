# REPORT — SPECIALISTS-4217: idle per-session specialists MCP server CPU

**Base commit:** `0102a1bd0161cc90a785923cf9dfdf8dca541ed4` (`origin/master`, `release: add v4.0.2 release notes`)
**Branch:** `xt/specialists-mcp-idle` (worktree `.xtrm/worktrees/specialists-xt-pi-specialists-mcp-idle`)
**Host:** shared Mercury production host, all measurements `nice -n 19`, never more than 2 extra MCP instances, no heavy work 20:00–23:00Z
**Runtime:** bun 1.3.14 (`/home/dawid/.bun/bin/bun`, unmodified since 2026-05-13)

---

## 1. Headline

| Question | Answer |
|---|---|
| Is there an always-on loop in the MCP server? | **No.** No timer in the MCP path is armed when no activation and no tool call is live. The three leads in the contract are disproven below (evidence, not argument). |
| Then what burns 0.60 core on 15 instances? | **Per-call cost of `specialist_status`, multiplied by the coordinator's poll rate.** One compact poll cost **85.8 ms of CPU**; agents poll at 0.8–3.3 calls/s. |
| What changed? | The compact path no longer rebuilds the whole specialist registry (24 specs × 4 config layers) and no longer forks `git rev-parse` on a call that never shows the result: **85.8 ms → 25.0 ms per call (−71 %)**. |
| Idle cost, before and after | **0.47 → 0.50 CPU-s per 300 s idle** (0.0016 → 0.0017 core). Unchanged, within noise: there was no idle loop to remove. The contract's bound is ≤ 1.5 CPU-s and master already met it. |
| Activation-notification latency | Unchanged. No timer, poll interval or wakeup path was touched; the push rides the forensic stream. Bound stays what it was: delivered in-band with the settling activation's terminal event. |

---

## 2. The three leads are not the cause (each disproven)

| Lead | Verdict | Evidence |
|---|---|---|
| `src/activation/peer-bridge.ts:51` `DEFAULT_POLL_INTERVAL_MS = 500` | **Never armed when idle** | `watchForReply()` is called only from the `deliver` hook, and only for `kind === 'question' \|\| 'escalation'` (peer-bridge.ts:107-113). An idle server has delivered nothing, so it holds no watcher. Each watcher also self-expires at `DEFAULT_REPLY_TIMEOUT_MS` = 1 h. |
| `src/specialist/supervisor.ts:604, :632` `setInterval(run, intervalMs)` | **Not in the MCP server process at all** | Both lines live inside `watchdogScript`, a string evaluated by a **detached child** that `spawnWatchdog()` launches per job (supervisor.ts:640-652). The MCP path never calls `spawnWatchdog`; it spawns nothing. |
| `src/activation/native-host.ts:2150` tool-duration interval | **Never armed when idle** | `noteToolStart()` returns early unless the activation is `starting`/`running`, and the timer is cleared by `noteToolEnd()`/`stopToolDurationWatch()`. With no live activation there is no watch. |

Direct confirmation: a freshly spawned server, handshaked, then left completely idle for 300 s, accumulates **0.47 CPU-s** — i.e. 0.0016 core, not 0.04.

Live-instance inspection agrees with the code. Every running instance on this host was read through `/proc` (read-only; no session was touched):

```
11 live instances, 10 s window:  0.501 core total   (matches host-load REPORT §3.4: 15 instances / 0.60 core)
per instance: 0.026 – 0.093 core
```

---

## 3. What the 0.60 core actually is

### 3.1 The cost is per call, and the callers poll in a loop

Per-instance CPU correlates with the call rate recorded in each repo's own `observability.db` (`specialist_forensic_events`, `event_family = 'mcp'`):

| Repo | `mcp.call.*` events, last 5 min | Live instances | CPU/instance |
|---|---|---|---|
| market-data | 998 (≈ 3.3 calls/s) | 5 | 0.026 – 0.093 core |
| platform | 633 (≈ 2.1 calls/s) | 2 | 0.044 – 0.048 core |
| infra | 496 (≈ 1.7 calls/s) | 1 | 0.032 – 0.041 core |

The workload is `specialist_status` — e.g. the `market-data-xt-claude-matview-retire` session was issuing **2.7 calls/s** at measurement time (`jsonrpc_request_id` 7140 and climbing). A coordinator waiting on an activation polls; each poll is charged to the server process.

### 3.2 One poll cost 85.8 ms — CPU profile

`bun --cpu-prof --cpu-prof-md`, 44 polls in 45 s (`/tmp/prof-calls.cpuprofile.md`, 35 s sampled):

| Self | Function | What it is |
|---:|---|---|
| 17.6 % (6.19 s) | `parse` (zod `_parse`, dist:2872, **25.8 % total**) | Re-parsing every specialist spec |
| 4.6 % (1.61 s) | `spawnSync` | `git rev-parse --git-common-dir` per call |
| 2.6 % / 2.4 % / 1.4 % | `readFileSync` / `existsSync` / `lstatSync` | Config-layer sweeps |
| 0.9 % (5.8 % total) | `buildMergedSpec` (dist:12388) | 4-layer merge, per specialist |

`src/tools/specialist/specialist_status.tool.ts` computed three things **before** the `input.full === true` branch:

1. `await loader.list()` — walks every scan dir and calls `buildMergedSpec(name)` for all 24 specialists (`loader.ts:459-497`). `get()` has a per-name cache; **`list()` never consults it**.
2. `projectOutstandingAsks(process.cwd())`
3. `projectUncertainWorkspaces(leaseScopeFor(process.cwd()))` — `leaseScopeFor` → `resolveCommonGitRoot` → `spawnSync('git', …)` (`job-root.ts:17-28`)

The compact payload returns only `{ activations, pending_asks }`. **All three results were computed and discarded** on every poll.

### 3.3 The fix

`src/tools/specialist/specialist_status.tool.ts` — the three reads moved inside the `full: true` branch that is their only consumer. Compact output is byte-identical, verbose output is byte-identical, tool names, schemas and the plugin manifest are untouched.

### 3.4 Before / after (same host, same harness, `nice -n 19`)

Idle cost — `tests/perf/measure-mcp-idle.mjs`, 300 s idle after handshake, same host, same cwd, `nice -n 19`:

| | CPU-s / 300 s | cores | RSS avg | RSS final |
|---|---:|---:|---:|---:|
| before (`0102a1bd`) | **0.47** | 0.0016 | 80.2 MB | 78.6 MB |
| after | **0.50** | 0.0017 | 82.1 MB | 80.1 MB |

The two are the same number within sampling noise (0.47 vs 0.50 CPU-s; per-10 s samples are 0.00–0.08 CPU-s throughout, i.e. no burst anywhere in the window). **Master already satisfied the idle bound before this change, and still does — at about a third of the 1.5 CPU-s limit.** Reporting that plainly matters more than claiming a win: it is the reason the fix targets the poll path instead of a timer.

Per-call cost — one `tools/call` per second, same repo state (`infra-xt-claude-2rz8`):

| Call | before | after |
|---|---:|---:|
| `specialist_status` (compact, the poll) | **85.8 ms** | **24.7 ms** |
| `specialist_status` in a cwd with no `observability.db` | — | 25.0 ms |
| `specialist_stop_activation` on an unknown id | — | 22.8 ms |
| `tools/list` (no tool handler runs at all) | — | 21.0 ms |

The last three rows are the floor: **~21–23 ms per request is the `@modelcontextprotocol/server` request path** and is independent of which tool runs (and of the forensic store — the row with no `observability.db` costs the same). The specialists-attributable share of a poll falls from **~63 ms to ~2–4 ms (−96 %)**.

---

## 4. Validation

1. **Idle-cost script, before and after on the same host** — `tests/perf/measure-mcp-idle.mjs`; see §3.4. After = 0.50 CPU-s / 300 s, bound ≤ 1.5 CPU-s: **met** (and met before the change too).
2. **Unit tests for the touched modules** (`bun --bun vitest run`):
   - `tests/unit/specialist/activation-mcp-tools.test.ts` — 26 passed (includes the new `reads the registry only for full:true`, which fails against the pre-fix file — verified by stashing the fix)
   - `tests/unit/mcp/v2-server.test.ts` — dual-revision handshake, `tools/list`, compact status over a real stdio server
   - `tests/unit/specialist/specialist-list.test.ts`
   - `tests/unit/specialist/activation-async-events.test.ts`, `tests/unit/specialist/activation-wake-equivalence.test.ts`, `tests/unit/mcp/v2-resume.test.ts` — the completion-push / channel path
   - `bun run lint` (`tsc --noEmit`) — clean
3. **MCP smoke** against a real server spawned through the plugin entry (`plugins/specialists/scripts/mcp-server.mjs`):
   - `tools/list` → the 7 tools, unchanged order
   - `specialist_list` → 28 specialists
   - `specialist_status` compact → `{activations, pending_asks}`; `full:true` → `loaded_count, activations, pending_asks, activation_results, pending_interactions, uncertain_workspaces, backends_health`
   - `specialist_dispatch` without a locator → clean `status: rejected` payload, no throw
   - **Channel notification:** the diff does not touch the push path (`v2-server.ts` channel wiring, `RuntimeEventPusher`, `withChannelPush` are untouched) and the suites above cover it (17 tests). A live notification needs a dispatch that reaches `settle()`, which spawns a model-backed activation; that was not run here because it falls outside the stated measurement budget on a saturated host. Not claimed as live-verified.

---

## 5. Activation-notification latency

Unchanged, and the bound is unchanged: the completion push rides the forensic stream of the settling activation (no poll), so latency is the same event-ordering bound as before the change — sub-second in practice, and the fix removes work *before* the handler runs, so the handler itself starts marginally earlier. Worst case is unchanged at the stream's own delivery latency; no new timer, backoff or wakeup was introduced, so the "not worse by more than 1 s" constraint is satisfied by construction.

---

## 6. Shared-MCP-server option (recorded, not taken)

**Option:** one MCP server per host instead of per session.

**Estimate, per the contract's instruction to record it rather than decide it:**

- **Memory:** the dominant per-instance cost. 15 instances × ~95 MB RSS ≈ 1.4 GB today (matches REPORT §3.4's 1.43 GB). One shared server ≈ 95 MB + per-session state → **~1.3 GB saved**, if session state stays small.
- **CPU:** the floor only. With this fix, a poll costs ~25 ms and ~21 ms of that is the SDK request path, which a shared server pays **once per request** instead of once per request per instance — no saving there, because the work is already per-request, not per-instance. The real CPU win of sharing would come from the ~2–4 ms of per-session registry state and from deduplicating identical polls across sessions (e.g. 5 market-data sessions polling the same repo at 2.7 Hz each): a coalescing cache keyed by repo could collapse ~13 calls/s into ~3.3. That is a **second change**, not this one.
- **Cost:** cross-session isolation. `buildV2Server` binds one `FleetRegistry` and one `NativeActivationHost` per instance; the module comment says that continuity is per-coordinator by design (a dispatch in one turn and its `specialist_reply` in the next must see the same registry). Sharing means keying that state by coordinator, plus a single point of failure for every session's activations — and on this host that failure mode is the one MMD-2235 already pays for.
- **Verdict:** worth revisiting **after** the per-call cost is the only remaining term. It does not remove the dominant cost measured here.

---

## 7. Reproduce

```bash
bun install && bun run build
# idle: 300 s, handshake then silence
nice -n 19 node tests/perf/measure-mcp-idle.mjs --idle-ms 300000
# per-call: one poll per second
nice -n 19 node tests/perf/measure-mcp-idle.mjs --idle-ms 60000 --call-rate 1000
# against a production-shaped repo
nice -n 19 node tests/perf/measure-mcp-idle.mjs --idle-ms 60000 --call-rate 1000 \
  --server-cwd /home/dawid/projects/mercury/infra/.xtrm/worktrees/infra-xt-claude-2rz8
# profile
nice -n 19 node tests/perf/measure-mcp-idle.mjs --idle-ms 45000 --call-rate 1000 --cpu-profile /tmp/prof.md
node tests/perf/summarize-cpuprofile.mjs /tmp/prof.md   # or read the .md profile bun writes
```

## 8. Notes on method

- Prod attribution was taken read-only from `/proc` (`stat`, `io`, `fd`, `fdinfo`, `cwd`, `syscall`) of already-running servers. No session, plugin config or tmux server was touched; no instance was stopped.
- The 1 Hz `timerfd` visible in the live instances is **not** the cause: it fires once per second, which cannot account for 40 ms/s, and a fresh master server with identical load shows no such cost.
- `observability.db-wal` in the market-data repo is 1.46 GB and the db is 3.86 GB — WAL growth under the write volume seen in §3.1 is a separate observation, out of scope here, worth its own issue.
