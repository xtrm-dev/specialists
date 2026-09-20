# XTRM-93 Lane F — Specialist Definitions, Schema, `user.json`, Mandatory Rules

Audit date: worktree `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`, branch `xt/akkh`,
HEAD `6553ef05` (master `472b1aef` + local `rx1bu`).
GitNexus index verified fresh for this tree: `.gitnexus/meta.json` → `lastCommit 6553ef05877a263384d6572980cc6e4affc3952a`,
`branch xt/akkh`.

## 0. Method and evidence standard

| Method | Where used |
|---|---|
| GitNexus CLI (`node .gitnexus/run.cjs context\|impact\|query --repo .`) | symbol-level caller resolution |
| `gitnexus_*` MCP tools | **not available in this agent's tool surface** — the CLI was used as the documented fallback (`.claude/skills/gitnexus-cli/SKILL.md`). The worktree index exists and is at HEAD, so the CLI result is equivalent to the MCP result |
| `grep -rn` across `src/`, `config/` | mandatory for this lane: GitNexus does not model plain-object property reads, so field-level consumers must be resolved textually |

**Explicit GitNexus limitation recorded (not a workaround, a finding).** Every specialist config field is read by
plain-object property access (`spec.specialist.execution.timeout_ms`). GitNexus returns `risk: UNKNOWN` with
`riskNote: "No callers resolved… plain-object property access … produces no edge to find"` for these
(`impact beads_write_notes`, `impact notes_mode`; `impact beads_integration|requires_worktree|auto_commit` →
`"Target not found"`). Per the repo's own rule, `UNKNOWN` is treated as unresolved, not as all-clear, and each such
field was confirmed by targeted `grep` over `src/` only. Every consumer cell below therefore cites a `file:line`
produced by grep, except where GitNexus supplied the call graph.

**Side taxonomy used in column 5.**
- `legacy` = the `sp run` path: `src/cli/run.ts` → `src/specialist/launch.ts` → `src/specialist/supervisor.ts` → `src/specialist/runner.ts`.
- `native` = `src/activation/native-host.ts` (`NativeActivationHost`), entered from `src/server.ts:153` and `src/mcp/v2-server.ts:105`. There is **no CLI subcommand** for native dispatch — a `grep` for `NativeActivationHost` finds only MCP/server constructors.
- `script` = the separate `sp script` / `sp serve` surface: `src/specialist/script-runner.ts` via `src/cli/script.ts:149` and `src/cli/serve.ts:397`.
- `shared` = read by more than one of the above.

## A) Field classification table

Root paths are relative to the JSON `specialist` object unless stated. `schema.ts` = `src/specialist/schema.ts`.

### A.1 `specialist.execution`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `mode` | `src/specialist/schema.ts:20` | enum `tool\|skill\|auto`, default `auto` | **none at runtime.** Only: schema validation `schema.ts:20`; error string `schema.ts:275`; enum allow-list for `sp edit` `src/cli/edit.ts:36`; help text `src/index.ts:529` | none | **stale** | DELETE field + schema line + `edit.ts:36` entry + `index.ts:529` example | grep `execution\.mode` over `src/` returns only `schema.ts` and CLI metadata; GitNexus `impact` finds no symbol. All 24 shipped configs set it (`tool`×19, `auto`×5) and nothing reads the value |
| `model` | `schema.ts:21` | `string \| null`; non-null enforced at load | `src/specialist/loader.ts:500` (missing-model gate), `:467`; `src/specialist/model-chain.ts:8`; `src/activation/native-host.ts:819`; `src/cli/view.ts:250`; `src/cli/render-task.ts:175`; `src/cli/setup.ts:368`; `src/cli/console/config-source.ts:59` | shared | shared-current-concept | KEEP | grep + `impact` resolve `loader.ts` gate and `model-chain.ts` |
| `surface_models` | `schema.ts:22` | `Record<string,string>` optional | `src/cli/view.ts:251`; `src/cli/render-task.ts:175` | legacy (CLI render/inspect only) | legacy-only | KEEP while `sp view`/`sp render-task` live; DELETE with them | grep `surface_models` → only those two readers; `native-host.ts` has 0 matches |
| `fallback_model` | `schema.ts:23` | `string \| null` optional | `src/specialist/model-chain.ts:14,16,21`; preset typing `src/specialist/preset-resolver.ts:193` | shared | shared-current-concept | KEEP | `model-chain.ts` is imported by `native-host.ts:59` and consumed at `:819` |
| `fallback_models` | `schema.ts:24` | `string[] \| null` optional | `src/specialist/model-chain.ts:14,15,18`; `native-host.ts:819` | shared | shared-current-concept | KEEP | same |
| `timeout_ms` | `schema.ts:25` | `number`, default `120000` | `src/specialist/runner.ts:1337,1402,1454`; `src/specialist/script-runner.ts:880` | legacy + script | **legacy-only** | KEEP until legacy cutover, then DELETE or port a native equivalent (see §C-2) | `grep` in `native-host.ts`: 0 matches |
| `stall_timeout_ms` | `schema.ts:26` | `number` optional | `runner.ts:1378`; `script-runner.ts:1136`; `preset-resolver.ts:198` | legacy + script | **legacy-only** | KEEP until legacy cutover, then DELETE (native is settle-driven, no stall detector) | `native-host.ts`: 0 matches |
| `max_retries` | `schema.ts:27` | `int >= 0`, default `0` | `runner.ts:1348` (`maxAttempts = maxRetries + 1`) | legacy | **legacy-only** | KEEP until cutover; native has its own retry/fallback walk (`native-host.ts:1748-1753`) that is NOT configurable | `native-host.ts`: 0 matches |
| `interactive` | `schema.ts:28` | `boolean`, default `false` | `runner.ts:1097` (keep-alive); `loader.ts:469`; `src/cli/list.ts:406`; `src/cli/view.ts:184`; `script-runner.ts:188` (`CompatGuardError`) | legacy | **legacy-only** | DELETE after cutover. Native has no keep-alive: every activation settles (`native-host.ts:1664` comment) | `native-host.ts`: 0 matches; 24/24 configs set it |
| `stdout_limit_bytes` | `schema.ts:29` | `int > 0` optional | `script-runner.ts:592` | script | legacy-only (script surface) | KEEP for `sp script` / `sp serve`; out of scope for the native cutover | grep → single reader |
| `prompt_limit_bytes` | `schema.ts:30` | `int > 0` optional | `script-runner.ts:580` | script | legacy-only (script surface) | KEEP for `sp script`; see §C-3 re native | grep → single reader; 1/24 configs sets it |
| `response_format` | `schema.ts:31` | enum `text\|json\|markdown`, default `text` | `runner.ts:1217`; `script-runner.ts:294,641,883`; `native-host.ts:921,1030` | shared | shared-current-concept | KEEP | three-sided reader list |
| `output_type` | `schema.ts:33` | enum (8 values), default `custom` | `runner.ts:1218`; `script-runner.ts:472,897,927,956,989,1010,1029`; `native-host.ts:1031` | shared | shared-current-concept | KEEP | three-sided reader list |
| `permission_required` | `schema.ts:40` | enum tier, default `READ_ONLY` | `native-host.ts:614,620` (`tier` → `WorkspaceAccess`); `src/cli/run.ts:1664`; `loader.ts:468`; `view.ts`/`list.ts` badges | shared | shared-current-concept | KEEP | native reads it for admission + lease path |
| `requires_worktree` | `schema.ts:42` | `boolean`, default `true` | `src/cli/run.ts:1665,1670`; `script-runner.ts:94,189` (`CompatGuardError`) | legacy | **legacy-only** | DELETE after cutover. Native deliberately forbids per-activation worktrees (`src/activation/types.ts:107`) | `native-host.ts`: 0 matches; 7/24 configs set `false` |
| `bare` | `schema.ts:43` | `boolean`, default `false` | `runner.ts:1225`; `task-prompt.ts:179`; `system-prompt.ts:142,190`; `native-host.ts:1041`; `script-runner.ts:840` | shared | shared-current-concept | KEEP | native reads it into `buildSystemPrompt` |
| `thinking_level` | `schema.ts:45` | enum, optional | `runner.ts:1373`; `native-host.ts:829,1159,1294,941,2291`; `script-runner.ts:947` | shared | shared-current-concept | KEEP | native reads it for every attempt incl. fallback |
| `auto_commit` | `schema.ts:46` | enum `never\|checkpoint_on_waiting\|checkpoint_on_terminal`, default `never` | `runner.ts:1536` (metrics only); `src/specialist/supervisor.ts:1707,1929,1930,1931,1942`; blocked-override `schema.ts:214` | legacy | **legacy-only** | DELETE after cutover. Native publishes through settlement, never git commits | `native-host.ts`: 0 matches; 6/24 configs set it |
| `extensions` | `schema.ts:51` | `Record<string, boolean>` optional | `loader.ts:246-251,590-604,633-645` (merge + npm-collision reject); `native-host.ts:742`; `runner.ts` session factory; `src/pi/session.ts` | shared | shared-current-concept | KEEP. `extensions.serena` is a **retired key** — see D-2 | native reads it via `resolveExecutionExtensionSelection` (`native-host.ts:742`) |
| `expected_output_keys` | `schema.ts:56` | `string[]` optional | `script-runner.ts:633,635,641,883` (`collectRequiredOutputKeys`) | script | legacy-only (script surface) | KEEP for `sp script`; DELETE if `sp script` is retired | 1/24 configs sets it (`executor`) |

### A.2 `specialist.prompt`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `system` | `schema.ts:60` | `string` optional | `runner.ts:1370`; `native-host.ts:1039`; `script-runner.ts:1117` | shared | shared-current-concept | KEEP | 24/24 configs set it |
| `system_prompt_mode` | `schema.ts:61` | enum `append\|replace` optional | `runner.ts:1371` → `src/pi/session.ts:1166`; `script-runner.ts:944,947,1262`; global override `src/specialist/global-config.ts:104,195` | legacy + script | **legacy-only** | KEEP for legacy; **native gap** — see §C-1 | `buildSystemPrompt` (`system-prompt.ts:159`) has no mode parameter and `native-host.ts` never passes one; grep `system_prompt_mode` in `native-host.ts` = 0 |
| `task_template` | `schema.ts:62` | `string` required | `task-prompt.ts:230,240`; consumed by native at `native-host.ts:1042` (`renderTaskPrompt`) | shared | shared-current-concept | KEEP | 24/24 configs set it |
| `output_schema` | `schema.ts:63` | `Record<string,unknown>` optional | `runner.ts:1219`; `script-runner.ts:295,642`; `native-host.ts:1035` via `resolveOutputContractSchema` | shared | shared-current-concept | KEEP | 9/24 configs set it |
| `skill_inherit` | `schema.ts:64` | `string` optional | `runner.ts:1282`; `script-runner.ts:200,219-221` (`CompatGuardError`, root containment) | legacy | **legacy-only** | DELETE after cutover | `native-host.ts`: 0 matches; 0/24 configs set it |
| `script_template` | **not declared** (absorbed by `.passthrough()` at `schema.ts:65`) | `string` | **no consumer anywhere** | none | **stale** | DELETE from config data | grep `script_template` over `src/` = 0 hits |

### A.3 `specialist.skills` and script entries

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `skills.paths` | `schema.ts:80` | `string[]` optional | `loader.ts:693-700` (`resolveSkillsPaths`), `:288-300` (append+dedup); `native-host.ts:1143`; `runner.ts:1282`; `task-prompt.ts:72` | shared | shared-current-concept | KEEP | native loads them into the resource loader |
| `skills.scripts` | `schema.ts:82` | `ScriptEntry[]` optional | `native-host.ts:787,789,793`; `runner.ts:1120+`; blocked-override `schema.ts:217` | shared | shared-current-concept | KEEP | native runs pre-phase scripts and refuses on required failure (`native-host.ts:789-796`) |
| `ScriptEntry.run` | `schema.ts:71` | `string` | `native-host.ts:788`; `runner.ts` | shared | shared-current-concept | KEEP | — |
| `ScriptEntry.phase` | `schema.ts:72` | enum `pre\|post` | `native-host.ts:787` filter; `runner.ts` | shared | shared-current-concept | KEEP | — |
| `ScriptEntry.inject_output` | `schema.ts:73` | `boolean`, default `false` | `native-host.ts:793`; `runner.ts` | shared | shared-current-concept | KEEP | — |
| `ScriptEntry.required` | `schema.ts:75` | `boolean` optional | `native-host.ts:789`; `runner.ts` | shared | shared-current-concept | KEEP | — |

### A.4 `specialist.capabilities`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `required_tools` | `schema.ts:87` | `string[]` optional | `runner.ts:422-439` (`validateBeforeRun`) | shared (via admission) | shared-current-concept | KEEP | `native-host.ts:765` calls `this.admission(specialist, tier, toolContract)`; default is `validateBeforeRun` (`native-host.ts:495`) |
| `external_commands` | `schema.ts:89` | `string[]` optional | `runner.ts:415-418` (`validateBeforeRun`) | shared (via admission) | shared-current-concept | KEEP | same call site |

### A.5 `specialist.permissions`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `permissions.<TIER>.denied_natives_when_extension` | `schema.ts:113` | `string[]` optional | `src/specialist/manifest-resolver.ts:94,103-106`; `src/specialist/resolution-diagnostics.ts:171-177`; `native-host.ts:747` (`specialistPermissions`); `src/tools/specialist/specialist_list.tool.ts:76` | shared | shared-current-concept | KEEP | native passes the field into tool-contract resolution |
| `permissions.<TIER>.denied_natives_mode` | `schema.ts:114` | enum `soft\|hard` optional | `manifest-resolver.ts:94,109` | shared | shared-current-concept | KEEP | — |

3/24 configs declare `permissions` (all `READ_ONLY`).

### A.6 `specialist.validation`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `files_to_watch` | `schema.ts:94` | `string[]` optional | `loader.ts:478` → `SpecialistSummary.filestoWatch`; `loader.ts:90,94` (`checkStaleness`); `src/cli/status.ts:338` | legacy (introspection/staleness only) | legacy-only | KEEP as an operator tool; not a runtime input | `native-host.ts`: 0 matches; `runner.ts`: 0 matches |
| `stale_threshold_days` | `schema.ts:96` | `number` optional | `loader.ts:479,99` | legacy | legacy-only | KEEP as an operator tool | same |
| `stale_threshold_ms` | **not declared** (`.passthrough()` at `schema.ts:97`) | `number` | **no consumer** | none | **stale** | DELETE from `config/specialists/transcriber.specialist.json:41` | grep `stale_threshold_ms` over `src/` = 0 hits |

### A.7 `specialist.stall_detection`

All five leaves are read only by the legacy `Supervisor`. Native has zero readers (`native-host.ts` grep = 0 for `stall_detection`, `stallTimeoutMs`).

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `running_silence_warn_ms` | `schema.ts:126` | `number` optional | `src/specialist/supervisor.ts:105` (`STALL_DETECTION_DEFAULTS`), `:1340`, `:2086` | legacy | legacy-only | DELETE with the supervisor | `native-host.ts` grep = 0 |
| `running_silence_error_ms` | `schema.ts:128` | `number` optional | `supervisor.ts:105,1340,2086` | legacy | legacy-only | DELETE with the supervisor | same |
| `waiting_stale_ms` | `schema.ts:130` | `number` optional | `supervisor.ts:105,1340,2086` | legacy | legacy-only | DELETE with the supervisor | same |
| `waiting_auto_close_ms` | `schema.ts:132` | `number \| null` optional | `supervisor.ts:109,1341,2087`; override surface `global-config.ts:108,197`; allow-list `schema.ts:189-191` | legacy | legacy-only | DELETE with the supervisor; also remove from `user.json` template and `getGlobalSpecialistOverrideLeafPaths()` | `native-host.ts` grep = 0 |
| `tool_duration_warn_ms` | `schema.ts:134` | `number` optional | `supervisor.ts:105,1340,2086` | legacy | legacy-only | DELETE with the supervisor | same |
| `stall_detection` (container) | `schema.ts:124-135` | object optional | `loader.ts:59,480`; `launch.ts:96` | legacy | legacy-only | DELETE with the supervisor | — |

### A.8 `specialist.mandatory_rules`

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `template_sets` | `schema.ts:107` | `KebabCase[]`, default `[]` | `mandatory-rules.ts:369`; merge `loader.ts:317-336`; introspection `src/cli/list-rules.ts:242,260`; `src/cli/doctor.ts:711,713`; override surface `global-config.ts:126,205` | shared | shared-current-concept | KEEP | native forces resolution (`native-host.ts:998-1013`) and emits `mandatory_rules_injection` |
| `disable_default_globals` | `schema.ts:108` | `boolean`, default `false` | `mandatory-rules.ts:377,378,410`; blocked-override `schema.ts:219` | shared | shared-current-concept | KEEP — but see §E-1: its documented scope in `config/mandatory-rules/README.md` disagrees with the code | code suppresses only the `workflow-quick-rules` global; README is silent on `Beads Workflow Quick Rules` being the thing suppressed |
| `inline_rules` | `schema.ts:109` | `MandatoryRule[]`, default `[]` | `mandatory-rules.ts:372,409`; blocked-override `schema.ts:218` | shared | shared-current-concept | KEEP | 2/24 configs use it (`test-engineer`) |

### A.9 Top-level `specialist.*` (the legacy/backend-boundary block)

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `output_file` | `schema.ts:149` | `string` optional | `runner.ts:1081,1508` (`writeJobFileOutput`); `supervisor.ts:1780,1859-1864`; `launch.ts:91`; override `schema.ts:206`, `global-config.ts:136,202`; console hint `src/cli/console/config-source.ts:73` | legacy | **legacy-only** | DELETE from schema, configs, `user.json` template, override allow-list, console hints. Native publishes to the Substrate Journal instead (`native-host.ts:2410`) | `native-host.ts` grep = 0; 4/24 configs set it |
| `notes_mode` | `schema.ts:150` | enum `full-trail\|final-only`, default `full-trail` | `launch.ts:83`; `supervisor.ts:1779,1826,1842,1861`; override `schema.ts:206`, `global-config.ts:135,201`; console glow `config-source.ts:82` | legacy | **legacy-only** | DELETE from schema, `user.json` template, override allow-list, console hints. 2/24 configs set `final-only` | `native-host.ts` grep = 0 |
| `beads_integration` | `schema.ts:152` | enum `auto\|always\|never`, default `auto` | `runner.ts:1323` → `shouldCreateBead`; `src/specialist/beads.ts:297`; error string `schema.ts:277`; enum allow-list `edit.ts:35`; `view.ts:217`; `quickstart.ts:184`; **native note only** `native-host.ts:2407,2412,2413` | legacy | **legacy-only** | DELETE from schema and all 24 configs. The native side already declares it inert; the note at `native-host.ts:2412-2414` must be deleted with it | 24/24 configs set `auto`; all `auto` = today the note never fires for shipped defs |
| `beads_write_notes` | `schema.ts:154` | `boolean`, default `true` | `src/cli/run.ts:1891`; `launch.ts:41,82`; `supervisor.ts:1778`; override `schema.ts:206`, `global-config.ts:134,200`; `view.ts:218`; console `config-source.ts:72`; **native note only** `native-host.ts:2407,2409,2410` | legacy | **legacy-only** | DELETE from schema, `user.json` template, override allow-list, console hints. Not the same as the global `notes_mode` | `native-host.ts:1272` calls `legacyOnlyConfigNotes(specialist.specialist)` — a *diagnostic* note, not an enforcement path |

### A.10 Undeclared / passthrough fields present in config data

| field | declared in (file:line) | type/default | consumers (file:line) | side | classification | post-cutover action | evidence |
|---|---|---|---|---|---|---|---|
| `specialist.communication` | **not declared** (`.passthrough()` `schema.ts:155`) | object | `src/cli/view.ts:22,238` (display only) | legacy (introspection) | **stale** — undeclared, persisted, never enforced | DELETE from `config/specialists/{quant-methodologist,quant-researcher,service-knowledge-sync,transcriber}.specialist.json` and remove `view.ts:22,238` | grep `communication` over `src/` finds only `view.ts`; `next_specialists` / `publishes` (its only children) have **0** consumers |
| `specialist.communication.next_specialists` | not declared | `string[]` | none | none | stale | DELETE (3/24 configs) | grep = 0 hits in `src/` |
| `specialist.communication.publishes` | not declared | `string[]` | none | none | stale | DELETE (1/24 configs) | grep = 0 hits in `src/` |

### A.11 Generated `~/.config/specialists/user.json` keys

Writer set (three writers, all via `writeGlobalUserConfig`):

| writer | file:line | note |
|---|---|---|
| `sp init --global` seed / merge | `src/cli/init.ts:742,750,754,770` | uses `buildGlobalUserConfigTemplate` + `mergeGlobalUserConfig` |
| `sp edit --global` | `src/cli/edit.ts:12` (import), `:715` (TTY gate) | per-field path writes |
| `sp console` config pane | `src/cli/console/config-source.ts:487` (`writeGlobalConfigSafe`) | mtime-guarded full-document write |

`readGlobalUserConfig` is called by the loader at `src/specialist/loader.ts:378` — **it is the only runtime read**.

| user.json key | emitted at (file:line) | validated at | consumers | side | classification | post-cutover action |
|---|---|---|---|---|---|---|
| `_doc` | `global-config.ts:217,276` | filtered out `:160` | none (documentation sentinel) | n/a | compatibility-alias (doc pointer to `overrides-guide.md`, `global-config.ts:36`) | KEEP — harmless, but re-point at the post-cutover guide |
| `<name>.execution.model` | `global-config.ts:180` | `:88` | `loader.ts:380-389` → `:239-245` | shared | shared-current-concept | KEEP |
| `<name>.execution.fallback_model` | `:181` | `:89` | loader `:239-245` | shared | shared-current-concept | KEEP |
| `<name>.execution.fallback_models` | `:182` | `:90` | loader `:239-245` | shared | shared-current-concept | KEEP |
| `<name>.execution.timeout_ms` | `:183` | `:91` | loader `:239-245` → legacy `runner.ts:1337` | legacy | legacy-only | DELETE after cutover |
| `<name>.execution.stall_timeout_ms` | `:184` | `:92` | loader `:239-245` → legacy `runner.ts:1378` | legacy | legacy-only | DELETE |
| `<name>.execution.interactive` | `:185` | `:93` | loader `:239-245` → legacy `runner.ts:1097` | legacy | legacy-only | DELETE |
| `<name>.execution.thinking_level` | `:186` | `:94-96` | loader `:239-245` → native `:829` | shared | shared-current-concept | KEEP |
| `<name>.execution.max_retries` | `:187` | `:97` | loader `:239-245` → legacy `runner.ts:1348` | legacy | legacy-only | DELETE |
| `<name>.execution.prompt_limit_bytes` | `:188` | `:98` | loader `:239-245` → script `script-runner.ts:580` | script | legacy-only | KEEP if `sp script` survives |
| `<name>.execution.stdout_limit_bytes` | `:189` | `:99` | loader `:239-245` → script `script-runner.ts:592` | script | legacy-only | KEEP if `sp script` survives |
| `<name>.execution.extensions` | `:190-192` | `:85,100` | loader `:246-251`, `:590-604`; doctor `:370-381` | shared | shared-current-concept | KEEP |
| `<name>.execution.extensions.gitnexus` (template seed) | `:191` | `:85` | `BUILTIN_EXTENSION_TOGGLES` `global-config.ts:328`; `native-host.ts:742` | shared | shared-current-concept | KEEP |
| `<name>.prompt.system_prompt_mode` | `:194-196` | `:103-105` | loader `:255-262` → legacy `runner.ts:1371` | legacy | legacy-only | KEEP while legacy lives; see §C-1 for the native gap |
| `<name>.stall_detection.waiting_auto_close_ms` | `:197-199` | `:107-109` | loader `:265-275` → `supervisor.ts:1341` | legacy | legacy-only | DELETE with the supervisor |
| `<name>.beads_write_notes` | `:200` | `:134` | loader `:277-283` → legacy `run.ts:1891` | legacy | **legacy-only** | DELETE key from template + `GlobalSpecialistOverrideSchema` + `OVERRIDE_ALLOWED_TOP_FIELDS` |
| `<name>.notes_mode` | `:201` | `:135` | loader `:277-283` → `launch.ts:83` | legacy | **legacy-only** | DELETE |
| `<name>.output_file` | `:202` | `:136` | loader `:277-283` → `runner.ts:1508` | legacy | **legacy-only** | DELETE |
| `<name>.skills.paths` | `:203` | `:111-113` | loader `:286-300` (append+dedup) | shared | shared-current-concept | KEEP |
| `<name>.mandatory_rules.template_sets` | `:204-206` | `:125-127` | loader `:316-336`; `mandatory-rules.ts:369` | shared | shared-current-concept | KEEP |

**Live-file observation (not a code claim).** `~/.config/specialists/user.json` on this machine has 38 specialist
entries and matches the template shape, with two divergences:
- **`mandatory_rules` is absent from all 38 entries** — the live file was generated before the `mandatory_rules`
  template key was added (`global-config.ts:204-206`). `sp init --global` would back-fill it via `fillMissingDefaults`
  (`global-config.ts:229-255`), which has not been run since.
- **31/38 entries still carry `execution.extensions.serena`** — a retired key (`RETIRED_EXTENSION_SOURCES`,
  `global-config.ts:327`). `analyzeGlobalUserConfigDrift` reports these (`global-config.ts:373`) but `sp init --global`
  never removes them, because `mergeGlobalUserConfig` never deletes (`global-config.ts:294` comment).

### A.12 `config/specialists/*.specialist.json` — actual field presence

24 files. Counts of `specialist.<path>` occurrences:

| present in | field |
|---|---|
| 24/24 | `metadata.{name,description,category,version,tags}`, `prompt.{system,task_template}`, `execution.{model,mode,timeout_ms,max_retries,interactive,permission_required}`, `capabilities.{required_tools,external_commands}`, `validation.files_to_watch`, `stall_detection`, `beads_integration`, `beads_write_notes` |
| 23/24 | `metadata.updated`, `execution.fallback_model`, `execution.stall_timeout_ms`, `validation.stale_threshold_days` |
| 22/24 | `execution.{output_type,response_format}`, `skills` |
| 21/24 | `execution.bare`, `prompt.system_prompt_mode`, `skills.paths` |
| 20/24 | `skills.scripts` |
| 19/24 | `mandatory_rules`, `mandatory_rules.template_sets` |
| 13/24 | `execution.thinking_level` |
| 9/24 | `prompt.output_schema` |
| 7/24 | `execution.requires_worktree` (all `false`) |
| 6/24 | `execution.auto_commit` |
| 5/24 | `execution.extensions` |
| 4/24 | `output_file`, `communication` |
| 3/24 | `permissions`, `mandatory_rules.disable_default_globals` |
| 2/24 | `notes_mode` (`final-only`), `mandatory_rules.inline_rules`, `communication.next_specialists` |
| 1/24 | `execution.expected_output_keys`, `execution.prompt_limit_bytes`, `prompt.script_template`, `validation.stale_threshold_ms`, `communication.publishes` |

Configured values of the boundary fields: `beads_integration` is `"auto"` in **24/24**; `beads_write_notes` is `true`
in 23/24 (`changelog-drafter` = `false`); `notes_mode` is `final-only` in 2/24 (`seconder`, `test-engineer`);
`output_file` is set in 4/24 (`executor`, `service-knowledge-sync`, `sync-docs`, `xt-merge`).

### A.13 Repo override layers — precedence ladder verified against loader source

**The audit target tree contains no `.specialists/` directory at all.** `git ls-files | grep '^\.specialists'`
returns nothing, and `find . -maxdepth 3 -name .specialists` returns nothing.

`docs/surface-ownership.md` describes a four-layer ladder. **The loader does not implement it.** Verified order:

`SpecialistLoader.getScanDirs()` (`src/specialist/loader.ts:158-170`) returns, in priority order:

| order | path | scope/source | source evidence |
|---|---|---|---|
| 1 | `.specialists/user/` | `user`/`user` | `loader.ts:161` |
| 2 | `.specialists/user/specialists/` | `user`/`legacy` | `loader.ts:163` |
| 3 | `config/specialists/` | `package`/`package-fallback` | `loader.ts:166` |
| 4 | `resolveCanonicalAssetDir('specialists')` | `package`/`package-live` | `loader.ts:167`, `src/specialist/canonical-asset-resolver.ts:9-17` |

**`.specialists/default/` is NOT walked.** The comment at `loader.ts:148-157` states the mirror was retired by commit
`31a6421c` and that stale files there are only detected by `drift-detector` / removed by `sp prune-stale-defaults`.
`docs/surface-ownership.md:11-15,33-45,53` still documents `.specialists/default/` as tier 2 with override power.
**This is a documentation defect, not a code defect** — see §G-1.

Merge shape: `findLayerHits` (`loader.ts:192-206`) keeps at most **one file per scope** (`seenScopes`, `:200`) and
reverses to base-first; `buildMergedSpec` (`loader.ts:359-425`) applies package base → global `user.json` (`:376-389`)
→ repo `.specialists/user/` (`:392-410`). The documented three-layer contract at `loader.ts:148` (package → global →
repo) is therefore **accurate**; `docs/surface-ownership.md` is not.

`mandatory-rules` resolution is genuinely four-tier and **does** include `.specialists/default/`:

- Index union (`src/specialist/mandatory-rules.ts:153-177`): `userOverlayPath` (`.specialists/user/mandatory-rules/index.json`)
  → `sourcePath` (`config/mandatory-rules/index.json`) → `canonicalCopyPath` (`.specialists/default/mandatory-rules/index.json`)
  → `overlayPath` (`.specialists/mandatory-rules/index.json`), deduped by set id (`mergeIndex` `:137-151`),
  with `packageLiveIndexPath` as a last-resort fallback (`:167-169`).
- Set-file probes (`readMandatoryRuleSet:286-292`): `.specialists/user/mandatory-rules/` → `.specialists/mandatory-rules/`
  → `.specialists/default/mandatory-rules/` → `config/mandatory-rules/` → package-live.
- Set ids are kebab-case-validated at the single sink (`:280-283`) — path-traversal guard.

So `.specialists/default/` is dead for **specialist definitions** and live for **mandatory-rule sets**. The docs get
the specialist ladder wrong and the mandatory-rules ladder right.

## B) Post-cutover deletion list (mechanical)

"Legacy consumer gone" = `sp run` (`cli/run.ts` → `launch.ts` → `supervisor.ts` → `runner.ts`) and the `sp script` /
`sp serve` surfaces are retired or no longer accept these fields.

### B-1 Schema deletions — `src/specialist/schema.ts`

Delete these lines/keywords exactly:

| action | file:line |
|---|---|
| delete `mode` field | `schema.ts:20` |
| delete `timeout_ms` field | `schema.ts:25` |
| delete `stall_timeout_ms` field | `schema.ts:26` |
| delete `max_retries` field | `schema.ts:27` |
| delete `interactive` field | `schema.ts:28` |
| delete `requires_worktree` field and its comment | `schema.ts:41-42` |
| delete `auto_commit` field | `schema.ts:46` |
| delete `skill_inherit` field and its comment | `schema.ts:64` |
| delete the whole `StallDetectionSchema` block and its key in `SpecialistSchema` | `schema.ts:124-135`, key at `:145` |
| delete `output_file` field and its comment | `schema.ts:148-149` |
| delete `notes_mode` field | `schema.ts:150` |
| delete `beads_integration` field and its comment | `schema.ts:151-152` |
| delete `beads_write_notes` field and its comment | `schema.ts:153-154` |
| delete the `beads_integration` branch of `getFriendlyMessage` | `schema.ts:277-279` |
| delete the `execution.mode` branch of `getFriendlyMessage` | `schema.ts:274-276` |
| delete `'stall_timeout_ms'` from `OVERRIDE_ALLOWED_EXECUTION_FIELDS` | `schema.ts:175` |
| delete `'interactive'` from `OVERRIDE_ALLOWED_EXECUTION_FIELDS` | `schema.ts:176` |
| delete `'max_retries'` from `OVERRIDE_ALLOWED_EXECUTION_FIELDS` | `schema.ts:178` |
| delete `'timeout_ms'` from `OVERRIDE_ALLOWED_EXECUTION_FIELDS` | `schema.ts:174` |
| delete `OVERRIDE_ALLOWED_STALL_DETECTION_PATHS` entirely | `schema.ts:188-191` |
| delete `'beads_write_notes','notes_mode','output_file'` from `OVERRIDE_ALLOWED_TOP_FIELDS` (leaves `[]`) | `schema.ts:206` |
| delete `'execution.auto_commit'` from `BLOCKED_OVERRIDE_FIELDS` | `schema.ts:214` |

`prompt_limit_bytes` / `stdout_limit_bytes` / `expected_output_keys` / `skills.scripts` deletions are conditional on
retiring `sp script` — do not delete while `src/cli/script.ts` and `src/cli/serve.ts` exist.

### B-2 Deletion in `src/specialist/global-config.ts`

| action | file:line |
|---|---|
| delete `timeout_ms, stall_timeout_ms, interactive, max_retries, prompt_limit_bytes, stdout_limit_bytes` from `OverrideExecutionSchema` | `:91,92,93,97,98,99` |
| delete `OverrideStallDetectionSchema` block | `:107-109` |
| delete `stall_detection` key from `GlobalSpecialistOverrideSchema` | `:132` |
| delete `beads_write_notes` | `:133-134` |
| delete `notes_mode` | `:135` |
| delete `output_file` | `:136` |
| delete the deleted leaves from `getGlobalSpecialistOverrideLeafPaths()` | `:145,148,150` |
| delete the deleted keys from `buildSpecialistOverrideTemplate()` | `:183,184,185,187,188,189,197-199,200,201,202` |
| delete `RETIRED_EXTENSION_SOURCES` and its drift branch once `serena` is purged from all live `user.json` files | `:327`, branch at `:373` |

`execution.extensions` (incl. the `gitnexus` template seed) and `mandatory_rules.template_sets` **stay**.

### B-3 Deletion in the renderer/task prompt — Beads-shaped surfaces

| action | file:line |
|---|---|
| delete the `workflow-quick-rules` global injection, the `disable_default_globals` gate, and the `STATIC_WORKFLOW_RULES_BLOCK` import/uses | `src/specialist/mandatory-rules.ts:4,377-390,402,407,410` |
| delete `STATIC_WORKFLOW_RULES_BLOCK` itself (`## Beads Workflow Quick Rules` + `## Session close checklist`) | `src/specialist/memory-retrieval.ts:10-21` |
| delete `beads_integration` / `beads_write_notes` from the `beads` view section | `src/cli/view.ts:216-220`; then the `'beads'` alias `:31` and the `printFullSpecialist` call `:242` |
| delete `beads_integration` from the `sp edit` enum allow-list | `src/cli/edit.ts:35` |
| delete the `beads_integration` line from the quickstart template text | `src/cli/quickstart.ts:184` |
| delete `beads_write_notes` + `notes_mode` + `output_file` hints from the console map | `src/cli/console/config-source.ts:72,73,82` |
| delete `beads_integration`/`beads_write_notes` from `sp view --raw` output | `src/cli/view.ts` (raw path); `src/cli/view.ts:217-218` |
| delete `execution.mode` example from help | `src/index.ts:529` |

### B-4 Deletion in legacy runtime files (the cutover itself)

| action | file:line |
|---|---|
| delete `legacyOnlyConfigNotes` and its call site | `src/activation/native-host.ts:2403-2416`, call at `:1272` |
| delete the `beadsIntegration` decision in the runner | `src/specialist/runner.ts:1323-1329` |
| delete `maxRetries`/`maxAttempts` retry loop | `src/specialist/runner.ts:1348-1349` |
| delete `stallTimeoutMs` pass-through | `src/specialist/runner.ts:1378` |
| delete `systemPromptMode` pass-through | `src/specialist/runner.ts:1371` |
| delete `autoCommit` from the result metrics | `src/specialist/runner.ts:1536` |
| delete `output_file` job-file write | `src/specialist/runner.ts:1508-1509` |
| delete `beadsWriteNotes` / `notesMode` / `output_file` from `RunOptions` and their consumers | `src/specialist/supervisor.ts:1778-1780`, `:1826`, `:1842`, `:1859-1864`; `src/specialist/launch.ts:41,82,83,91`; `src/cli/run.ts:1891` |
| delete `stallDetection` threading and `STALL_DETECTION_DEFAULTS` | `src/specialist/supervisor.ts:105-110,227,1340-1341,2086-2087`; `src/specialist/launch.ts:96` |
| delete `runAutoCommitCheckpoint` | `src/specialist/supervisor.ts:534-551,1929-1957` |

### B-5 Generated `user.json` keys to delete

After the code deletions above, the next `sp init --global` must stop emitting and must actively strip these keys.
`mergeGlobalUserConfig` (`global-config.ts:272-309`) already has a `removed[]` channel (`:279,294-295`) but never
deletes — the cutover needs an explicit purge pass, not a template change alone:

`<every specialist>.execution.timeout_ms`, `.execution.stall_timeout_ms`, `.execution.interactive`,
`.execution.max_retries`, `.execution.prompt_limit_bytes`†, `.execution.stdout_limit_bytes`†,
`.prompt.system_prompt_mode`†, `.stall_detection` (whole object), `.beads_write_notes`, `.notes_mode`, `.output_file`,
and every `execution.extensions.serena` key.

† keep if the `sp script` surface survives.

The `<every specialist>` scope is the 38 live entries plus any future shipped name.

### B-6 Config files to delete from `config/specialists/`

Per-file line-accurate removal (values from the A.12 scan):

| file | delete |
|---|---|
| all 24 `config/specialists/*.specialist.json` | `specialist.beads_integration`, `specialist.beads_write_notes` |
| all 24 | `specialist.execution.mode` |
| all 24 | `specialist.execution.interactive` |
| all 24 | `specialist.execution.max_retries` |
| 23/24 | `specialist.execution.stall_timeout_ms` |
| 23/24 | `specialist.execution.timeout_ms` |
| 21/24 | `specialist.execution.bare` — **only if** `bare` is retired; it is currently native-live, so KEEP |
| 7/24 (`chain-coordinator`, `changelog-drafter`, `changelog-keeper`, `node-coordinator`, `seconder`, `service-knowledge-sync`, `test-engineer`) | `specialist.execution.requires_worktree` |
| 6/24 | `specialist.execution.auto_commit` |
| 4/24 (`executor`, `service-knowledge-sync`, `sync-docs`, `xt-merge`) | `specialist.output_file` |
| 2/24 (`seconder`, `test-engineer`) | `specialist.notes_mode` |
| 1/24 `transcriber.specialist.json:41` | `specialist.validation.stale_threshold_ms` (undeclared, unconsumed) |
| 1/24 `service-knowledge-sync.specialist.json:41` | `specialist.prompt.script_template` (undeclared, unconsumed) |
| 4/24 (`quant-methodologist:132`, `quant-researcher:133`, `service-knowledge-sync:77`, `transcriber:43`) | `specialist.communication` (undeclared; only `sp view` prints it) |

### B-7 Generated/default *files*

| action | evidence |
|---|---|
| `docs/surface-ownership.md` tier-2 (`.specialists/default/`) rows for **specialists** must be deleted, not the directory | `docs/surface-ownership.md:11-15,33-45` contradict `loader.ts:148-157` |
| `sp init --sync-defaults` (`.specialists/default/mandatory-rules/` copier) should be deleted or reduced to mandatory-rules only; it currently claims a tier the specialist loader does not read | `src/cli/init.ts:240-283`; `docs/surface-ownership.md:104-106` |
| `config/presets.json` preset references remain valid — `preset-resolver.ts` resolves into override-allowed leaves only (`loader.ts:341-349`) | no deletion |

## C) Native-only additions (fields the native path needs that do not exist today)

These are **gaps found by consumer-gap analysis**, not proposals. Each names the native code site that currently
has no configurable input. Rule 4 is respected: nothing here touches settlement policy.

| # | gap | evidence that it is missing | why it is native-only | must NOT overlap |
|---|---|---|---|---|
| C-1 | No `prompt.system_prompt_mode` consumption on the native path | `native-host.ts:1039` calls `buildSystemPrompt({ systemPromptTemplate: specialist.specialist.prompt.system ?? '' , … })`; `SystemPromptContext` (`system-prompt.ts:137-166`) has no mode field; `buildSystemPrompt` (`:159`) never reads one. Grep `system_prompt_mode` in `native-host.ts` = 0. Legacy honours it at `runner.ts:1371` → `pi/session.ts:1166` | the field exists and is globally overridable (`global-config.ts:104`), so today a global `replace` silently does nothing on native activations — an *existing field with a native gap*, not a new field. Fix is to plumb it, not to add a field | must not alter settlement |
| C-2 | No wall-clock cap on a native activation | `native-host.ts` grep for `timeout_ms` = 0; the only timeout-named constants are retryability classifiers (`:302`, `:1720`) | legacy caps at `runner.ts:1402,1454` (`session.waitForDone(execution.timeout_ms)`); the native path can run unbounded | must not be a settlement deadline — settlement is runtime-owned |
| C-3 | No prompt/stdout size cap on a native activation | `native-host.ts` grep for `prompt_limit_bytes` / `stdout_limit_bytes` = 0; legacy/script caps live at `script-runner.ts:580,592` and default from env | a runaway native prompt or stdout is unbounded today | independent of settlement |
| C-4 | No declared native analogue of `requires_worktree` — currently correct by construction, must stay so | `src/activation/types.ts:107` records the rejection of per-activation worktrees; `native-host.ts:627` resolves a shared workspace via `resolveWorkspace` | if a future native design wants per-specialist isolation, it needs a **new** field; it must not resurrect `requires_worktree`, whose semantics are legacy worktree provisioning (`run.ts:1665-1670`) | — |
| C-5 | No declared native analogue of `output_file` — native publishes to the Substrate Journal | `native-host.ts:2410` states this explicitly | a native opt-in for an extra artifact would be a new field | must not duplicate settlement publication |

**Deliberately NOT proposed** (would violate rule 4): any configurable settle/retry/auto-close policy, any
`stall_detection` revival, any `auto_commit` analogue.

## D) Must keep as compatibility alias

| # | item | why it must stay | alias lifetime |
|---|---|---|---|
| D-1 | `execution.mode` (`schema.ts:20`) | **Not an alias — listed here explicitly because it is often mistaken for one.** `tool\|skill\|auto` never had a reader. Decision: DELETE (§B-1), do not alias | none |
| D-2 | `execution.extensions.serena` | accepted-but-ignored by design: `schema.ts:49-50` comment, `global-config.ts:327` (`RETIRED_EXTENSION_SOURCES`), `config-source.ts:67` hint. 31/38 live `user.json` entries still carry the key; rejecting it would fail `GlobalSpecialistOverrideSchema` (`.strict()`, `global-config.ts:85,101`) and lock those users out of `sp edit --global` | until a purge pass strips every `serena` key from `~/.config/specialists/user.json` and the four backup copies. Then delete the `RETIRED_EXTENSION_SOURCES` handling (`global-config.ts:327`, branch `:373`) and the hint (`config-source.ts:67`) |
| D-3 | `<name>.prompt.system_prompt_mode` in `user.json` | must stay while the legacy renderer honours it (`runner.ts:1371`) — removing it early would silently drop a live override for `sp run` users. It is also the C-1 native gap | until C-1 is plumbed **and** legacy `sp run` is retired. Then it drops to native-live (KEEP) or is deleted with legacy |
| D-4 | `_doc` key in `user.json` | written by both writers (`global-config.ts:217,276`), filtered by the schema preprocess (`:160`), points at `overrides-guide.md` (`:36`). Unknown keys inside a specialist entry would be rejected (`.strict()`), `_doc` is top-level so it is safe | permanent, but re-point `GLOBAL_USER_CONFIG_DOC` (`:36`) at the post-cutover guide |
| D-5 | `.specialists/user/specialists/` nested path | migration bridge only — `loader.ts:163` marks it `scope: 'user', source: 'legacy'` | keep until no consumer repo has that layout; `docs/surface-ownership.md:117` documents it as a legacy layout |
| D-6 | `.specialists/default/mandatory-rules/` | **not an alias — it is a live tier.** `mandatory-rules.ts:155,161,289` reads it; `cli/init.ts:240-283` writes it; `cli/list-rules.ts:49` reports it. Deleting it breaks the mandatory-rules ladder, unlike specialist defaults | permanent for mandatory-rules; delete only for the specialist-definition row of `docs/surface-ownership.md` (§B-7) |
| D-7 | `<name>.beads_write_notes` / `.beads_integration` in `user.json` and configs | `beads_write_notes` is genuinely overridable (`OVERRIDE_ALLOWED_TOP_FIELDS`, `schema.ts:206`) and legacy-live (`run.ts:1891`), so removing it before the cutover silently drops user intent. `beads_integration` is not overridable but is present in 24/24 configs and validated (`schema.ts:152`) | until legacy `sp run` is retired. Then DELETE (§B-1/B-2/B-6). **Rule 2 applies: do not remove while the legacy backend consumes them** |

## E) Mandatory-rules leakage analysis

> **CURRENT STATUS — semantic cutover implemented on `fix/xtrm-93-specialist-semantic-cutover`.**
> The measurements below are preserved as the evidence that justified the change. Their
> present-tense defect wording is historical on this branch:
>
> - the synthetic `workflow-quick-rules` / `STATIC_WORKFLOW_RULES_BLOCK` Beads injection is removed;
> - `core-session-boundary` names the pinned Substrate Issue revision, Journal/result evidence, and explicit Closure;
> - canonical role definitions load `issue-ref-verbatim`; `bead-id-verbatim` is quarantined as legacy compatibility only;
> - `executor-delivery`, `git-workflow-safe`, changelog, sync-docs and security rules use Issue/Journal/Closure semantics;
> - compatibility fields `beads_integration` / `beads_write_notes` remain until the legacy consumer is unreachable.
>
> See `specialist-definition-semantic-cutover.md`. N8 retains the mechanical zero-consumer cleanup; this correctness fix is deliberately pre-N8.


### E-1 The injected globals block IS Beads workflow doctrine (highest-severity leak)

`buildMandatoryRulesInjection` always prepends a synthetic set unless `disable_default_globals` is true:

- `src/specialist/mandatory-rules.ts:377-390` — injection gate, set id `workflow-quick-rules`, `priority: 'must_keep'` (so it can never be budget-evicted, `compileMandatoryRulesBudget:97-107`).
- The text is `STATIC_WORKFLOW_RULES_BLOCK` (`src/specialist/memory-retrieval.ts:10-21`), verbatim:

  ```
  ## Beads Workflow Quick Rules
  - Claim work: `bd update <id> --claim`
  - Append progress notes: `bd update <id> --append-notes "..."`
  - Store reusable insight: `bd remember "insight"`
  - Close completed issue: `bd close <id> --reason "done"`
  ## Session close checklist    (git add / git commit / git push)
  ```

- Only two `replace()` calls strip text: the `## Beads Workflow Quick Rules` heading (`mandatory-rules.ts:386`) and the `bd remember` line (`:387`). No replacement text is injected, so the emitted rule is the mangled remainder of a Beads block.
- **This is reachable from the native runtime.** `native-host.ts:1042` → `renderTaskPrompt` → `task-prompt.ts:248` → `buildMandatoryRulesInjection`. Native refuses to launch without rules (`native-host.ts:998-1003`) and emits `sets_loaded` including `workflow-quick-rules`. Practically every native activation today carries a Beads-command block in its prompt.
- Under the native runtime this is **wrong**, not merely stale: native dispatch has no Beads client — `native-host.ts:631-634` says "No Beads client, no `bd` subprocess, no second readiness derivation". A specialist told to run `bd update <id> --claim` would either fail, or shell out to a board the native runtime does not own.
- `disable_default_globals` is the only switch, and it is a **user-rules-only escape hatch**, not a runtime-owned fix: it also suppresses nothing else (`mandatory-rules.ts:377` gates exactly this one synthetic set). Rule 4 spirit: the runtime, not the definition, should decide whether Beads doctrine is injected.

**Disposition:** DELIVERED by the semantic cutover. The synthetic global is removed now because it was a native correctness defect, not a legacy-field cleanup dependency. Native workflow doctrine remains in required platform rules and `core-session-boundary`.

### E-2 `core-session-boundary` (required set — injected into EVERY specialist, native and legacy)

`config/mandatory-rules/index.json` → `required_template_sets: ["core-session-boundary"]`. Injected unconditionally
(`mandatory-rules.ts:367,392`), `priority: 'must_keep'` (`:396`) so it cannot be evicted.

`config/mandatory-rules/core-session-boundary.md` body contains:

> "The assigned **Bead**/task is authority: if PROBLEM/SUCCESS/SCOPE/NON_GOALS/CONSTRAINTS/VALIDATION/OUTPUT … is missing or materially ambiguous, ask the coordinator"

Under the native runtime the durable work item is a Substrate **Issue**, not a Bead (`native-host.ts:631`, and
`inputIssueRef` vs the legacy `inputBeadId` split in `system-prompt.ts:152-154`). The seven-section contract shape is
the same, so the **semantics survive** — this is a vocabulary leak, not a doctrine conflict. It is still wrong to
ship under the native runtime because a specialist that reports "the bead is missing" while the runtime calls it an
issue produces ambiguous refusal notes.

**Disposition:** DELIVERED. `core-session-boundary` now names the pinned Substrate Issue revision and preserves the always-on XTRM contract boundary.

### E-3 `bead-id-verbatim` (6 Beads-token occurrences — highest density)

`config/mandatory-rules/bead-id-verbatim.md`. Every line is Beads-specific:

- Rule: "Source bead-id arguments verbatim from injected context: `bead_id`, branch name, … or `bd create` output."
- Command scope: "`bd close`, `bd update`, `bd dep add`, `bd dep list`, `bd show`."
- Failure example: "`unitAI-m8744.2` … `bd close` then failed with `issue id not found`."

The **failure class it prevents** (retyping an identifier from memory) is real and runtime-independent. The
**mechanism** (`bd` subcommands, `bead_id` template variable) is legacy-only.

Referenced by 18 of 19 shipped `template_sets` declarations: `debugger`, `executor`, `explorer`,
`obligations-scanner`, `overthinker`, `planner`, `researcher`, `reviewer`, `seconder`, `security-auditor`,
`specialists-creator`, `sync-docs`, `test-engineer`, `test-runner`, `xt-merge`, plus the `changelog-*` pair via
`per-turn-handoff-schema` adjacency.

**Disposition:** DELIVERED with a safer split: canonical definitions now reference `issue-ref-verbatim`; `bead-id-verbatim` remains under its old id only as explicitly legacy compatibility, avoiding a false claim that native and legacy identifiers are the same authority.

### E-4 `executor-delivery` (2 occurrences, one of them an instruction the native runtime cannot satisfy)

`config/mandatory-rules/executor-delivery.md`:

- "Never close the anchor bead … `bd close <anchor>` is reserved for the orchestrator on evidence." — under the
  native runtime the orchestrator does not close a Bead; settlement is runtime-owned and posts to the Substrate
  Journal (`native-host.ts:2410`). The instruction is inert at best and misleading at worst.
- "parse the bead's SCOPE section into an explicit path allowlist …" — the contract shape survives; the noun does not.

Referenced by `executor.specialist.json` only.

**Disposition:** DELIVERED. Scope allowlisting remains load-bearing; lifecycle/output wording now uses pinned Issue + Journal/result + explicit Closure.

### E-5 `git-workflow-safe` (default set — injected into EVERY specialist)

`config/mandatory-rules/index.json` → `default_template_sets: ["git-workflow-safe"]`, injected unconditionally
(`mandatory-rules.ts:368,393`), `priority: 'important'` (evictable under budget, `:113`).

`config/mandatory-rules/git-workflow-safe.md` body: *"Use one branch per issue. **Claim before edit, close before
commit**, push only after sync."*

"Claim before edit / close before commit" is the **Beads lifecycle** (`bd update --claim` / `bd close`). Under the
native runtime the claim is an activation-bound Issue claim owned by the work-item boundary
(`native-host.ts:650-680`), and no commit is created by the runtime at all (native has zero `auto_commit` readers).
The "one branch per issue" and "push only after sync" halves remain correct.

**Disposition:** DELIVERED. The set remains default but now expresses live claim/workspace discipline and explicitly states that commit/push/PASS/settlement do not perform Issue Closure.

### E-6 `changelog-keeper-scope` (3 occurrences) and `changelog-conventions` (2 occurrences)

- `changelog-keeper-scope.md`: "The bead's SCOPE/RANGE names the relevant tag range", ".beads/**" in the edit blacklist.
- `changelog-conventions.md`: "Include bead-id references in parentheses when helpful, like `(unitAI-123)`."

These encode a Beads-id commit-message convention. Under the native runtime the durable reference is an Issue ref.
The blacklist line `.beads/**` is harmless but stale if the repo no longer has `.beads/`.

**Disposition:** DELIVERED. Changelog rules use durable Issue refs; `.beads/**` remains only as a file blacklist for legacy workspace noise.

### E-7 `sync-docs-scope-discipline` (2 occurrences)

`sync-docs-scope-discipline.md`: "The bead's `SCOPE` field MUST name exactly one doc path", "Cross-cutting updates
are separate beads with their own SCOPE."

**Disposition:** DELIVERED. The one-doc invariant now binds to the pinned Issue revision's SCOPE.

### E-8 Verified clean (no Beads doctrine)

`code-quality-defaults`, `diagnose-loop`, `exact-citation-contract`, `explorer-readonly`, `gitnexus-required`,
`json-only-final-output`, `overthinker-4phase`, `per-turn-handoff-schema`, `research-tool-routing`,
`researcher-source-discipline`, `reviewer-verdict-format`, `security-review-defaults`,
`service-knowledge-diff-scan-mandatory`, `service-knowledge-gitnexus-triage`, `test-runner-execution-scope`.

Counts by file (grep `-ciE '\b(bead|beads|bd )\b'`): `bead-id-verbatim` 6, `changelog-keeper-scope` 3,
`sync-docs-scope-discipline` 2, `executor-delivery` 2, `changelog-conventions` 2, `security-review-defaults` 1,
`core-session-boundary` 1, `README.md` 1, all others 0.

### E-9 Documentation drift in the mandatory-rules README (blocks the cutover)

`config/mandatory-rules/README.md` contradicts the code in three ways:

1. It documents a four-tier ladder (lines 12-28) that matches `mandatory-rules.ts:153-177` — **correct** — while
   `docs/surface-ownership.md:11-15` claims the same for specialist definitions, which is **wrong** (§A.13).
2. **CORRECTED:** the synthetic `STATIC_WORKFLOW_RULES_BLOCK` / `workflow-quick-rules` path is retired. `disable_default_globals` remains a compatibility field but no longer controls Beads doctrine; required/default index-driven sets remain authoritative.
3. It calls `.specialists/default/mandatory-rules/` "a mirror of canonical, placed in every downstream project" —
   the *specialist* loader does not read `.specialists/default/` at all (`loader.ts:148-157`); only the mandatory-rules
   loader does. The README is right for mandatory-rules; the sibling doc generalizes it wrongly.

Also note `src/cli/init.ts:240-283` still provides the `sp init --sync-defaults` copier, and
`docs/surface-ownership.md:104-106` calls it deprecated-but-present while `README.md` row 3 lists it as a normal
writer.

## F) UNKNOWNs

| # | unknown | reason it is unresolved | how to resolve |
|---|---|---|---|
| F-1 | Whether a native activation *ever* observed `workflow-quick-rules` in a real run | `native-host.ts:1006-1013` emits `mandatory_rules_injection` with `sets_loaded`, so the data exists in activation events, but no activation event log was inspected in this lane (out of scope: state-machine/telemetry lanes) | read `.specialists/settlements/**` or the registry for a `mandatory_rules_injection` event and check `sets_loaded` |
| F-2 | Whether the 38 live `user.json` entries silently drop intent for the 4 fields native ignores | `legacyOnlyConfigNotes` (`native-host.ts:2407-2416`) only reports `beads_integration != auto` and `beads_write_notes === false`. All 24 shipped configs are `beads_integration: auto`, and `notes_mode`/`output_file` are **not** in the note set — so a user `output_file` override produces no native diagnostic at all | enumerated: `native-host.ts:2407-2416` covers 2 of 5 ignored fields. `notes_mode`, `output_file`, `auto_commit`, `requires_worktree`, `interactive`, `timeout_ms`, `stall_timeout_ms`, `max_retries` produce **zero** native feedback. Treat this as a finding, not an unknown |
| F-3 | Whether `sp script` / `sp serve` survive the cutover | not stated in this lane's brief; affects whether `prompt_limit_bytes`, `stdout_limit_bytes`, `expected_output_keys`, `skills.scripts` post-cutover actions are KEEP or DELETE | decide at XTRM-93 programme level; §B marks them conditional |
| F-4 | Whether `docs/surface-ownership.md` is itself slated for rewrite | the doc is not in this lane's edit scope and its `.specialists/default/` claim may be owned by another lane | flag to the XTRM-93 doc-consolidation owner |
| F-5 | Whether any downstream consumer repo has `.specialists/default/*.specialist.json` files that would silently stop loading | the loader ignores them (`loader.ts:148-157`), and this worktree has no such files; no downstream repo was inspected | `sp doctor --check-drift` + `sp prune-stale-defaults --dry-run` in a consumer repo |
| F-6 | Whether `permissions` (3/24 configs, all READ_ONLY) are exercised by the native admission path in production | `native-host.ts:747` passes `specialist.specialist.permissions` into `resolveRuntimeToolContract`; whether any shipped `denied_natives_when_extension` value is load-bearing was not traced to a runtime observation | trace one activation of `seconder`/`reviewer`/`security-auditor` and read `tool_contract` warnings |
| F-7 | Whether `beads_integration`/`beads_write_notes` are read by a consumer outside `src/` (a hook, extension, or downstream package) | grep covered `src/` only; a repo-wide grep including `packages/`, `.xtrm/`, `hooks/` was not run for this lane | `grep -rn 'beads_integration\|beads_write_notes' --include='*.ts' --include='*.js' --include='*.json' .` excluding `node_modules` |

## G) Unrelated findings

| # | finding | evidence | impact |
|---|---|---|---|
| G-1 | `docs/surface-ownership.md` documents an override tier (`.specialists/default/`) for specialist definitions that the loader does not walk | doc `:11-15,33-45,104-106` vs `loader.ts:148-157` (comment names commit `31a6421c`) | an operator following the doc would place an override that silently never loads. Highest-value doc fix in this lane |
| G-2 | `mergeGlobalUserConfig` never removes keys; `_doc`-preserving merge only adds | `global-config.ts:272-309`; `removed[]` collected at `:295` but the value is copied verbatim at `:294` and never dropped | retired extension keys (`serena` in 31/38 live entries) and removed template fields accumulate forever. A cutover purge pass is required (§B-5) |
| G-3 | Live `user.json` is 12 template keys behind (no `mandatory_rules` in any of 38 entries) | `global-config.ts:204-206` vs live file scan | `mandatory_rules.template_sets` global overrides are unreachable for this operator until `sp init --global` is re-run |
| G-4 | `config/specialists/reviewer.specialist.json` and `seconder.specialist.json` embed multi-kilobyte prose system prompts (the reviewer prompt is ~15 KB) | `config/specialists/reviewer.specialist.json:41`; the file push the schema-defaults scan past the 50 KB tool-output limit | these are the files most likely to trip `prompt_limit_bytes` (`script-runner.ts:580`) and the least likely to be reviewed line-by-line. Consider moving to skill files |
| G-5 | `duplicate line in the reviewer Release Checklist` — `- [ ] seconder ran:` appears twice in the required block | `config/specialists/reviewer.specialist.json:41` (Release Checklist body) | a machine-parsed checklist section will see two identical keys. Cosmetic but in a `REQUIRED, machine-readable` block |
| G-6 | `sp edit` ENUM_PATHS and `sp console` hints are hand-maintained copies of schema enums and will drift | `src/cli/edit.ts:31-38` vs `schema.ts:20,31,33,45,152`; `src/cli/console/config-source.ts:58-83` | every schema deletion in §B-1 needs a matching edit in two UI maps. Derive them from the Zod schema instead |
| G-7 | `.specialists/` is absent from this worktree while `.specialists/{jobs,ready,db,settlements,leases}` exist in the main checkout | `find` over the worktree vs `/home/dawid/dev/specialists/.specialists` | expected for a `xt pi` worktree, but it means `sp doctor --check-drift` results differ between the worktree and the main checkout |
| G-8 | GitNexus cannot resolve any of these config fields | `impact beads_write_notes` → `risk: UNKNOWN` + `riskNote`; `impact beads_integration\|requires_worktree\|auto_commit` → `"Target not found"` | any future "is this field unused?" question needs grep, not the graph. Worth recording in the repo's GitNexus skill so the next agent does not read `UNKNOWN` as unused |
