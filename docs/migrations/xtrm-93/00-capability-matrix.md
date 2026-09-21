# XTRM-93 — Canonical Capability Matrix

> **Status: DRAFT — coordinator merge in progress.**
> Lane artifacts (`01`–`10`, `gitnexus-*.md`, `*-delta.md`, `migration-dag.md`) are the
> evidence sources. This file is the single merged truth: one row per **capability**, not
> per file, symbol, or command. A command may produce several rows; a row may span
> several commands.

---

## 0. Verified baseline

Do not treat any earlier narrative as more current than this section. All facts below were
re-derived from source on the migration worktree.

| Fact | Value | How verified |
|---|---|---|
| Migration worktree | `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh` | `pwd` |
| Upstream master at audit time | `472b1aef` — `test(parity): stop calling the contract quote a mechanical tie (#373)` | `git log -1 origin/master` after `git fetch --all --prune` |
| Worktree HEAD at audit time | `6553ef05` = `472b1aef` + local commit `rx1bu` (`fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch`) | `git rev-parse HEAD`, `git log --oneline` |
| Local `master` divergence | Local `master` was at `34d2ba79` (`9ceccac9` + `rx1bu`), i.e. **4 commits behind** `origin/master` and **1 commit ahead** of the merge base. `34d2ba79` is not an ancestor of `origin/master`. | `git merge-base --is-ancestor`, `git log origin/master..34d2ba79` |
| GitNexus index used for this audit | Worktree path indexed at `6553ef05`, `gitnexus status` = `✅ up-to-date` | `gitnexus analyze --index-only --skip-agents-md --skip-skills` |
| Package version | `@jaggerxtrm/specialists@3.21.6`, `bin: specialists`/`sp` → `dist/index.js` | `package.json` |
| Source size | 193 TS files under `src/`, ~69.8k lines | `find src -name '*.ts' \| wc -l` |

### Prompt-claim verification

| Claim in the XTRM-93 brief | Verdict | Evidence |
|---|---|---|
| "master recently reached `472b1aef`" | **CONFIRMED** | `origin/master` = `472b1aef` |
| "PR #372 landed cross-process exactly-once settlement publication" | **CONFIRMED, but not on local `master`** | `c33b8e1b` merge of `07ecb683`; adds `src/activation/settlement-lease.ts`, rewrites `src/activation/settlement-publication.ts`, adds `tests/unit/specialist/settlement-exclusion.test.ts`. Absent from local `34d2ba79`. |
| "PR #373 closed the latest parity-guard overclaim" | **CONFIRMED** | `472b1aef`; touches `tests/unit/specialist/execution-profile-parity.test.ts` |
| "Native Specialists + Substrate is already the primary execution architecture" | **PARTIALLY CONFIRMED — see counterexamples** | `src/mcp/v2-server.ts:52` constructs `NativeActivationHost`; `src/index.ts:1462` starts MCP v2 when no subcommand is given; `src/lib.ts:41` exports it. **But** `src/tools/specialist/steer_specialist.tool.ts:31`, `stop_specialist.tool.ts:17`, `resume_specialist.tool.ts:38` still construct the legacy `Supervisor`, and `sp run` has **no** native path at all. |
| "The legacy CLI backend still uses the older RPC/Supervisor/job execution stack" | **CONFIRMED** | `src/cli/run.ts:1894` → `src/specialist/launch.ts:64,71` → `SpecialistRunner` + `Supervisor` |
| "XTRM-93 tracks replacing that backend with the native execution core" | **NOT FOUND IN THIS REPO'S TRACKER** | `bd search "XTRM-93"` → "No issues found". XTRM-93 appears in no file in the repo. Coordinator created `unitAI-t9iyp` to carry this audit. External tracker reference unverified. |
| "XTRM-92 documentation vNext is intentionally delayed" | **UNVERIFIED** | No `XTRM-92` reference in the repo. |

### Structural facts that constrain the whole migration

1. **There is no native gate on `sp run`.** No flag, env var, or branch selects the native
   host from the CLI. `sp run` unconditionally reaches `launchSpecialist` → legacy
   `Supervisor`. Migration therefore means **adding a boundary**, not flipping a switch.
2. **The frontends are already split.** The Claude/MCP frontend (`plugins/specialists/.mcp.json`
   → `dist/index.js` with no subcommand → `src/mcp/v2-server.ts` → `NativeActivationHost`)
   is native. The CLI frontend is legacy. The same published binary serves both.
3. **One shared public API surface.** `package.json` `exports["./lib"]` → `dist/lib.js`,
   and `src/lib.ts` exports **both** legacy symbols (`SpecialistLoader`, `resolveModelChain`,
   `validateBeforeRun`, `evaluateBeadReadiness`, `createBeadFromContract`) and native symbols
   (`NativeActivationHost`, `RuntimeEventPusher`, `toActivationView`, activation types).
   This is a compatibility surface with no test coverage implied by its name alone.
4. **A precedent for retirement exists in-tree.** `sp release` (`src/index.ts:1467`) already
   deprecates itself in favour of `xt release` and forwards with `spawnSync`, exiting with
   the child's status. This is the shape the migration can reuse for `FRONTEND_ONLY` moves.

---

## 1. Vocabulary (closed enums)

### Migration action — exactly one per capability

| Value | Meaning |
|---|---|
| `PRESERVE_NATIVE` | Behaviour survives with a native implementation; legacy implementation is retired. |
| `FRONTEND_ONLY` | The user-facing surface stays; it becomes a thin frontend over the shared service boundary. |
| `MOVE_TO_CORE` | The behaviour is a Core (`xt`) session/worktree-topology concern and moves there. |
| `REUSE_EXISTING_NATIVE` | A native capability already exists and is adopted unchanged. |
| `INTENTIONAL_RETIREMENT` | Deliberately removed. **Requires an explicit product decision, cited.** |
| `DEAD_AFTER_CUTOVER` | No supported consumer remains. **Requires positive proof of no consumer.** |

### Status — exactly one per capability

`PARITY` · `ADAPTER_NEEDED` · `NATIVE_GAP` · `OWNERSHIP_MOVE` · `INTENTIONAL_DIFFERENCE` · `UNKNOWN`

**GO is forbidden while any row is `UNKNOWN`.**
**Every `NATIVE_GAP` becomes an implementation item before cutover.**

### Capability ID ranges

| Range | Area | Primary lane |
|---|---|---|
| `CAP-CLI-###` | CLI command + argv/output/exit-code surface | A |
| `CAP-EXEC-###` | Launch, admission, prompt/skills/rules/extensions/tools/model/scripts, session creation, run state | B |
| `CAP-CTL-###` | Control verbs: steer, resume, retry, stop, answer, finalize, follow-up | B, G |
| `CAP-TEL-###` | Telemetry, events, forensics, metrics, projections, query surfaces | C |
| `CAP-ID-###` | Durable state, identity, recovery, reaping | D |
| `CAP-GIT-###` | Worktree, branch/base pinning, diff/review evidence, merge/publication | E |
| `CAP-CFG-###` | Specialist schema, global config, user.json, mandatory-rules, renderers | F |
| `CAP-SEC-###` | Secondary execution surfaces: script, serve, chat, console, node, pipeline, MCP tools | G |
| `CAP-DEL-###` | Deletion / dead-code candidates (recorded as rows only where they carry behaviour) | H |
| `CAP-FE-###` | Frontends: `sp` CLI, Pi plugin, Claude plugin/MCP, library surface | G, I |

---

## 2. Required columns

Every row uses exactly these columns:

| # | Column | Content rule |
|---|---|---|
| 1 | `ID` | From the ranges above. |
| 2 | `user-visible behavior` | What an operator/script observes, in one sentence. Not a file name. |
| 3 | `CLI/API surface` | Exact command + flags, or exact API/tool name. |
| 4 | `legacy implementation` | `file:line` of the owning code. |
| 5 | `legacy durable state` | Paths / DB tables / rows written. |
| 6 | `legacy telemetry` | Signals emitted (`CAP-TEL-###` cross-refs allowed). |
| 7 | `native equivalent` | `file:line`, or `NONE`. |
| 8 | `semantic delta` | Only real divergences. `none` is a claim that must be evidenced. |
| 9 | `target owner` | `Specialists-native` / `Specialists-CLI` / `Core` / `frontend` / `retired`. |
| 10 | `migration action` | Enum from §1. |
| 11 | `compatibility risk` | `LOW`/`MEDIUM`/`HIGH`/`CRITICAL` + one-line why. |
| 12 | `required differential test` | Scenario id from `10-differential-acceptance-corpus.md`, or `NEW`. |
| 13 | `deletion candidates` | `CAP-DEL-###` / file paths unlocked by this row. |
| 14 | `status` | Enum from §1. |

---

## 3. Capability rows

### 3.0 Merge decisions (read before using the table)

1. **Detail is not duplicated; it is cross-referenced.** `CAP-CLI-###` argv/output/exit-code
   contracts are authored in `01-cli-surface.md` (47 rows × 16 columns). `CAP-TEL-###` signal
   contracts are authored in `03-telemetry-observability.md` (108 rows, `CAP-TEL-001..108`).
   This table is the **capability roll-up** that carries the merged decision columns. Where a
   `CAP-TEL-###` block is summarised here, the roll-up status is the **worst** status in its block.
2. **A capability is a behaviour, not a file.** Several commands map to one capability, and one
   command can span several.
3. **`status` is the merge gate.** A row is `PARITY` only when a native path exists and the lane
   evidence says the semantics match. `ADAPTER_NEEDED` means the native primitive exists but the
   surface does not. `NATIVE_GAP` means no native equivalent. `UNKNOWN` blocks GO.
4. **`UNKNOWN` in this table is reserved for capability status.** Open questions that do not decide a
   capability's status are collected in §7 and do **not** by themselves block GO — except where they
   are the sole evidence for a `DEAD_AFTER_CUTOVER` or `INTENTIONAL_RETIREMENT` action, in which
   case §7 marks them as gate-blocking.

### 3.1 CLI surface capabilities

| ID | user-visible behavior | CLI/API surface | legacy implementation | legacy durable state | legacy telemetry | native equivalent | semantic delta | target owner | migration action | compatibility risk | required differential test | deletion candidates | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAP-CLI-001 | Run a Specialist to completion in the foreground, streaming output | `sp run <name> --prompt/--bead` | `cli/run.ts:1654` → `specialist/launch.ts:64,71` | `jobs/<id>/{status,result,events}` | `run_start`, `run_complete` | `NativeActivationHost.start` (`native-host.ts:506`) — **no CLI path exists** | native is always async-return; no streaming foreground surface | Specialists-CLI | ADAPTER_NEEDED | **CRITICAL** — the primary verb | DX-EXEC-001, DX-CLI-001 | `cli/run.ts` (blocked) | NATIVE_GAP |
| CAP-CLI-002 | Detached background dispatch with one launch line | `sp run --background` | `cli/run.ts:1724-1877` | `jobs/latest` | `specialists.background_launch.v1` | none — host is in-process | no native background mechanism | Core | MOVE_TO_CORE | **HIGH** — tmux/agent-pane dispatch form | DX-CLI-002 | none yet | NATIVE_GAP |
| CAP-CLI-003 | Ask a specialist a quick question in chat | `sp chat` | `cli/chat.ts:3,158` | `jobs/**` | run_* | `NativeActivationHost.start` | chat is a streaming UX; native has no streaming frontend | Specialists-CLI | FRONTEND_ONLY | MEDIUM | DX-CLI-004 | `cli/chat*` | ADAPTER_NEEDED |
| CAP-CLI-004 | Watch live job activity | `sp console`, `sp status`, `sp ps` | `cli/{console,status,ps}`; `console/runtime.ts:958-981` | `jobs/**`, `observability.db` | read-side | Fleet registry (`activation/registry.ts`) — **in-process only** | native state is unreadable cross-process; the `ps` native block is read from the shared forensic DB by identity, but its enumeration is **row-bounded and can starve older activations** (CAP-TEL-057..064 residual, `unitAI-kmbb9`) | Specialists-CLI | FRONTEND_ONLY | HIGH | DX-TEL-005, DX-TEL-013 | none | ADAPTER_NEEDED |
| CAP-CLI-005 | Read a job's result | `sp result <job-id>` | `cli/result.ts:342-367` | `jobs/<id>/result.txt`, `specialist_results` | — | `specialist_results` row is written natively (`forensic-sink.ts:219-236`) | **BROKEN for native ids** — `result.ts:93-98` splits on `:`; `act:` ids unreachable | Specialists-CLI | PRESERVE_NATIVE | **CRITICAL** — live defect | DX-ID-001 | none | NATIVE_GAP |
| CAP-CLI-006 | Stream/stream-back job events | `sp feed`, `sp log`, `sp forensic` | `cli/{feed,log,forensic}` | `observability.db` (**dual-path**) | read-side | same store, same vocabulary | last-known only for native (`feed.ts:489-524` labels it) | Specialists-CLI | FRONTEND_ONLY | MEDIUM | DX-TEL-001/002 | none | PARITY |
| CAP-CLI-007 | Prometheus metrics + text exposition | `sp metrics` | `cli/metrics.ts:1` → `prometheus-projection.ts` | `observability.db` | 19 metric families | none | 49 `NATIVE_GAP` telemetry rows; 6 families have no producer at all | Specialists-CLI | PRESERVE_NATIVE | HIGH | DX-TEL-010 | none | NATIVE_GAP |
| CAP-CLI-008 | Mid-run control: steer | `sp steer <job-id> <msg>` | `cli/steer.ts:21`, `specialist/control.ts` | FIFO + `control_signal` rows | `steer_*` | **no native steer method exists** | `retry` error text tells operators to steer (`native-host.ts:1886-1889`) | Specialists-CLI | PRESERVE_NATIVE | **CRITICAL** — blocker B3 | DX-CTL-002 | none | NATIVE_GAP |
| CAP-CLI-009 | Resume a parked job | `sp resume <job-id>` | `cli/resume.ts:21` | FIFO | `resume_consumed` | `NativeActivationHost.resume` (`:2245`) | native advances `attemptId`; legacy keeps `job_id`+FIFO; native accepts more states | Specialists-CLI | REUSE_EXISTING_NATIVE | MEDIUM | DX-CTL-003 | none | ADAPTER_NEEDED |
| CAP-CLI-010 | Retry a failed/cancelled job | `sp retry <job-id>` | `cli/retry.ts:85` | `jobs/**` | — | `NativeActivationHost.retry` (`:1879`) | native retries only `failed`, in place, same activation; legacy mints a **new job id** and also accepts `cancelled` | Specialists-CLI | REUSE_EXISTING_NATIVE | HIGH | DX-CTL-004 | none | ADAPTER_NEEDED |
| CAP-CLI-011 | Stop a running job | `sp stop <job-id>` | `cli/stop.ts`, `control.ts` | terminal status + SIGTERM/KILL | `stop_*` | `NativeActivationHost.stop` (`:2191`) | native has no `cancelled` result and **drops the row** (no terminal result) | Specialists-CLI | PRESERVE_NATIVE | HIGH | DX-CTL-007 | none | NATIVE_GAP |
| CAP-CLI-012 | Chain reviewer-PASS cascade | `sp finalize <job-id>` | `cli/finalize.ts`, `control.ts:201-253` | `jobs/**` | `finalize_*` | none — no chain concept natively | no native keep-alive chain | Specialists-CLI | PRESERVE_NATIVE | HIGH | UNCOMPARABLE | none | NATIVE_GAP |
| CAP-CLI-013 | Multi-agent node orchestration | `sp node <sub>...` | `cli/node.ts` → `NodeSupervisor` → `JobControl` → `Supervisor` (**7 sites**) | `node_runs/members/events/memory` | `node_*` | none | distinct orchestration runtime **built on** the legacy engine | Core | MOVE_TO_CORE | HIGH | DX-SEC-001 (UNCOMPARABLE) | `node-*` (after replacement) | NATIVE_GAP |
| CAP-CLI-014 | Epic lifecycle (readiness, sync, merge, abandon) | `sp epic <sub>` | `cli/epic.ts`, `specialist/epic-*.ts` | `epic` state, `chain-identity.ts` | `epic_*` | Substrate `parent_child` edges only | native has no `epic_runs`, no chain id, no PASS cascade | Specialists-CLI | PRESERVE_NATIVE | HIGH | DX-EXEC-011 | `epic-*.ts` (blocked) | NATIVE_GAP |
| CAP-CLI-015 | Merge/end: integration + PR | `sp merge`, `sp end` | `cli/{merge,end}.ts` | `branch_integration_events` | `branch_integration_*` | none | `sp end` branch regex `/^feature\/(unitAI-[^-]+)-/i` cannot match native `xt/<slug>`; `sp merge` is declared broken in-tree | Core | OWNERSHIP_MOVE | HIGH | DX-GIT-002 | none | OWNERSHIP_MOVE |
| CAP-CLI-016 | Published cross-repo integration surface | `sp integration record\|list --json` | `cli/integration.ts` | `branch_integration_events` | — | none | `docs/cli-reference.md:1637-1643` declares it a **published write surface** for `xtrm.branch.integration.v1`, consumed by `xtrm-tools core` | Specialists-CLI | KEEP_COMPAT (PRESERVE_NATIVE) | **CRITICAL** — byte-compat | DX-TEL-016 | none | ADAPTER_NEEDED |
| CAP-CLI-017 | Script-class one-shot run (cron) | `sp script`, exit codes 0-7/75 | `cli/script.ts:104-118` → `script-runner.ts` (**engine 3**) | `obs.db` traces | script traces | none in `src/activation/**` | independent runtime; only the `SupervisorStatus` **type** is shared | Specialists-native (ops) | PRESERVE_NATIVE | **HIGH** — external consumer (darth-feedor) | DX-SEC-002 (EXIT-CODE-only) | none | NATIVE_GAP |
| CAP-CLI-018 | HTTP generation service | `sp serve`: `POST /v1/generate`, `GET /healthz` | `cli/serve.ts:306,341` → engine 3 | `obs.db` | — | none | same runtime as CAP-CLI-017 | Specialists-native (ops) | PRESERVE_NATIVE | HIGH | DX-SEC-002 | none | NATIVE_GAP |
| CAP-CLI-019 | Specialist discovery/config authoring | `sp list`, `view`, `models`, `edit`, `config`, `init`, `setup`, `list-rules`, `validate`, `db` | `cli/*` | config layers, `~/.config/specialists/user.json` | — | same loader/schema | native resolves the same 3-layer merge | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-CLI-005 | 84 schema deletions (post-cutover) | PARITY |
| CAP-CLI-020 | Install health diagnostics | `sp doctor` | `cli/doctor.ts` | — | `lifecycle.dead_declared` | none | **default run always exits 0** (`docs/cli-reference.md:1191`); Substrate probe is advisory-only and becomes wrong at cutover | Specialists-native (ops) | PRESERVE_NATIVE | HIGH | DX-CLI-003 | none | ADAPTER_NEEDED |
| CAP-CLI-021 | Core-boundary render envelopes | `sp render-task`, `render-bead`, `render-skill-prefix`, `launch-outcome` | `cli/render-*.ts`, `launch-outcome.ts` | — | — | `contractToMarkdown` (`native-host.ts:2345`) | shared renderers on both paths | Core | MOVE_TO_CORE | HIGH — published envelopes | DX-CLI-005 | none | OWNERSHIP_MOVE |
| CAP-CLI-022 | Release | `sp release` | `cli/index.ts:1467` → `spawnSync('xt', …)` | — | — | n/a | already a deprecated alias forwarding to `xt release` | Core | FRONTEND_ONLY | LOW | none | — | INTENTIONAL_DIFFERENCE |

### 3.2 Execution, control, telemetry, identity, git, config, secondary, frontend

| ID | user-visible behavior | CLI/API surface | legacy implementation | legacy durable state | legacy telemetry | native equivalent | semantic delta | target owner | migration action | compatibility risk | required differential test | deletion candidates | status |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| CAP-EXEC-001 | Admit a dispatch (specialist→workspace→work gate→tools→model→lease→contract→session) | `sp run` / `specialist_dispatch` | `supervisor.ts:1559-1647` | `observability.db`, `status.json` | timeline | admission order `native-host.ts:506+` | native refuses **before** a session exists and leaves forensics; legacy claims by bead+specialist and `--force-job` bypasses | Specialists-native | REUSE_EXISTING_NATIVE | MEDIUM | DX-EXEC-005 | none | ADAPTER_NEEDED |
| CAP-EXEC-002 | Prompt composition (task + system + skills + mandatory rules) | both | `runner.ts:1160-1279` | rendered prompt in prompt cache | `memory_injection` | `renderTaskPrompt`/`buildSystemPrompt` (`native-host.ts:959-1057`) | native passes Substrate epic lineage instead of Beads context; **Beads doctrine leaks into the native prompt (see §6)** | Specialists-native | PRESERVE_NATIVE | HIGH | DX-EXEC-008 | 22 schema lines | ADAPTER_NEEDED |
| CAP-EXEC-003 | Extension/tool surface resolution and verification | both | `pi/session.ts:1114-1163` | `resolved_tool_contract` | extension/tool events | `native-host.ts:1118-1232` | native fails closed on a missing promised tool; legacy cannot detect it; non-local sources differ | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-EXEC-009 | none | PARITY |
| CAP-EXEC-004 | Model chain, override, fallback, thinking | `sp run --model/--thinking` | `runner.ts:1086-1091`, `model-chain.ts` | `status.json` | `model_change`, `model_fallback` | `native-host.ts:819-859` | native probes availability and skips unavailable primaries; `model_fallback` telemetry maps to `model.changed` with full diagnostics (C-4 CLOSED: `nat-obs:390-405`) | Specialists-native | PRESERVE_NATIVE | HIGH | DX-EXEC-010 | none | ADAPTER_NEEDED |
| CAP-EXEC-005 | Scripts: pre/post phases, required, inject_output | `specialist.scripts` | `runner.ts`/`script-runner.ts` | `status.json` | script events | pre-phase only (`native-host.ts`) | **native has no post-phase producer** | Specialists-native | PRESERVE_NATIVE | HIGH | DX-EXEC-011 (UNCOMPARABLE) | none | NATIVE_GAP |
| CAP-EXEC-006 | Output schema validation | `output_schema` | `runner.ts` | `result` | `output_validation_*` | `native-host.ts` validation | legacy warns; native is fail-closed | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-EXEC-021 | 22 schema lines | PARITY |
| CAP-EXEC-007 | Keep-alive / waiting park | `--keep-alive`, `--no-keep-alive`, `interactive` | `supervisor.ts:1613-1626` | durable `waiting` | `status_change(waiting)` | native parks at `settled`; **`waiting` is declared but never produced** | opt-in vs always-on | Specialists-native | PRESERVE_NATIVE | HIGH | DX-CTL-008 (UNCOMPARABLE) | none | NATIVE_GAP |
| CAP-EXEC-008 | Stall detection and stale-waiting auto-close | `stall_detection`, `waiting_auto_close_ms` | `supervisor.ts:108,1363-1374,2119-2171` | `stale_warning` rows | `stale_warning` ×4 reasons | **none** | no native watchdog at all | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-TEL-011 (UNCOMPARABLE) | `stall_detection` (5 leaves) | NATIVE_GAP |
| CAP-EXEC-009 | Crash recovery / orphan reconciliation | crash | `supervisor.ts:1336-1425`, `dead-job-audit.ts` | self-heal on next read | `lifecycle.dead_declared` | **none** | native has no activation reconciler; `auditDeadJobs` SQL requires `pid IS NOT NULL` and native never writes a pid | Specialists-native | PRESERVE_NATIVE | **HIGH** | NEW | `dead-job-audit.ts` (blocked) | NATIVE_GAP |
| CAP-CTL-001 | Answer a mid-run question from the coordinator | `specialist_reply`, `specialist_answer` | **none** (native-only) | interaction files | `clarification_*` | `NativeActivationHost.answer` (`:2008`) | native-only capability | Specialists-native | REUSE_EXISTING_NATIVE | LOW | DX-CTL-010 (UNCOMPARABLE) | none | PARITY |
| CAP-CTL-002 | Inspect live Fleet state | `specialist_status` | none | in-process | — | `inspect`/`liveStats`/`list` (`:2137,2145,2182`) | in-process only; lost on host restart → `unknown_activation` | Specialists-native | REUSE_EXISTING_NATIVE | MEDIUM | DX-ID-013 | none | PARITY |
| CAP-TEL-001..008 | Job/turn/message/tool timeline signals | `sp feed/log/forensic` | supervisor/runner emit | `observability.db` | — | shared writer + mapper | **one store, one vocabulary**; 53 rows PARITY | Specialists-native | REUSE_EXISTING_NATIVE | LOW | DX-TEL-001/002 | none | PARITY |
| CAP-TEL-009..020 | Settlement publication / degradation / recovery telemetry | — | `settlement-publication.ts:271-679` (19 emits, 10 names) | **none** | — | mapper has **no case** → `return null` | **zero durable rows**; degradation is stderr-only | Specialists-native | PRESERVE_NATIVE | **HIGH** | DX-ID-011 | none | NATIVE_GAP |
| CAP-TEL-021..028 | Counting semantics (turns, tool calls, tokens, elapsed) | `sp metrics` | legacy counters | `specialist_job_metrics` | 19 families | native counters | **10 count-semantics divergences** (D-1..D-10) incl. per-turn vs session-cumulative tokens; `total_turns` is per-message natively | Specialists-native | PRESERVE_NATIVE | **HIGH** | DX-TEL-003, DX-TEL-006 | none | ADAPTER_NEEDED |
| CAP-TEL-029..034 | Context-window accounting | `sp console` context health | `statusOf` | `context_pct`, `context_trajectory_json` | `xtrm_context_usage_ratio` | native never sets `context_pct` | metric empty for every native activation | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-TEL-004 | none | NATIVE_GAP |
| CAP-TEL-035..040 | Identity/lineage correlation (trace/span/parent/chain) | — | legacy rows | `trace_id`, `span_id`, `chain_id` | chain metrics | native carries **none** | `xtrm_chains_total` label degrades to `"chain"` | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-TEL-014 (UNCOMPARABLE) | none | NATIVE_GAP |
| CAP-TEL-041..048 | Forensic event vocabulary (producers vs classifier-only) | `sp forensic` | sink classifier | `specialist_forensic_events` | — | partial | 6 classified names have no producer (matches open bead `unitAI-rrdnt.38`); 6 metric families have no producer at all | Specialists-native | PRESERVE_NATIVE | MEDIUM | NEW | none | NATIVE_GAP |
| CAP-TEL-049..056 | Retention / pruning policy | `sp clean`, `sp db` | `pruneObservabilityData` | asymmetric: prunes `specialist_events` only | — | none | forensic/metrics/branch tables never pruned | Specialists-native | PRESERVE_NATIVE | MEDIUM | NEW | none | ADAPTER_NEEDED |
| CAP-TEL-057..064 | `sp ps` native activation projection | `sp ps` | `ps.ts:747` reads `eventFamily:'activation'` → **replaced** by `jobIdPrefix:'act:'` + `order:'desc'` (XTRM-93 N2B, `4fbc4a30`) | — | — | **no writer** for `event_family='activation'` (deleted by `febef0ad`) — correctly **no longer read** | stale family no longer read; native rows are found in the **shared** families by `job_id = 'act:<uuid>'` | Specialists-CLI | FRONTEND_ONLY | HIGH | DX-TEL-013 | `native-activation-summary.ts` (**landed** `4fbc4a30`, review-fixed `6113a710`) | **NATIVE_GAP (RESIDUAL — do NOT read as resolved)** — see the row-cap residual below |

**N2B residual — `sp ps` native enumeration is row-bounded, not activation-bounded (keeps this row a `NATIVE_GAP`).**
The landed N2B fixes are correct and were independent defects: the retired-family read was replaced by an identity
prefix, `order:'desc'` was restored, `job.status_changed` is now payload-aware (`waiting` no longer flattens to
`settled`), failure names no longer map to `active`, and the counts are labelled as window counts. **Those fixes do
not bound the enumeration defect.** `ps.ts:749` still passes a global `limit: 1000`, and that limit applies to raw
event **rows**, not to activation ids, so:

| Measure (real shared DB, `<git-common-root>/.specialists/db/observability.db`) | Value |
|---|---|
| distinct activations inside the global `ORDER BY t DESC, seq DESC, id DESC LIMIT 1000` window | **1** (`act:9aeabf76-262`, 1000 rows) |
| distinct `act:` ids that actually have rows | **249** |
| rows in just the newest 3 activations | 1591 + 765 + 2006 = **4362** |

`latest 1000 events != latest N activations`, and a high-event activation crowds others out entirely. The decisive
evidence that this is row-density rather than data: the **same command returned 3 activations earlier in this session
and 1 now**. An operator cannot distinguish a quiet system from a hidden one. Tracked as **`unitAI-kmbb9`** (P1);
the correct fix is an activation-oriented projection whose limit applies to activation ids (newest N by `MAX(t)`,
then each activation's own window). XTRM-93 reconciliation chose **option B**: defect left open, capability **not**
recorded as parity. |
| CAP-ID-001 | Job identity survives the cutover | `sp result/feed/ps/stop/...` | `[0-9a-f]{6}` (`supervisor.ts:1437`) | `jobs/<id>/**` | `job_id` column | `act:[0-9a-f]{12}` + `att:…:N` (`native-host.ts:507-508`) | **disjoint by construction; no alias, no resolver exists**; `types.ts:19-20`'s "maps to job_id" is a comment, not a mechanism | Specialists-native | ADAPTER_NEEDED | **CRITICAL** | DX-ID-001 | none | NATIVE_GAP |
| CAP-ID-002 | Attempt identity (retry/resume continuity) | `sp retry/resume` | none — legacy retry mints a new job | — | `attempt_no` (0 for legacy rows) | `attemptId`, advances in place (`registry.ts:81-88`) | no legacy counterpart; `attempt_no=0` must never be aggregated as identity | Specialists-native | PRESERVE_NATIVE | HIGH | DX-ID-004 | none | ADAPTER_NEEDED |
| CAP-ID-003 | Durable store anchoring | all | git common root (`job-root.ts:34-37`) | `.specialists/jobs` | — | `process.cwd()` (`native-host.ts:494`) | **three stores, two anchors** (corrected): jobs + `observability.db` are both base-root/shared (`observability-db.ts:80-94`, or `$XDG_DATA_HOME/specialists/`), settlements are per-worktree. Native forensic rows and native settlement state therefore land in **different stores**; see consequence #7 | Specialists-native | PRESERVE_NATIVE | HIGH | DX-ID-011 | none | ADAPTER_NEEDED |
| CAP-ID-004 | Settlement exactly-once + Journal result + provenance | `check_and_publish`, Substrate tools | none | `.specialists/settlements/**` | settlement_* | `settlement-publication.ts`/`-store.ts`/`-lease.ts` (PR #372) | native-only; Journal attempt attribution is envelope-only (unattributed entries defer forever) | Specialists-native | REUSE_EXISTING_NATIVE | MEDIUM | DX-ID-011 | none | PARITY |
| CAP-ID-005 | Dead-job reaping / GC / TTL | `sp clean`, `sp doctor --reap-dead-jobs` | `clean.ts`, `worktree-gc.ts`, `dead-job-audit.ts` | `jobs/**`, `ready/` | `lifecycle.dead_declared` | none — native stores have **no GC/TTL** | `.specialists/ready/` is documented in 2 places and read by **nobody in `src/`** | Specialists-native | PRESERVE_NATIVE | MEDIUM | NEW | `worktree-gc.ts` (blocked) | NATIVE_GAP |
| CAP-ID-006 | Worktree-lease as writer exclusion | `worktree.lease` | none (bead+specialist collision refusal) | — | lease_* | `workspace-lease.ts` | native-only; **lease ≠ worktree isolation** (single-writer over a shared tree) | Specialists-native | REUSE_EXISTING_NATIVE | MEDIUM | DX-ID-007 | none | PARITY |
| CAP-GIT-001 | Worktree provisioning / branch naming / base pin | `sp run --worktree/--base-sha/--base-ref` | `cli/run.ts:432-851`, `worktree.ts` | `worktree_path`, `base_sha_pinned` | `pr_*` | **none** — native runs **in place**, pins no base, no branch | native produces **no diff evidence and no base pin** | Core | MOVE_TO_CORE | HIGH | DX-GIT-002 | `worktree.ts` (blocked) | OWNERSHIP_MOVE |
| CAP-GIT-002 | Reviewer diff/test evidence + line-citation verification | `reviewer --job <id>` | `git-diff-evidence.ts`, `citation-evidence.ts` | evidence bundle | `review_verdict_*` | **none** (no `git` in `src/activation/`) | native reviewer has **no `reviewed_job_id`** while the shipped reviewer contract declares it required | Specialists-native | PRESERVE_NATIVE | HIGH | DX-EXEC-030 | none | NATIVE_GAP |
| CAP-GIT-003 | Auto-commit and zero-commit result handling | `auto_commit` | `runner.ts`/`supervisor.ts` | `auto_commit_*` | `auto_commit_*` events | none | no native producer | Core | MOVE_TO_CORE | MEDIUM | DX-GIT-002 (UNCOMPARABLE) | `auto_commit` field | NATIVE_GAP |
| CAP-GIT-004 | PR creation and PR-drift observation | `sp run --pr`, `doctor --pr-drift` | `merge.ts:1072`, `pr-drift-refresh.ts` | `pr_url`, `pr_base_*` | — | `pr_*` "recorded by xt" per `obs:1319` | two producers today (`sp merge` and `xt`) | Core | OWNERSHIP_MOVE | MEDIUM | NEW | none | OWNERSHIP_MOVE |
| CAP-CFG-001 | Specialist definition schema + 3-layer merge | `config/specialists/*.json`, `.specialists/user/` | `schema.ts`, `loader.ts` | config layers | — | same loader | **`.specialists/default/` retired for definitions by `31a6421c`** but still documented as tier 2 | Specialists-native | PRESERVE_NATIVE | MEDIUM | DX-CLI-005 | 22 schema lines, 13 config fields | ADAPTER_NEEDED |
| CAP-CFG-002 | Global user config (`~/.config/specialists/user.json`) | `sp edit --global`, `sp setup` | `global-config.ts` | 38 live entries | — | same resolver | `extensions.serena` accepted-but-ignored (31/38 carry it); 4 native-ignored fields emit no diagnostic | Specialists-native | PRESERVE_NATIVE | MEDIUM | NEW | 11 key families | ADAPTER_NEEDED |
| CAP-CFG-003 | Mandatory rules injection | `mandatory_rules`, `config/mandatory-rules/**` | `mandatory-rules.ts` | 4-tier index | `mandatory_rules_injection` | reached from native (`native-host.ts:1042`) | **native fails closed; legacy warns** — intentional tightening; **and Beads doctrine is injected natively (§6)** | Specialists-native | PRESERVE_NATIVE | **HIGH** | DX-EXEC-008 | 15 sets clean, 8 leak | NATIVE_GAP |
| CAP-CFG-004 | Retired/inert config fields | `execution.mode`, `prompt.script_template`, `validation.stale_threshold_ms`, `communication` | `schema.ts` | 24/24 configs set `execution.mode` | — | none | `execution.mode` has **zero consumers ever** | retired | DEAD_AFTER_CUTOVER | LOW | none | 6 stale fields | DEAD_AFTER_CUTOVER |
| CAP-SEC-001 | Python/native SDK library surface | `@jaggerxtrm/specialists/lib` | `src/lib.ts` exports legacy+native | — | — | — | one published entrypoint exports **both** stacks; `verifyExactLineCitation` has no in-repo caller | Specialists-native | PRESERVE_NATIVE | HIGH | NEW | none | ADAPTER_NEEDED |
| CAP-SEC-002 | MCP tool surface (Claude plugin) | `specialist_dispatch/reply/stop_activation/retry/status/list` | legacy tools **unregistered** | — | — | `mcp/v2-server.ts` native tools | `specialist_retry` is registered **only in dead `src/server.ts`**; 3 legacy tool files are dead code | Specialists-native | REUSE_EXISTING_NATIVE | HIGH | DX-EXEC-026 | `*_specialist.tool.ts`, `src/server.ts` | NATIVE_GAP |
| CAP-SEC-003 | Pi extension frontend | `config/pi-extensions/specialist-subagents/index.mjs:362` | — | — | — | `NativeActivationHost` | native frontend | Specialists-native | REUSE_EXISTING_NATIVE | LOW | NEW | none | PARITY |
| CAP-FE-001 | `sp` CLI UX preserved over a new backend | all `sp` verbs | `src/index.ts` dispatch (47 tokens) | — | — | — | the CLI is the surface to keep; the backend behind it changes | Specialists-CLI | FRONTEND_ONLY | **CRITICAL** | DX-CLI-001..005 | none | ADAPTER_NEEDED |
| CAP-FE-002 | Committed build artifact | `dist/index.js`, `dist/lib.js` | 397 tracked files | — | — | same files | CI enforces `git diff --exit-code -- dist/`; **deleting source without rebuilding still ships the legacy engine** | Specialists-native | PRESERVE_NATIVE | HIGH | DX-CLI-005 | none | ADAPTER_NEEDED |

---

## 4. Lane verification ledger

The coordinator independently re-derived each lane's load-bearing claims from source before
merging them. A lane artifact is not mergeable until its row here is `VERIFIED`.

| Lane | Artifact(s) | Citation check | Coordinator findings | Verdict |
|---|---|---|---|---|
| A | `01-cli-surface.md` | 47 command rows; 503 citations resolved; 5 defects | All 5 corrected in place, with a provenance table appended to the artifact. Two further flags were verifier false positives (`~/.config/…` paths where a naive regex strips `~/.`). **Accepted finding:** GitNexus cannot answer CLI reachability for this repo — every verb is a dynamic `await import()`, so `impact` returns `ambiguous`/`impactedCount: 0`. Reachability came from source reading and the lane says so. **Accepted correction:** `observability.db` is NOT legacy-only — `src/activation/forensic-sink.ts:1-21` states native and legacy write one store. | VERIFIED |
| B | `02-rpc-supervisor-lifecycle.md`, `state-machine-delta.md` | 389 citations resolve; 0 defects | Independently confirmed: no native `steer` method exists while `retry`'s refusal text says "steer it or stop it first" (`src/activation/native-host.ts:1886-1889`) → B3 **real**; `ActivationResult.status = completed\|failed\|uncertain`, no `cancelled` (`src/activation/types.ts:261`) → B1 **real**; `snapshot.state` is assigned only `starting`/`running`/`needs_reply`/`escalated`/`settled`/`stopping`/`stopped`/`failed` = **8 produced**, so `waiting` and `uncertain` are both unproduced as `ActivationState` (the lane's summary said "9 produced"; its delta table at row `waiting`/`uncertain` is correct) | VERIFIED (summary off-by-one noted) |
| C | `03-telemetry-observability.md`, `telemetry-delta.md` | 103 citations resolve; 2 flagged docs are **deliberate dead references** | The two `docs/telemetry/*.md` paths are correctly reported as deleted by `092c0462` per `docs/testing-quarantine-map.md:141-143`. Coordinator independently reproduced the three highest-impact blockers: **(C-1)** `settlement-publication.ts` emits 10 distinct `settlement_*` names across 19 call sites and `mapNativeLifecycleEvent` has no matching case → `default: return null`, confirming **zero durable rows**; **(C-4)** `model_fallback` has 5 emit sites in `native-host.ts` and is absent from both the mapper switch and both gap lists → silent, undocumented drop; **(C-13)** `ps.ts:747` reads `event_family='activation'` and no in-tree writer exists. **External cross-validation:** the producer-vs-classifier finding reproduces open bead `unitAI-rrdnt.38` ("Emit the three forensic event names the sink still classifies with no producer") independently. Lane C also self-corrected three claims before finalising (`model_change` is live, not dead; retention is asymmetric; two silent-drop surfaces). | VERIFIED |
| D | `04-persistence-identity.md` | 64 citations resolve; 1 false positive (`substrate/src/domain/journal.ts` is an external Substrate-package path) | One real citation defect corrected: `src/tools/specialist/activation.tool.ts:1879-1892` (a 634-line file) → `src/activation/native-host.ts:1879-1892`. **Headline defect independently reproduced live:** `sp result act:deadbeef1234` → `No node matching ref: act`. Identity answers are direct and evidence-backed (legacy `job_id` is *not* minted natively; `activation_id` becomes canonical; `attemptId` is the second axis with no legacy counterpart). | VERIFIED (final write confirmed; correction log intact) |
| E | `05-worktree-git-review.md` | 46 citations resolve; 0 defects | Genuine GitNexus receipts, including an honest `risk: UNKNOWN` on `provisionWorktree` (`ambiguous`, 2 candidates) resolved by text search — exactly the required doctrine. Correctly distinguishes Core topology from Specialists execution. 8 gaps/blockers incl. native producing **no diff evidence at all** and **no base SHA/branch pin**. | VERIFIED |
| F | `06-schema-config-rules.md` | 114 citations resolve; 2 flags are verifier false positives | Correctly used GitNexus and reported that it returns `UNKNOWN` for config fields because they are plain-object property reads, then confirmed each with grep — the required doctrine. **Coordinator reproduced two headline findings:** `execution.mode` has **zero consumers** (only a validator message at `schema.ts:274-275`; 24/24 configs set it); and `.specialists/default/` **was retired for specialist definitions** by commit `31a6421c` (`loader.ts:145-157`) while `docs/surface-ownership.md` still documents it as tier 2. **E-1 confirmed verbatim and is a hard-rule violation — see §6 below.** | VERIFIED |
| G | `07-secondary-surfaces.md` | 119 citations resolve; 0 defects | Corrected the coordinator's own brief: found **7** `new JobControl` sites (the brief listed 2), each indirectly constructing a `Supervisor` → `sp node` is a *distinct orchestration runtime built on* the legacy engine. **Independently confirmed:** `specialist_retry` is **not** registered in `src/mcp/v2-server.ts` (zero `retry` matches) — it is registered only in `src/server.ts:31,170`, which nothing imports; the shipped entrypoint (`src/index.ts:1462` → `serveV2Stdio`) registers native tools only, and the three legacy `*_specialist.tool.ts` files are unregistered dead code. | VERIFIED |
| J | `10-differential-acceptance-corpus.md` | 78 scenario rows × 11 columns | Crux claims reproduced verbatim from the existing harness: the legacy side is a **reconstruction, not a capture**, *"because running the legacy path needs a real `pi` subprocess and this suite forbids one"*; `spawn` is mocked to throw; *"Cross-runtime equality cannot see a change made to BOTH sides"*; and PR #373's *"NOT A MECHANICAL TIE, and it must not be described as one"*. Reuses the four-category divergence vocabulary (`process topology \| lifetime semantics \| workspace strategy \| interaction transport`) and the `LEGACY_ONLY_*` lists rather than inventing a new one. Honestly marks **12 scenarios `UNCOMPARABLE`**. Independently reproduced `Supervisor` 113/CRITICAL/direct 51 and `NativeActivationHost` 14/MEDIUM/direct 11 — matching Lane B and the coordinator. | VERIFIED |
| H | `08-dead-code-ledger.md` | 71 candidate rows | **Coordinator reproduced two headline claims:** `native-host.ts:41-50` imports 10 *runtime* symbols from `../specialist/runner.js`, so `runner.ts` is `KEEP_SHARED` despite its legacy path — the single highest regression risk. `activation/forensic-sink.ts:34` and `specialist/observability-sqlite.ts:104` import `SupervisorStatus`/`SupervisorJobStatus` as **`import type`**, so deleting `supervisor.ts` breaks the **native compile**, not the native runtime — B-1 is a real sequential prerequisite. Coordinator **resolved Lane H's UNKNOWN-2** (see §7). Lane H's `dist/` finding is stronger than the coordinator's: `package-payload.yml:75-76` enforces both `git diff --exit-code -- dist/` and a clean `git status` for `dist/`. | VERIFIED |
| I | `gitnexus-legacy-graph.md`, `gitnexus-native-graph.md`, `gitnexus-overlay.md` | 200 overlay rows; 55/59 map nodes | **Coordinator reproduced:** `impact createObservabilitySqliteClient` → `ambiguous`, 15 candidates, **max 127 / CRITICAL** — exact. Tier-1 shared claim confirmed: it is called from native `src/mcp/v2-server.ts` **and** legacy `src/cli/status.ts` + `src/specialist/supervisor.ts`. **All three graph-gap seams reproduced:** `supervisor.ts:23` imports `SpecialistRunner` as `import type` and calls `runner.run(...)` at `:2219`; `runner.ts:1016` uses `PiAgentSession.create.bind(PiAgentSession)`; `activation.tool.ts:330` takes `getHost: () => NativeActivationHost`. | VERIFIED |

### Execution-engine census (coordinator-run; supersedes any lane's two-engine framing)

The repo contains **three** independent execution engines, not two. This is the single most
important structural constraint on the migration, because "remove the legacy backend" names only
engine 1 while the CLI also fronts engine 3.

| Engine | Entry surface(s) | Runtime | Evidence |
|---|---|---|---|
| **1. Legacy Supervisor job engine** | `sp run`, `sp chat`, `sp node`, `sp steer`, `sp resume`, `sp retry`, `sp stop`, `sp finalize`, `sp follow-up`, `sp attach`; projection surfaces `sp ps`, `sp status`, `sp result`, `sp feed`, `sp log`, `sp forensic`, `sp console`, `sp clean`, `sp metrics` | `SpecialistRunner` + `Supervisor` + `PiAgentSession` (pi `--mode rpc` subprocess) + `.specialists/jobs/**` + `observability.db` | `src/cli/run.ts:1894`; `src/specialist/launch.ts:64,71`; `src/specialist/job-control.ts:31,58`; `src/cli/console/runtime.ts:958-981`; `src/cli/metrics.ts:1` |
| **2. Native activation engine (target)** | Claude plugin / MCP v2 (`plugins/specialists/.mcp.json` → `dist/index.js` with no subcommand), `src/lib.ts` library surface, `src/server.ts` | `NativeActivationHost` + in-process Pi `AgentSession` + Substrate `WorkItemStore` + settlement | `src/index.ts:1462`; `src/mcp/v2-server.ts:52`; `src/lib.ts:41` |
| **3. Script class (independent)** | `sp script`, `sp serve` (`POST /v1/generate`, `GET /healthz`) | `src/specialist/script-runner.ts` → `PiAgentSession.create` and `spawn('pi', …)` **directly**; it imports only the `SupervisorStatus` *type* from the legacy engine (`src/specialist/script-runner.ts:16,26,1126,1271`) | `src/cli/script.ts:104-118` exit-code table; `src/cli/serve.ts:306,341` |

Consequences for the migration:

- Engine 3 is **not** the legacy backend and must not be deleted with it. It carries the only
  documented external consumer (`handoff-feedor.md`, `docs/specialists-service.md`,
  `docs/examples/specialists_client.py`) and a cron-oriented exit-code contract
  (`0/1/2/3/4/5/6/7/75`, `src/cli/script.ts:104-118`) that is a byte-compatibility surface.
- `sp node` is **engine 1**, not a separate runtime: `NodeSupervisor` → `JobControl` → `new Supervisor(...)`
  (`src/specialist/job-control.ts:31,58`).
- `sp chat` is engine 1: it calls `launchSpecialist` (`src/cli/chat.ts:3,158`).
- The projection surfaces (`ps`, `status`, `result`, `feed`, `log`, `forensic`, `console`, `metrics`)
  read `observability.db` / the job dir directly; they hold no engine, so they are adapter targets,
  not blockers.

### Migrator-visible consequences derived by the coordinator

These are not lane findings. They follow from combining a verified lane claim with source, and
they change the cutover plan.

1. **`sp doctor`'s Substrate check becomes wrong at cutover.** `src/cli/doctor.ts` (end of
   `doctor()`) calls `checkSubstrateRuntime()` **advisory-only**, with the in-source rationale:
   *"A missing Substrate breaks the NATIVE path and leaves the legacy CLI fully usable, so failing
   the doctor would misreport a working install as broken."* The `allOk` conjunction deliberately
   excludes `checkSubstrateRuntime()`. After the legacy path is unreachable, that premise is false:
   a missing Substrate would then break **the only** execution path while `doctor` still reports
   the install healthy. **The Substrate probe must be promoted into the exit status as part of the
   cutover, not after it.** (The default run's `0`-always contract is separately documented at
   `docs/cli-reference.md:1191` and is a CI compatibility surface — so this is a deliberate,
   documented contract change, not a silent one.)
2. **`observability.db` is dual-path, so most projection surfaces are adapters, not blockers.**
   Per `src/activation/forensic-sink.ts:1-21`, native and legacy write one store and one query
   answers both. `sp forensic`, `sp log`, `sp metrics`, `sp db stats`, `sp ps`, and
   `sp clean --observability` therefore do not need a new backend — they need the *legacy-only*
   `jobs/**/status.json` write target to be reconciled. Only `status.json` is legacy-only.
3. **Published cross-repo CLI surfaces exist and are documented, not inferred.**
   `docs/cli-reference.md:1637-1643` declares `sp integration record` as the "Published **write**
   surface for `xtrm.branch.integration.v1`" and the "cross-repo counterpart of `sp ps --json`",
   naming `xtrm-tools core` as the out-of-tree consumer that "shells out to this verb" because it
   "carries no sqlite dependency". These are byte-compatibility surfaces.

4. **`sp ps`'s native-activation block was an orphaned reader of a deleted telemetry family
   (Lane C blocker C-13, provenance now resolved). — RESOLVED BY N2B, with a residual.**
   *Historical record (true at audit time):* `src/cli/ps.ts:747` queried
   `readForensicEvents({ eventFamily: 'activation' })`, and `src/specialist/native-activation-summary.ts:6`
   justified it as *"the forensic trail in specialist_forensic_events (event_family='activation'),
   written since unitAI-rrdnt.37.1.1"*. **Nothing in `src/` writes that family today.**
   Commit `febef0ad` (**unitAI-rrdnt.20**) deleted it on purpose, stating in its message:
   *"The activation.* parallel vocabulary is gone; one bead query answers both runtimes"* — that
   commit's diff removes the only `event_family: 'activation'` write site. Native events now
   project onto the **legacy** timeline vocabulary through `mapNativeLifecycleEvent`
   (`src/specialist/native-activation-observability.ts:236-305`) and land in families derived from
   the timeline event type (`run_start`, `status_change`, `run_complete`, `control_signal`, …).
   *Correction (this pass):* the claim that the block **renders empty** was wrong — see item 3 below.
   **N2B fixed the reader** (`4fbc4a30`, review-fixed `6113a710`): the retired-family read became an
   identity prefix (`jobIdPrefix:'act:'`) with `order:'desc'`, and the stale header comment was
   corrected. **What remains open** is that the enumeration limit applies to event rows rather than
   activation ids, so older activations can starve — see the `CAP-TEL-057..064` residual and
   `unitAI-kmbb9`. This is still both a **telemetry-parity** item and a **live production defect**
   (recorded, not
   fixed, per the audit's no-opportunistic-fix rule).

   **Confirmed against the canonical database at cutover-prep time, and the finding is sharper than
   the audit recorded.** Read from the real common-root store
   (`<git-common-root>/.specialists/db/observability.db`, resolved via
   `resolveObservabilityDbLocation`, schema version 15):

   | Evidence | Value |
   |---|---|
   | `activation`-family rows present | 214 (so the empty-query conclusion is *not* "no rows ever") |
   | Names | `activation.activation_requested`, `activation.activation_settled`, `activation.turn_started`, … |
   | Last `activation`-family write | **2026-09-08 11:11:09 UTC** |
   | `febef0ad` commit time | **2026-09-08 11:37:32 UTC** (+02:00 13:37) |
   | Gap | **26 minutes** — and no write to that family since |
   | Every other family (job/turn/tool/model/git/control/mcp) | current at 2026-09-16 |

   The producer stopped precisely when the commit that declared the vocabulary *gone* landed. This
   upgrades the claim from git-archaeology inference to time-series proof: the family is a closed
   historical record, not a live stream.

   **Three corrections the database forced, all material to the fix:**

   1. **The fix must be identity-based, not a family swap.** In the current vocabulary there is *no*
      native-specific family: native rows land in the **shared** families (`job`, `turn`, `model`,
      `tool`, `control`, `git`) and are distinguished only by `job_id = 'act:<uuid>'`
      (`native-host.ts:507`), with `attempt_id` (`att:<id>:<n>`) as a second axis in its own column.
      Verified live: `act:0293a2bc-f48` carries `job.started`, `job.status_changed`, `job.completed`,
      `turn.turn`, `model.meta`, `model.token_usage.recorded`. So `ps` must query by **id prefix**.
      `ListForensicEventsFilters` (`observability-sqlite.ts:1174-1184`) exposes only an exact
      `jobId` and an exact `eventFamily` — there is **no prefix filter**, so one must be added.
      Replacing the literal with another literal would be wrong in both directions.
   2. **A second, independent defect at the same call site.** `ps.ts:746-750` omits `order`, and the
      reader defaults to `'asc'` (oldest first). For a busy stream it therefore slices the **oldest**
      rows in the window and discards the newest — the interface comment at
      `observability-sqlite.ts:1181-1183` warns about exactly this: *"Use 'desc' to fetch the newest
      rows when a caller intends to slice the tail of a busy stream."* Fixing only the family would
      leave `sp ps` rendering the wrong end of the correct stream. Neither of the two
      `readForensicEvents` callers that could hit this passes `order: 'desc'`.

   *Provenance: substantiated during cutover-prep (N2B) by the operator's instruction to diagnose
   from the real canonical DB rather than from a worktree-local absence. The audit's original wording
   said the writer was "deleted by `febef0ad`"; the mechanism is more precisely that the parallel
   vocabulary was retired and native events were re-projected onto the shared timeline families.*

3. **The block does not render EMPTY — it renders a closed historical snapshot, which is worse.**
   The audit (and Lane C's C-13) said "renders empty". Measured on the unfixed code against the real
   DB, `sp ps --json` returns **40** `native_activations` entries, every one carrying an `act:` id,
   with a `last_event_at_ms` range of **2026-09-07 17:51 → 2026-09-08 11:11 UTC** — exactly the span
   of the 214-row closed family, and nothing after.

   | Probe | Result |
   |---|---|
   | `native_activations` entries | **40** (not 0) |
   | Entries with an `act:` id | 40 of 40 |
   | `last_event_at_ms` span | 2026-09-07 17:51 → 2026-09-08 11:11 |
   | `act:758931b7-9ce` (N0) | **MISSING** |
   | `act:47a2b74f-a25` (N2A) | **MISSING** |
   | `act:51b14a21-af0` (N2B) | **MISSING** |
   | Operator note rendered | *"LAST-KNOWN state from forensics, not live registry state."* |

   The reason "empty" looked plausible is that the query passes `sinceMs: args.sinceMs`, and with no
   `--since` that is `undefined`, so `readForensicEvents` applies **no time filter** and returns the
   historical rows. With a window it would be empty; without one it presents eight-day-old
   activations as current. Combined with the note telling the operator this is "last-known state",
   the output is **actively misleading**: a reader sees 40 native activations, all from before the
   vocabulary change, and none of the ones that actually ran since. The defect statement for N2B
   must therefore be "shows a stale snapshot and hides everything current", not "shows nothing".

5. **The shipped artifact is a committed build, so "delete the legacy backend" is not done
   until `dist/` is rebuilt.** `package.json` `bin` maps `specialists`/`sp` → `dist/index.js`, and
   `dist/` is **tracked in git** (397 files; `git ls-files dist/ | wc -l`). `dist/index.js` and
   `dist/lib.js` contain the compiled legacy engine *and* the native host, and
   `plugins/specialists/scripts/mcp-server.mjs` resolves `../../../dist/index.js` as its
   "local-first, load-bearing" runtime. Consequences:
   - A PR that removes legacy source but does not rebuild+commit `dist/` **still ships the legacy
     engine** — the deletion would be cosmetic in the published artifact while appearing complete
     in `src/`.
   - The native frontend (Claude plugin/MCP) executes the committed build, so any cutover step that
     changes the native path must land `dist/` in the same change or the frontend keeps the old
     behaviour.
   - A differential harness must compare against the **built** artifacts, not only `src/`, if it is
     meant to prove the published surface.

6. **`sp result` cannot resolve any native activation id — reproduced live (Lane D, confirmed by
   coordinator).** `src/cli/result.ts:93-98` rewrites any `jobId` containing `:` into a
   node/member pair:
   ```js
   if (jobId && jobId.includes(':') && !nodeId && !memberKey) {
     nodeId = jobId.slice(0, jobId.indexOf(':'));
     memberKey = jobId.slice(jobId.indexOf(':') + 1);
     jobId = undefined;
   }
   ```
   `src/activation/native-host.ts:507` mints `const activationId = `act:${randomUUID().slice(0, 12)}``.
   Every native id therefore contains `:`. Live run in this worktree:
   `bun run src/index.ts result act:deadbeef1234` → **`No node matching ref: act`**.
   `sp result` is the primary CLI result verb and a preserved compatibility surface, so this is a
   **cutover blocker and a live production defect** on the native path. It is the single highest-value
   fix in the persistence lane.

7. **Durable-store anchoring: two stores at the git common root, one per worktree — corrected and
   verified at `6553ef05`.**

   There are **three** durable stores, not two, and they do not share an anchor:

   | Store | Path | Anchor | Shared across worktrees? |
   |---|---|---|---|
   | Job state (`status.json`) | `.specialists/jobs/` | git **common** root | **Yes** |
   | Forensic DB (`observability.db`) | `.specialists/db/observability.db` | git **common** root, or `$XDG_DATA_HOME/specialists/` | **Yes** |
   | Native settlements | `.specialists/settlements/` | `process.cwd()` | **No — per worktree** |

   - Jobs: `resolveJobsDir()` = `join(resolveCommonGitRoot(cwd) ?? cwd, '.specialists', 'jobs')`
     (`src/specialist/job-root.ts:34-37`).
   - Forensic DB: `resolveObservabilityDbLocation()` (`src/specialist/observability-db.ts:80-94`) runs
     `git rev-parse --path-format=absolute --git-common-dir`, strips the trailing `/.git`, and returns
     `join(gitRoot, '.specialists', 'db')`. Verified in this worktree: `--git-common-dir` is
     `/home/dawid/dev/specialists/.git` (→ base root) while `--show-toplevel` is the worktree — the
     resolver deliberately takes the **former**. On disk: `/home/dawid/dev/specialists/.specialists/db/observability.db`.
   - Settlements: `createFileSettlementStore(join(this.cwd, '.specialists', 'settlements'))`
     (`src/activation/native-host.ts:494`), `this.cwd` defaulting to `process.cwd()` (`:375`).

   **Why this matters more than the original wording implied.** A native activation dispatched from a
   worktree writes its **forensic rows into the shared base-root DB** but its **settlement record into
   the worktree**. So the evidence and the state that explains it live in different stores, and the
   once-per-process republish pass only ever sees its own cwd's settlement backlog. Any recovery or
   orphan-reconciliation work that assumes one store locality is wrong, and B5 (no native orphan
   reconciler) is harder to close than it first appears: a reconciler anchored to the worktree cannot
   see the shared forensic rows it needs, and one anchored to the base root cannot see the settlements.

   **`XDG_DATA_HOME` is an anchor override that only the forensic DB has.** When set, the DB moves to
   `$XDG_DATA_HOME/specialists/` while **jobs stay at the git root** — a writer/reader split the file
   itself already documents as a real failure class: it records that a test run once migrated the
   repository's authoritative forensic store in place (unitAI-rrdnt.16, `observability-db.ts:56-72`).
   Neither the jobs store nor settlements has an equivalent override, so the asymmetry is not
   symmetric by design; it must be treated as a configuration hazard at cutover.

   *Provenance: this item originally carried only the jobs-vs-settlements half. It was corrected after
   the operator observed that `observability.db` lives at the base root. The correction replaces a
   wrong corroboration in the coordinator's handoff — the absence of `.specialists/observability.db`
   from a worktree is correct behaviour (the real path is `.specialists/db/observability.db`), and
   should never have been cited as evidence. Lane A already recorded the `XDG_DATA_HOME` override at
   `01-cli-surface.md:26`; it is consolidated here.*

8. **Beads workflow doctrine is injected into the NATIVE runtime today — a direct violation of the
   migration's non-negotiable rule (Lane F E-1, confirmed verbatim).**
   `src/specialist/memory-retrieval.ts:10-21` defines `STATIC_WORKFLOW_RULES_BLOCK` as a literal
   Beads block:
   ```
   ## Beads Workflow Quick Rules
   - Claim work: `bd update <id> --claim`
   - Append progress notes: `bd update <id> --append-notes "..."`
   - Store reusable insight: `bd remember "insight"`
   - Close completed issue: `bd close <id> --reason "done"`
   ## Session close checklist
   1. `git add <files>`  2. `git commit -m "..."`  3. `git push`
   ```
   `src/specialist/mandatory-rules.ts:377-390` injects it as set id `workflow-quick-rules`, rule
   level `required`, **`priority: 'must_keep'`** (so it can never be budget-evicted), whenever
   `mandatory_rules.disable_default_globals` is not set. `src/specialist/task-prompt.ts:248` calls
   `buildMandatoryRulesInjection` on the non-`bare` path, and that path is reached from native
   dispatch. The injection site **strips the `## Beads Workflow Quick Rules` heading and the
   `bd remember` line** as cosmetic cover (`mandatory-rules.ts:384-386`) while leaving
   `bd update <id> --claim` and `bd close <id>` in the prompt.
   This is exactly what the migration rule forbids: *"Beads-specific workflow doctrine in
   mandatory-rules must not leak into the native runtime."* Native has no Beads client by design.
   Lane F additionally classifies `core-session-boundary` (the **required** set injected into every
   activation, whose text says *"the assigned Bead/task is authority"*), `bead-id-verbatim`
   (referenced by 18 of 19 `template_sets`), `executor-delivery`, and `git-workflow-safe` as further
   Beads-lifecycle leaks.

---

### Harness fact: sub-agents get the GitNexus CLI, not the GitNexus MCP tools

Every explorer in this swarm reported (verbatim, Lane E) *"GitNexus MCP is not exposed to this
sub-agent session (`mcp status` → tool not found)"* and used the **`gitnexus` CLI** instead, which
selects the repository **by cwd** (build 1.6.11 has no `--repo` flag). This is why the lane briefs'
instruction to "pass `repo=<absolute path>`" was not actionable for them.

This does **not** weaken the evidence. The coordinator re-ran every lane's headline graph query
from the worktree cwd and reproduced the reported numbers exactly:

| Lane | Query claimed | Coordinator reproduction |
|---|---|---|
| B | `impact Supervisor --direction upstream` → direct 51, CRITICAL | 51 direct, `risk: CRITICAL` — **exact** |
| B | `impact launchSpecialist --direction upstream` → 2, LOW | 2 direct, `risk: LOW` — **exact** |
| B | `impact NativeActivationHost --direction upstream` → 11, MEDIUM | 11 direct, `risk: MEDIUM` — **exact** |
| A | `impact run` → `ambiguous`, cannot answer CLI reachability | `status: ambiguous`, 73 candidates, `risk: UNKNOWN` — **exact** |
| C | `impact appendForensicEvent --direction upstream` → `risk: UNKNOWN`, max 12 impacted, 3 candidates | 3 candidates, max 12, `risk: UNKNOWN` — **exact** |
| E | `impact resolveWorkingDirectory` → LOW/exact | reproduced as LOW/exact |

**Standing rule for the next auditor:** to make a graph claim about this repo, either pass
`repo=<absolute path>` through the **MCP** tools (coordinator sessions) or `cd` to the worktree and
use the **CLI** (sub-agent sessions). A `gitnexus` CLI run from anywhere else silently queries a
different index — the parent checkout's index was at `ce33c313` and lacks
`src/activation/settlement-lease.ts` entirely.

---

### Cross-cutting verification (coordinator-run, independent of any lane)

- **No lane modified source.** `git status --porcelain` shows only `?? docs/migrations/`.
- **No native gate on `sp run`.** `grep` for a native flag/env on `src/cli/run.ts` returns nothing;
  `sp run` reaches `src/specialist/launch.ts:64,71` unconditionally.
- **Frontends genuinely differ.** `src/index.ts:1462` starts the native MCP v2 server when no
  subcommand is given; `plugins/specialists/.mcp.json` invokes exactly that. The CLI subcommand
  path never reaches `NativeActivationHost`.
- **Legacy MCP tools are orphaned.** `src/tools/specialist/{steer,stop,resume}_specialist.tool.ts`
  each construct the legacy `Supervisor`; none of the three is imported by `src/mcp/v2-server.ts`.
  Their only in-tree references are `src/cli/quickstart.ts:217-222` (help text) and docs.
- **Reachability split (independent import-graph computation, `src/` only):** 54 modules forward-
  reachable from the legacy roots, 67 from `src/activation/native-host.ts`, **45 shared**, 9 legacy-only,
  22 native-only. The 45 shared modules are the highest-risk set for a naive cutover.
  (Lane I owns the authoritative GitNexus-graph version of this.)

---

### Final citation audit (all 17 artifacts)

**3,220 machine-checkable `file:line` citations resolved. 28 flagged, all triaged to zero real defects:**

| Class | Count | Examples |
|---|---|---|
| Regex artifact: `~/.config/…` prefix stripped | 5 | `config/specialists/user.json` → really `~/.config/specialists/user.json` |
| Regex artifact: `src/` suffix split | 3 | `pi/session.ts` → really `src/pi/session.ts` |
| Legitimate out-of-tree path | 2 | `substrate/src/domain/journal.ts` (external Substrate package) |
| Table column header / negative existence claim | 3 | `config/package.json` (a column header); `src/tools/index.ts` (“neither … exists”) |
| Deliberate dead-doc reference | 2 | `docs/telemetry/*.md` — reported as deleted by `092c0462`, with evidence |
| Historical quote inside a correction log | 5 | the old paths quoted in the Lane A / Lane D correction tables |
| **Proposed new module, explicitly marked as such** | 8 | `script-exec.ts` (“proposed …”), `status-types.ts` (“proposed: …”), Lane J's harness files (marked `NEW`), `src/activation/service.ts` (N1 “new”) |

Five real citation defects were found and **corrected in place** during verification (Lane A ×5, Lane D ×2),
each with a provenance log appended to the affected artifact.

---

## 6. Hard-rule violations reproduced by the coordinator

These are behaviours that the migration's own non-negotiable rules forbid and that exist in the
current tree. They are not implementation items the audit invented; they are conditions the audit
found and proved.

### 6.1 Beads workflow doctrine is injected into the native runtime

The rule states: *"Beads-specific workflow doctrine in mandatory-rules must not leak into the native
runtime."*

> **CURRENT STATUS:** corrected by the Specialist Definition Semantic Cutover. The measurement below
> is historical evidence: current canonical prompts no longer inject `workflow-quick-rules`;
> `core-session-boundary` is Substrate-native; canonical roles use `issue-ref-verbatim`; the old
> `bead-id-verbatim` set is explicitly legacy compatibility. See
> `specialist-definition-semantic-cutover.md`.

At audit time, it leaked as follows.

- `src/specialist/memory-retrieval.ts:10-21` defines `STATIC_WORKFLOW_RULES_BLOCK` as a literal
  Beads block (`bd update <id> --claim`, `bd update <id> --append-notes`, `bd remember`, `bd close`,
  plus a git close checklist).
- `src/specialist/mandatory-rules.ts:377-390` injects it as set id `workflow-quick-rules`, rule level
  `required`, **`priority: 'must_keep'`**, unless `mandatory_rules.disable_default_globals` is set.
- `src/specialist/task-prompt.ts:248` calls `buildMandatoryRulesInjection` on the non-`bare` path;
  that path is reached from native dispatch (`src/activation/native-host.ts:1038-1044`).
- The injection site strips the `## Beads Workflow Quick Rules` heading and the `bd remember` line
  (`mandatory-rules.ts:384-386`) — cosmetic removal that leaves `bd update <id> --claim` and
  `bd close <id>` in the prompt.

Further leaks classified by Lane F: `core-session-boundary` (the **required** set injected into every
activation; its text says *"the assigned Bead/task is authority"*), `bead-id-verbatim` (referenced by
18 of 19 `template_sets` — rewrite the set, do not delete it), `executor-delivery`
(*"never close the anchor bead"*), `git-workflow-safe` (*"claim before edit, close before commit"*),
`changelog-keeper-scope`, `changelog-conventions`, `sync-docs-scope-discipline`. 15 of 23 shipped
sets are clean.

### 6.2 Runtime-owned settlement is not configurable — held

The rule states: *"automatic native settlement is runtime-owned and must not be configurable."*
Lane F found **no** schema field exposing settlement, and **no** native-only config fields. This rule
is currently satisfied; it is recorded because the deletion list must not accidentally introduce one.

### 6.3 No `substrate_write_notes` introduced — held

Lane F's deletion list removes `beads_write_notes`/`beads_integration` only *after* the legacy
consumer is gone, and introduces no Beads-shaped replacement. Held.

---

## 7. Open-question register (UNKNOWNs)

GO is forbidden while any **capability row** is `UNKNOWN`. The register below separates the two
populations so the gate is applied to the right one.

### 7.1 Gate-blocking (decide a capability status or a deletion)

| # | Question | Blocks | Owner |
|---|---|---|---|
| G-1 | `src/activation/transport/peer-registration.ts`: wiring gap or dead code? Its module header records an **operator approval dated 2026-09-07** with two binding conditions, and `peer-transport.ts:24` says the adapter "requires `registerPeer()`". Graph shows zero callers; the only consumer is a test that reaches the file by absolute path. | Lane H B-5; any `DELETE_AFTER_CUTOVER` on that file | Product decision |
| G-2 | Does any **out-of-tree** consumer exist for: the `sp script` 9-value exit-code table; `sp node`; `src/server.ts`; `pi/rpc/**`; `verifyExactLineCitation` (exported from `src/lib.ts:140-143`); `xtrm.branch.integration.v1`; the `::attempt::` id form? | Every `DEAD_AFTER_CUTOVER` and `INTENTIONAL_RETIREMENT` row in §3 whose sole evidence is in-tree absence | Operator census |
| G-3 | `waiting_auto_close_ms = 0`: intentional retirement or unset default? No cited decision exists. | CAP-EXEC-008 | Product decision |
| G-4 | Is native `waiting` intended to be produced, or should `settled` be the only park state? The type, `RESUMABLE_STATES`, and the telemetry bridge all assume `waiting`; no producer exists. | CAP-EXEC-007, CAP-TEL rows | Product decision |

### 7.2 Non-gate-blocking (resolved enough to decide, or informational)

- **Resolved by the coordinator:** Lane H UNKNOWN-2 (`timeline-query.ts` / `forensic-renderer.ts`).
  Their only readers are `cli/feed.ts:36`, `cli/log.ts:13`, `cli/console/forensic.ts:15`, and the
  **unregistered dead** `feed_specialist.tool.ts:5`. Because `observability.db` is dual-path
  (`activation/forensic-sink.ts:1-21`), both are dual-path projection helpers a native reader can
  reuse → **`KEEP_COMPAT`**, not `DELETE_AFTER_CUTOVER`. This resolves the row; it does not delete it.
- **Resolved by the coordinator:** Lane C U-1 (out-of-tree producer of `event_family='activation'`).
  Commit `febef0ad` (unitAI-rrdnt.20) deleted the in-tree writer deliberately. An out-of-tree
  producer is not required to explain the `sp ps` block, though it is not positively excluded
  — it is folded into G-2. (The block was never empty; see the item 3 correction. Its content is
  a stale-then-starved sample of the **shared** families, not the retired `activation` family.)
- **Informational:** Lane A (10), B (7), C (8), D (7), E (7), F (7), J (10) each list their own
  open questions in their artifacts. They do not decide a capability's status and do not block GO
  individually; the ones that do are promoted to §7.1.

---

## 8. GO gate

This matrix is the sole basis for `09-go-no-go.md`. The GO decision must not be made
because the target architecture is aesthetically cleaner.

Blocking conditions:

- any row `UNKNOWN`
- any `NATIVE_GAP` without an implementation item
- any `INTENTIONAL_RETIREMENT` without a cited product decision
- any `DEAD_AFTER_CUTOVER` without proof of no consumer
- any legacy telemetry signal with no native destination
- any stable identity surface (`job_id` and its persisted shapes) without a defined survival rule
