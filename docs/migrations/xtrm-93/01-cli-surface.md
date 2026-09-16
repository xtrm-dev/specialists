# XTRM-93 Lane A — Complete CLI Surface Inventory

Bead: `unitAI-t9iyp` (XTRM-93). Audit of the **current tree only**.

- Worktree: `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`
- HEAD: `6553ef05` (`fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch`)
- Source of truth: `git master 472b1aef` + local commit `6553ef05`

## Method and evidence rules

- Command tokens and help text read directly from `src/index.ts` (1473 lines) and `src/cli/**`.
- Structural claims use GitNexus at `repo=/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`.
  **The worktree index is present and fresh**: `.gitnexus/gitnexus.json` reports
  `lastCommit: 6553ef05877a263384d6572980cc6e4affc3952a`, and `gitnexus status` reports
  `Status: up-to-date`. No fallback to the `/home/dawid/dev/specialists` index (ce33c313)
  was needed, so nothing in this artifact was read from the older index.
- **Graph limitation, stated up front.** Every CLI verb is loaded by *dynamic*
  `await import('./cli/<name>.js')` from `src/index.ts`. The graph records no call edge for
  those. `gitnexus impact run --direction upstream` returns `"status": "ambiguous"` (73
  candidates); `gitnexus impact handleNodeCommand`, `handleEpicCommand`, `runList`, and
  `runRecord` each return `impactedCount: 0` with GitNexus' own `riskNote` that absence of
  edges is not evidence of non-use. Therefore **every CLI reachability claim below comes from
  reading `src/index.ts` and the verb's source, not from the graph.** Graph evidence is used
  where it does resolve (shared modules, MCP/native wiring).
- `d` = `.specialists/`; `obs.db` = `d/db/observability.db` (git-root) or
  `$XDG_DATA_HOME/specialists/observability.db` when `XDG_DATA_HOME` is set
  (`src/specialist/observability-db.ts:47`). `jobs/<id>/` = `d/jobs/<id>/` holding
  `status.json`, `events.jsonl`, `result.txt` — documented as the **legacy/operator mirror**,
  not a normal-runtime source of truth (`docs/ARCHITECTURE.md:255,266`,
  `docs/cli-reference.md:1608`, `docs/background-jobs.md:27,45,168-170`).
- `NATIVE` shorthand = `NativeActivationHost` (`src/activation/native-host.ts:443`), reachable
  only through `src/mcp/v2-server.ts:105,166-171` (product entrypoint: `src/index.ts:1462`
  calls `serveV2Stdio()`) and `src/server.ts:153,167-172`.

### Native surface actually registered today

| surface | tools | source |
|---|---|---|
| MCP v2 (product entrypoint) | `specialist_status`, `specialist_dispatch`, `specialist_reply`, `specialist_resume`, `specialist_stop_activation`, `specialist_list` | `src/mcp/v2-server.ts:166-171` |
| MCP v2 substrate | `substrate_issue`, `substrate_journal`, `substrate_provenance` | `src/mcp/v2-server.ts:159-161` |
| MCP (legacy `src/server.ts`) | same set **plus** `specialist_retry` | `src/server.ts:167-172` |
| Pi extension | `specialist_dispatch`, `specialist_status`, `specialist_reply`, `specialist_resume`, `specialist_retry`, `specialist_stop_activation`, `specialist_list` | `config/pi-extensions/specialist-subagents/index.mjs:1047,1236,1266,1324,1409,1488,1538` |
| retired | `use_specialist` — module deleted, name not registered, no synchronous dispatch path | `docs/mcp-tools.md:274-279` |

### Two runtimes in one package

- **legacy** = `SpecialistRunner` + `Supervisor` + Pi-RPC + shelled `bd` + tmux + per-job FIFO +
  per-run worktree provisioning. Reached by `sp run` (`src/cli/run.ts:1897-1902` constructs
  `new SpecialistRunner(...)`).
- **native** = in-process Pi `AgentSession`, Substrate Issues authority, run-in-place workspace
  with a writer lease, no worktree provisioning, no `bd` subprocess
  (`docs/native-activation.md:29-42,52-118`).

`docs/native-activation.md:32-34` states the boundary explicitly: *"The Pi extension and the
Claude Code MCP server are frontends over this class; neither invokes the legacy `sp run` CLI."*

## Dispatch inventory confirmation

`src/index.ts` dispatches 47 `sub === '...'` literals, plus aliases and the no-subcommand MCP
mode. **The caller's list was complete — nothing missed, nothing extra:**

| # | token | index.ts lines | handler |
|---|-------|----------------|---------|
| 1 | `install` | 40-53 | `cli/install.ts` |
| 2 | `version` (aliases `--version`, `-v`) | 55-58 | `cli/version.ts` |
| 3 | `list-rules` | 60-63 | `cli/list-rules.ts` |
| 4 | `list` | 65-108 | `cli/list.ts` |
| 5 | `render-task` | 110-143 | `cli/render-task.ts` |
| 6 | `render-bead` | 145-178 | `cli/render-bead.ts` |
| 7 | `render-skill-prefix` | 180-203 | `cli/render-skill-prefix.ts` |
| 8 | `launch-outcome` | 205-237 | `cli/launch-outcome.ts` |
| 9 | `view` | 239-270 | `cli/view.ts` |
| 10 | `models` | 272-287 | `cli/models.ts` |
| 11 | `init` | 289-345 | `cli/init.ts` |
| 12 | `db` | 347-389 | `cli/db.ts` |
| 13 | `integration` (`record` \| `list`) | 391-455 | `cli/integration.ts` |
| 14 | `validate` | 457-488 | `cli/validate.ts` |
| 15 | `edit` | 490-538 | `cli/edit.ts` |
| 16 | `config` | 540-565 | `cli/config.ts` |
| 17 | `chat` | 567-580 | `cli/chat.ts` |
| 18 | `console` | 582-590 | `cli/console.ts` |
| 19 | `run` | 592-679 | `cli/run.ts` |
| 20 | `node` | 681-726 | `cli/node.ts` |
| 21 | `epic` (**first** branch) | 728-762 | `cli/epic.ts` |
| 22 | `status` | 764-791 | `cli/status.ts` |
| 23 | `ps` | 793-848 | `cli/ps.ts` |
| 24 | `result` | 850-879 | `cli/result.ts` |
| 25 | `feed` | 881-916 | `cli/feed.ts` |
| 26 | `forensic` | 919-943 | `cli/forensic.ts` |
| 27 | `metrics` | 945-974 | `cli/metrics.ts` |
| 28 | `log` | 976-1027 | `cli/log.ts` |
| 29 | `steer` | 1030-1056 | `cli/steer.ts` |
| 30 | `resume` | 1058-1087 | `cli/resume.ts` |
| 31 | `retry` | 1089-1115 | `cli/retry.ts` |
| 32 | `follow-up` | 1117-1132 | `cli/follow-up.ts` |
| 33 | `clean` | 1134-1191 | `cli/clean.ts` |
| 34 | `merge` | 1193-1207 | `cli/merge.ts` |
| 35 | `epic` (**second** branch) | 1209-1213 | `cli/epic.ts` — **unreachable**, see §A/D |
| 36 | `end` | 1215-1239 | `cli/end.ts` |
| 37 | `stop` | 1241-1258 | `cli/stop.ts` |
| 38 | `finalize` | 1260-1280 | `cli/finalize.ts` |
| 39 | `attach` | 1282-1306 | `cli/attach.ts` |
| 40 | `prune-stale-defaults` | 1308-1311 | `cli/prune-stale-defaults.ts` |
| 41 | `quickstart` | 1313-1316 | `cli/quickstart.ts` |
| 42 | `doctor` | 1318-1381 | `cli/doctor.ts` |
| 43 | `setup` | 1383-1396 | `cli/setup.ts` |
| 44 | `serve` | 1398-1417 | `cli/serve.ts` |
| 45 | `script` | 1419-1436 | `cli/script.ts` |
| 46 | `release` | 1438-1446 | inline `spawnSync('xt', ['release', ...])` |
| 47 | `help` (aliases `--help`, `-h`) | 1448-1451 | `cli/help.ts` |

Non-command entry behaviour that is also part of the surface:

- `--version` / `-v` aliases for `version` (`src/index.ts:55`).
- `--help` / `-h` aliases for `help` (`src/index.ts:1448`).
- Unknown subcommand: stderr `Unknown command: '<sub>'` + exit 1 (`src/index.ts:1454-1457`).
- **No subcommand**: starts the v2 MCP stdio server (`src/index.ts:1461-1463`). This is the
  default and the only mode that serves the native runtime.
- Process exit: after `run()` resolves, `process.exit(process.exitCode ?? 0)` for every token
  except `serve` (`src/index.ts:1466-1473`).
- Global `uncaughtException` handler swallows `EBADF` on `close`, otherwise logs and exits 1
  (`src/index.ts:11-15`). Non-Bun runtime exits 1 with an install hint (`:17-24`).
- Bins: `specialists` and `sp` both → `dist/index.js`; `install` → `bin/install.js` (`package.json` `bin`).

---

# Command rows

Column order is exactly as specified. `—` means "verified absent / not applicable".

| command | flags / argv contract | JSON / text output contract | exit codes | legacy backend dependencies | durable stores read | durable stores written | process/session assumptions | telemetry emitted | control messages/events | worktree/git behavior | native equivalent | semantic delta | post-migration owner | compatibility risk | tests covering current behavior |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| `install` | none; `--help` is intercepted in `src/index.ts:41` | plain-text deprecation banner to stdout (`src/cli/install.ts:9-20`) | 0 | — | — | — | none | — | — | — | `xt install` (Core) | none — pure redirect message | Core (`xt`) | LOW (no machine consumer) | `tests/unit/cli/install.test.ts:24-25` |
| `version` / `--version` / `-v` | `--json` (`src/cli/version.ts:92`) | text `pkg vX` (`:100`); JSON `VersionInfo{package,version,commit,dirty,source,built_at,runtime.bun}` (`:8-19,93-97`) | 0 | `git rev-parse HEAD`, `git status --porcelain` in install root (`:48,63,68`); `spawnSync` only | install-root `package.json`, `dist/index.js` mtime | — | cwd-independent (resolves install root) | — | — | reads install-root git only, mutates nothing | none (Core owns `xt --version`) | `source`/`dirty` are `null` on npm installs (`:51,66`) | Specialists-native (ops/diagnostic) | MEDIUM: `--json` is a stable object; version-check consumers may key on `runtime.bun`/`built_at` | `tests/unit/cli/version.test.ts`, `tests/unit/cli/version-check.test.ts` |
| `list-rules` | `--json`, `--rule <id>`, `--specialist <name>` (`src/cli/list-rules.ts:170-180`) | text matrix (`:328-333`); JSON `{rule,applied_to[]}` (`:276`), single spec (`:295`), full library (`:308`) | 0 ok; 1 unknown option (`:174`), unknown specialist (`:292`) | 4-tier mandatory-rules walk | `d/user/mandatory-rules`, `d/mandatory-rules`, `d/default/mandatory-rules`, `config/mandatory-rules`, package-canonical (`:47-56`); specialist configs | — | none | — | — | — | none (config introspection) | none | Specialists-native | LOW | `tests/unit/cli/list-rules.test.ts` |
| `list` | `--category <name>`, `--json`, `--compact`, `--full` / `--no-truncate`, `--live`, `--scope`, `--show-dead` (`src/cli/list.ts:298+`) | catalog text (`:402-435`); `--json` = JSON array of summaries (`:386`); `--live` = `id  tmuxSession  status` lines or tmux attach (`:279,285`) | 0; 1 invalid `--category`/`--scope` (`:293,364`), tmux attach spawn error (`:292`) | `SpecialistLoader`; `--live` shells `tmux attach-session` (`:285`) and scans `status.json` (`:184`) | specialist config layers; `jobs/*/status.json` (`--live`); `obs.db` elapsed-by-specialist (`:61`) | — | `--live` needs tmux on PATH and a TTY for the picker | — | — | — | `specialist_list` covers the catalog only | **catalog parity OK; `--live` has no native equivalent** — the native Fleet registry is in-process and there is no tmux session to attach to | Specialists-native (catalog); `--live` retires with the tmux path | MEDIUM: `--json` array shape is described in docs/skills; `--live` line format is scraped | `tests/unit/cli/list.test.ts`, `tests/unit/cli/attach-tui.test.ts` |
| `render-task` | positional `<name>`; `--bead <id>` (required), `--cwd <path>`, `--context-depth <n>` default 3, `--surface pi\|claude\|codex` (`src/cli/render-task.ts:45-69`) | **always JSON on stdout**: `{ok, specialist, bead_id, surface, cwd, context_depth, initial_prompt, prompt_hash, skill_prefix, components[]}` (`:113-133`); errors `{ok:false,error{code,message}}` (`:39`) | 1 for `usage`, `bead_not_found`, `template_render_failed`, `mandatory_rules_failed` | `BeadsClient` shells `bd show`/`bd` | bead via `bd`; `d` skill + mandatory-rule tiers | — (read-only by charter, `:5-7`) | none | — | — | — | consumed by the Core `xt pi\|claude\|codex <role>` launcher | K1/K2 pinned as a **line-level** contract, not a naming-similarity parity claim | Specialists-native | **HIGH** — Core `xt` parses this envelope; `prompt_hash` and `components` are pin-tested | `tests/unit/cli/render-codex-surface.test.ts`, `tests/unit/cli/codex-k4-handoff.test.ts`, `tests/unit/fixtures/codex-k3-separation.test.ts`, `tests/unit/cli/command-help.test.ts:177-190` |
| `render-bead` | positional `<id>` or `--bead <id>`; `--cwd`, `--context-depth`, `--surface` (`src/cli/render-bead.ts:52`) | same envelope as `render-task` with `specialist: null`, `skills: []`, `skill_prefix: ""` (`:11-13`) | 1, same code set as `render-task` | `BeadsClient` → `bd` | bead via `bd` | — | none | — | — | — | bare `xt claude worker --bead <id>` with no `--role` | roleless render declares **no** skills by construction, so consumers keep a position-0 body-safety fallback | Specialists-native | HIGH (same envelope family) | `tests/unit/cli/render-bead.test.ts`, `tests/unit/cli/render-codex-surface.test.ts` |
| `render-skill-prefix` | positional `<name>`; `--surface pi\|claude\|codex` (`src/cli/render-skill-prefix.ts:22-32`) | **always JSON**: `{ok, specialist, surface, skill_prefix}` (`:38-43`); errors `usage`, `specialist_not_found` (`:12-17`) | 1 | `SpecialistLoader` + `buildSkillPrefix` | specialist config layers | — | none | — | — | — | Core `xt --role` reuses this instead of re-deriving the prefix | documented as byte-identical to `render-task`'s `skill_prefix` (`:190`) | Specialists-native | HIGH — Core `xt` calls it specifically to avoid reimplementing derivation/dedup | `tests/unit/cli/render-skill-prefix.test.ts`, `tests/unit/cli/render-codex-surface.test.ts` |
| `launch-outcome` | positional `<file>`; `--json` accepted and ignored (`src/cli/launch-outcome.ts:33`) | **always JSON**: `{ok, schema_version, status, reason_code, summary, runtime, identity, worktree, readiness, safety_profile, persistence, authoritative_mutation, side_effects, next_actions}` (`:52`); errors `{ok:false,error{code,message}}` with stable codes `usage\|file_not_read\|invalid_json\|unsupported_schema\|invalid_outcome` (`:23-28`) | 1 on any failure | none — file read plus `src/specialist/launch-outcome.ts` validators | the outcome JSON file | — | none (read-only by charter, `:9-10`) | — | — | — | the Core K2 launcher is the **producer**; this verb is its only consumer | field names and reason codes owned by Core; unknown fields tolerated and never echoed (`:18-20`) | Specialists-native | **HIGH** — stable error-code list is a published contract (`docs/design/codex-k4-invocation-result.md:54`) | `tests/unit/cli/launch-outcome-cli.test.ts`, `tests/unit/specialist/launch-outcome.test.ts`, `tests/unit/fixtures/codex-k4-outcome.test.ts` |
| `view` | positional `<name>`; `--raw`, `--all`, `--section <metadata\|execution\|prompt\|...>`, `--surface pi\|claude\|codex` (`src/cli/view.ts:56-97`) | text sections (`:130-189`); `--raw` prints raw source config for piping (`:281`) | 0; 1 specialist not found (`:279`), unknown section / unknown flag (`:291-292`), unexpected extra arg (`:311`) | `SpecialistLoader` | specialist config layers | — | prompts interactively when no name and stdout is a TTY (`:202`) | — | — | — | none on MCP; config reading only | `--surface` selects `execution.surface_models[name]`; codex experimental until K5 | Specialists-native | MEDIUM — the `xt pi --role` launcher's `parseSpecialistJson` reads `view --raw` (`:270` comment) | `tests/unit/cli/view.test.ts` |
| `models` | `--provider <name>`, `--used` (`src/cli/models.ts:49-55`) | grouped text (`:101-126`); **no JSON mode** | 0; 1 when `pi --list-models` fails (`:75`) | shells `pi --list-models`, 8 s timeout (`:20-25`) | `pi` stdout; specialist configs for `--used` | — | `pi` on PATH | — | — | — | none | parses `pi` output by column position (`:33-46`) — silently empties if pi changes its table | Specialists-native (diagnostic) | MEDIUM — no JSON; a pi output change degrades silently | none found — UNKNOWN |
| `init` | `--sync-defaults`, `--sync-skills`, `--no-xtrm-check`, `--global` (`src/index.ts:339-344`) | plain-text progress (`src/cli/init.ts:737-883`); no JSON | 0; 1 when `xt` missing (`:44`), `.xtrm/` missing (`:53`), non-TTY (`:813`), unhandled error | shells `xt`; writes `.mcp.json`, `AGENTS.md`, `.claude/settings.json`, `.gitignore` | `xt` availability, `.xtrm/`, `.claude/`, `.pi/` layout | `d/user/`, `d/default/`, `d/jobs/`, `d/ready/`, `d/db/`, `d/settlements/`; `.gitignore`; `AGENTS.md`; `.mcp.json`; `.claude/hooks`; `.xtrm/skills/*` symlinks | requires a TTY for full bootstrap (`:813`); human-only | — | — | — | Core `xt init` / `xt install` own the prerequisites; sp adds the Specialists MCP entry | `--sync-defaults` is a **deprecated** compatibility path (`docs/installation.md:103`) | Core (prerequisites) + Specialists-native (sp-specific writes) | MEDIUM — many filesystem assertions pinned by integration tests | `tests/unit/cli/init.test.ts`, `tests/unit/cli/init-global.test.ts`, `tests/integration/cli/init.integration.test.ts`, `tests/integration/cli/init-global.test.ts`, `tests/unit/cli/command-help.test.ts:16-23` |
| `db` | subverbs `setup\|init\|backfill\|vacuum\|prune\|extract\|stats\|benchmark-export`; `backfill: --events`; `prune: --before, --apply, --include-epics, --dry-run`; `extract: --job, --all-missing, --since, --backfill, --skip-extract`; `stats: --spec, --model, --since, --format json\|table, --with-payload`; `benchmark-export: --output, --epic-id, --model, --epic, --include-prep` (`src/cli/db.ts:100-115,281-330`) | per-subverb text blocks; `stats --format json` → `{rows:[...], count}` (`:605`); `benchmark-export` also writes NDJSON (`:837-841`) | 0; 1 invalid subcommand / bad option (`:920-922`); explicit `process.exit(0)` on bootstrap branches (`:247,296`) | direct SQLite through `ObservabilitySqliteClient` | `jobs/*/status.json` for `backfill` (`:342`); `obs.db` | `obs.db` (heavy writer); `.gitignore` on `setup` (`:159`) | `vacuum` refuses while jobs are `running\|starting` (`:484`); TTY required for legacy migration tooling (`docs/cli-reference.md:368`) | appends `specialist_events` rows during backfill (`:378`) | — | — | none on the native path | human-only maintenance; no native analogue required | Specialists-native (ops) | MEDIUM — `stats --format json` `{rows,count}` could be consumed; `table` is the default | `tests/unit/cli/db.test.ts`, `tests/unit/cli/command-help.test.ts:120-126` |
| `integration` | `record`: `--source-branch`, `--source-worktree`, `--target-branch`, `--target-worktree`, `--commit` (required) + `--source-job-id`, `--target-role`, `--status`, `--cwd`, `--json`; `list`: `--target-branch`, `--job`, `--limit`, `--json` (`src/cli/integration.ts:44-45,83-95`) | `record` text `recorded <schema>: <src> → <tgt> @ <sha>` (`:131`) or `{ok:true,event}` (`:128`); `list` text rows (`:211`) or NDJSON, one stored event payload per line (`:199`); errors `{ok:false,error{code,message}}` only with `--json`, otherwise stderr (`:50-52`) | 0 recorded / already present; 1 for `usage`, `observability_db_missing`, `record_failed` (`:42,106-107`) | `createObservabilitySqliteClient`; refuses when no DB exists (`:106-107`) | `obs.db` | `obs.db` `branch_integration` rows (`:120`) | none | writes `xtrm.branch.integration.v1` rows | — | **never** inspects, verifies, or mutates git (`src/index.ts:411-412`) | none; this *is* the published write contract Core shells out to | observation-only; git stays the merge authority | Specialists-native | **HIGH** — `docs/cli-reference.md:1637-1643` names it the published cross-repo write surface and the counterpart of `sp ps --json`, because xtrm-tools carries no sqlite dependency | `tests/unit/cli/integration.test.ts`, `tests/unit/specialist/branch-integration-events.test.ts`, `tests/unit/cli/command-help.test.ts:78-96` |
| `validate` | positional `<name\|path>`; `--target=<surface>` (only `script` supported today), `--json` (`src/cli/validate.ts:28-58`) | text `PASS` / `✓` / `✗` (`:139-159`); JSON `{valid, errors[{path,message,code}]}` (`:96,108,118,129`) | 0 pass; 1 fail / not found / read error / invalid args (`:81,91,100,112,122,136,162`) | schema validator + `compatGuard` (`:61`) | specialist config file | — | none | — | — | — | none | `--target=script` is the only supported target today | Specialists-native | LOW-MEDIUM — `{valid,errors[].code}` is the documented shape | `tests/unit/cli/validate.test.ts`, `tests/integration/cli/validate.integration.test.ts` |
| `edit` | `<name> <dot.path> <value>` / `--get <path>` / `--set <path> <value>` / `--all` / `--preset <p> [--dry-run]` / `--global [name.field value]` / `--list-presets`; `--append`, `--remove`, `--file <path>`, `--scope <default\|user>`, `--fork-from`; legacy aliases `--model`, `--fallback-model`, `--description`, `--permission`, `--timeout`, `--tags` (`src/index.ts:492-533`, `src/cli/edit.ts`) | text confirmations and dry-run diff (`:549-564`); `--get` prints `name.field: value` (`:766`); preset list (`:807-809`) | 0; 1 invalid args/values, specialist not found, write failure, preset not found (`:100-101`) | `SpecialistLoader` + schema validation + preset resolver; validates global config (`:748`) | specialist config layers; `config/presets.json` (probed with `config/specialists/presets.json` as a fallback at `src/specialist/preset-resolver.ts:105-106`); `~/.config/specialists/user.json` for `--global` | `.specialists/user/<name>.specialist.json`, `config/specialists/*.json`, `~/.config/specialists/user.json` (`:584,591,773,835,887`) | `--all` with no path opens `$EDITOR` (`:895`); interactive otherwise | — | — | — | none; config authoring stays Specialists-owned | `--global` writes a **separate override layer** that the native path also resolves through the 3-layer merge | Specialists-native | MEDIUM — `--get`/`--set` dot-path grammar is documented and script-facing | `tests/unit/cli/edit.test.ts`, `tests/unit/cli/edit-global.test.ts`, `tests/unit/cli/config.test.ts`, `tests/integration/cli/edit.integration.test.ts`, `tests/integration/cli/preset-resolve.test.ts` |
| `config` | `<get\|set\|show> <key\|specialist> [value]`; `--all`, `--name <specialist>`, `--resolved`, `--from-source` (`src/cli/config.ts`) | `get`/`set` delegate to `edit` and inherit its output; `show <name> --resolved` prints `formatResolvedConfigReport(...)` (`:200`); deprecation banner on stderr (`:213`) | 0; 1 usage error (`:29`); otherwise propagates the `edit`/subprocess status (`:193`) | `edit` subprocess; `git rev-parse --is-inside-work-tree`, `--git-common-dir`, `--show-toplevel` (`:42,47,53`) | `.specialists/catalog/index.json` legacy path probe (`:161`); specialist config layers | delegates writes to `edit` | `--from-source` shells `bunx tsx src/index.ts ...` (`docs/cli-reference.md:1070`) | — | — | reads git identity for worktree-source resolution | none | `config show --resolved` has **no equivalent on `edit`** and remains the only surface for inspecting how a specialist's `--tools` argument is computed (`docs/cli-reference.md:1062`) | Specialists-native | MEDIUM — the deprecated `get`/`set` aliases stay script-facing; `--resolved` report is load-bearing | `tests/unit/cli/config.test.ts`, `tests/unit/cli/config.show.test.ts`, `tests/integration/cli/config-show-resolved.test.ts`, `tests/unit/cli/command-help.test.ts:141-148` |
| `chat` | positional `<name>`; `[prompt...]`, `--bead <id>`, `--prompt <text>`, `--context-depth N`, `--model M` (`src/index.ts:571`) | interactive TUI; raw terminal mode; not a machine surface | 0 TUI exit; 1 startup/terminal failure (`:59`); SIGTERM/SIGHUP exit 0, unhandled/rejection exit 1 (`:672-675`) | `Supervisor` + jobs stack; `bd create` for prompt-mode beads (`:251-256`); FIFO write for steer/resume (`:630-637`) | `jobs/<id>/status.json`, `events.jsonl` (`:289`); `obs.db` events-after-seq (`:323`) | `bd` (creates a tracking bead for a bare prompt, `:256`); FIFO `{type:'steer'\|'resume'}` | needs a TTY; leaves the job running on detach (`attach-tui.ts:79,102`) | appends chat/feed events to the job timeline | writes `{type:'steer'\|'resume'}` FIFO messages | — | none — native has no interactive TUI | native activations have no FIFO and no keep-alive turn loop; the TUI's input model does not map | Specialists-native (UX) on a native execution backend | MEDIUM — TUI only, but the FIFO payload shape is shared with `steer`/`resume` | `tests/unit/cli/chat-input.test.ts`, `tests/unit/cli/chat-control.test.ts`, `tests/unit/cli/chat-feed.test.ts`, `tests/unit/cli/chat-status.test.ts`, `tests/unit/cli/attach-tui.test.ts`, `tests/integration/chat/launch.test.ts`, `tests/integration/chat/control.test.ts`, `tests/integration/chat/mailbox-routing.test.ts`, `tests/integration/chat/status.test.ts`, `tests/smoke/sp-chat.smoke.test.ts` |
| `console` | none (`src/index.ts:582-590`); help from `src/cli/console/help.ts` | full-screen TUI over pi-tui; views `all\|ps\|feed\|job\|result\|bead\|diff\|config\|repoConfig` (`src/cli/console/types.ts:4`); not a machine surface | 0 on clean exit; signals resolve the exit promise (`:25-26`) | `createRuntimeClient(process.cwd())` (`src/cli/console/runtime.ts`, 1321 lines); multi-repo discovery | `obs.db` across discovered repos; `jobs/*/status.json`; git for diff views (`console/git.ts`) | — (read-only operator TUI) | needs a TTY; `ProcessTerminal` drains input on stop | — | — | reads git porcelain/numstat for diff views (`console/git.ts`) | none | none | Specialists-native (UX) | MEDIUM — 14 test files pin the rendering contract; view names are referenced by console help parity tests | `tests/unit/cli/console-view-model.test.ts`, `console-goldens.test.ts`, `console-help-parity.test.ts`, `console-e2e-smoke.test.ts`, `console-core-gaps.test.ts`, `console-diff-view.test.ts`, `console-repo-config*.test.ts`, `console-config-*.test.ts`, `console-resilience.test.ts`, `console-render-resilience.test.ts`, `console-telemetry-redaction.test.ts`, `console-perf.test.ts`, `console-regression.test.ts`, `console-key-gating.test.ts`, `console-theme.test.ts` |
| `run` | positional `<name>`; `--prompt`, `--bead`, `--context-depth N`, `--no-beads`, `--no-bead-notes`, `--model`, `--keep-alive`, `--no-keep-alive`, `--background`, `--json`, `--raw`, `--worktree`, `--job <id>`, `--force-job`, `--epic <id>`, `--base-sha`, `--base-ref`, `--accept-stale-base`, `--reason`, deprecated `--force-stale-base`, removed `--no-worktree` (rejection stub) (`src/cli/run.ts:155-197`) | human event summaries (`:601-609`); `--json` = pi-compatible NDJSON event stream via `createPiJsonProjector` (`src/cli/pi-json-output.ts:37`); `--raw` = legacy raw text deltas (`:605`); `--background --json` = **one** launch event `specialists.background_launch.v1` (`src/cli/run.ts:85,94-113`); `--background` without `--json` = bare job id or pid on stdout | 0 success; 1 invalid args / load / dispatch / runtime error (`:135,180,201,206,218,236,241,255,480,501,510,518,1660,1679,1705,1972`); background launch failure exits with the child status (`:1844`), success exits 0 (`:1876`) | full legacy stack: `SpecialistRunner` (`:1897-1902`), `Supervisor`, `BeadsClient`, `CircuitBreaker`, `HookEmitter`, Pi-RPC session, tmux for `--background` when available | bead via `bd show --json` (`:292-307`); `obs.db` (`findActiveJob`, `resolveEpicByChainRootBeadId`, `readEventsAfterSeq`, `appendEvent`); `jobs/*/status.json` fallback (`:355-376`) | `obs.db` status/event rows; `jobs/<id>/` mirror; `trace.jsonl` hooks; `.worktrees/*` via `provisionWorktree`; bead notes via `bd` unless `--no-bead-notes` | tmux (optional), FIFO (`mkfifo`, `supervisor.ts:1662`), detached re-invocation, `SPECIALISTS_BG_JOB_ID_PATH` handoff (`:44`), `SPECIALISTS_TMUX_SESSION` | appends timeline events to `obs.db` (`:666`); runs hook scripts; runtime-origin capture (`:1720+`) | creates a job id; may create a tracking bead (`--prompt` without `--no-beads`); writes bead completion notes; tmux session `sp-<specialist>-<suffix>` | **auto-provisions a worktree** for MEDIUM/HIGH when `requires_worktree` (`:1662-1681`); `--base-sha`/`--base-ref` fetch-and-pin; stale-base sibling guard (`:378-430`); auto-commit noise filtering | `specialist_dispatch` (MCP/Pi) | **largest delta in the audit**: native runs **in place** with a writer lease, no worktree, no `bd`, Substrate Issues authority, no tmux, no keep-alive, different readiness/refusal codes | Specialists-native (`NativeActivationHost`) behind an unchanged CLI face | **HIGH** — `--json` NDJSON is the pi-compatible stream; `--background --json` carries a distinct schema tag; `--background` stdout job-id line is parsed by agent panes and xtrm-tools | `tests/unit/cli/run.test.ts`, `run-bead-id-validation.test.ts`, `run-diff-base.test.ts`, `run-launch-line.test.ts`, `tests/unit/cli/pi-json-output.test.ts`, `tests/unit/cli/tmux-utils.test.ts`, `tests/integration/cli/run.integration.test.ts`, `tests/integration/cli/worktree.integration.test.ts`, `tests/integration/cli/run-fallback-chain.live.test.ts`, `tests/integration/cli/run-notes-mode.live.test.ts`, `tests/integration/cli/run-preset.live.test.ts`, `tests/unit/cli/command-help.test.ts:24-56` |
| `node` | subverbs `run\|list\|spawn-member\|create-bead\|wait-phase\|complete\|members\|memory\|stop\|promote`; `run: <node-config> [--inline JSON] [--bead] [--context-depth] [--json]`; `spawn-member: --node --member-key --specialist [--bead] [--phase] [--scope] [--json]`; `create-bead: --node --title [--type] [--priority] [--depends-on]`; `wait-phase: --node --phase --members [--timeout]`; `complete: --node --strategy <pr\|manual> [--force-draft-pr]`; `promote: <node-ref> <finding-id> --to-bead <id>` (`src/cli/node.ts:100-287`) | text per subverb; `--json` on every subverb (`:542,564,580,602,654,696,764,812,860,890`); action envelopes `{ok:true,...}` (`:937,952,963,984`) and `{ok:false,error}` (`:1001`) | 0; 1 invalid args, missing ids, runtime/control failure, unavailable coordinator control surface (`:896`); `src/index.ts:725` forces `process.exit(0)` after the handler | `NodeSupervisor` over the job runtime; `bd` for `create-bead` and `promote` | `obs.db` node tables (`readNodeRun`, `readNodeMembers`, `readNodeMemory`, `readNodeEvents`, `listNodeRuns`); `config/nodes`, `d/default/nodes`, package `config/nodes` (`:300,306`) | `obs.db` node/member rows; beads via `bd create`; node memory entries | node coordinator is itself a specialist job; spawns member jobs | node events into `obs.db` | node members are dispatched as ordinary jobs | node runs create worktrees through the same legacy provisioning path | partial — `specialist_dispatch` + `specialist_status` cover single activations, not node supervision | **no native node supervisor exists**; the whole NodeSupervisor contract is legacy-only today | Specialists-native (to be built) | **HIGH for `--json` consumers** — node action envelopes and `ps --node` trees are read by coordinators | `tests/unit/cli/node.test.ts`, `tests/integration/cli/node.integration.test.ts`, `tests/integration/node-actions.test.ts`, `tests/integration/node-bootstrap.test.ts`, `tests/unit/specialist/node-supervisor*.test.ts`, `tests/unit/specialist/node-contract.consistency.test.ts` |
| `epic` (first branch) | `list [--unresolved] [--json]`, `status <id> [--json]`, `sync <id> [--apply] [--json]`, `abandon <id> --reason <text> [--force] [--json]`, `merge <id> [--rebuild] [--pr] [--json] [--target-branch <name>]` (`src/index.ts:728-762`, `src/cli/epic.ts:825-891`) | `list --json` → `{epics:[...]}` (`:517`); `status --json` (`:783`); `sync --json` → result object (`:668`); `abandon --json` (`:717`); `merge --json` (`:632`); errors as `{error}` or `{epic_id,error}` with exit 1 | 0; 1 invalid args, epic not found, chains non-terminal, missing PASS, merge conflict, TS gate failure (`:499,510,549,562,586,638,650,661,700,711,733,747,758,892`) | `ObservabilitySqliteClient` epic tables; `merge.ts` git engine; `bd`; forensic emitter | `obs.db` `epic_runs` / `epic_chain_memberships`; beads; git worktree list | `obs.db` epic rows; git merge/commit; forensic events | `merge` mutates the git worktree and runs the TS gate and rebuild | `createForensicEvent` for `worktree.merged` etc. (`:424,603`) | — | **`epic merge` merges branches and commits** (`:603-632`); `sync` repairs rows only | none | **`epic merge` is a declared-broken command** (`[broken]` in help, `docs/design/using-specialists-progressive-disclosure.md:131`: *"never use sp merge or sp epic merge because both are broken"*). `list/status/sync/abandon` have no native equivalent | Specialists-native for `list/status/sync/abandon`; `merge` → INTENTIONAL_RETIREMENT | HIGH for read verbs; `merge` output is explicitly unsafe to depend on | `tests/unit/cli/epic.test.ts`, `tests/integration/cli/epic.integration.test.ts`, `tests/integration/cli/epic-flows.integration.test.ts`, `tests/unit/specialist/epic-readiness.test.ts`, `tests/unit/specialist/epic-lifecycle.test.ts`, `tests/unit/specialist/epic-reconciler.test.ts`, `tests/unit/cli/command-help.test.ts:156-176` |
| `epic` (second branch) | — | — | — | — | — | — | — | — | — | — | — | **DEAD**: `src/index.ts:1209-1213` is unreachable because the identical `sub === 'epic'` branch at `:728` always returns or `process.exit(0)`s first (`:761`). Plain `if` chain, so the second block can never execute. | Specialists-native (delete) | LOW (dead code), but it is a live trap for future edits | none — no test covers the second branch |
| `status` | `--json`, `--job <id>` (`src/cli/status.ts:79-106`) | human sections (`:387-482`); `--json` system object `{specialists{count,items[]}, pi{...}, beads{...}, mcp{...}, runtime{...}, jobs[]}` (`:318-380`); `--job --json` → `{runtime,job}` (`:311`) | 0; 1 unknown `--job` (`:260,311`) | `Supervisor` read-only; `bd`/`pi`/`sp` availability probes | `jobs/*/status.json` and `events.jsonl` (`:127,171`); `obs.db` context snapshot; `.beads` presence (`:286`); specialist configs | — | none | — | — | — | `specialist_status` (native activations + breaker + specialist count) | **shape delta**: CLI `status` reports legacy jobs; native `specialist_status` reports in-process activations, pending asks, uncertain workspaces | Specialists-native | HIGH — `status --json` is documented (`docs/cli-reference.md:420-469`) and read by scripts | `tests/unit/cli/status.test.ts`, `tests/unit/cli/chat-status.test.ts`, `tests/integration/chat/status.test.ts`, `tests/smoke/sp-chat.smoke.test.ts` |
| `ps` | `--json`, `--all`, `--follow`/`-f`, `--health`, `--active`, `--include-terminal`, `--include-cleaned`, `--include-merged`, `--node`, `--bead`, `--since`, `--zombies`, `--mine`, `--needs-attention`, `--running`; positional `<job-id>` for inspect (`src/cli/ps.ts:162-180`) | human dashboard + trees (`:658-925`); `--json` `{generated_at_ms, include_terminal, counts{jobs,nodes,trees}, flat[], trees[], native_activations[], native_activations_note}` (`:1012,1114-1157`); inspect `--json` → `{job{...}}` (`:1012-1035`) | **0 always** (empty is a valid result, `docs/cli-reference.md:1350-1354`); 1 only for unknown job id in inspect (`:1047`) | `Supervisor`/`loadStatuses`; process-health scanner; `bd query` for assignee resolution (`:114`) | `obs.db` statuses, node runs, forensic events for `native_activations` (`:413,746`); `status.json` fallback; process table | — (soft-hide for `--include-cleaned` lives in `clean --ps`) | `--follow` needs a repainting-capable stream; EPIPE exits 0 (`:1288-1292`) | — | — | reads worktree/branch fields only | `specialist_status` (partial) + the `native_activations[]` block already projected from forensics | **`native_activations` is explicitly labelled "LAST-KNOWN from forensics — not live"** (`:767,1157`): the native Fleet registry is in-process in the host session, so an external `sp ps` cannot see live native state | Specialists-native | **HIGH** — `docs/cli-reference.md:1295-1342` publishes the `--json` schema and `docs/cli-reference.md:1643` names `sp ps --json` the counterpart of the published `integration record` surface | `tests/unit/cli/ps.test.ts`, `tests/unit/cli/ps-spawned-by-line.test.ts`, `tests/unit/cli/native-activation-summary.test.ts` |
| `result` | `<node-ref>:<member>` / `<job-id>` / `--node <ref> --member <key>` / `--member <key>`; `--wait`, `--timeout <seconds>`, `--json`, `--limit` (`src/cli/result.ts:76-113`) | human: startup block + payload preamble + output to stdout, metrics footer to stderr (`:322-338`); `--json` → `{job{id,specialist,status,model,backend,bead_id,metrics,startup_context,error}, output, startup_context, error}` (`:296-312`) | 0 printed; 1 job missing, still running without a result, failed, cancelled, timeout, invalid args (`:77,91,103,108,113,401,418,441,454,468,486,499,521,546,559,571,589`) | `Supervisor.readStatus`; `obs.db` first (`readEvents`, `readNodeRun`, `readNodeMembers`, `readResult`) with `status.json`/`events.jsonl` fallback (`:148,154`) | `obs.db`; `jobs/<id>/status.json`, `events.jsonl` | — | none | — | — | — | none directly; `specialist_status`/notification model carries outcomes but there is no CLI result verb on the native path | native settlements are durable in the settlement store and are not projected into a `result` verb today | Specialists-native | **HIGH** — documented as the canonical final-output consumer (`docs/cli-reference.md:349-419`); exit 1 semantics are scripts' completion signal | `tests/unit/cli/result.test.ts`, `tests/integration/cli/result.integration.test.ts` |
| `feed` | `<job-id>` or `-f` global; `--node <ref>`, `--from <n>`, `-f`/`--follow`, `--forever`, `--json`, `--limit`, `--since`, `--specialist`, `--job` (`src/cli/feed.ts` + `src/index.ts:881-916`) | human event lines (`:576-590,949-963`); `--json` = **pi-compatible NDJSON** via `createPiJsonProjector` (`:557,941`); forensic fallback row `{source:'forensic', last_known:true, live:false, ...row}` (`:508`) | 0 success including no events; 1 unhandled runtime error (`docs/cli-reference.md:299-304`) | `Supervisor`/timeline reader; `obs.db` forensic events when the timeline is empty (`:490-508`) | `obs.db` (`readEventsAfterSeq`, `readForensicEvents`); `jobs/<id>/events.jsonl`, `status.json` fallback (`:331-334`) | — | `-f` polls; global mode tracks all jobs until all complete unless `--forever` | — | — | — | `feed_specialist` MCP tool (cursor-paginated timeline events) | `feed_specialist` returns structured events with `next_cursor`, not the pi NDJSON stream; the `--json` shape is not the same contract | Specialists-native | **HIGH** — `--json` is a pi-compatible NDJSON stream (same projector as `run --json`), consumed by `jq` recipes in docs | `tests/unit/cli/feed.test.ts`, `tests/unit/cli/chat-feed.test.ts`, `tests/unit/cli/format-helpers.test.ts`, `tests/unit/chat/feed.test.ts`, `tests/unit/cli/pi-json-output.test.ts` |
| `forensic` | positional `[job-id]`; `--family <name>`, `--event-name <name>`, `--since <5m\|iso>`, `--limit <n>` default 1000 max 10000, `--json` (default) (`src/cli/forensic.ts:47`) | `--json` NDJSON, one `event_json` per row (`:72`); default text line `<iso> family/name role job= seq=` (`:75`) | 0; 1 unknown option | `ObservabilitySqliteClient.readForensicEvents` | `obs.db` `xtrm.forensic.v1` rows | — | none | reads the canonical persisted event stream | — | — | none | none — forensic store is Specialists-owned infra | Specialists-native (ops) | MEDIUM — NDJSON rows are directly queryable and documented; `event_json` is passed through verbatim | `tests/unit/specialist/forensic-events.test.ts`, `tests/unit/cli/console-feed-source.test.ts`, `tests/unit/cli/command-help.test.ts:71-77` |
| `metrics` | `--prometheus` (default), `--since <5m\|iso>` (`src/cli/metrics.ts:8-30`) | **always Prometheus exposition text on stdout** (`:49`); no JSON | 0; throws on unknown option or unsupported format (`:26,48`) — surfaces as the global handler's exit 1 | `collectPrometheusProjection` over `obs.db` | `obs.db` runtime state + job metrics | — | none | projects `xtrm.forensic.v1` semantics into metrics | — | — | none | none | Specialists-native (ops) | MEDIUM — the Prometheus text format is a scraper contract; label discipline is asserted (`:965-967` of index help) | `tests/unit/specialist/prometheus-projection.test.ts` (no CLI-level test) |
| `log` | `[job-id]` / `-f`; `--job`, `--specialist`, `--bead`, `--node`, `--repo`, `--since`, `--limit` default 200, `-f`/`--follow`, `--json`, `--all-events`, `--legacy`, `--verbose` (`src/cli/log.ts:150-200`) | default text row: timestamp, job, specialist, bead, worktree, status, pid, event detail (`:468-473`); `--json` NDJSON envelope `{timestamp, job_id, bead_id, repo, db_path, forensic_event{...}}` (`:416,611`); schema warning to stderr (`:652`) | 0; 1 invalid args or missing observability DB (`:484,491,497`) | `createObservabilitySqliteClientAtPath` + cross-repo discovery; `--legacy` falls back to `TimelineEvent` filtering (`:483`) | `obs.db` in the repo root and in child repos (`:161,213`); `events.jsonl` via the legacy path | — | `-f` polls; parent-directory mode aggregates child repos | reads `xtrm.forensic.v1` | — | reads `worktree_path` only | none | none — `--legacy` is deprecated and scheduled for removal next minor (`:483`) | Specialists-native (ops) | **HIGH** — the NDJSON row envelope is documented in `sp log --help` with explicit field-access guidance and terminal event names | `tests/unit/cli/log.test.ts`, `tests/unit/cli/log-forensic-filter.test.ts`, `tests/unit/cli/console-telemetry-redaction.test.ts`, `tests/unit/cli/console-resilience.test.ts` |
| `steer` | `<job-id> "<message>"` positional only (`src/cli/steer.ts:12-13`) | stdout `✓ Steer message sent to job <id>` (`:51`) | 0; 1 missing args (`:17`), no job (`:28`), terminal job (`:33`), no FIFO (`:39`), write failure (`:53`) | `Supervisor.readStatus` + `emitControlEvent` (`:21,24,45`); direct FIFO write (`:44`) | `jobs/<id>/status.json` (`fifo_path`) | FIFO `{type:'steer',message}`; control event in job telemetry | job must be non-terminal **and** have a FIFO (`mkfifo` may have failed at job start, `supervisor.ts:1665`) | `emitControlEvent(jobId,'steer_sent',{source,previous_status,fifo_path,message_preview})` | FIFO message `{type:'steer', message}`; control event `steer_sent` | — | `specialist_reply` (answers a pending ask) is **not** the same thing: native has no mid-run unrequested steer | **semantic delta**: `steer` delivers at the next turn boundary best-effort; `specialist_reply` answers a specific pending question and the native host has no equivalent "push text mid-run" verb | Specialists-native (to be designed) | MEDIUM — success-line text and exit codes are script-visible; no JSON mode means no machine contract beyond exit code | none found — **UNKNOWN** (no unit/integration test imports `cli/steer.ts`) |
| `resume` | `<job-id> "<task>"` positional only (`src/cli/resume.ts:12-13`) | two stdout lines: `✓ Resume sent to job <id>` and a `feed --follow` hint (`:62-63`) | 0; 1 missing args (`:16`), no job (`:27`), non-waiting status (`:32`), no FIFO (`:38`), write failure (`:46`) | `Supervisor` (`:21,24`); FIFO write (`:44`); `emitControlEvent` best-effort (`:51-59`) | `jobs/<id>/status.json` (`fifo_path`, `status`) | FIFO `{type:'resume',task}`; control event `resume_sent` | job must be exactly `waiting` (`:31`); keep-alive job required | `emitControlEvent(jobId,'resume_sent',{source,previous_status:'waiting',next_status:'running',fifo_path,task_preview})`; a telemetry failure only warns and still exits 0 (`:59`) | FIFO `{type:'resume', task}`; control event `resume_sent` | — | `specialist_resume` (MCP v2 + Pi extension) over `NativeActivationHost.resume` | native resume continues an activation's session; there is no `waiting`/keep-alive state machine — status vocabulary differs (`waiting` is explicitly **not** terminal in the legacy model, `src/index.ts:1017-1019`) | Specialists-native | MEDIUM — exit codes and the `waiting` precondition are script-visible | `tests/unit/cli/resume.test.ts`, `tests/integration/cli/resume.integration.test.ts` |
| `retry` | `<job-id>`; `--model <model>`, `--background` (`src/cli/retry.ts` + `src/index.ts:1089-1115`) | none of its own — it re-dispatches `sp run` and inherits that output | 0 re-dispatch succeeded / launched; 1 missing args (`:79`), missing job (`:90`), non-terminal status, no bead and no workspace, re-dispatch failure (`:96`) | builds a `sp run` argv and re-invokes it (`:67-68`), so it inherits the entire legacy stack | `jobs/<id>/status.json` via `resolveJobsDir` (`:84`) | via the re-dispatched `sp run` | inherits `sp run`'s assumptions | — | — | reuses the failed job's workspace through `--job` when `worktree_path` is set (`:67`) | `specialist_retry` — **registered on `src/server.ts:170` and the Pi extension (`index.mjs:1409`), NOT on the v2 MCP server today** | native retry is an in-process re-attempt with fresh admission; the CLI retry is a shell-out to `sp run` | Specialists-native | MEDIUM — depends on `sp run` argv stability | `tests/unit/cli/retry.test.ts` |
| `follow-up` | `<job-id> "<task>"` | deprecation warning on stderr (`src/cli/follow-up.ts:5-7`), then `resume`'s output | inherits `resume` | imports and calls `resume.run()` (`:8-9`) | via `resume` | via `resume` | via `resume` | via `resume` | via `resume` | — | `specialist_resume` | pure alias; `docs/background-jobs.md:152` confirms it "remains as a deprecated alias that delegates to `resume`" | Specialists-native (retire) | LOW | `tests/integration/cli/resume.integration.test.ts` |
| `clean` | `--all`, `--keep <n>`, `--dry-run`, `--ps`, `--observability`, `--before <iso\|dur>`, `--include-epics`, `--reap-orphans`, `--processes`, `--stale-after <hours>`, `--aggressive-prune` (`src/cli/clean.ts:100-215`) | plain text reports per mode (`:384-419,477-498,550-584,675-719`); **no JSON** | 0; 1 invalid args or runtime failure (`:212-215,425`) | `ObservabilitySqliteClient` (`pruneObservabilityData`, `markSpecialistJobCancelled`, `upsertStatus`, `listReferencedChainRootJobIds`), `worktree-gc`, process scanner | `obs.db`; `jobs/*/status.json`; process table; worktree GC candidates | `obs.db` (prune / status upserts); **deletes job directories**; removes worktrees; kills leaked processes | `--reap-orphans` kills pids; requires a 30 min min-age | — | — | **removes worktrees** and prunes terminal epic rows with `--include-epics` | none | none — cleanup is Specialists-owned ops, but the native path leaves no job dirs and no tmux sessions to reap | Specialists-native (ops) | MEDIUM — destructive; no JSON means no dry-run machine contract beyond text | `tests/unit/cli/clean.test.ts` |
| `merge` | `<target-bead-id>`; `--target-branch <name>`, `--rebuild`, `--pr` (`src/index.ts:1197`, `src/cli/merge.ts`) | text result block (`:912-925`); errors to stderr with usage (`:930-931`); **no JSON** | 0 merge + TS gate passed; 1 invalid args, bead not found, no chain branch, unresolved-epic guard, empty/noise-only delta, non-terminal job (`:932`, `docs/cli-reference.md:1582`) | git engine (`worktree list --porcelain`, merge, cherry-pick, TS gate, rebuild), `bd`, `ObservabilitySqliteClient` | `obs.db` chain/epic membership; beads; git refs/worktrees | **git commits and merges**; `obs.db` branch-integration records (`:972`) | mutates the caller's git worktree; runs `tsc`/build | emits `xtrm.branch.integration.v1` (`:972`) | — | full git merge authority: fast-forward policy, `--no-ff`, worktree resolution, commit creation | none | **declared broken**: help prints `[broken]` and *"Do not use this command"* (`src/index.ts:1199`); rule 9 of the skills router states *"never use sp merge or sp epic merge because both are broken"* (`docs/design/using-specialists-progressive-disclosure.md:131`) | INTENTIONAL_RETIREMENT — see §B for the product decision and the residual-risk note | HIGH if anything still shells out to it; the emission into `integration` is the reason it has not been deleted | `tests/unit/cli/merge.test.ts`, `tests/integration/cli/merge.integration.test.ts`, `tests/unit/cli/command-help.test.ts:57-63` |
| `end` | `[--bead <id>\|--epic <id>]`, `--pr`, `--rebuild` (`src/index.ts:1219`) | text publication-mode lines (`:109-111`) and epic-redirect lines (`:138-145`); **no JSON** | 0; 1 usage error (`:96`), epic-guard redirect failure (`:142`) | routes to `epic merge` when `--epic` is set (`src/index.ts:1225`), otherwise `merge` semantics; `ObservabilitySqliteClient` | `obs.db` statuses filtered by `worktree_path` and `chain_root_bead_id` (`:72`) | via `merge`/`epic merge` | inherits merge's git mutation | — | — | `git rev-parse --abbrev-ref HEAD` (`:83`) plus merge's git work | none | **inherits the broken merge/epic-merge path** | INTENTIONAL_RETIREMENT (routes into a retired command) | **HIGH** — a session-close helper; if it is removed without a replacement, agent session-close flows break | `tests/integration/cli/end.integration.test.ts` |
| `stop` | `<job-id>`; `--force`, `--close-bead-anyway` (`src/cli/stop.ts:5-30`) | none; success is silent, failures to stderr (`src/specialist/control.ts:126-177`) | 0 signal sent / already terminal / ESRCH; 1 missing args (`:40`), unknown option (`:26`), missing job (`:46`), missing pid or unexpected kill error (`:53`) | `stopJob` → SIGTERM/SIGKILL to the recorded pid, optional tmux session kill | `jobs/<id>/status.json` (pid) | job status marked terminal; `obs.db` control events | kills a process; escalates SIGTERM→SIGKILL on `--force`; may kill a tmux session | `emitControlEvent` for `stop_requested`, `signal_sent`, `status_marked_before_signal`, `force_stop_escalated`, `tmux_kill_requested`, `stop_marked_error`, `stop_terminal_alive_reaped` (`src/specialist/control.ts:78-177`) | `stop_requested`, `signal_sent`, `force_stop_escalated`, `tmux_kill_requested` | — | `specialist_stop_activation` (MCP v2 + Pi extension) | native stop settles an activation through `NativeActivationHost`, releases the writer lease, and records forensics; it does not signal a host pid and has no `--close-bead-anyway` (Substrate issue, not a bead note) | Specialists-native | MEDIUM — exit codes and `--force`/`--close-bead-anyway` are documented; no JSON | `tests/unit/cli/stop.test.ts` |
| `finalize` | `<job-id>` positional (`src/cli/finalize.ts:8-11`) | none on success; errors to stderr | 0 chain finalized (one or more members waiting→done); 1 missing args (`:19`), not eligible or job not found (`:26`) | `finalizeJob` from `src/specialist/control.ts`; reads a reviewer PASS verdict | `obs.db` `specialist_results` first; `result.txt` fallback when `SPECIALISTS_JOB_FILE_OUTPUT=on` (`src/index.ts:1267-1268`) | job statuses for all waiting keep-alive chain members | requires keep-alive chain members in `waiting`; refuses non-waiting or non-PASS | — | — | — | none — the native path has no keep-alive turn loop and no chain-finalize concept | **semantic delta**: finalize exists only to close the legacy keep-alive chain after a reviewer PASS; native settlements are exactly-once publications (`feat(XTRM-252.8)`, `07ecb683`) with no equivalent operator step | INTENTIONAL_RETIREMENT once keep-alive chains are gone | MEDIUM — depends entirely on keep-alive semantics | `tests/unit/cli/finalize.test.ts`, `tests/integration/cli/finalize.integration.test.ts` |
| `attach` | `<job-id>` positional, or no argument for an interactive picker (`src/cli/attach.ts:155-170`) | full-screen TUI (`attach-tui.ts`); not a machine surface | 0 attached then exited normally; 1 missing args / job missing / terminal state / no FIFO / non-TTY (`:27`); 130 on Ctrl+C in the picker (`:118`) | `loadStatuses`; FIFO write for TUI input; `feed.appendEvent` for chat events (`attach-tui.ts:123-139`) | `jobs/*/status.json` (`status`, `fifo_path`, `bead_id`, `specialist`) | FIFO `{type:'steer'\|'resume'}`; chat events into the job timeline | **requires a TTY**; job must be non-terminal | appends chat events | FIFO `{type:'steer'\|'resume'}` | — | none — native has no attachable live session from a separate process | **documentation mismatch**: `src/index.ts:1287` and `docs/cli-reference.md:594` describe `attach` as the **tmux** attachment path requiring `tmux_session`, but `src/cli/attach.ts` contains **no tmux call at all** — it drives the in-process TUI in `src/cli/attach-tui.ts` from `jobs/*/status.json`. The tmux attach path today is `list --live` (`src/cli/list.ts:285`). | Specialists-native (UX) | MEDIUM — TTY-only, but the stale tmux description is a documented contract that is already wrong | `tests/unit/cli/attach.test.ts`, `tests/unit/cli/attach-tui.test.ts`, `tests/integration/cli/attach.integration.test.ts` |
| `prune-stale-defaults` | `--dry-run`, `--keep-diverged`, `--root <path>`, `--help`/`-h` (`src/cli/prune-stale-defaults.ts:4-33`) | text findings list and summary (`:53-68`) | 0; throws on unknown argument (`:30`) → global exit 1 | `detectDriftForRepo` + `pruneStaleDefaults` (`:49,67`) | `d/default/` snapshots vs package canonical | **deletes** `d/default/` entries | none | — | — | — | none | none — package/mirror hygiene | Specialists-native (ops) | MEDIUM — destructive default change already documented in its own output (`:59`) | `tests/unit/cli/prune-stale-defaults.test.ts` |
| `quickstart` | none (`src/index.ts:1313-1316`) | static text guide (`src/cli/quickstart.ts:19-255`) | 0 | none | — | — | none | — | — | — | none | none | Specialists-native (docs surface) | LOW | `tests/unit/cli/quickstart.test.ts` |
| `doctor` | default checks; `orphans`; `--check-drift`/`--drift`, `--pr-drift`, `--reap-dead-jobs [--dry-run] [--json]`, `--channels`, `--specialists`, `--catalogs`, `--check-catalogs`, `--check-channels`, `--check-specialists`, `--require-installed`, `--list-models`, `--add`, `--apply`, `--accept-overwrite`, `--root`, `--cwd`, `--global`, `--json` (`src/cli/doctor.ts:560-600`) | text check blocks; `--json` on subcommands: drift `{drift_findings:[...]}` (`:775`), PR drift `{jobs:[...]}` (`:1080`), reap `{dryRun, found:[{job_id,pid,reason,age_ms}], cancelled}` (`:1135`), plus structured stderr logs (`:1036,1068,1131`) | **0 always** for the default run — failures are reported in output, not the exit code (`docs/cli-reference.md:1191-1195`); 1 on unknown subcommand (`:1206`) | `bd`/`pi`/`xt` availability probes; `xt claude-sync --check --json` (`:507`); `gh pr view --json` for `--pr-drift`; `ObservabilitySqliteClient` for reap | `.beads/`, `d/` layout, `.mcp.json`, `.claude/settings.json`, hooks, catalogs, `obs.db` | runtime dirs when auto-creating; `obs.db` status updates for `--reap-dead-jobs` (`:873`) and PR-drift refresh | `--reap-dead-jobs` mutates unless `--dry-run`; gh failures classify as `unknown` and never throw | `xtrm.forensic.v1` `lifecycle.dead_declared` events per reap finding (`:1358` in index help) | — | — | none | none — health/diagnostic for the whole install (legacy + native) | Specialists-native (ops) | **HIGH** — `--json` envelopes on three subcommands are documented; the *always-0* default-run contract is documented and is what CI relies on | `tests/unit/cli/doctor.test.ts`, `doctor-drift.test.ts`, `doctor-catalogs.test.ts`, `doctor-pr-drift.test.ts`, `doctor-specialists.test.ts`, `tests/integration/cli/doctor.integration.test.ts`, `tests/unit/specialist/channel-doctor.test.ts`, `tests/unit/cli/command-help.test.ts:127-133` |
| `setup` | `--discovery`, `--fetch-benchmarks [--offline]`, `--plan <preset>`, `--apply <plan.json> [--dry-run]`, `--probe-only <model> <spec>`, `--interactive`, `--json`, `--global` (`src/cli/setup.ts:55,127-199`) | `{workflow, skill_reference}` under `--json` for the interactive path (`:262`); other modes `JSON.stringify(value)` or a text formatter (`:270-273`) | 0; **75 (`EX_TEMPFAIL`)** when `--offline` and the benchmark cache is missing or stale (`:9,324,329`) — the only non-0/1 exit code in the CLI besides 130 | model probes; benchmark cache fetcher; global config writer | benchmark cache, specialist catalog registry, `~/.config/specialists/user.json` | global user config via `--apply` (rollback on failure, `:507`) | `--probe-only` spends real model calls | — | — | — | none | none — model-benchmark tooling is Specialists-owned | Specialists-native (ops) | MEDIUM — `EX_TEMPFAIL` is a documented-ish cron contract; `--json` shape differs per mode | `tests/unit/cli/setup.test.ts`, `tests/integration/cli/setup.live.test.ts` |
| `serve` | `--port`, `--concurrency`, `--shutdown-grace-ms`, `--project-dir`, `--db-path`, `--fallback-model`, `--queue-timeout-ms`, `--audit-failure-threshold`, `--log-level`, `--mode`, `--allow-skills`, `--allow-skills-roots`, `--allow-local-scripts`, `--no-*` pi passthrough flags, `--readiness-canary*`, `--reload-poll-ms` (`src/cli/serve.ts:20-38,60-100`) | HTTP JSON, not CLI JSON: `POST /v1/generate`, `GET /healthz` → `{ok:true}`, `GET /metrics`, `GET /jobs/:id/feed-events`, readiness probe → `{ready, warning?, db_write_failures_total}`; errors `{success:false, error, error_type}` (`:306-438`) | 0 on SIGTERM after grace (`:457`); process exit otherwise | `runScriptSpecialist` + Pi subprocess spawn; `ObservabilitySqliteClient` | `obs.db`; `d/user` specialist dirs; pi config for the readiness canary | `obs.db` | long-running daemon; binds a port (reports the **bound** port, `:464-467`); SIGTERM grace then SIGKILL | serves Prometheus metrics on `/metrics` | — | — | none | none | Specialists-native (service) | **HIGH** — HTTP routes and the `error_type` enum (`auth`, `quota`, `timeout`, `network`, `invalid_json`, `output_too_large`, …) are an external service contract | `tests/unit/cli/serve-readiness.test.ts`, `tests/unit/cli/serve-hot-reload.test.ts`, `tests/integration/sp-serve.test.ts` |
| `script` | positional `<name>`; `--vars k=v`, `--template <text>` \| `--template-field <name>`, `--model`, `--thinking`, `--user-dir`, `--db-path`, `--timeout-ms`, `--json`, `--allow-local-scripts`, `--allow-write-capable`, `--single-instance <lockpath>`, `--no-trace`, `--project-dir` (`src/cli/script.ts:28-100`) | default = assistant text only (`:126`); `--json` = full `GenerateResponse` JSON (`:122`); errors to stderr (`:129`) | **granular, cron-oriented** (`:105-118`): 0 success; 1 default; 2 specialist_not_found/load_error; 3 template_variable_missing; 4 auth/quota; 5 timeout/network; 6 invalid_json; 7 output_too_large; 75 when the `--single-instance` flock is already held (`:145-148`) | `runScriptSpecialist` + Pi subprocess; `SpecialistLoader` | specialist config; `obs.db` via `--db-path`/project dir | `obs.db` traces unless `--no-trace` | `--single-instance` shells `flock -n` and re-invokes itself (`:142-148`) | script-runner traces into `obs.db` | — | — | none | none | Specialists-native (ops/cron) | **HIGH** — the exit-code table is the documented cron contract (`src/index.ts:1423` help; `docs/cli-reference.md`) | `tests/unit/cli/script.test.ts`, `tests/integration/sp-script.test.ts` |
| `release` | passthrough: `process.argv.slice(3)` handed to `xt` (`src/index.ts:1440`) | none of its own; `xt release` output via `stdio: 'inherit'` | propagates `xt`'s status (`:1445`); 1 if `xt` cannot be spawned (`:1442-1444`) | shells `xt release` | — | — | `xt` on PATH | — | — | — | Core `xt release prepare/publish` | none — `docs/release.md:8` and `docs/cli-reference.md:1768` confirm the deprecated alias | Core (`xt`) | LOW — already a documented alias | `tests/unit/cli/version-check.test.ts` indirectly; no dedicated test |
| `help` / `--help` / `-h` | none | static text catalog, two tiers: `CORE_COMMANDS` and `EXTENDED_COMMANDS` (`src/cli/help.ts:11-60`) | 0 | none | — | — | none | — | — | — | none | none | Specialists-native (docs surface) | MEDIUM — help text is snapshot-tested and is the user-facing command inventory | `tests/unit/cli/help.test.ts`, `tests/unit/cli/command-help.test.ts` (21 assertions across 24 subcommands), `tests/unit/cli/console-help-parity.test.ts` |

---

# A) Scripting compatibility surface

## A.1 `--json` / `--format` / `--robot` survey

Every flag carrying `--json` today, verified by reading the parser in each file:

| flag form | where | notes |
|---|---|---|
| `--json` (boolean) | `version`, `list-rules`, `list`, `node` (all subverbs), `integration record`, `integration list`, `validate`, `status`, `ps`, `result`, `feed`, `forensic` (default), `log`, `metrics` (not needed), `script`, `setup`, `doctor` (on `--check-drift`, `--pr-drift`, `--reap-dead-jobs`), `epic` (all subverbs), `launch-outcome` (accepted, ignored), `render-*` (implicit) | |
| `--format json\|table` | `db stats` **only** (`src/cli/db.ts:324-327`); default `table` | the only `--format` in the CLI |
| `--robot` | **nowhere** | verified absent from `src/cli/**`; `bv --robot-*` is a different project |
| structured stderr | `log` schema warning (`src/cli/log.ts:652`), `doctor` structured logs (`:1036,1068,1131`), `run` refusal envelope (`src/cli/run.ts:413,800`) | |

### The two JSON helper modules the task named

- **`src/cli/pi-json-output.ts`** is a real output contract. `createPiJsonProjector`
  (`:37`) projects the persisted specialist timeline into pi's documented JSON event stream.
  It is used by `run --json` (`src/cli/run.ts:601`) and `feed --json`
  (`src/cli/feed.ts:557,941`). Event vocabulary it can emit: `session` (with `version: 3`),
  `agent_start`, `turn_start`, `turn_end`, `message_start`, `message_update`
  (`text_start`/`text_delta`/`text_end`), `message_end`, `tool_execution_start`/`_update`/`_end`,
  `compaction_start`/`_end`, `auto_retry_start`/`_end`, `agent_end`, `agent_settled`
  (`:60-211`). Usage field spelling is camelCase (`cacheRead`, `cacheWrite`, `totalTokens`,
  `stopReason`, `partial`) because it targets pi's consumer, not this repo's snake_case.
- **`src/specialist/json-output.ts`** is **not** an output contract. It exports exactly one
  function, `stripJsonFences(text)` (`:1-5`), which removes a leading/trailing markdown code
  fence. No CLI verb uses it to shape a machine payload. Treating it as part of the JSON
  surface would be a naming-similarity inference, so it is recorded here as **not load-bearing**.

## A.2 Byte-compatibility requirements

These are the surfaces where an external consumer parses exact bytes. A change to field
spelling, event names, ordering, or line framing is a breaking change, not a semantic one.

| # | surface | consumer | why byte-level | evidence |
|---|---|---|---|---|
| B1 | `sp run --json` NDJSON stream | pi-compatible consumers; docs' `jq` recipes | event names and camelCase fields are pi's stream, not this repo's | `src/cli/pi-json-output.ts:37-211`; `src/cli/run.ts:601` |
| B2 | `sp feed --json` NDJSON stream | same projector, same consumers | identical projector as B1 | `src/cli/feed.ts:557,941` |
| B3 | `sp run --background --json` single event | agent panes / xtrm-tools parsing stdout as NDJSON | the schema tag exists precisely so a strict pi consumer does not mis-parse it as a run stream | `src/cli/run.ts:85,94-113` |
| B4 | `sp run --background` (no `--json`) stdout | agent panes, xtrm-tools, shell scripts | a bare job id (or pid) on stdout is the whole handoff | `src/cli/run.ts:102` |
| B5 | `sp run` stderr launch-error markers | `extractLaunchError` parses `"error_code":"..."` and a line-final `Fatal error: ...` | the regex is a parser of another process's stderr | `src/cli/run.ts:116-126` |
| B6 | `sp ps --json` | documented as the published cross-repo read surface, counterpart of `integration record` | `.specialists/db/observability.db` is private to the repo, so external tools read this JSON instead of the schema | `docs/cli-reference.md:1643`; `src/cli/ps.ts:1114-1157` |
| B7 | `sp integration record --json` / `list --json` | xtrm-tools core after `xt merge` / `gh pr merge` | explicitly *"Published write surface for consumers outside this repo"* | `src/index.ts:408-410`; `src/cli/integration.ts:50,128,199` |
| B8 | `sp render-task` / `render-bead` / `render-skill-prefix` / `launch-outcome` JSON envelopes | Core `xt` launcher (`xt pi\|claude\|codex <role>`) | K1/K2-pinned; `render-skill-prefix` exists solely so Core can avoid re-deriving the prefix byte-for-byte | `src/cli/render-task.ts:113-133`; `src/cli/render-skill-prefix.ts:3-5,190`; `src/cli/launch-outcome.ts:52` |
| B9 | `sp script` exit-code table | cron / host scripts | 0/1/2/3/4/5/6/7/75 is a documented dispatch contract | `src/cli/script.ts:105-118,145-148` |
| B10 | `sp log --json` row envelope | monitor recipes in `using-specialists/references/monitoring.md` | field-access guidance is in the command's own help (`--forensic_event` nesting) and terminal event names are named | `src/cli/log.ts:416,611`; `src/index.ts:1011-1020` |
| B11 | `sp metrics` Prometheus text | scrapers | exposition format is a wire format | `src/cli/metrics.ts:49` |
| B12 | `sp serve` HTTP JSON + `error_type` enum | external service callers | routes and the error-type vocabulary are the service contract | `src/cli/serve.ts:306-438` |
| B13 | `sp doctor` default-run exit code 0 | CI | *"Always (current implementation reports failures in output, not process exit code)"* | `docs/cli-reference.md:1191-1195` |
| B14 | command-level `--help` text | `tests/unit/cli/command-help.test.ts` (21 assertions) and, transitively, agent prompts that quote help | 24 subcommands' help strings are snapshot-asserted, including that every `run.ts` flag appears in `run --help` | `tests/unit/cli/command-help.test.ts:16-201` |

## A.3 Semantic-only contracts

Shape-stable but tolerant of additive change. Consumers read named keys; extra keys and
reordering are safe.

- `version --json` `VersionInfo` (`src/cli/version.ts:8-19`).
- `status --json` (`src/cli/status.ts:318-380`) and `status --job --json` (`:311`).
- `result --json` `{job{...}, output, startup_context, error}` (`src/cli/result.ts:296-312`).
- `list --json` array of specialist summaries (`src/cli/list.ts:386`).
- `list-rules --json` three shapes (`src/cli/list-rules.ts:276,295,308`).
- `validate --json` `{valid, errors[{path,message,code}]}` (`src/cli/validate.ts:96,108,118,129`).
- `forensic` NDJSON with `event_json` passed through verbatim (`src/cli/forensic.ts:72`).
- `db stats --format json` → `{rows,count}` (`src/cli/db.ts:605`).
- `epic list --json` `{epics:[...]}`; `epic status/sync/abandon/merge --json` result objects
  (`src/cli/epic.ts:517,668,717,632,783`). Error envelopes `{error}` / `{epic_id,error}` are
  **not** a shared shape — they vary per handler.
- `node --json`: `list` returns an array (`:602`); actions return `{ok:true,...}` (`:937,952,963,984`);
  failures return `buildActionError(...)` (`:1001`) — the failure envelope is not the `{ok:false,error}`
  shape used by `integration`/`launch-outcome`/`render-*`. **This inconsistency is a real
  compatibility hazard**: a consumer cannot use one error parser across verbs.
- `ps <job-id> --json` → `{job{...}}` (`src/cli/ps.ts:1012-1035`); unknown job prints
  `{error:"Job not found: <id>"}` and sets exit 1 **while still exiting 0-shaped JSON on stdout**
  (`:1043-1047`) — the error path is stdout JSON plus `process.exitCode = 1`, not stderr.
- `doctor --check-drift --json` (`:775`), `--pr-drift --json` (`:1080`), `--reap-dead-jobs --json`
  (`:1135`); structured stderr logs at `:1036,1068,1131`.
- `setup --json`: `{workflow, skill_reference}` for interactive (`:262`), raw value otherwise (`:270`).

## A.4 Stable stdout/stderr shapes that are not JSON

- `run --background` job-id line (B4).
- `result` human mode: final output on **stdout**, metrics footer on **stderr**
  (`src/cli/result.ts:326,337`) — redirection semantics matter (`sp result <id> > out.md`).
- `steer` / `resume` success lines (`src/cli/steer.ts:51`, `src/cli/resume.ts:62-63`).
- `resume` warning when telemetry fails but delivery succeeded, exit still 0 (`src/cli/resume.ts:59`).
- `[deprecated]` and `Error:` prefixes on stderr (`src/cli/run.ts:190`, `:200-255`).
- Global fatal handler: `[specialists] [ERROR] Fatal error:` (`src/index.ts:13`).
- `unknown command` + `Run 'specialists help'` (`src/index.ts:1455`).

## A.5 Load-bearing summary

Load-bearing (byte-level): **B1-B14 above**.
Semantic-only: the list in A.3.
Not part of the surface: `src/specialist/json-output.ts` (`stripJsonFences` only).

The single highest-risk item is **B3/B4**: `sp run --background` is the *required* dispatch form
from an agent pane (`src/index.ts:619-620`), and its stdout is either a bare job id or a
schema-tagged JSON event depending on `--json`. Both spellings must survive any backend change.

---

# B) Commands with no native equivalent — the blocker list

Each entry is a command (or sub-behaviour) with **no** `NativeActivationHost` / MCP path today.
Grouped by why.

## B.1 No native subsystem exists at all

| command | blocker | evidence |
|---|---|---|
| `node` — all 10 subverbs | No native node supervisor. `NodeSupervisor` (`src/specialist/node-supervisor.ts`) drives coordinator + member **legacy jobs**, node tables in `obs.db`, and `sp run` dispatches. Nothing in `src/activation/**` implements node runs, member lineage, node memory, or phase waits. | `src/cli/node.ts:1006-1070`; `docs/nodes.md`; no `node` reference in `src/activation/**` |
| `epic list/status/sync/abandon` | Native epic lineage comes from Substrate `parent_child` edges (`epicAncestors(ref, depth)`, `docs/native-activation.md:110-114`); there is no native `epic_runs` table, no readiness reconciler, and no `epic sync` repair path. | `src/cli/epic.ts:865-889`; `docs/native-activation.md:110-114` |
| `serve` | HTTP wrapper for **script-class** specialists over `runScriptSpecialist` (`src/cli/serve.ts:10`). The native host hosts role specialists on `AgentSession`; there is no native HTTP surface. | `src/cli/serve.ts:306-438` |
| `script` | One-shot **script-class** runner over `runScriptSpecialist` (`src/cli/script.ts:155`). Script-class is a separate engine from both `Supervisor` and `NativeActivationHost`. | `src/cli/script.ts:105-163` |
| `steer` | Native activation has no mid-run unrequested steer. `specialist_reply` answers a *pending question*; the host exposes no "inject text now" verb. | `src/cli/steer.ts:43-45`; MCP tool list `src/mcp/v2-server.ts:166-171` |
| `finalize` | Exists only to close legacy keep-alive chain members after a reviewer PASS (`docs/cli-reference.md:699-721`). Native activations settle exactly once and have no `waiting`-between-turns state machine. | `src/cli/finalize.ts:6,23`; `src/index.ts:1267-1269` |
| `list --live` | Attaches to a **tmux** session. Native activations run in-process in the host session; there is no session to attach to. | `src/cli/list.ts:285`; `src/activation/registry.ts:1-8` (Fleet registry is a persistent in-process store, not an attachable session); `docs/native-activation.md:198` |
| `attach` | TTY TUI over `jobs/*/status.json` FIFO. No native equivalent from a separate process. | `src/cli/attach.ts:155-170`; `src/cli/attach-tui.ts` |
| `chat` | Interactive TUI with FIFO steer/resume and a keep-alive turn loop. No native FIFO, no keep-alive. | `src/cli/chat.ts:630-637`; `src/cli/chat/control.ts` |
| `console` | Multi-repo operator TUI over `obs.db` + `jobs/` across discovered repos. Native Fleet state is in-process only. | `src/cli/console/runtime.ts`; `src/cli/console/repo-discovery.ts` |

## B.2 Native subsystem exists, but the behaviour does not map

| command | gap |
|---|---|
| `run --keep-alive` / `--no-keep-alive` | Native has no keep-alive turn loop. `waiting` is explicitly documented as *not* terminal in the legacy model (`src/index.ts:1017-1019`); native has no equivalent status. |
| `run --worktree` / `--job <id>` / `--no-worktree` removal | Native writers **run in place** with a writer lease and *"there is no per-activation worktree provisioning on the native path"* (`docs/native-activation.md:66-70`). There is no branch, no `.worktrees/*`, and no workspace reuse-by-job concept. |
| `run --base-sha` / `--base-ref` / `--accept-stale-base` / `--reason` / `--force-stale-base` | These pin and gate the *worktree base branch*. With no worktree, the whole stale-base guard has no native analogue. |
| `run --no-beads` / `--no-bead-notes` | Native authority is Substrate Issues, not Beads: *"There is no Beads client and no `bd` subprocess on the native path"* (`docs/native-activation.md:52-56`). `docs/overrides-guide.md:17` confirms `beads_write_notes`/`beads_integration` *"apply to the legacy `sp` CLI only"* and native *"publish their result to the Substrate Journal instead"*. |
| `stop --close-bead-anyway` | Bead-note semantics; native has no bead notes. |
| `retry` on MCP v2 | `specialist_retry` is registered on `src/server.ts:170` and the Pi extension (`index.mjs:1409`) but **not** on the v2 MCP server that `src/index.ts:1462` actually starts (`src/mcp/v2-server.ts:166-171`). A retry path exists natively but is not reachable from the shipped MCP entrypoint. |
| `ps --follow` / live native state | `ps` already projects `native_activations[]`, but its own output says *"LAST-KNOWN from forensics, not live (the Fleet registry is in-process in the host session)"* (`src/cli/ps.ts:767,1157`). Out-of-process live native observation does not exist. |
| `clean --reap-orphans` / `--processes` / `--ps` | Reap legacy leaked tool processes, tmux/dolt/gitnexus orphans, and soft-hide terminal **job** rows. Native activations leave no job dirs and no tmux sessions. `--observability` prune remains relevant because native forensics share `obs.db`. |
| `doctor --pr-drift` / `--reap-dead-jobs` | Both iterate `specialist_jobs` rows in active states. Native activations do write `obs.db` (see below), so these may partially apply, but the predicates (`pr_drift_checked_at_ms`, pid/ESRCH) are legacy-job fields. |
| `end` | Routes to `epic merge` (`src/index.ts:1225`) and `merge` semantics. Replacing it requires a native session-close publication path that does not exist. |

## B.3 Important correction to the "legacy store" framing

`observability.db` is **not** a legacy-only store. `src/activation/forensic-sink.ts:1-21` states:
*"Native and legacy activations write one `observability.db`. Native events are projected onto the
existing timeline vocabulary, written through the same append-event writer … There is deliberately
NO native-subagent telemetry database and no second forensic model."*

Consequences:
- `forensic`, `log`, `metrics`, `db stats`, `ps` (SQLite-first), and `clean --observability` are
  **dual-path**, not legacy-only. They are not migration blockers and should not be retired with
  the legacy runner.
- `.specialists/jobs/` **is** legacy-only as a write target: the native path writes
  `obs.db`, `.specialists/settlements/` (`src/activation/native-host.ts:494`),
  `.specialists/interactions/` (`:424`), and `.specialists/leases/` (`src/activation/workspace-lease.ts:209`)
  — never `jobs/`. Every `jobs/*/status.json` read below is therefore a legacy mirror read.

## B.4 Declared retirements (product decisions cited)

| command / flag | decision | citation |
|---|---|---|
| `merge` | *"`sp merge` and `sp epic merge` … both are broken"*; help prints `[broken]` and *"Do not use this command"* | `docs/design/using-specialists-progressive-disclosure.md:131`; `src/index.ts:1199,1200` |
| `epic merge` | same decision; help prints `[broken]` | `src/cli/epic.ts:842`; `tests/unit/cli/command-help.test.ts:57-63,168-176` |
| `install` | *"setup and install are deprecated; use specialists init"* | `src/index.ts:328`; `src/cli/install.ts:9-12` |
| `config get`/`set` | *"a deprecated alias for `specialists edit`. It will be removed in a future version."* (`config show --resolved` is explicitly NOT deprecated) | `docs/cli-reference.md:1047,1062` |
| `follow-up` | *"remains as a deprecated alias that delegates to `resume`"* | `docs/background-jobs.md:152`; `src/cli/follow-up.ts:5-9` |
| `release` | *"remain as deprecated aliases for backward compatibility … print a deprecation notice on every invocation"* | `docs/release.md:8`; `src/index.ts:1439` |
| `--force-stale-base` | *"deprecated; use `--accept-stale-base --reason <text>`. Aliased for one release."* | `src/cli/run.ts:190` |
| `log --legacy` | *"deprecated, removed next minor release"* | `src/cli/log.ts:483` |
| `init --sync-defaults` | deprecated compatibility path | `docs/installation.md:103` |
| `use_specialist` (MCP) | retired; module deleted; no synchronous dispatch path | `docs/mcp-tools.md:274-279` |

**No retirement decision found** (so these are blockers, not retirements): `attach`,
`list --live`, `chat`, `console`, `finalize`, `end`, `ps --follow`, `node`, `epic list/status/sync/abandon`,
`serve`, `script`, `steer`, `run --worktree`, `run --keep-alive`.

---

# C) Commands that become FRONTEND_ONLY

The UX (flags, exit codes, stdout/stderr shape) stays exactly as documented; the execution
backend behind it changes from `SpecialistRunner`/`Supervisor`/Pi-RPC/jobs to
`NativeActivationHost` (+ Substrate). For each, the CLI face is separable from the engine.

| command | stays (face) | changes (backend) | seam in code today |
|---|---|---|---|
| `run` | all flags, both background forms (B3/B4), `--json` stream, all documented exit codes | `new SpecialistRunner(...)` + `Supervisor` + Pi-RPC → `NativeActivationHost.start()` | `src/cli/run.ts:1897-1902` constructs `SpecialistRunner`; `src/specialist/launch.ts:64` | 
| `result` | `<job-id>` / node-member addressing, stdout output + stderr footer, exit 1 semantics | `Supervisor.readStatus` + `obs.db`/file reads → activation result read | `src/cli/result.ts:314-315` |
| `feed` | `-f`, `--node`, `--from`, pi NDJSON under `--json` | timeline/`obs.db` reads + file fallback → activation event projection | `src/cli/feed.ts:331-334` |
| `status` | sections and `--json` object | job status listing → activation listing (shape delta required) | `src/cli/status.ts:300-380` |
| `ps` | flags, `--json` schema, always-0 exit | `loadStatuses()` + process health → activation status + already-present `native_activations[]` | `src/cli/ps.ts:1114-1157` |
| `log` | filters, NDJSON row envelope | `obs.db` is shared; only the legacy `--legacy` timeline branch is at risk | `src/cli/log.ts:483,504` |
| `forensic` | NDJSON passthrough | `obs.db` shared — no backend change needed | `src/cli/forensic.ts:72` |
| `metrics` | Prometheus text | `obs.db` shared — no backend change needed | `src/cli/metrics.ts:49` |
| `steer` | argv + exit codes | FIFO write → a native control verb (must be designed) | `src/cli/steer.ts:43-45` |
| `resume` | argv + `waiting` precondition + exit codes | FIFO write → `specialist_resume`/`NativeActivationHost.resume` | `src/cli/resume.ts:42-44` |
| `retry` | argv + exit codes | shell-out to `sp run` → native retry (and register it on v2 MCP) | `src/cli/retry.ts:67-68` |
| `stop` | argv + exit codes | pid SIGTERM → `specialist_stop_activation` | `src/specialist/control.ts:126-177` |
| `finalize` | argv + PASS precondition | keep-alive chain close → native settlement/notification | `src/cli/finalize.ts:6,23` |
| `chat` | TUI, input model, FIFO steer/resume | job feed + FIFO → native event stream + native control verbs | `src/cli/chat.ts:630-637` |
| `attach` | TTY TUI picker | `jobs/*/status.json` → activation projection | `src/cli/attach.ts:45-48` |
| `console` | views `all/ps/feed/job/result/bead/diff/config/repoConfig` | `obs.db` + `jobs/` multi-repo discovery → same store, job-dir reads dropped | `src/cli/console/runtime.ts:1-100` |
| `list` | catalog output + `--json` array | `SpecialistLoader` only — no backend change for the catalog | `src/cli/list.ts:383-435` |
| `node` | all subverbs + `--json` envelopes | `NodeSupervisor` over legacy jobs → a native supervision layer (must be built) | `src/cli/node.ts:1006-1070` |
| `epic list/status/sync/abandon` | `--json` objects and text | `epic_runs` rows + legacy chain readiness → Substrate `parent_child` lineage | `src/cli/epic.ts:865-889` |
| `clean` | flags and text reports | `--observability` stays (shared store); job-dir/worktree/tmux reaping loses its target | `src/cli/clean.ts:659-719` |
| `doctor` | check list, always-0 default exit, three `--json` envelopes | probes stay; `--pr-drift`/`--reap-dead-jobs` predicates are legacy-job fields | `src/cli/doctor.ts:1014-1135` |
| `db` | subverbs, `--format json|table` | `obs.db` shared; `backfill` from `jobs/*/status.json` is a legacy-migration-only verb | `src/cli/db.ts:342-378` |
| `integration` | both verbs, `--json` shapes, exit codes | `obs.db` shared — no backend change needed | `src/cli/integration.ts:120,199` |
| `edit` / `config` / `validate` / `view` / `list-rules` / `models` / `version` / `help` / `quickstart` | unchanged | config/loader layer already shared by both runtimes | `src/specialist/loader.ts` |
| `init` / `prune-stale-defaults` / `setup` | unchanged | filesystem/config only | `src/cli/init.ts`, `src/cli/setup.ts` |
| `render-task` / `render-bead` / `render-skill-prefix` / `launch-outcome` | unchanged, must stay byte-stable | already on the shared task-prompt/launch-outcome layer; **these are the Core boundary, not the legacy engine** | `src/specialist/task-prompt.ts`, `src/specialist/launch-outcome.ts` |
| `doctor --pr-drift` (non-blocking) | flag + `--json` | `gh pr view --json` + job columns → activation columns | `src/cli/doctor.ts:1023` |

---

# D) Test inventory

Per-command tests that pin current behaviour, from static import analysis of
`tests/**/*.test.ts` plus the spawned-CLI integration suite. Absolute paths are relative to the
repo root.

## D.1 Unit tests importing the verb module

| command | test files |
|---|---|
| `version` | `tests/unit/cli/version.test.ts`, `tests/unit/cli/version-check.test.ts` |
| `list-rules` | `tests/unit/cli/list-rules.test.ts` |
| `list` | `tests/unit/cli/list.test.ts` |
| `render-task` | `tests/unit/cli/render-codex-surface.test.ts`, `tests/unit/cli/codex-k4-handoff.test.ts`, `tests/unit/fixtures/codex-k3-separation.test.ts` |
| `render-bead` | `tests/unit/cli/render-bead.test.ts`, `tests/unit/cli/render-codex-surface.test.ts` |
| `render-skill-prefix` | `tests/unit/cli/render-skill-prefix.test.ts`, `tests/unit/cli/render-codex-surface.test.ts` |
| `launch-outcome` | `tests/unit/cli/launch-outcome-cli.test.ts`, `tests/unit/specialist/launch-outcome.test.ts`, `tests/unit/fixtures/codex-k4-outcome.test.ts`, `tests/unit/cli/codex-k4-handoff.test.ts` |
| `view` | `tests/unit/cli/view.test.ts` |
| `init` | `tests/unit/cli/init.test.ts`, `tests/unit/cli/init-global.test.ts` |
| `db` | `tests/unit/cli/db.test.ts` |
| `integration` | `tests/unit/cli/integration.test.ts`, `tests/unit/specialist/branch-integration-events.test.ts` |
| `validate` | `tests/unit/cli/validate.test.ts` |
| `edit` / `config` | `tests/unit/cli/edit.test.ts`, `tests/unit/cli/edit-global.test.ts`, `tests/unit/cli/config.test.ts`, `tests/unit/cli/config.show.test.ts` |
| `chat` | `tests/unit/cli/chat-input.test.ts`, `chat-control.test.ts`, `chat-feed.test.ts`, `chat-status.test.ts`, `attach-tui.test.ts` |
| `run` | `tests/unit/cli/run.test.ts`, `run-bead-id-validation.test.ts`, `run-diff-base.test.ts`, `run-launch-line.test.ts`, `tests/unit/cli/pi-json-output.test.ts`, `tests/unit/cli/tmux-utils.test.ts` |
| `node` | `tests/unit/cli/node.test.ts`, `tests/unit/specialist/node-supervisor.test.ts`, `node-supervisor-*.test.ts`, `node-contract.consistency.test.ts`, `node-coordinator-contract.test.ts` |
| `epic` | `tests/unit/cli/epic.test.ts`, `tests/unit/specialist/epic-readiness.test.ts`, `epic-lifecycle.test.ts`, `epic-reconciler.test.ts`, `epic-lineage.test.ts` |
| `status` | `tests/unit/cli/status.test.ts`, `tests/unit/cli/chat-status.test.ts` |
| `ps` | `tests/unit/cli/ps.test.ts`, `tests/unit/cli/ps-spawned-by-line.test.ts`, `tests/unit/cli/native-activation-summary.test.ts` |
| `result` | `tests/unit/cli/result.test.ts` |
| `feed` | `tests/unit/cli/feed.test.ts`, `tests/unit/cli/chat-feed.test.ts`, `tests/unit/cli/format-helpers.test.ts`, `tests/unit/chat/feed.test.ts` |
| `forensic` | `tests/unit/specialist/forensic-events.test.ts`, `tests/unit/cli/console-feed-source.test.ts`, `tests/unit/cli/console-core-gaps.test.ts` |
| `log` | `tests/unit/cli/log.test.ts`, `tests/unit/cli/log-forensic-filter.test.ts`, `tests/unit/cli/console-telemetry-redaction.test.ts`, `tests/unit/cli/console-resilience.test.ts` |
| `resume` | `tests/unit/cli/resume.test.ts` |
| `retry` | `tests/unit/cli/retry.test.ts` |
| `clean` | `tests/unit/cli/clean.test.ts` |
| `merge` | `tests/unit/cli/merge.test.ts` |
| `stop` | `tests/unit/cli/stop.test.ts` |
| `finalize` | `tests/unit/cli/finalize.test.ts` |
| `attach` | `tests/unit/cli/attach.test.ts`, `tests/unit/cli/attach-tui.test.ts` |
| `prune-stale-defaults` | `tests/unit/cli/prune-stale-defaults.test.ts` |
| `quickstart` | `tests/unit/cli/quickstart.test.ts` |
| `doctor` | `tests/unit/cli/doctor.test.ts`, `doctor-drift.test.ts`, `doctor-catalogs.test.ts`, `doctor-pr-drift.test.ts`, `doctor-specialists.test.ts`, `tests/unit/specialist/channel-doctor.test.ts` |
| `setup` | `tests/unit/cli/setup.test.ts` |
| `serve` | `tests/unit/cli/serve-readiness.test.ts`, `tests/unit/cli/serve-hot-reload.test.ts` |
| `script` | `tests/unit/cli/script.test.ts`, `tests/unit/specialist/script-runner.test.ts`, `script-runner-trust.test.ts`, `script-runner-no-follow.test.ts` |
| `console` | `tests/unit/cli/console-view-model.test.ts`, `console-goldens.test.ts`, `console-help-parity.test.ts`, `console-e2e-smoke.test.ts`, `console-core-gaps.test.ts`, `console-diff-view.test.ts`, `console-config-edit.test.ts`, `console-config-view.test.ts`, `console-repo-config.test.ts`, `console-repo-config-view.test.ts`, `console-bead-view.test.ts`, `console-feed-source.test.ts`, `console-key-gating.test.ts`, `console-perf.test.ts`, `console-regression.test.ts`, `console-render-resilience.test.ts`, `console-resilience.test.ts`, `console-telemetry-redaction.test.ts`, `console-theme.test.ts` |
| `install` | `tests/unit/cli/install.test.ts:24-25` (deprecation banner) |
| `help` | `tests/unit/cli/help.test.ts`, `tests/unit/cli/command-help.test.ts` |

## D.2 Spawned-CLI integration and smoke tests

These run the real binary (`dist/index.js` or `src/index.ts` via bun) and therefore pin
end-to-end behaviour including exit codes and stdout:

`tests/unit/cli/command-help.test.ts` (`execFileSync('bun', [dist/index.js, ...])`),
`tests/integration/cli/attach.integration.test.ts`, `config-show-resolved.test.ts`,
`doctor.integration.test.ts`, `edit.integration.test.ts`, `end.integration.test.ts`,
`epic.integration.test.ts`, `epic-flows.integration.test.ts`, `finalize.integration.test.ts`,
`init.integration.test.ts`, `init-global.test.ts`, `merge.integration.test.ts`,
`node.integration.test.ts`, `preset-resolve.test.ts`, `result.integration.test.ts`,
`resume.integration.test.ts`, `run.integration.test.ts`, `run-fallback-chain.live.test.ts`,
`run-notes-mode.live.test.ts`, `run-preset.live.test.ts`, `setup.live.test.ts`,
`validate.integration.test.ts`, `worktree.integration.test.ts`,
`tests/integration/sp-script.test.ts`, `tests/integration/sp-serve.test.ts`,
`tests/smoke/sp-chat.smoke.test.ts`, `tests/unit/cli/console-e2e-smoke.test.ts`,
`tests/unit/cli/list.test.ts`, `tests/unit/cli/list-rules.test.ts`, `tests/unit/cli/run.test.ts`.

## D.3 The `--help` contract test is the broadest single guard

`tests/unit/cli/command-help.test.ts` makes 21 assertions across 24 subcommand help texts and
includes an **anti-drift guard**: *"every run flag parsed by run.ts appears in run --help"*
(`:44-55`), implemented by regexing `token === '(--[a-z0-9-]+)'` out of `src/cli/run.ts`. Any
migration that adds, renames, or removes a `run` flag fails this test unless the help text moves
with it.

## D.4 Behaviour with no test importing its module

Verified by static import analysis; these commands are pinned only indirectly (or not at all):

| command | coverage |
|---|---|
| `steer` | **no test imports `cli/steer.ts`.** Not covered by any integration test name either. |
| `models` | **no test.** |
| `metrics` | **no CLI test**; only `tests/unit/specialist/prometheus-projection.test.ts` covers the projection, not the verb. |
| `install` | covered by `tests/unit/cli/install.test.ts` (not by module import — it spawns/asserts text). |
| `follow-up` | no direct test; only `tests/integration/cli/resume.integration.test.ts` covers `resume`. |
| `end` | no unit test; `tests/integration/cli/end.integration.test.ts` covers it end-to-end. |
| `release` | no dedicated test; the passthrough is only indirectly exercised. |
| `epic` (second branch, `src/index.ts:1209-1213`) | **no test — the branch is unreachable.** |

---

# E) UNKNOWNs

Each item is something this audit could not ground, with the reason. `UNKNOWN` is preferred to a
guess throughout.

1. **External consumer inventory.** I can ground which *in-repo* surfaces are declared published
   (`sp ps --json`, `integration record/list --json`, the `render-*`/`launch-outcome` envelopes,
   and `xt release`). I **cannot** enumerate every shell script, CI job, or sibling repository
   (xtrm-tools, bd-substrate) that shells out to an `sp` subcommand, because those live outside
   this tree. The byte-level list in §A.2 is therefore derived from in-repo declarations and
   callers, not from a global consumer census.
2. **`steer`, `models`, `metrics`, `release` behaviour pinning.** No test imports these verb
   modules. Whether their current behaviour is pinned by an out-of-tree consumer test is UNKNOWN.
3. **`attach`'s documented tmux contract.** `src/index.ts:1284-1301` and
   `docs/cli-reference.md:576-604` describe `attach` as requiring tmux and a live `tmux_session`,
   but `src/cli/attach.ts` contains no tmux call — it drives the in-process TUI in
   `src/cli/attach-tui.ts` over `jobs/*/status.json`. I confirm the mismatch from source; I cannot
   determine from this tree whether the tmux path was intentionally removed and the docs were not
   updated, or whether the tmux attach moved to `list --live` and the `attach` name was reused.
   Recorded as UNKNOWN rather than resolved by inference.
4. **`end`'s epic redirect target.** `src/cli/end.ts:141` prints
   `Run: sp epic resolve <epicId>`, but `cli/epic.ts` implements only
   `list|status|sync|abandon|merge` (`src/cli/epic.ts:865-889`) — there is no `resolve` subcommand.
   The printed remediation is UNKNOWN/invalid; whether an older `epic resolve` existed is not
   determinable from the current tree without git history archaeology beyond this audit's scope.
5. **`retry` reachability on the shipped MCP entrypoint.** `specialist_retry` is registered on
   `src/server.ts:170` and in the Pi extension, but not on `src/mcp/v2-server.ts`. I verified the
   registration lists; I did **not** determine whether `src/server.ts` is still a supported
   entrypoint or dead code. UNKNOWN.
6. **`setup`'s relationship to `init`.** `src/index.ts:328` (inside `init --help`) states
   *"setup and install are deprecated; use specialists init"*, but `src/cli/setup.ts:55-132`
   implements a live, distinct model-discovery/benchmark/plan/apply workflow with no `init`
   equivalent. Whether `setup` is genuinely deprecated or the `init --help` sentence is stale is
   UNKNOWN from source alone.
7. **Native coverage of script-class specialists.** `script` and `serve` both route through
   `runScriptSpecialist`. I did not find any `src/activation/**` path that executes a
   script-class specialist, but absence of a reference in the files I read is weaker than a
   positive "this is not supported" statement, so the blocker entry in §B.1 is asserted on the
   routing evidence alone.
8. **`.specialists/jobs/` as a native read.** Native writes no `jobs/` directory
   (`src/activation/**` has no `jobs` write). Whether any native code *reads* a pre-existing
   `jobs/*/status.json` as a fallback was not exhaustively traced. UNKNOWN.
9. **`doctor --pr-drift` / `--reap-dead-jobs` against native rows.** Native activations write
   `specialist_jobs` rows through the shared forensic sink (`src/activation/forensic-sink.ts:174-227`),
   but I did not verify whether the native rows carry `pid`, `pr_drift_checked_at_ms`, and the
   other predicate columns those two doctor subcommands require. UNKNOWN.
10. **GitNexus coverage of dynamic imports.** Documented as a graph limitation in the header: the
    graph resolves no edge from `src/index.ts` to `src/cli/**`, so no reachability claim in this
    artifact rests on graph evidence. `gitnexus impact` output for the CLI entrypoints is
    `impactedCount: 0` with an explicit `riskNote` — treated as "graph could not answer", not as
    evidence of non-use.

---

# Bounded summary

## Counts

| metric | value |
|---|---|
| dispatch tokens in `src/index.ts` | **47** (caller's list confirmed complete; nothing missed, nothing extra) |
| tokens with a handler module | 43 `export async function run` / `handle*Command` entrypoints in `src/cli/**` |
| non-command entry behaviour | 4 aliases (`--version`/`-v`, `--help`/`-h`), 1 unknown-command refusal, 1 no-subcommand MCP stdio mode |
| commands with `--json` in some form | 26 |
| commands with **no** machine-readable output | 21 (`install`, `models`, `init`, `chat`, `console`, `run` without `--json`, `steer`, `resume`, `clean`, `merge`, `end`, `stop`, `finalize`, `attach`, `prune-stale-defaults`, `quickstart`, `help`, `metrics` (Prometheus text instead), `release`, `setup` text modes, `epic`/`db` text modes) |
| exit codes used | 0, 1, **75** (`setup --offline` stale cache; `script --single-instance` flock held), **130** (`attach` picker Ctrl+C) |
| `script` granular codes | 0/1/2/3/4/5/6/7 (+75) |
| byte-compatibility surfaces | **14** (B1-B14) |
| commands/behaviours with no native equivalent | **10 subsystems + 9 partial-gap behaviours** (§B.1, §B.2) |
| declared retirements with a cited product decision | **10** |
| candidate retirements with **no** cited decision (blockers) | **15** |
| test files touching CLI behaviour | 43 unit imports + 27 spawned-CLI integration/smoke files |
| commands with no test importing their module | 8 (`steer`, `models`, `metrics`, `install`*, `follow-up`, `end`, `release`, second `epic` branch) — `install` is covered by a spawned test |

## No-native-equivalent blocker list (the migration blockers)

1. `node` — all 10 subverbs. No native node supervisor exists.
2. `epic list` / `epic status` / `epic sync` / `epic abandon` — no native epic store or reconciler.
3. `serve` — no native HTTP surface for script-class specialists.
4. `script` — no native script-class execution path.
5. `steer` — no native mid-run unrequested control message.
6. `finalize` — no native keep-alive chain to finalize.
7. `list --live` — tmux; native Fleet registry is in-process.
8. `attach` — TTY TUI over `jobs/*/status.json` FIFO.
9. `chat` — interactive TUI over the FIFO/keep-alive turn loop.
10. `console` — multi-repo operator TUI over `obs.db` + `jobs/`.
11. `run --keep-alive` / `--no-keep-alive` — no native keep-alive turn loop.
12. `run --worktree` / `--job` / `--no-worktree` — native runs **in place** under a writer lease; no per-activation worktree.
13. `run --base-sha` / `--base-ref` / `--accept-stale-base` / `--reason` / `--force-stale-base` — guards a worktree base that no longer exists.
14. `run --no-beads` / `--no-bead-notes`, `stop --close-bead-anyway` — native authority is Substrate Issues, not Beads.
15. `retry` on the shipped MCP entrypoint — `specialist_retry` is missing from `src/mcp/v2-server.ts`.
16. `end` — routes into the retired `epic merge`/`merge` path; no native session-close publication.
17. `ps --follow` live native state — the Fleet registry is in-process; `ps` can only show LAST-KNOWN forensic state.
18. `doctor --pr-drift` / `--reap-dead-jobs` — predicates are legacy-job columns.
19. `clean --reap-orphans` / `--processes` / `--ps` — reaps legacy leaked processes, tmux/dolt/gitnexus orphans, and job rows.

## Top compatibility risks, ranked

1. **`sp run --background` stdout (`src/cli/run.ts:94-113`).** Two mutually exclusive shapes on
   the same stream: a bare job id line, or one `specialists.background_launch.v1` JSON event when
   `--json` is set. It is the *required* dispatch form from an agent pane (`src/index.ts:619-620`).
   Any backend swap must preserve both, plus the `extractLaunchError` stderr markers
   (`src/cli/run.ts:116-126`) that callers regex.
2. **`sp ps --json` and `sp integration record/list --json` are published cross-repo surfaces**
   (`docs/cli-reference.md:1637-1643`). `.specialists/db/observability.db` is private to this repo
   precisely so external tools read these JSONs instead of the schema. Both must keep their
   current field names and NDJSON framing.
3. **`sp run --json` / `sp feed --json` is pi's NDJSON stream, not this repo's**
   (`src/cli/pi-json-output.ts`). Field spelling is camelCase (`cacheRead`, `totalTokens`,
   `stopReason`) and the event vocabulary is pi's. Any refactor toward repo-internal snake_case
   silently breaks pi-compatible consumers.
4. **The four Core-boundary envelopes** — `render-task`, `render-bead`, `render-skill-prefix`,
   `launch-outcome` — are consumed by the `xt` launcher. `render-skill-prefix` exists only so Core
   does not re-derive the prefix byte-for-byte (`src/cli/render-skill-prefix.ts:3-5`).
   `launch-outcome`'s stable error-code list is itself a contract
   (`docs/design/codex-k4-invocation-result.md:54`).
5. **`sp script` exit codes 0-7 + 75** (`src/cli/script.ts:105-118,145-148`) are a cron contract;
   `sp setup --offline` returning 75 (`src/cli/setup.ts:324,329`) is another.
6. **Inconsistent error envelopes across verbs.** `integration`/`launch-outcome`/`render-*` use
   `{ok:false, error:{code,message}}`; `epic` uses `{error}` or `{epic_id,error}`; `node` uses
   `buildActionError(...)`; `ps` prints `{error}` on **stdout** with `process.exitCode = 1`
   (`src/cli/ps.ts:1043-1047`). No single parser works across the surface; any consolidation is a
   breaking change to at least one consumer.
7. **`sp doctor` exits 0 even when checks fail** (`docs/cli-reference.md:1191-1195`). Mapped
   deliberately; a migration that "fixes" this breaks CI.
8. **`tests/unit/cli/command-help.test.ts` is the anti-drift guard for `run` flags** (`:44-55`).
   It will fail on any flag change that does not also update `src/index.ts`'s help text — a
   useful tripwire, but it means the help text is a build-blocking contract.
9. **`merge` and `epic merge` are declared broken but not deleted.** Their help says
   `[broken]`/`Do not use`, and the skills router rule 9 forbids them
   (`docs/design/using-specialists-progressive-disclosure.md:131`). `end` still routes into
   `epic merge` (`src/index.ts:1225`) and `merge` still emits `xtrm.branch.integration.v1`
   (`src/cli/merge.ts:972`), so neither can be removed before `end` is replaced and the
   integration emission is relocated.
10. **`src/index.ts:1209-1213` is an unreachable second `epic` branch.** Dead, untested, and a
    live trap for an editor who changes the first branch and expects the second to run.

## Documentation defects found (recorded, not fixed — this lane does not modify source)

- `src/index.ts:1284-1301` and `docs/cli-reference.md:576-604` describe `attach` as the tmux path;
  `src/cli/attach.ts` has no tmux call.
- `src/cli/end.ts:141` prints `sp epic resolve <id>`; no `resolve` subcommand exists in
  `src/cli/epic.ts`.
- `src/index.ts:328` says `setup` is deprecated; `src/cli/setup.ts` implements a live, distinct
  workflow with no `init` equivalent.
- `src/index.ts:1209-1213` is dead dispatch.

---

## Coordinator verification and corrections (applied 2026-09-16)

Independently checked by the XTRM-93 coordinator against worktree HEAD `6553ef05`.
All 503 machine-checkable `file:line` citations in this artifact were resolved against the
tree. Four defects were found and **corrected in place**:

| # | Was | Now | Why |
|---|---|---|---|
| 1 | `config/specialists/presets.json` | `config/presets.json` (with `config/specialists/presets.json` noted as the resolver's second probe, `src/specialist/preset-resolver.ts:105-106`) | `config/specialists/presets.json` does not exist; the shipped file is `config/presets.json` |
| 2 | `d/user/<name>.specialist.json` (truncated path) | `.specialists/user/<name>.specialist.json` | Truncation artifact; `docs/surface-ownership.md` confirms the user layer |
| 3 | `docs/cli.md` | `docs/cli-reference.md` | `docs/cli.md` does not exist; the CLI reference is `docs/cli-reference.md` (65,904 bytes) |
| 4 | `docs/native-activation.md:397` | `src/activation/registry.ts:1-8` (`Fleet registry`), `docs/native-activation.md:198` | The doc is 260 lines; `:397` is out of range. The claim (Fleet registry is in-process, not attachable) is correct and is better sourced from the registry module |
| 5 | `src/cli/launch.ts:64` | `src/specialist/launch.ts:64` | Wrong directory |

**Corrections requiring no change (verifier false positives, recorded for the next auditor):**
the `~/.config/specialists/user.json` and `~/.config/specialists/presets.json`-style paths are
correct; a naive citation regex strips the leading `~/.` and then reports them as missing.

### Accepted as load-bearing coordinator evidence

- **GitNexus cannot answer CLI reachability for this repo.** Every verb is loaded through a
  dynamic `await import()` in `src/index.ts`, so `gitnexus impact run` returns `ambiguous` and
  several handlers return `impactedCount: 0` with GitNexus' own "absence is not evidence" note.
  This lane therefore sourced all CLI reachability from reading `src/index.ts`, and said so.
  The coordinator independently reproduced this: the index is fresh at `6553ef05`, and the
  limitation is a property of the dispatch design, not of the index. **Any later lane that
  reports a CLI verb as unreachable from the graph alone must be rejected.**
- **`observability.db` is not legacy-only.** `src/activation/forensic-sink.ts:1-21` states that
  native and legacy write one store and one query answers both. This corrects the coordinator's
  own earlier framing and is carried into `00-capability-matrix.md`.
