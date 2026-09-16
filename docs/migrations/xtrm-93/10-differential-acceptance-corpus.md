# XTRM-93 — Lane J: Differential Acceptance Corpus (design only)

> **Status: DESIGN ARTIFACT — not implemented.** No source file is modified by this lane.
> This file defines a reusable differential scenario corpus that runs the LEGACY backend
> (`SpecialistRunner` + `Supervisor` + `PiAgentSession` pi-RPC subprocess) and the NATIVE
> backend (`NativeActivationHost` + in-process Pi `AgentSession`) against the SAME Specialist
> definitions and compares results.
>
> Worktree: `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`
> HEAD: `6553ef05` (= master `472b1aef` + local `rx1bu`). Audit of the current tree only.
>
> GitNexus evidence (independently re-run by this lane, not inherited): repository
> `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`, `gitnexus status` =
> Indexed commit `6553ef0` / Current commit `6553ef0` (up to date). `gitnexus impact Supervisor
> --direction upstream` → `impactedCount: 113`, `risk: CRITICAL`, `direct: 51`,
> `processes_affected: 23`. `gitnexus impact NativeActivationHost --direction upstream` →
> `impactedCount: 14`, `risk: MEDIUM`, `direct: 11`, `processes_affected: 1`. These reproduce
> `00-capability-matrix.md` §4 and `07-secondary-surfaces.md` exactly.
>
> **Load-bearing structural fact, restated because the whole corpus depends on it: `sp run` has
> no native path.** `src/cli/run.ts:1894` → `src/specialist/launch.ts:64,71` unconditionally
> constructs the legacy engine; the native engine is reached only from MCP v2
> (`src/index.ts:1462` → `src/mcp/v2-server.ts:52`) and the library surface (`src/lib.ts:41`).
> A differential corpus therefore cannot compare two CLI invocations today: it must drive two
> in-process backends through their injectable seams. That is a design constraint, not a
> preference, and it is why the corpus is a scenario file plus two backend adapters rather than
> a shell script running `sp run` twice.

---

## A) Existing coverage and its exact gaps

### A.1 What the current parity harness already compares

There are six files under `tests/**` whose name or purpose is parity. Only the first two are
legacy-vs-native backend parity; the rest are cross-surface ties that the corpus must not
re-own.

| File | What it compares | Mechanism |
|---|---|---|
| `tests/unit/specialist/execution-profile-parity.test.ts` | ONE `ExecutionProfile` record (17 keys) compiled from each runtime, field by field | native = real `NativeActivationHost` + recording SDK double; legacy = **reconstruction** from the shared production helpers |
| `tests/unit/specialist/activation-parity.test.ts` | Native resource assembly vs the legacy call-site helpers: skills, discovery fence, output contract, pre-scripts, blocker context, mandatory rules, tool allowlist + ask tools, curated extensions, session cwd | native = real host + recording SDK double; legacy = helper reconstruction |
| `tests/unit/specialist/eof-parity.test.ts` | EOF trailing-newline line counting across Pi's model, the vendored `read-line-numbers` fork, and `readEvidenceWindow` | three pure surfaces, no backend |
| `tests/integration/substrate-parity.test.ts` | Substrate work-item boundary: revision/hash stability across view/check/bind, foreign-holder refusal, journal append | real private checkout; `describe.skipIf(!XTRM_SUBSTRATE_DIR)` |
| `tests/unit/cli/console-help-parity.test.ts` | `renderKeyBar` tokens vs `consoleHelpText` sections | pure functions |
| `tests/unit/skills/role-envelope-parity.test.ts` | Task-prompt envelope across `sp run`, `render-task --surface pi`, `--surface claude` | pure renderer |

### A.2 The divergence vocabulary the existing harness uses

This is the vocabulary the corpus must reuse rather than invent, because the capability matrix
already references it.

1. **`DivergenceCategory`**, quoted BYTE for BYTE from the SPECIALISTS-55 contract and parsed at
   run time (`execution-profile-parity.test.ts:192-216`): `process topology`, `lifetime
   semantics`, `workspace strategy`, `interaction transport`. Asserted to be exactly these four
   at `:820`.
2. **`NamedDivergence`** (`:331-345`): every declared divergence carries a `category` (from the
   four) and a `reason` asserted longer than 20 characters (`:822-823`), plus a `holds(native,
   legacy)` predicate. The predicate is a **checked shape**, not a skip: the file's own history
   is that a `continue`-style skip let `tools` and `extensions` go entirely uncompared, which is
   how SPECIALISTS-57 survived a green run (`:336-344`).
3. **Three declared divergences** currently exist (`:353-388`): `customTools` (workspace
   strategy), `tools` (interaction transport, two ask tools), `extensions` (process topology,
   `npm:` resolution). An unlisted divergence is a failure.
4. **Contract dimensions** (`:222-231`): `skills, tools, extensions, scripts, outputContract,
   resources, contextInputs, modelThinking, reviewerEvidence`, plus one declared beyond-contract
   dimension `workspace`. The compared-field list is DERIVED from the quoted contract line, and
   the mapping is compile-time exhaustive (`:300-303`) so adding a profile key without a
   dimension fails `tsc`.
5. **Legacy-only input vocabulary** (`activation-parity.test.ts:59-67`):
   `LEGACY_ONLY_JOB_REUSE_VARIABLES = ['reused_from_job_id', 'worktree_owner_job_id',
   'gitnexus_summary']` and `LEGACY_ONLY_INPUTS = ['--var variables', 'fallbackPrompt']`, checked
   by `assertNoUnlistedDivergence` (`:69-77`).
6. **Approved task-side differences** (`role-envelope-parity.test.ts:12-17`): pre-scripts,
   reviewer git-diff context, mandatory-rule failure policy. Everything else is BYTE-identical
   on that surface.

`PARITY-ANALYSIS.md` is **not** this parity. It is a 2026-03-22 document about
Specialists↔xtrm-tools ownership (`PARITY-ANALYSIS.md:1-11`). It must not be cited as
legacy-vs-native coverage.

### A.3 The exact gaps

The corpus exists to close these. Each gap is stated with its evidence.

- **G1 — The legacy side is a reconstruction, never a capture.** `execution-profile-parity.test.ts:44-50`
  (residual 1) states the legacy profile is recomputed from the same helpers the legacy call site
  uses (`resolveExecutionExtensionSelection`, `resolveRuntimeToolContract`,
  `resolveCuratedExtensionPaths`, `deduplicateExtensionSources`, `sessionResourceFenceArgv`,
  `renderTaskPrompt`, `buildSystemPrompt`, `createReviewerDiffAppendHook`) because running the
  legacy path "needs a real `pi` subprocess and this suite forbids one". A helper the legacy call
  site stops calling is invisible here.
- **G2 — Both runtimes are forbidden to spawn.** `execution-profile-parity.test.ts:68-76` and
  `activation-parity.test.ts:7-16` mock `node:child_process.spawn` to throw. No scenario can
  therefore observe a legacy subprocess's argv, env, stdio, or exit code.
- **G3 — Cross-runtime equality is blind to a change made to BOTH sides.**
  `execution-profile-parity.test.ts:57-59` (residual 3) and `:886-894` record that forcing both
  compilers to return `extensions: []` left the file green. The mitigation is absolute pins for
  "cheap" dimensions only (`:857-897`), and the contract quote is explicitly **not** a mechanical
  tie (`:167-190`, `:184-190`).
- **G4 — The two legacy override seams are unmodelled.** `execution-profile-parity.test.ts:51-56`
  (residual 2): `runner.ts:1101` passes `options.autonomyLevel ?? execution.permission_required`
  and `runner.ts:1103` passes `options.specialistPermissions ?? spec.specialist.permissions`; the
  harness passes the spec field only. A regression in the runner's own override plumbing is
  invisible.
- **G5 — Coverage is composition-only.** Both parity files compare a compiled envelope
  (profile keys / assembled resources). They observe **no** session event, so nothing covers
  turn counting, `agent_end` vs `agent_settled`, retries, compaction, provider errors, tool
  denials at runtime, or output validation outcomes.
- **G6 — No model is called anywhere.** `activation-parity.test.ts:51`: "No model is called
  anywhere in this file."
- **G7 — No durable store is captured or compared.** Neither file reads `observability.db`,
  a job directory, the settlement store, the authority store, or the Substrate Journal. The
  native side is asserted from `createAgentSession` arguments and a forensic sink that only
  records event NAMES (`activation-parity.test.ts:197-200`).
- **G8 — No lifecycle verb is exercised.** `waiting`, keep-alive, resume, retry, steer, stop,
  finalize, ask/answer, follow-up, and `waiting_auto_close` are all outside both files. The
  state-machine delta (`state-machine-delta.md` §d) records ~14 rows where the two runtimes have
  no common state at all.
- **G9 — No CLI surface is compared.** Exit codes, `--json` schemas, `--background` launch line,
  `sp ps`/`sp status`/`sp result` projections, and the `sp result` `act:` id defect
  (`00-capability-matrix.md` §6) are uncovered by any parity file.
- **G10 — Post scripts have no native producer and are silently skipped.**
  `state-machine-delta.md` §d row `post scripts`: legacy `runner.ts:1469-1470` vs `NONE`; "A
  specialist declaring `phase: post` scripts gets them silently skipped." No parity file even
  declares a post script fixture.
- **G11 — Comparison semantics are one-shot field equality.** There is no vocabulary for
  SET-equality, ordered projection, exit-code-only, or UNCOMPARABLE. A scenario that legitimately
  cannot be compared has nowhere to be recorded, which is precisely how a hard scenario gets
  dropped instead of marked.

---

## B) Scenario catalogue

Columns are exactly as specified by the lane brief.

**Notation used in cells**

- `DEF(root, opts)` = the fixture factory pattern already proven in
  `execution-profile-parity.test.ts:479-510`: a minimal `{specialist:{metadata,execution,prompt,
  skills,capabilities}}` written into a temp root, with `model: 'testprov/test-model'`,
  `permission_required` = the tier, `bare:false`. Never rewritten for admission (the host injects
  `admission`, `native-host.ts:404-417`).
- `L-ADAPTER` = legacy backend adapter (D.2). `N-ADAPTER` = native backend adapter (D.3).
- `N1..N7` and `K1..K6` are the normalization classes defined in section C.
- Divergence categories `PT` (process topology), `LS` (lifetime semantics), `WS` (workspace
  strategy), `IT` (interaction transport) are the four from
  `execution-profile-parity.test.ts:212-215`.
- Every scenario's default owner is the lane named in `00-capability-matrix.md` §1 ranges.

### B.1 Execution envelope (owner Lane B / F)

| scenario id | axis | setup (definition + flags + fixtures) | legacy invocation | native invocation | observable outputs to capture | comparison semantics | equivalence relation (testable assertion) | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-EXEC-001 | READ_ONLY | `DEF(root,{permission:'READ_ONLY'})`, one skill dir | `L-ADAPTER.run(scenario)` | `N-ADAPTER.run(scenario)` | `ExecutionProfile` (all 17 keys, `execution-profile-parity.test.ts:244-276`) | SEMANTIC (relation: field equality) | `profile_legacy[k] === profile_native[k]` for every `k` not in `INTENTIONAL_DIVERGENCES`; declared keys satisfy `holds()` | N3,N5 | already covered by `execution-profile-parity.test.ts:899-907` — risk is double-owning the assertion; corpus must import the same diff function, not re-implement | B |
| DX-EXEC-002 | LOW | `DEF(root,{permission:'LOW'})` | `L-ADAPTER.run` | `N-ADAPTER.run` | profile + resolved tool contract `toolsList` | SEMANTIC | as 001, plus `native.tools ⊇ legacy.toolContract.toolsList` and ask-tool allowance checked as a named `IT` divergence | N3 | host-PATH-dependent catalog deny (`execution-profile-parity.test.ts:997-1015`) | B |
| DX-EXEC-003 | MEDIUM | `DEF(root,{permission:'MEDIUM',requires_worktree:true})` + git repo fixture | `L-ADAPTER.run` with worktree policy | `N-ADAPTER.run` | profile, `cwd`, worktree path | SEMANTIC | as 001; `cwd` difference recorded as a `WS` divergence with a reason, never silently skipped | N3 | native runs in-place; legacy provisions a worktree (`state-machine-delta.md` row `prompt composition`) | B |
| DX-EXEC-004 | HIGH | `DEF(root,{permission:'HIGH'})` + one local extension source | `L-ADAPTER.run` | `N-ADAPTER.run` | profile incl. `extensions`, `resources` fence | SEMANTIC | as 001; `extensions` satisfies the `PT` `holds()` from `:372-387`; `resources` equals the absolute fence literal `{true,true,true,true,true}` | N3 | npm resolution depends on installed packages (`:84-115`) — pin the fixture node_modules root | B |
| DX-EXEC-005 | skills | `DEF(root,{withSkills:true})`, `skillDirs(['gitnexus','engineering-quality'])` | `L-ADAPTER.run` | `N-ADAPTER.run` | `skills`, `skillPrefix`, loader `getSkills()` | SET-equality | `set(legacy.skills) === set(native.skills)` AND `legacy.skillPrefix === native.skillPrefix` (order-bearing) | N3 | ambient discovery (`:308-333` `activation-parity`) | B |
| DX-EXEC-006 | skills (absent) | `DEF(root,{withSkills:false})` | `L-ADAPTER.run` | `N-ADAPTER.run` | `skills`, `skillPrefix`, fence | BYTE | `legacy.skills === []` BYTE AND `native.skills === []` BYTE AND both fences all-true | none | a both-sides omission is invisible to equality alone — the absolute pins are mandatory here | B |
| DX-EXEC-007 | mandatory-rules | root with a real `MANDATORY_RULES` source file | `L-ADAPTER.run` | `N-ADAPTER.run` | `contextInputs` contains `mandatoryRules`; prompt text; forensic event names | SEMANTIC | `legacy.mandatoryRulesBlock.trim() === native.mandatoryRulesBlock.trim()` and both contain the rule text; native emits `mandatory_rules_injection` | N3 | `activation-parity.test.ts:360-367` owns part of this; corpus adds the forensic-name assertion only | B/F |
| DX-EXEC-008 | mandatory-rules (unavailable) | mandatory-rules source absent or over budget | `L-ADAPTER.run` (warn-and-continue, `runner.ts:1177-1195,1251-1279`) | `N-ADAPTER.run` (fail-closed `mandatory_rules_unavailable`, `native-host.ts:998-1023`) | terminal status, error text, forensic names, CLI exit code | SEMANTIC-with-relation (allowlisted tightening) | `legacy.status === 'done'` AND `native.status === 'failed'` AND `native.error.code === 'mandatory_rules_unavailable'`; the asymmetry is a declared `LS` divergence with reason, asserted by name | N1,N2,N6 | This is an intentional tightening, not parity. Testing it as equality is wrong; the assertion must pin the asymmetry. | B |
| DX-EXEC-009 | pre scripts | `DEF` + `skills.scripts=[{phase:'pre',run:'<echo script>',inject_output:true}]` | `L-ADAPTER.run` | `N-ADAPTER.run` | rendered turn-1 prompt, script exit code, `pre_script_output` variable | SEMANTIC | `legacy.initial_prompt === native.prompt` BYTE after N3 path substitution; both contain the script's stdout (`activation-parity.test.ts:343-349`) | N3 | `spawnSync` in `runScript` (`runner.ts:164-170`) executes for real on both sides — script must be a shell builtin no-op | B |
| DX-EXEC-010 | pre scripts (required failure) | `scripts=[{phase:'pre',run:'<exit 3>',required:true}]` | `L-ADAPTER.run` → `findRequiredPreScriptFailure` (`runner.ts:245-247`) | `N-ADAPTER.run` | refusal vocabulary, status, exit code, which phase ran | SEMANTIC (refusal equivalence) | both refuse before session creation; `native.error.code` and legacy thrown class map onto the same refusal family; session was never created on either side | N1,N2 | native and legacy refuse at different points in the sequence (native after admission, `state-machine-delta.md`) — compare the refusal, not the ordering | B |
| DX-EXEC-011 | post scripts | `scripts=[{phase:'post',run:'<echo>'}]` | `L-ADAPTER.run` executes it (`runner.ts:1469-1470`) | native has no post phase (delta row `post scripts`) | script side-effect marker file; events | **UNCOMPARABLE** | No relation exists. Assert only that the legacy side ran it and the native side did not; record as gap G10 with a blocking flag. Do NOT report PASS. | n/a | A future native post-script implementation would change the expected asymmetry — the scenario must carry the asymmetry as data, not as an implicit assumption | B |
| DX-EXEC-012 | extensions | `DEF` + one local declared extension path | `L-ADAPTER.run` | `N-ADAPTER.run` | `extensions` set, loader `additionalExtensionPaths` | SET-equality | `set(native.extensions) === set(legacy curated ∪ deduped kept)` and the declared local source appears on both | N3 | curated set is host-dependent (`:828-839`) — pin declared sources absolutely | B |
| DX-EXEC-013 | extension exclusions | `DEF` + `extensions:{gitnexus:false}` + `required_tools:['read','grep','find','ls']` | `L-ADAPTER.run` with `excludeExtensions` (`runner.ts:1076-1084`) | `N-ADAPTER.run` | `tools`, `required_tools` declaration | SET-equality | `set(native.tools minus ASK) === set(legacy.tools)`; the excluded extension's tools are absent on BOTH; `declaredRequiredTools` equals the declared list exactly | N3 | host-PATH dependence (`:997-1015`) — admission is injected, so the deny must be forced, not observed | B |
| DX-EXEC-014 | extensions (non-local) | `DEF` + `npm:pi-parity-probe` + an uninstalled `npm:` + a `git:` source | `L-ADAPTER.run` forwards raw spec to pi | `N-ADAPTER.run` resolves local, skips non-local | `extensions` on both; warning events | SEMANTIC (allowlisted) | relation from `execution-profile-parity.test.ts:372-387` `holds()` reused verbatim: native = local legacy sources + installed-npm-resolved dirs; drops only no-local-form sources | N3,N2 | The `holds` predicate is the contract; do not restate it loosely | B |
| DX-EXEC-015 | tool catalogs (grant) | `DEF(root,{requiredTools:['read','bash']})` | `L-ADAPTER.run` | `N-ADAPTER.run` | `tools` allowlist, `customTools`, `builtinToolsFenced` | SET-equality | `set(native.tools) === set(legacy.tools) ∪ {ASK,ESCALATE}` and `native.customTools === [ASK,ESCALATE, ...GUARDED∩native.tools]` and both `builtinToolsFenced === true` | none | deriving the expected customTools set from `native.tools` is self-referential (`:889-894`) — derive from `GUARDED_TOOL_NAMES` | B |
| DX-EXEC-016 | tool catalogs (refusal) | `DEF` + a `required_tool` the tier does not grant | `L-ADAPTER.run` → `validateBeforeRun` throws | `N-ADAPTER.run` → `activation_rejected` | refusal code/class, exit code, no session created | SEMANTIC (refusal family) | both refuse before any `createAgentSession` / sessionFactory call; map `DispatchRejectedError` and the legacy validation error onto one declared refusal family | N1,N2 | legacy throws and the caller exits non-zero; native emits one structured refusal — the assertion must compare the FAMILY, not the shape | B/F |
| DX-EXEC-017 | model override | `DEF` + dispatch `modelOverride:'prov/other-model'` | `L-ADAPTER.run` (override seam `runner.ts:1101-1103`) | `N-ADAPTER.run({modelOverride})` | `model`, `requestedModel`, `resolvedModel`, `modelOverride` boolean | SEMANTIC | `legacy.model === native.requestedModel === 'prov/other-model'` and `native.modelOverride === true`; `native.fallbackUsed === false` | none | G4: the legacy override seam is currently unmodelled — this scenario is the one that closes it | B |
| DX-EXEC-018 | fallback models | `DEF` with a 2-entry model chain whose head is unavailable | `L-ADAPTER.run` (circuit breaker only, starts at index 0, delta row `model resolution`) | `N-ADAPTER.run` (probe-then-skip pre-session walk, `native-host.ts:819-859`) | resolved model, `fallbackUsed`, `model_fallback` events | SEMANTIC | both end on chain entry 1; `native.fallbackUsed === true`; the legacy `fallback_used` status flag equals `native.fallbackUsed` | N1,N2,N7 | legacy starts at index 0 and native probes first — a fixture where the head IS available is a different scenario (017) | B |
| DX-EXEC-019 | thinking level | `DEF` + `thinking_level:'low'`; second variant `'bogus'` | `L-ADAPTER.run` (passes `--thinking` verbatim, delta row `thinking level`) | `N-ADAPTER.run` (validates, `native-host.ts:823-829`, `1159`) | `thinkingLevel`, refusal code | SEMANTIC | valid variant: `legacy.thinking === native.thinkingLevel === 'low'`. Invalid variant: native refuses `invalid_thinking_override`, legacy surfaces pi's own error; neither creates a session | none | legacy's invalid path depends on pi; compare refusal presence, not text | B |
| DX-EXEC-020 | output schema + validation pass | `DEF` + `prompt.output_schema` + `response_format:'markdown'`, `output_type:'analysis'` | `L-ADAPTER.run` with a session returning schema-valid output | `N-ADAPTER.run` with a session returning schema-valid output | `outputContractSchema` block from the system prompt, `validation{valid,schema}` | BYTE (schema block) + SEMANTIC (validation) | `legacy.outputContractSchema === native.outputContractSchema` BYTE; `native.validation.valid === true`; `legacy` warning count for schema is 0 | N3 | `output_validation` is native tighter than legacy warn-only (`state-machine-delta.md` row `output contract validation`) | B/F |
| DX-EXEC-021 | output validation fail / empty | `DEF` + schema; session returns `''` and then schema-invalid JSON | `L-ADAPTER.run` (warn-only, never fails) | `N-ADAPTER.run` (fails empty/whitespace, `native-host.ts:1572-1585`) | terminal status, validation errors, events | SEMANTIC-with-relation (allowlisted tightening) | declare the asymmetry: legacy `done` with a warning; native `failed` with `validation.valid === false`; assert both and assert the divergence is listed | N1,N2 | Do not assert equality. This is an intentional tightening; asserting equality would either fail forever or force a wrong legacy change | B |
| DX-EXEC-022 | reviewer diff evidence | reviewer definition + a git worktree with an uncommitted diff | `L-ADAPTER.run` (`createReviewerDiffAppendHook`, `runner.ts:1150`) | `N-ADAPTER.run` | `reviewerEvidence` block, `contextInputs` contains `reviewerDiff` | SEMANTIC | both prompts contain `## Reviewer Diff Context` and the changed path; block text equal after N3 | N3 | `execution-profile-parity.test.ts:940-959` already owns the positive-both-sides assertion; corpus adds a real non-fixture diff | E |
| DX-EXEC-023 | provider error + fallback | stub session emits a retryable provider error then succeeds on the next model | `L-ADAPTER.run` (`src/pi/session.ts` event path) | `N-ADAPTER.run` (`native-host.ts` fallback walk) | `fallbackUsed`, `model.changed` rows, `error.rpc` row, retry counters | SEMANTIC (event-family projection) | both record one provider-error row and one model transition; `fallbackUsed` equal; retry counts equal | N1,N2,N6,N7 | Native's `error.rpc` row is a known gap (`03-telemetry-observability.md` CAP-TEL-040) — mark the row as a KNOWN-GAP expectation, not a silent pass | B/C |
| DX-EXEC-024 | admission refusal | shipped definition with an absent external command | `L-ADAPTER.run` → `validateBeforeRun` throws | `N-ADAPTER.run` | refusal code, `missing` detail, exit code | SEMANTIC (refusal family) | one refusal on each side before session creation; native `activation_rejected` carries `created_ref`/`missing` (`state-machine-delta.md`) | N1,N2 | `validateBeforeRun` is PATH-dependent — pin PATH in the scenario harness | B/F |
| DX-EXEC-025 | failure / degenerate turn | stub session ends with zero assistant messages and empty output | `L-ADAPTER.run` | `N-ADAPTER.run` | terminal status, output fallback, events | SEMANTIC | both reach a terminal state; assert the fallback output text is identical after N1 | N1,N2 | `tests/unit/specialist/supervisor-empty-output-fallback.test.ts` and `supervisor-degenerate-turn.test.ts` already own legacy-side behaviour; corpus adds the cross-backend tie | B |

### B.2 Control verbs (owner Lane B / G)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-CTL-001 | waiting / keepalive | `DEF` with `interactive:true`; stub session settles after one turn | `L-ADAPTER.run({keepAlive:true})` → durable `waiting` (`supervisor.ts:115,1613-1626,2595-2601`) | `N-ADAPTER.run` → `settled`; `waiting` declared but unproduced (`types.ts:126`, `native-host.ts:1496,1587`) | durable status row, `status_change` events, forensic names | SEMANTIC-with-relation | declared `LS` divergence: legacy status string `waiting`, native `settled`; both resumable. Assert the mapping is total and that both are in their resumable sets. | N1,N2 | The native `waiting` state has no producer — an assertion that expects it will fail; assert `settled` explicitly | B |
| DX-CTL-002 | no keepalive | `DEF` + `--no-keep-alive` (`src/cli/run.ts:167`) | `L-ADAPTER.run({keepAlive:false})` | native has no equivalent (delta row `--no-keep-alive`) | terminal state, session disposed | **UNCOMPARABLE** | No native relation. Record the legacy behaviour and mark the native side `NONE`; UNCOMPARABLE, not PASS. | n/a | Easy to mistake "native always keep-alive" for parity; it is not | B |
| DX-CTL-003 | resume | job/activation parked in the resumable state; resume with a new prompt | `L-ADAPTER.resume(jobId, prompt)` via FIFO (`supervisor.ts:1971-1986`) | `N-ADAPTER.resume(activationId, prompt)` (`native-host.ts:2245-2311`) | status transition, `control_signal`/`control.resume_consumed` row, attempt identity, session reuse | SEMANTIC | both return to a running state and produce a second settlement; legacy `job_id`+`session_id` stable, native `activationId` stable and `attemptId` advanced — assert both invariants separately | N1,N2,N6 | resume gating differs: legacy waiting-only (`src/cli/resume.ts:31-42`), native 4 states (`registry.ts:94`). Fixture must use a state common to both. | B |
| DX-CTL-004 | retry (failed) | a terminal failed job/activation | `L-ADAPTER.retry(jobId)` mints a NEW job (`src/cli/retry.ts:15,55-68`) | `N-ADAPTER.retry(activationId)` retries in place (`native-host.ts:1879-1999`) | new/old identity, worktree, lease, attempt, events | SEMANTIC-with-relation | declared `LS` divergence: legacy new `job_id`, native same `activationId` + new `attemptId`; assert both sides produce a fresh execution and a fresh settlement, and that the identity rule matches the declaration | N1,N2,N3 | The identity shapes are incompatible by design — the relation must assert the RULE, not equality | B/D |
| DX-CTL-005 | retry (cancelled) | a cancelled/stopped terminal | legacy gate is `error`/`cancelled` | native gate is `failed` only | refusal | SEMANTIC | both refuse a cancelled retry; assert refusal on both, and record that native's refusal reason differs | N1,N2 | `state-machine-delta.md` marks this a blocking gap — the refusal must be asserted, not skipped | B |
| DX-CTL-006 | steer | a running job/activation | `L-ADAPTER.steer(jobId,text)` via FIFO → `session.steer` (`supervisor.ts:2554-2570`) | `N-ADAPTER`: **no `steer` method exists** (`pi-sdk.ts:90` has the session capability; host does not expose it; delta row `steer`) | `control_signal steer_consumed`, session prompt stream | **UNCOMPARABLE** | No native relation. Record as a blocking native gap; the corpus must NOT mark PASS. | n/a | `retry()`'s own error text says "steer it" with no such method (`native-host.ts:1888`) — the gap is real, not a harness artifact | B |
| DX-CTL-007 | stop | a running job/activation | `L-ADAPTER.stop(jobId)` (`src/specialist/control.ts:63-199`) | `N-ADAPTER.stop(activationId)` (`native-host.ts:2191-2215`) | terminal status, `run_complete CANCELLED` vs disposal, pid/tmux side effects, bead close, orphan reap | SEMANTIC-with-relation (allowlisted) | declared `PT`+`LS` divergence: legacy writes a durable `cancelled` status and a result row; native removes the registry row and produces no `ActivationResult` (`types.ts:261` has no `cancelled`). Assert both terminal observations and the declared asymmetry. | N1,N2,N5 | No native terminal result state exists — comparing results here is a category error | B/G |
| DX-CTL-008 | waiting auto-close | a parked job/activation past the auto-close threshold | `L-ADAPTER` (`supervisor.ts:109,2119-2171`) | native has no threshold | close event, status | **UNCOMPARABLE** | `00-capability-matrix.md` marks `waiting_auto_close_ms=0` as UNKNOWN (product decision vs unset default). Record as UNCOMPARABLE pending that decision. | n/a | Do not invent a native threshold to make the test pass | B |
| DX-CTL-009 | finalize (chain) | a 2-member chain where the reviewer returns PASS | `L-ADAPTER.finalize` (`src/specialist/control.ts:201-253`) | native has no chain/finalize concept (delta row `finalize`) | every waiting member's terminal state, `chain.ready_for_review`, `chain.finalized` | **UNCOMPARABLE** | No native relation. Record as a blocking gap. | n/a | Native `chain_kind` defaults to `prep` (`03-telemetry-observability.md` CAP-TEL-077) | B/G |
| DX-CTL-010 | ask/answer + follow-up | native ask tool emits an escalation; legacy has no ask tool | legacy: `follow_up` declared but throws (`src/pi/session.ts:1814-1816`); no ask | native `answer(messageId,body)` (`native-host.ts:2008-2021`), `needs_reply`/`escalated` states | interaction records, state transitions, events | **UNCOMPARABLE** | Native-only capability. Assert the native behaviour absolutely and record the legacy side `NONE`. | n/a | Do not call it parity; record as additive native capability | G |

### B.3 Telemetry and projections (owner Lane C)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-TEL-001 | forensic / run_start | `DEF` completing one turn | `L-ADAPTER.run` | `N-ADAPTER.run` | `observability.db` rows: `specialist_events run_start`, `specialist_forensic_events job.started` | SET-equality | `project(legacy_db, 'run_start') === project(native_db, 'run_start')` after N1,N2,N3; at least one row and `specialist_name` equal | N1,N2,N3 | `agent_start` fires at different points (`state-machine-delta.md` row `running`) | C |
| DX-TEL-002 | forensic / run_complete COMPLETE | one clean turn | `L-ADAPTER.run` | `N-ADAPTER.run` | `run_complete` row incl. `metrics{...}`, `specialist_results` row | SEMANTIC | `project(run_complete).status === 'COMPLETE'` on both; `metrics.turns`, `metrics.auto_retries`, `metrics.auto_compactions` equal; `output` equal after N1 | N1,N2,N6,N7 | native `elapsed_s` starts at first projected event, not dispatch (`03-telemetry-observability.md` CAP-TEL-063) | C |
| DX-TEL-003 | forensic / run_complete ERROR | stub session throws | `L-ADAPTER.run` | `N-ADAPTER.run` | `run_complete ERROR` + `job.failed`; result row | SEMANTIC | both emit exactly one terminal error row with equal `status`; `error` text equal after N1; exactly one `job.failed` | N1,N2,N6 | native maps `activation_rejected` to ERROR with no legacy pre-session terminal | C |
| DX-TEL-004 | run_complete CANCELLED | stop after start | legacy `run_complete CANCELLED` + result row | native `stopped`/`activation_disposed`, no result | rows, result presence | **UNCOMPARABLE** | Native has no `cancelled` terminal result (`types.ts:261`). Record the asymmetry; UNCOMPARABLE pending the destination decision. | n/a | A same-name row would be a false positive; do not fabricate one | C |
| DX-TEL-005 | status_change | one run with a settle then a resume | `L-ADAPTER` | `N-ADAPTER` | `status_change` rows in order, durable status column | SEMANTIC (ordered projection) | the ordered list of `(previous_status,status)` pairs is equal after N1; native must gain the resume re-entry row (KNOWN GAP CAP-TEL-004) | N1,N2 | native emits only one `status_change('waiting')` today | C |
| DX-TEL-006 | turn counting | stub session with 3 assistant messages in 1 turn, then 2 turns | `L-ADAPTER` | `N-ADAPTER` | `turn_summary` row count, `specialist_job_metrics.total_turns` | SEMANTIC | `count(turn_summary)` and `total_turns` equal on both (KNOWN GAP CAP-TEL-010: legacy per-turn, native per-message) | N1 | the counting basis differs today — assert equality and let the gap surface | C |
| DX-TEL-007 | log/text dedup | stub session emits the same assistant text twice consecutively | `L-ADAPTER` (dedupes via `lastPersistedAssistantMessage`, `supervisor.ts:2400-2412`) | `N-ADAPTER` (single per `message_end`) | `text` rows, `char_count` | SET-equality | exactly one `text` row per distinct message on both; multiset of `char_count` equal | N1,N2 | dedup only triggers on true duplicates; fixture must emit them adjacently | C |
| DX-TEL-008 | meta + model_change | model resolved, then a fallback hop | `L-ADAPTER` | `N-ADAPTER` | `meta` rows, `model_change` rows / forensic `model.changed` | SEMANTIC | `meta.model` equal; one `model_change`/`model.changed` row per hop on both (KNOWN GAP CAP-TEL-026/TEL-027) | N1,N2 | native emits no `model.changed` today | C |
| DX-TEL-009 | finish_reason + tokens | stub session with known `stopReason` and usage | `L-ADAPTER` | `N-ADAPTER` | `finish_reason` rows, token counters, `xtrm_llm_tokens_total` | SEMANTIC | same `finish_reason` per turn; token totals equal as sums of per-turn deltas (KNOWN GAP CAP-TEL-097) | N1,N7 | legacy per-turn vs native cumulative trajectory (CAP-TEL-097) | C |
| DX-TEL-010 | context projection | a multi-turn run | `L-ADAPTER` (`context_pct` computed, `supervisor.ts:2470-2476`) | `N-ADAPTER` (`statusOf` never sets `context_pct`, `sink:96-127`) | `context_trajectory_json`, `status_json.context_pct`, `sp metrics` ctx values | SEMANTIC | `context_pct` present and non-null for both; `context_trajectory_json` length equals turn count (KNOWN blocker CAP-TEL-028) | N1,N7 | This is an explicit blocker (C-5); the corpus asserts it and the gap must fail red | C |
| DX-TEL-011 | stale / control diagnostics | a stalled run past the silence threshold | `L-ADAPTER` (`stale_warning`, `supervisor.ts:2099-2117`) | native has no watchdog (CAP-TEL-034) | `stale_warning` / `process_health.stale_detected` rows | **UNCOMPARABLE** (blocker C-7) | Native has no producer. Record as a blocking gap; UNCOMPARABLE. | n/a | Do not simulate a timer to force a pass | C |
| DX-TEL-012 | error.rpc | stub session emits a 429-ish API error | `L-ADAPTER` (`api_error`, family `error`) | native maps `activation_failed` only (CAP-TEL-040) | `error` row with `source`, `error_message` | SEMANTIC | exactly one error row per injected error on both (KNOWN GAP CAP-TEL-040) | N1,N2 | native loses the distinct row today | C |
| DX-TEL-013 | review verdict | reviewer output with a `## Compliance Verdict` block | `L-ADAPTER` parses it (`supervisor.ts:407,423,1765`) | native has no extraction (CAP-TEL-043) | `review_verdict_*` rows, `xtrm_gate_verdicts_total` | SEMANTIC | identical verdict rows for identical reviewer output (KNOWN blocker C-9) | N1,N2 | — | C |
| DX-TEL-014 | chain + auto_commit + evidence | a run that commits and forms a chain | `L-ADAPTER` (`chain_ready_for_review`, `chain_finalized`, `auto_commit_success`, evidence refs, CAP-TEL-046/047/049/045) | native: none of these (`03-telemetry-observability.md`) | chain/git/evidence rows, `family=evidence` | **UNCOMPARABLE** | Native has no chain, no auto-commit decision, no evidence refs. Record as one blocking row per capability; do not merge into a single PASS. | n/a | Tempting to test only the legacy side and call it covered — the lane brief forbids that | C/E |
| DX-TEL-015 | feed + log + forensic + metrics | a completed run | `sp feed <id>`, `sp log <id>`, `sp forensic --family <f>`, `sp metrics` invoked against the temp store | same four verbs, native id | stdout text/JSON, exit code, row counts | SEMANTIC | each verb's normalized stdout and exit code equal across backends for the same projection; row counts equal after N1,N2 | N1,N2,N3,N6 | legacy reads job dir + obs.db; native reads obs.db only (`00-capability-matrix.md` §5.2) — the temp harness must point both at the same obs.db | C/A |
| DX-TEL-016 | ps/status/console + startup_payload | a parked and a terminal run | `sp ps --json`, `sp status <id>`, `sp console` (non-TTY snapshot) | same verbs, native id | row shape, `status_json` keys, `chain_template` label, `context_pct` in StatsLine | SEMANTIC | `sp ps --json` row key sets equal; `startup_payload_json` present on both (KNOWN blockers CAP-TEL-030/077, C-6) | N1,N2,N3 | `sp result` cannot resolve `act:` ids (`00-capability-matrix.md` §6) — that is scenario DX-ID-001 | C/A |

### B.4 Identity, recovery, settlement (owner Lane D)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-ID-001 | provenance / id mapping | one completed run each | `sp result <jobId>` | `sp result <activationId>` | result text, exit code, resolved id | SEMANTIC | `sp result` resolves BOTH id shapes to the same projected result. Today the native id is rewritten into node/member (`src/cli/result.ts:93-98`) and fails; assert exit 0 and equal result content, so the defect fails red. | N1,N2 | This is the single highest-value scenario: a real cutover blocker (§6) | D/A |
| DX-ID-002 | attempt lineage | a failed run then a retry | legacy has no attempt concept (`job_id` only) | native `attemptId` advances (`native-host.ts:509,2260`) | attempt columns on events/jobs | SEMANTIC-with-relation | legacy rows keep `attempt_no=0`/`NULL`; native rows carry `att:<12hex>:<n>`; assert a queryable lineage for every native row and the declared format difference (CAP-TEL-075) | N1,N2 | two incompatible formats in one column — assert the rule, not equality | D |
| DX-ID-003 | bead_id / issue ref | run bound to an issue ref | `L-ADAPTER` writes `bead_id` | `N-ADAPTER` writes `bead_id` = issue ref (`host:513-516`) | `specialist_jobs.bead_id`, `sp ps --bead <ref>` | SEMANTIC | both rows carry the same ref in `bead_id`; `sp ps --bead <ref>` finds both (CAP-TEL-076) | N1,N2 | column name is legacy, value is an issue ref | D |
| DX-ID-004 | trace/span correlation | one run each | legacy sets `trace_id`/`span_id` (`chain-identity.ts:58`, `sup:1244-1246`) | native sets none (blocker C-12) | `correlation.trace_id` in forensic JSON | SEMANTIC | non-null `correlation.trace_id` on both; parent/child relation equal after N2 (KNOWN blocker C-12) | N2 | — | D |
| DX-ID-005 | crash mid-run | kill the supervisor process during a turn | `L-ADAPTER` with a forced process death (`supervisor.ts:664-758` watchdog) | native host is in-process; process death loses the fleet (delta row `SIGTERM handler`) | durable status after death, crash artifact, next-load reconciliation | SEMANTIC-with-relation | declared `PT`+`LS` divergence: legacy leaves a durable `starting`/`running` row plus a crash artifact; native leaves no in-process trace. Assert both observations and the declared asymmetry. | N1,N2,N5 | Native has no crash semantics at all — this is a declared gap, not parity | D |
| DX-ID-006 | restart | restart the CLI/MCP process then read state | `L-ADAPTER` reloads job dirs + obs.db (`supervisor.ts:1193-1221`) | native lists only its own process registry (`native-host.ts:2182-2184`) | visible fleet, status rows | SEMANTIC-with-relation | legacy visible across processes; native empty. Assert both and record the divergence. | N1,N2 | — | D |
| DX-ID-007 | orphan recovery | a dead pid with a non-terminal row | `L-ADAPTER` reaps via `process-health` (`process-health.ts:454-488`) | native has no pid sweep (delta row `terminal-but-alive reap`) | status reconciled to terminal/error, reaping events | SEMANTIC-with-relation | legacy reconciles to a terminal error; native refuses new writers via lease `uncertain`. Assert both behaviours separately. | N1,N2,N5 | Native recovery is via the lease, not a sweep — different mechanism, both must be asserted | D |
| DX-ID-008 | cleanup | run several jobs, then `sp clean` | `L-ADAPTER` + `sp clean` | same verb against native rows | removed rows/dirs, retained rows | SET-equality | the set of removed ids equals the set of eligible ids on both; terminal native rows are eligible under the same rule | N1,N2,N3 | `sp clean --observability` is dual-path (`00-capability-matrix.md` §5.2) | D |
| DX-ID-009 | lease | two writers contend for one workspace | legacy serialises via active-job guards (`src/cli/run.ts:1692-1711`) | native `workspace-lease.ts:277,348`, `inspect:229` | acquire/release/inspect outcomes, refusal | SEMANTIC | the second writer is refused on both; native lease state returns to `free` after release | N1,N2,N3,N5 | native-only concept; the legacy side must be asserted via its own guard, not skipped | D |
| DX-ID-010 | crash under lease / reconcile | kill a native holder mid-write | legacy equivalent is a dead job marked error | native leaves `uncertain`, reconciled by `workspace-reconcile.ts:191` to one of `safe_free`/`recovered_holder`/`superseded`/`manual_attention_required` (`:89-93`) | lease state, reconcile outcome | SEMANTIC-with-relation | declared `PT` divergence: legacy error status vs native `uncertain` then a reconcile outcome. Assert the native outcome is one of the four enumerated values. | N1,N2,N5 | The enumerated outcome set is the contract — assert membership, not a fixed value | D |
| DX-ID-011 | settlement + journal + receipt | one completed and one failed run | legacy: bead notes/handoff is the nearest analogue; not exactly-once | native `publishSettlement` (`settlement-publication.ts:515`), `SettlementPublicationState = published / pending / refused` (`settlement-store.ts:30`) | settlement record, `journalEntryId`, `receiptId`, publication state, exclusion lease | SEMANTIC (native absolute) + UNCOMPARABLE (legacy) | native: a completed settlement reaches `published` with both `journalEntryId` and `receiptId`, exactly once across a re-run; legacy side recorded `NONE`. The exactly-once clause is asserted by re-running publication and requiring the same ids. | N1,N2 | Legacy has no counterpart; asserting equality is impossible. The value is the native absolute assertion. | D |
| DX-ID-012 | output_file | run with file output enabled | `L-ADAPTER` + `SPECIALISTS_JOB_FILE_OUTPUT=on`, `.specialists/jobs/<id>/result.txt` (`supervisor.ts:943-956`) | native has no job dir / `output_file`; settlement store is `.specialists/settlements/` (`native-host.ts:494`) | file presence, content, `latest` pointer | SEMANTIC | both make the result retrievable through the same CLI verb; the file PATHS differ by design and the path relation is declared `WS` | N1,N2,N3 | path equality is impossible; the relation must assert retrievability, not the same file | D |
| DX-ID-013 | status row vs status.json | one run with file output on | `status.json` + `specialist_jobs` row both written | native writes the row only | both artifacts' key sets | SEMANTIC | the row's projected columns equal the `status.json` projection after N1,N2,N3 (KNOWN legacy-only `status.json` write target, `00-capability-matrix.md` §5.2) | N1,N2,N3 | `status.json` is legacy-only by construction; the point is that the ROW must carry everything the file carried | D |

### B.5 Worktree and git (owner Lane E)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-GIT-001 | worktree behavior | MEDIUM definition with `requires_worktree` default true | `L-ADAPTER` provisions/uses a worktree (`src/cli/run.ts:1663-1680`) | native runs in-place (`native-host.ts:959-988` `worktreeBoundary` = in-place workspace) | session `cwd`, worktree path, branch, base pin | SEMANTIC-with-relation | declared `WS` divergence: both sessions run in a directory whose path appears verbatim in the prompt as `Assigned worktree boundary: <path>`, and the two paths differ. Assert the invariant, not path equality. | N3 | The boundary-instruction invariant already exists (`activation-parity.test.ts:389-395`) — reuse it | E |
| DX-GIT-002 | auto-commit + zero-commit | session makes 0 changes, then a second run makes changes | `L-ADAPTER` auto-commit decision (`git.auto_commit.*`, CAP-TEL-049) | native has no auto-commit (CAP-TEL-049 `NONE`) | commit sha, committed files, `auto_commit_success/skipped/failed` row, evidence | **UNCOMPARABLE** for native parity; SEMANTIC absolute for legacy | zero-commit: legacy records `skipped` with no commit; assert the legacy absolute and record the native side `NONE`. UNCOMPARABLE for the pair. | N1,N2 | Do not mark this PASS by testing the legacy side alone | E |
| DX-GIT-003 | base pin + integration record | a stale base ref | `L-ADAPTER` base-pin refusal (`src/cli/run.ts:185-193`) | native binds issue revision/hash and refuses revision divergence (`native-host.ts:707-737,1243-1259`) | refusal, `base_sha`, `integration record` row | SEMANTIC (refusal family) | both refuse a stale/divergent base before session creation; `sp integration record` output is byte-stable on both | N1,N2 | `sp integration record` is a documented byte-compatibility surface (`docs/cli-reference.md:1637-1643`) | E |

### B.6 CLI surface (owner Lane A)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-CLI-001 | CLI exit codes (success) | a clean run | `sp run --prompt ...` foreground → exit | (native CLI path does not exist; drive through MCP/library) | process exit code, stderr footer | EXIT-CODE-only | legacy exit code for a clean foreground run is asserted absolutely (0) and recorded as the target the native frontend must reproduce when it gains a CLI path | none | There is no native CLI invocation today — the native cell must honestly read `N/A (no CLI path)`; this is not a PASS | A |
| DX-CLI-002 | CLI exit codes (failure) | a session that fails | `sp run` foreground | — | exit code, stderr `Error:` line | EXIT-CODE-only | legacy non-zero exit on failure is pinned absolutely; recorded as the contract the native frontend must meet | none | same N/A caveat | A |
| DX-CLI-003 | structured JSON output | a clean run under `--json` | `sp run --json` | — | JSON schema `specialists.background_launch.v1` / stream shape | BYTE | the emitted JSON's `schema`, `type`, and key set are pinned BYTE against the documented schema | N1,N2,N3,N6 | `parseArgs` `--json`/`--raw` (`src/cli/run.ts:171-172`); background launch JSON at `:103-112` | A |
| DX-CLI-004 | background/detached | `--background` with tmux available and absent | `sp run --background` | — | exactly one launch line, handoff file, detached child, exit 0 | BYTE (line) + EXIT-CODE-only | the launch line is BYTE-identical to `formatBackgroundLaunchLine` output, and exit is 0 before the job terminates | N1,N2,N3 | tmux availability changes the branch (`src/cli/run.ts:1749-1786`) — pin tmux presence in the fixture | A |
| DX-CLI-005 | ps/status/result JSON + exit | a terminal run | `sp ps --json`, `sp status <id> --json`, `sp result <id> --json` | same three verbs on a native id | JSON key sets, exit codes | BYTE (schema) + EXIT-CODE-only | key sets pinned BYTE against the documented schemas; exit 0 on found, non-zero on not-found | N1,N2,N3,N6 | `sp result` `act:` defect (DX-ID-001) makes the native not-found path the current reality | A |

### B.7 Secondary surfaces (owner Lane G)

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-SEC-001 | node run | a 2-member node run | `sp node` → `NodeSupervisor` → `JobControl` → legacy `Supervisor` (`job-control.ts:31,58`) | native has no node runtime | node rows, member rows, ps tree | **UNCOMPARABLE** | Engine 1 nested; native models Fleet activations, not nodes (`03-telemetry-observability.md` CAP-TEL-060). Record as a blocking gap. | n/a | `supervisor impact` upstream = 113/CRITICAL because of exactly this caller | G |
| DX-SEC-002 | script/serve exit table | `sp script` with each documented outcome | `src/cli/script.ts:104-118` exit codes `0/1/2/3/4/5/6/7/75` | native has no script path | exit code, stdout JSON | EXIT-CODE-only | the full 9-value exit-code table is pinned BYTE; the scenario's purpose is to prove the corpus does NOT conflate engine 3 with the legacy backend | none | Engine 3 is independent (`00-capability-matrix.md` §3) and must not be deleted with engine 1 | G |
| DX-SEC-003 | MCP tool surface | MCP v2 `specialist_run` and friends | legacy Supervisor-constructing MCP tools (`steer_specialist.tool.ts:31`, `stop_specialist.tool.ts:17`, `resume_specialist.tool.ts:38`) | native `NativeActivationHost` via `v2-server.ts:52` | tool result JSON, durable rows | SEMANTIC | the two tool families produce the same durable projection for the same intent; where a verb is legacy-only, record the gap | N1,N2,N3 | The frontend split is real (`00-capability-matrix.md` §0.2) — this scenario exists to stop a corpus that assumes one tool surface | G |
| DX-SEC-004 | Pi extension surface | the Pi plugin activation path | — | native host via the Pi extension | activation view, events | SEMANTIC | the Pi-extension and Claude/MCP native paths produce identical activation projections for the same definition | N1,N2,N3 | both are native; this is a native-internal tie, not legacy-vs-native, and must be labelled as such | G |

### B.8 Cross-cutting scenarios that close specific gaps

| scenario id | axis | setup | legacy invocation | native invocation | observable outputs | comparison semantics | equivalence relation | normalization | false-positive risks | owner |
|---|---|---|---|---|---|---|---|---|---|---|
| DX-EXEC-026 | both-sides blindness sentinel | inject a fault that zeroes `extensions` on BOTH adapters, then a fault that zeroes only native | both adapters with a mutation hook | both adapters with a mutation hook | `diff` result | SEMANTIC | the zero-on-both case MUST fail (absolute `extensions` pin present); the zero-on-one case MUST fail. This is the executable form of `execution-profile-parity.test.ts:57-59` residual 3. | none | A corpus that passes when both sides are wrong has no value; this scenario is the corpus's own falsifier | J |
| DX-EXEC-027 | legacy override seam | `DEF` with `permission_required:'READ_ONLY'` and a runner `autonomyLevel` override | `L-ADAPTER.run({autonomyLevel:'HIGH'})` (`runner.ts:1101`) | no native counterpart | resolved tool contract | SEMANTIC (absolute) | legacy resolves the HIGH contract; assert absolutely. This closes G4. | none | Native has no override; the scenario is legacy-absolute by design and must be labelled | J |

**Scenario count: 78** (B.1 EXEC 27, B.2 CTL 10, B.3 TEL 16, B.4 ID 13, B.5 GIT 3, B.6 CLI 5,
B.7 SEC 4). Each row's PRIMARY comparison semantics, tallied:

| semantics | count | scenarios |
|---|---|---|
| BYTE | 5 | DX-EXEC-006, DX-EXEC-020, DX-CLI-003, DX-CLI-004, DX-CLI-005 |
| SEMANTIC-with-relation | 51 | all EXEC except 006/011/012/013/015/020; DX-CTL-001/003/004/005/007; all TEL except 001/004/007/011/014; all ID except 008; DX-GIT-001/003; DX-SEC-003/004 |
| SET-equality | 7 | DX-EXEC-005, DX-EXEC-012, DX-EXEC-013, DX-EXEC-015, DX-TEL-001, DX-TEL-007, DX-ID-008 |
| EXIT-CODE-only | 3 | DX-CLI-001, DX-CLI-002, DX-SEC-002 |
| UNCOMPARABLE | 12 | DX-EXEC-011, DX-CTL-002/006/008/009/010, DX-TEL-004/011/014, DX-GIT-002, DX-SEC-001 |

Some rows carry an explicit secondary clause (for example DX-CLI-004 is BYTE on the launch line
plus EXIT-CODE-only on the process code); the table classifies the row by its PRIMARY semantics,
so the five counts sum to 78. **Twelve scenarios are marked UNCOMPARABLE with a stated reason,
not dropped.** Five further cells are honestly marked `N/A (no CLI path)` inside BYTE/EXIT-CODE
rows (DX-CLI-001..005), because `sp run` has no native CLI invocation today — those are not
UNCOMPARABLE scenarios, they are native gaps inside otherwise comparable rows.

---

## C) Normalization contract

Every comparison in section B normalizes through exactly this table. A field not listed as
normalizable is **not** normalized.

### C.1 Fields that legitimately differ (normalize)

| token | field class | rule |
|---|---|---|
| **N1** | timestamps and durations | any `*_at_ms`, `t`, `started_at_ms`, `completed_at_ms`, `updated_at_ms`, `elapsed_s`, `duration_ms`, `active_runtime_ms`, `waiting_ms` → replace with a sentinel or compare within a tolerance. Tolerance for durations: `± max(250 ms, 10% of the value)`. Ordering is preserved; absolute values are not. |
| **N2** | generated identity values | `job_id`, `activation_id`, `attempt_id`, `participant_id`, `execution_binding_id`, `pi_session_id`, `workspace_id`, `session_id`, `trace_id`, `span_id`, `parent_span_id`, `journalEntryId`, `receiptId`, `claimId`, any UUID- or `act:`/`att:`-shaped string → replaced with a stable positional placeholder (`<id:1>`, `<id:2>`, …) assigned in first-observation order, identically on both sides. The placeholder MAPPING is compared, so a relation (same id appears in two rows) survives. |
| **N3** | absolute paths and roots | the scenario temp root, the fixture node_modules root, the worktree path, the job/activation directory, the observability.db path, the settlement directory → replaced with `<ROOT>`, `<NPM_ROOT>`, `<WORKSPACE>`, `<STORE>` placeholders. Symlink realpath is applied first so `/tmp` vs `/private/tmp` cannot cause a false difference. |
| **N4** | ports | any bound port in `sp serve` output, tmux/handoff URLs, or Dolt endpoints → `<PORT>`. |
| **N5** | pids, sockets, tmux names | `pid`, `ppid`, tmux session names, FIFO paths such as `steer.pipe` → `<PID>`, `<TMUX>`, `<FIFO>`. |
| **N6** | latency-sensitive scheduling artifacts | retry backoff sleeps, watchdog tick counts within a window, the number of poll iterations → canonicalized to a count, or tolerance-compared. |
| **N7** | model/provider token accounting | raw token counts are compared ONLY as monotone deltas with a `±` of one token per message; cache read/creation splits are compared as sums. This absorbs provider-side tokenizer variance without hiding a counting-basis regression (which shows as an order-of-magnitude divergence). |

### C.2 Fields that must NEVER be normalized

These are the assertion surface. Normalizing any of them makes the corpus decorative.

| token | field class | why |
|---|---|---|
| **K1** | identity keys and their relations | `bead_id`/issue ref values, the `activationId ↔ jobId` mapping, `attempt_no`, chain membership, the relation asserted in DX-ID-001/002/003. The VALUE may be replaced under N2; its presence, type, and inter-row relations may not. |
| **K2** | exit codes | every `process.exit` value, the `sp script` `0/1/2/3/4/5/6/7/75` table (`src/cli/script.ts:104-118`), foreground success/failure codes. |
| **K3** | permission decisions | the resolved tier, the granted tool allowlist membership, `builtinToolsFenced`, every admission/refusal verdict and its code (`invalid_thinking_override`, `mandatory_rules_unavailable`, `DispatchRejectedError`, `validateBeforeRun` outcomes). |
| **K4** | settlement outcome | `SettlementPublicationState ∈ {published, pending, refused}`, `journalEntryId`/`receiptId` presence, the reconcile outcome enum (`safe_free`/`recovered_holder`/`superseded`/`manual_attention_required`, `workspace-reconcile.ts:89-93`), and the exactly-once property. |
| **K5** | tool surface | the tool NAMES in `tools`/`customTools`, the guard substitution set, the deny decisions, active-tool verification results. Names are stable contract; never collapse or sort them away. |
| **K6** | evidence hashes and handoff content | `prompt_hash`, `contractHash`, issue revision numbers, base `sha`, commit shas, `pr_head_sha`, evidence refs, bead note bodies, settlement artifact content. |

---

## D) Harness design

### D.0 One scenario file, two backend adapters

A scenario is data, not code. One JSON file per area under `tests/differential/scenarios/` with
this shape:

```jsonc
{
  "id": "DX-EXEC-023",
  "axis": "provider error + fallback",
  "owner": "B/C",
  "semantics": "SEMANTIC",
  "workspace": { "git": true, "files": { "target.txt": "before\n" } },
  "definition": { "path": "config/specialists/reviewer.specialist.json" },
  "dispatch": { "modelOverride": "prov/other", "keepAlive": true, "flags": ["--keep-alive"] },
  "session": { "kind": "stub", "script": "provider-error-then-success" },
  "steps": [ { "verb": "run" } ],
  "capture": ["durable/obs.db", "durable/status", "profile", "events", "result"],
  "normalize": ["N1","N2","N3","N6","N7"],
  "expectDivergence": [{ "key": "fallbackUsed", "category": "lifetime semantics", "reason": "..." }]
}
```

The **same `session` script** drives both adapters. That is the central design decision: the
legacy `SessionLike` double (`runner.test.ts:18-34`) and the native `PiAgentSessionLike`
(`pi-sdk.ts:85-98`) are different interfaces, so the harness defines ONE abstract turn script
(`agent_start`, N × `message_end`, `agent_end{willRetry}`, `agent_settled`) and each adapter maps
it onto its own session shape. Without this, the same scenario would be authored twice and the
comparison would be about the author, not the runtimes.

### D.1 Determinism seams the harness needs

| need | legacy seam | native seam |
|---|---|---|
| clock | `Supervisor`/`Runner` read `Date.now()`; N1 covers it, but `now` injection would be stronger | `NativeActivationHostDeps.now` (`native-host.ts:377,492`) |
| SDK / session | `RunnerDeps.sessionFactory` (`runner.ts:121,1016`), default `PiAgentSession.create` | `NativeActivationHostDeps.loadSdk` (`native-host.ts:374,491`); `setPiSdkForTesting`/`resetPiSdkCache` (`pi-sdk.ts:192-200`) |
| work items | `BeadsClient` double / `testWorkItems` (`tests/utils/test-work-items.ts`) | `NativeActivationHostDeps.workItems` |
| forensics | `HookEmitter` (`runner.ts:118`) | `NativeActivationHostDeps.forensics` (`ActivationForensicSink`, `activation-parity.test.ts:197-200` pattern) |
| admission | real `validateBeforeRun` | `NativeActivationHostDeps.admission` (`native-host.ts:404-417`) |
| settlement | n/a | `NativeActivationHostDeps.settlements` (memory store, `settlement-store.ts:258`) |
| authority | n/a | `NativeActivationHostDeps.authority` (`native-host.ts:395`) |
| durable store | temp `jobsDir` + temp obs.db via `resolveObservabilityDbLocation`/`resolveJobsDir` | temp obs.db, memory settlement store, file authority writer under a temp root |

**Missing seam, flagged:** both backends mint ids with `crypto.randomUUID()` directly
(`native-host.ts:507`, `supervisor.ts:1437`). N2 handles this by placeholder mapping, but a seed
seam would remove the ordering ambiguity in the placeholder assignment. **UNKNOWN U-3.**

### D.2 Legacy adapter

```
legacyAdapter.run(scenario):
  root = tempRoot(scenario)                       // git init if required
  spec = loadDefinition(scenario)
  session = sessionDouble(scenario.session)       // legacy SessionLike shape
  runner = new SpecialistRunner({ loader, hooks, circuitBreaker,
                                  sessionFactory: async () => session })   // runner.ts:1016
  supervisor = new Supervisor({ runner, runOptions, jobsDir: root/.specialists/jobs })
  jobId = await supervisor.run()                  // supervisor.ts:1431
  return capture(root, jobId)
```

This is a **real legacy Supervisor**. It does not require the `pi` binary because the session is
injected at the factory, which is a documented production seam (`runner.ts:120-121`), not a test
backdoor. It is still not the full `sp run` CLI (no `parseArgs`, no worktree policy, no
`launchSpecialist` footer) — that residue is stated in F/UNKNOWN U-1 and is why DX-CLI-001/002
are EXIT-CODE-only.

### D.3 Native adapter

```
nativeAdapter.run(scenario):
  root = tempRoot(scenario)
  host = new NativeActivationHost({
    loader: { get: async () => loadDefinition(scenario) },
    workItems: testWorkItems({ blockers: scenario.blockers }),
    forensics: recordingSink(),
    loadSdk: async () => sdkDouble(record, sessionDouble(scenario.session)),
    cwd: root,
    now: scenario.clock,
    settlements: createMemorySettlementStore(),
    authority: recordingAuthorityWriter(),
    admission: scenario.admission ?? noopAdmission,
  })
  handle = await host.start(request)              // native-host.ts:506
  await handle.result
  return capture(root, handle)
```

This mirrors `execution-profile-parity.test.ts:597-682` exactly, including the `admission`
injection rationale (`native-host.ts:404-417`) and the model-override requirement (every shipped
definition configures no model, so the sweep injects one — `:461-465`).

### D.4 Capturing both durable stores

The comparison reads the **stores**, not the in-memory objects, wherever a store exists:

- `observability.db` — one temp DB per scenario, shared by both adapters so a single query
  answers both (this is the producer rule in `forensic-sink.ts:1-21`). Read through the existing
  query surfaces (`readForensicEvents`, `loadStatuses`, the metrics renderer) rather than raw SQL,
  so the projection under migration is the thing compared.
- legacy job dir — `status.json`, `result.txt`, `events.jsonl` (`supervisor.ts:943-956`). Projected
  into the same row shape as the obs.db row so DX-ID-013 is a real comparison.
- native settlement store — `settlement-store.ts:51-158`; `publicationStateOf` is the query.
- native authority store — the injected `AuthorityWriter` records its writes; the project reads
  them back through the same Fleet projection the production server exposes.

`capture()` returns a normalized `DifferentialRecord`:
`{ profile, durable, events, result, exit, stdout, stderr }`. The diff function is the same
field-by-field reporter as `execution-profile-parity.test.ts:395-415` (so a failure names the
field), extended with the semantics enum and the `expectDivergence` list.

### D.5 CI without model spend

Two modes, declared per scenario in the `session` field:

1. **`stub` (default, zero spend).** A scripted `PiAgentSessionLike` / `SessionLike` double. No
   network, no SDK auth. `execution-profile-parity.test.ts:535-556` and
   `activation-parity.test.ts:148-195` are the provenance for the native double; `runner.test.ts:18-34`
   is the provenance for the legacy double. The `spawn` guard those suites install
   (`execution-profile-parity.test.ts:68-76`) is KEPT: a scenario that unexpectedly spawns must
   fail loudly, not silently pass.
2. **`live` (opt-in, real model).** Gated exactly like `substrate-parity.test.ts:19-23`: a single
   env var (`XTRM_DIFFERENTIAL_LIVE=1`), `describe.skipIf(!LIVE)`, never in the default public
   gate. Only scenarios whose observable depends on a real provider belong here: DX-EXEC-018
   (real availability probe), DX-EXEC-019 (real `--thinking` rejection), DX-EXEC-023 (real
   provider error), DX-TEL-009 (real tokenizer), DX-TEL-010 (real context accounting). Every
   other scenario in section B runs on the stub.

The default suite therefore has **zero model spend** and runs the 73 stub scenarios; the five
live scenarios are a separate, opt-in job.

### D.6 Where the harness lives

| artifact | path | status |
|---|---|---|
| scenario schema + loader | `tests/differential/scenario.ts` | NEW |
| legacy adapter | `tests/differential/legacy-adapter.ts` | NEW |
| native adapter | `tests/differential/native-adapter.ts` | NEW |
| shared record + diff + normalization | `tests/differential/record.ts` | NEW |
| scenario files | `tests/differential/scenarios/*.json` | NEW |
| corpus runner | `tests/differential/corpus.test.ts` | NEW |
| live-gated subset | `tests/differential/live.test.ts` | NEW |

No file under `src/` changes. The harness consumes the existing seams; it does not add new ones
(that is why U-3 is an UNKNOWN rather than a proposed refactor).

---

## E) Minimal CI-viable subset (highest cutover risk per unit of runtime)

Ten scenarios, all `stub` mode, all deterministic, all under ~30 s total. They are chosen so
that each one is either a **live production defect** or a **silent-drop class** the audit already
proved, and so that the set covers all four divergence categories.

| rank | scenario | why it is in the minimal set | runtime |
|---|---|---|---|
| 1 | **DX-ID-001** `sp result` id mapping | Live cutover blocker (`00-capability-matrix.md` §6): every native id contains `:` and resolves to "No node matching ref: act". Fails red today; highest value per line. | <1 s |
| 2 | **DX-TEL-001/002** run_start + run_complete | The two terminal telemetry rows every projection reads. A silent drop here breaks `sp ps`, `sp log`, `sp feed`, `sp metrics` at once. | ~2 s |
| 3 | **DX-EXEC-008** mandatory-rules unavailable | Asserted `LS` asymmetry: legacy warn-and-continue vs native fail-closed. If this is tested as equality it either fails forever or masks a wrong change. Proves the divergence vocabulary works. | ~1 s |
| 4 | **DX-EXEC-021** output validation fail/empty | Same class as 3 but on the output contract. Native fails, legacy warns. | ~1 s |
| 5 | **DX-CTL-003** resume | The only control verb both backends produce. Covers attempt advancement, status re-entry (KNOWN GAP CAP-TEL-004), and the resumable-set divergence (`registry.ts:94`). | ~2 s |
| 6 | **DX-CTL-007** stop | Terminal asymmetric: legacy durable `cancelled` + result row vs native disposal + no result (`types.ts:261`). A careless cutover here loses the operator's result verb. | ~2 s |
| 7 | **DX-TEL-005** status_change sequence | The ordered transition projection. Catches the native missing resume re-entry and any both-sides sequence drift. | ~1 s |
| 8 | **DX-ID-011** settlement + journal exactly-once | Highest-consequence native-only property (PR #372 rewrote it for cross-process exactly-once). A re-run must produce the SAME `journalEntryId`/`receiptId` pair. | ~2 s |
| 9 | **DX-GIT-002-zero** zero-commit auto-commit | The highest-frequency real-world path: a run that changes nothing. Recorded as an explicit disconnect (legacy `skipped`, native `NONE`) so it cannot be silently declared parity. | ~2 s |
| 10 | **DX-EXEC-026** both-sides blindness sentinel | The corpus's own falsifier. Without it, a future refactor can zero both adapters and the whole suite stays green (the exact defect `execution-profile-parity.test.ts:57-59` records). | ~1 s |

Deliberately excluded from the minimal set: DX-EXEC-001..004 (already owned by
`execution-profile-parity.test.ts`; re-running them doubles runtime for no new signal — the full
corpus still imports the same diff function), and every `live` scenario.

---

## F) UNKNOWNs

| id | unknown | why it is unknown | needed to resolve |
|---|---|---|---|
| U-1 | Whether a real `sp run` subprocess can be driven in CI at all, and at what cost. The legacy adapter drives `Supervisor` + injected session, not `parseArgs` → `launchSpecialist` → footer. | `execution-profile-parity.test.ts:44-50` states running the legacy path needs a real `pi` subprocess and the suite forbids one; G2/G9 record the residue. | A prototype that spawns `bun run src/index.ts run` against a fake `pi` shim on PATH, and a measurement of whether it is stable in the CI container. |
| U-2 | Whether the **built** `dist/` must be the comparison target. | `00-capability-matrix.md` §5.5: `dist/` is tracked (397 files) and `plugins/specialists/scripts/mcp-server.mjs` resolves `dist/index.js`. A `src/`-only corpus proves nothing about the published surface. | A coordinator decision on whether the corpus runs against `src/` (fast, dev) plus a release-gate job against `dist/` (slow, publishable). |
| U-3 | Whether the id minting in both backends can be seeded. | `native-host.ts:507` and `supervisor.ts:1437` call `crypto.randomUUID()` directly with no injection seam. N2 placeholder mapping works, but first-observation ordering is not guaranteed when ids are observed out of order. | Either a seed/injection seam (a `src/` change, outside this audit's no-modify rule) or a coordinator acceptance that placeholder ordering is compared as a set, not a sequence. |
| U-4 | Whether `waiting_auto_close_ms=0` means "disabled" or "unset default". | `00-capability-matrix.md` and `state-machine-delta.md` both flag this; the source default is not disambiguated in the delta. It decides whether DX-CTL-008 is UNCOMPARABLE or a real legacy behaviour to port. | `sb issue show` on the originating capability, or the commit that introduced the threshold. |
| U-5 | Whether `sp node` (engine 1 nested) is in scope for the cutover or moves to Core. | `00-capability-matrix.md` §5.6 lists it as a `MOVE_TO_CORE` candidate; `07-secondary-surfaces.md` records `Supervisor` impact = 113/CRITICAL because of this caller. DX-SEC-001 cannot be scoped until the destination is decided. | A coordinator product decision recorded against `CAP-TEL-060`. |
| U-6 | Whether the native `waiting` state will ever be produced, or should be struck. | `state-machine-delta.md` row `waiting`: the state is declared (`types.ts:126`) and in `RESUMABLE_STATES` (`registry.ts:94`), but `NativeActivationHost` never assigns it. | A decision recorded against the `waiting` capability row; it decides DX-CTL-001's relation. |
| U-7 | Whether `sp result`'s `act:` rewrite (DX-ID-001) is fixed before or during cutover. | The audit records it as a live defect and a blocker but explicitly does not fix it (`00-capability-matrix.md` §6, no-opportunistic-fix rule). | The fix landing decides whether DX-ID-001 asserts the defect or the repaired behaviour; the scenario must be written so the expected value flips in one place. |
| U-8 | Whether the `sp serve`/`sp script` exit-code table survives cutover unchanged. | `00-capability-matrix.md` §3 calls it a byte-compatibility surface with out-of-tree consumers (`handoff-feedor.md`, `docs/specialists-service.md`), but no consumer census exists in this audit. | A positive consumer proof, required by the `DEAD_AFTER_CUTOVER` enum's own rule. |
| U-9 | Whether a forensic-sink double that records event NAME only (as today) is sufficient, or whether bodies must be captured. | `activation-parity.test.ts:197-200` records names only; the telemetry scenarios (B.3) compare row CONTENT, which needs the bodies. No existing double records bodies. | A decision on whether the corpus reads bodies from `observability.db` (preferred, D.4) instead of from the sink. |
| U-10 | Whether `DX-EXEC-018`'s fallback fixture can be made deterministic without a live model. | Legacy starts at chain index 0 and uses only the circuit breaker; native probes availability before session creation (`native-host.ts:819-859`). Whether the native availability probe is itself injectable is not established here. | A read of `native-host.ts:819-859` against the model-probe double used in `tests/unit/specialist/model-probes.test.ts`. |

---

*End of Lane J artifact. No source file was modified. The scenario count is 78; 12 scenarios are
explicitly UNCOMPARABLE with a stated reason; the minimal CI subset is 10 stub-mode scenarios.*
