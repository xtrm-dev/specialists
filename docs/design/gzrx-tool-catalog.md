# gzrx — Centralized Specialists Manifest + Tool Catalog Design

> Status: **DRAFT — design phase**. Implementation tracked under `unitAI-gzrx`.
> Author: Pi in-pi coding agent (evidence-driven).
> Last updated: 2026-04-30.

This document is the canonical design for `unitAI-gzrx`. The design is split
into the **manifest overlay** (transport) and the **tool catalog + capability
matrix** (content). The original overthinker pass produced the manifest; this
doc fills in the catalog half on top of firsthand evidence from a pi session
that can introspect its own toolbox.

---

## 0. Problem statement

The current runtime has hardcoded tier→tool mappings in
`src/pi/session.ts::mapPermissionToTools` (constants `GITNEXUS_READ_TOOLS`,
`SERENA_READ_TOOLS`, `SERENA_LOW_TOOLS`, `SERENA_WRITE_TOOLS`,
`GITNEXUS_WRITE_TOOLS`, plus inline native tool literals). The hotfix
`unitAI-2s7y8` added extension tool names so they are *available* per tier, but:

- Native tools (`read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`) and
  extension tools coexist with no policy distinguishing **preferred** from
  **fallback**.
- There is no concept of "deny native `grep` when GitNexus is loaded" —
  explorer can still reach for `grep` instead of `gitnexus_query`.
- Specialists cannot override tier policy without forking the YAML or hacking
  `excludeExtensions`.
- There is no `sp config show <name> --resolved` to debug what a specialist
  *actually* gets at runtime.

This design fixes all four.

---

## 1. Evidence — current state

> Evidence was gathered from this pi harness, `src/pi/session.ts`, and the
> installed `pi-gitnexus` / `pi-serena-tools` packages.

### 1.1 Native tool universe

The specialist runtime's native tier universe is exactly the seven names listed
in `src/pi/session.ts:225-231`:

- READ_ONLY native tools: `read`, `grep`, `find`, `ls`
- LOW adds: `bash`
- MEDIUM adds: `edit`
- HIGH adds: `write`

This pi harness also exposes orchestration/admin tools to the top-level agent
outside the specialist permission map (`process`, `structured_return`, `mcp`,
`interactive_shell`, plus `multi_tool_use.parallel`). Those are not part of
`mapPermissionToTools` and should not be treated as native specialist tools
unless a future catalog explicitly models harness-only capabilities.

Behavior observed in this session: native `grep` and `bash` are callable even
while GitNexus and Serena are loaded; native `read` is currently blocked by the
harness with `Tool 'read' is disabled. Use Serena tools instead.` That block is
visible to the agent as a normal tool error, not silently hidden.

### 1.2 Serena tool universe (via `pi-serena-tools` extension)

`pi-serena-tools` registers these 43 tools in
`pi-serena-tools/serenaTools.ts:25-695`:

- Meta / lifecycle: `serena_list_tools`, `get_current_config`,
  `activate_project`, `remove_project`, `switch_modes`, `open_dashboard`,
  `check_onboarding_performed`, `onboarding`, `initial_instructions`,
  `prepare_for_new_conversation`, `summarize_changes`,
  `think_about_collected_information`, `think_about_task_adherence`,
  `think_about_whether_you_are_done`, `serena_mcp_reset`
- Symbol/navigation: `find_symbol`, `find_referencing_symbols`, `read_file`,
  `get_symbols_overview`, `jet_brains_get_symbols_overview`,
  `jet_brains_find_symbol`, `jet_brains_find_referencing_symbols`,
  `jet_brains_type_hierarchy`, `search_for_pattern`, `list_dir`, `find_file`
- Writes/refactors: `insert_after_symbol`, `replace_symbol_body`,
  `insert_before_symbol`, `rename_symbol`, `create_text_file`,
  `replace_content`, `delete_lines`, `replace_lines`, `insert_at_line`,
  `restart_language_server`
- Shell: `execute_shell_command`
- Memory: `read_memory`, `write_memory`, `list_memories`, `delete_memory`,
  `rename_memory`, `edit_memory`

Comparison with `src/pi/session.ts:164-214`: no drift in tool *names*. The
source map contains the same 43 names split as 21 READ_ONLY, 1 LOW, and 21
WRITE tools. The split is policy, not package capability: the extension
registers the whole surface; `--tools` chooses which names are
advertised/allowed.

The capability-taxonomy grouping above (Meta / Symbol-nav / Writes / Shell /
Memory) is *not* the same axis as source's READ/LOW/WRITE tier-allowlist
grouping. The source treats anything that mutates Serena state — including
admin/lifecycle ops and memory mutators — as WRITE-tier, not READ-tier.
Capability taxonomy is for manifest design (§2-3); the table below is the
authoritative source-tier assignment per tool.

#### 1.2.1 Source-tier cross-reference

Tools where the doc's capability-group differs from the source-tier are
flagged ⚠. They remain mutating ops in source policy regardless of
capability label; the design must preserve the source split in default
output (§7 step 2: byte-equivalent snapshot tests).

| Tool | Doc group | Source tier (`pi/session.ts:164-214`) | Note |
|------|-----------|---------------------------------------|------|
| `serena_list_tools` | Meta | READ_ONLY | |
| `get_current_config` | Meta | READ_ONLY | |
| `activate_project` | Meta | READ_ONLY | |
| `check_onboarding_performed` | Meta | READ_ONLY | |
| `initial_instructions` | Meta | READ_ONLY | |
| `think_about_collected_information` | Meta | READ_ONLY | |
| `think_about_task_adherence` | Meta | READ_ONLY | |
| `think_about_whether_you_are_done` | Meta | READ_ONLY | |
| `remove_project` | Meta | **WRITE** | ⚠ admin/lifecycle treated as mutation |
| `switch_modes` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `open_dashboard` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `onboarding` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `prepare_for_new_conversation` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `summarize_changes` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `serena_mcp_reset` | Meta | **WRITE** | ⚠ admin/lifecycle |
| `find_symbol` | Symbol/nav | READ_ONLY | |
| `find_referencing_symbols` | Symbol/nav | READ_ONLY | |
| `read_file` | Symbol/nav | READ_ONLY | |
| `get_symbols_overview` | Symbol/nav | READ_ONLY | |
| `jet_brains_get_symbols_overview` | Symbol/nav | READ_ONLY | |
| `jet_brains_find_symbol` | Symbol/nav | READ_ONLY | |
| `jet_brains_find_referencing_symbols` | Symbol/nav | READ_ONLY | |
| `jet_brains_type_hierarchy` | Symbol/nav | READ_ONLY | |
| `search_for_pattern` | Symbol/nav | READ_ONLY | |
| `list_dir` | Symbol/nav | READ_ONLY | |
| `find_file` | Symbol/nav | READ_ONLY | |
| `execute_shell_command` | Shell | LOW | |
| `insert_after_symbol` | Writes | WRITE | |
| `replace_symbol_body` | Writes | WRITE | |
| `insert_before_symbol` | Writes | WRITE | |
| `rename_symbol` | Writes | WRITE | |
| `restart_language_server` | Writes | WRITE | mutates LSP state |
| `create_text_file` | Writes | WRITE | |
| `replace_content` | Writes | WRITE | |
| `delete_lines` | Writes | WRITE | |
| `replace_lines` | Writes | WRITE | |
| `insert_at_line` | Writes | WRITE | |
| `list_memories` | Memory | READ_ONLY | |
| `read_memory` | Memory | READ_ONLY | |
| `write_memory` | Memory | **WRITE** | ⚠ memory mutator |
| `delete_memory` | Memory | **WRITE** | ⚠ memory mutator |
| `rename_memory` | Memory | **WRITE** | ⚠ memory mutator |
| `edit_memory` | Memory | **WRITE** | ⚠ memory mutator |

Implication for §3 tier capabilities: `memory` capability cannot be a
single bucket. It must split into `memory.read` (READ_ONLY+) and
`memory.write` (WRITE+). The same applies to `admin.serena` — must split
into read-only meta probes (config/onboarding/think_*) and lifecycle
mutators (remove_project/switch_modes/open_dashboard/onboarding/
prepare_for_new_conversation/summarize_changes/serena_mcp_reset).

### 1.3 GitNexus tool universe (via `pi-gitnexus` extension)

`pi-gitnexus` registers seven tools in
`pi-gitnexus/dist/tools.js:86-216`:

- READ/analyze: `gitnexus_list_repos`, `gitnexus_query`, `gitnexus_context`,
  `gitnexus_impact`, `gitnexus_detect_changes`
- WRITE/refactor/admin: `gitnexus_rename`, `gitnexus_cypher`

Comparison with `src/pi/session.ts:156-219`: no drift found. The READ array
contains the first five names, and the WRITE array contains `gitnexus_rename`
and `gitnexus_cypher`. `gitnexus_query` and `gitnexus_detect_changes` both
worked in this pi session against the indexed `specialists` repo.

### 1.4 Other extensions observed

Source extension loading in `src/pi/session.ts:650-672` currently adds:

- directory extension `service-skills` if present under pi's extension dir;
- directory extension `caveman` if present;
- npm package extension `pi-gitnexus` if installed and not excluded;
- npm package extension `pi-serena-tools` if installed and not excluded.

In this environment, global npm packages include `pi-gitnexus`,
`pi-serena-tools`, `pi-interactive-shell`, and `context-mode`. The specialist
runtime only auto-loads the first two via `src/pi/session.ts:657-672`.
`pi-interactive-shell` registers `interactive_shell` in its own extension
(`pi-interactive-shell/index.ts:1072`), but it is top-level harness tooling, not
part of specialist tier policy. Quality gates in this repo are Claude/pi hooks
(`.claude/hooks/quality-check.cjs`, `.claude/hooks/quality-check.py`, and
`.xtrm/hooks/*`), not a pi tool namespace in `mapPermissionToTools`.

### 1.5 Current tier→tool mapping (from source)

| Tier | Native | Serena | GitNexus | Notes |
|------|--------|--------|----------|-------|
| READ_ONLY | read, grep, find, ls | SERENA_READ_TOOLS (~21) | GITNEXUS_READ_TOOLS (5) | no bash, no writes |
| LOW | + bash | + SERENA_LOW_TOOLS (execute_shell_command) | (same) | inspect/run, no edits |
| MEDIUM | + edit | + SERENA_WRITE_TOOLS (~20) | + GITNEXUS_WRITE_TOOLS (rename, cypher) | edit existing files |
| HIGH | + write | (same) | (same) | full access |

> Source: `src/pi/session.ts:225-243` (`mapPermissionToTools`).

### 1.6 Behavioral evidence

Observed directly in this pi session:

- Native and extension tools coexist. A native `grep` command against
  `src/pi/session.ts` succeeded while GitNexus was loaded; GitNexus then added
  related-symbol context after the grep output. Nothing prevented the native
  search path.
- Native `read` was visible enough to call, but the harness returned a visible
  error: `Tool 'read' is disabled. Use Serena tools instead.` This proves a
  hard-deny can be surfaced as an explicit tool error to the agent.
- Serena calls (`read_file`, `serena_list_tools`) succeeded, but the current
  pi UI summarized some Serena results instead of printing full payloads. For
  exact package evidence, source inspection of `pi-serena-tools/serenaTools.ts`
  was more reliable.
- GitNexus health in this repo is good: `gitnexus_list_repos`,
  `gitnexus_query`, and `gitnexus_detect_changes` are callable. `pi-gitnexus`
  implements a missing-index guard in `dist/tools.js:10-104`: when no repo
  override is provided and no index is found under cwd, read/query tools return
  the visible text `No GitNexus index found. Run: /gitnexus analyze`.
- Extension packages that are not installed are silently skipped by
  `src/pi/session.ts:657-672`; there is no startup warning in the current code.
- Serena LSP/index failure behavior is tool-level, not startup-level: the
  extension registers tools up front, then individual tool calls route through
  the Serena MCP client. The design should treat this as `loaded_unhealthy`
  when probes fail, not as `not_installed`.

---

## 2. Capability axes

Tools should be classified by *what they do*, not which package they came
from. Proposed capability tags:

| Capability | Description | Examples |
|------------|-------------|----------|
| `read` | Open and emit file contents | native `read`, serena `read_file` |
| `search.text` | Lexical/regex search across files | native `grep`, serena `search_for_pattern` |
| `search.symbol` | Symbol-aware code search | serena `find_symbol`, gitnexus `gitnexus_context` |
| `analyze.graph` | Call graph / impact / process flows | gitnexus `gitnexus_impact`, `gitnexus_query`, `gitnexus_detect_changes` |
| `analyze.refs` | Find references to a symbol | serena `find_referencing_symbols` |
| `nav.fs` | Filesystem listing/finding | native `ls`, `find`, serena `list_dir`, `find_file` |
| `shell` | Execute arbitrary commands | native `bash`, serena `execute_shell_command` |
| `write.text` | Edit existing files (line/text scope) | native `edit`, serena `replace_content`, `replace_lines` |
| `write.symbol` | Symbol-aware edits | serena `replace_symbol_body`, `insert_after_symbol` |
| `write.create` | Create new files | native `write`, serena `create_text_file` |
| `mutate.rename` | Project-wide rename | serena `rename_symbol`, gitnexus `gitnexus_rename` |
| `mutate.graph` | Mutate the graph store | gitnexus `gitnexus_cypher` (when used as write) |
| `admin.serena.read` | Read-only Serena meta probes | `get_current_config`, `check_onboarding_performed`, `initial_instructions`, `think_about_*` |
| `admin.serena.write` | Serena lifecycle mutators | `restart_language_server`, `serena_mcp_reset`, `switch_modes`, `remove_project`, `open_dashboard`, `onboarding`, `prepare_for_new_conversation`, `summarize_changes` |
| `memory.read` | Serena memory readers | `read_memory`, `list_memories` |
| `memory.write` | Serena memory mutators | `write_memory`, `delete_memory`, `rename_memory`, `edit_memory` |
| `meta` | Self-introspection | `serena_list_tools`, `gitnexus_list_repos` |

> Decision: model `memory` as a normal READ_ONLY+ capability. It is currently
> available whenever `pi-serena-tools` is loaded, but explicit cataloging keeps
> it visible in `sp config show --resolved` and allows future denial if needed.

---

## 3. Tier policy

A tier is **a set of capability tags** plus **deny rules**. Concrete tools are
derived from `(catalog filter capabilities ∩ tier.capabilities) − tier.denied`.

### 3.1 Proposed tier capability sets

Default policy must be backward-compatible: if no catalog/manifest is present,
`mapPermissionToTools` output remains byte-for-byte equivalent to
`src/pi/session.ts:225-243`. The capability policy below is the manifest-driven
replacement target:

```yaml
READ_ONLY:
  capabilities:
    - read
    - search.text
    - search.symbol
    - analyze.graph
    - analyze.refs
    - nav.fs
    - memory.read
    - admin.serena.read
    - meta
  denied_natives_when_extension:
    read: [read_file]
    grep: [gitnexus_query, search_for_pattern]
    find: [find_file]
    ls: [list_dir]
  denied_natives_mode: soft

LOW:
  inherits: READ_ONLY
  capabilities: [shell]
  denied_natives_when_extension: same-as-READ_ONLY
  # Keep native bash by default. Serena execute_shell_command is useful but not
  # proven equivalent for cwd/env/TTY behavior.

MEDIUM:
  inherits: LOW
  capabilities:
    - write.text
    - write.symbol
    - mutate.rename
    - admin.serena.write    # restart_language_server, serena_mcp_reset, switch_modes,
                            # remove_project, open_dashboard, onboarding,
                            # prepare_for_new_conversation, summarize_changes
    - memory.write          # write_memory, delete_memory, rename_memory, edit_memory
  denied_natives_when_extension:
    edit: [replace_content, replace_lines, replace_symbol_body]
  denied_natives_mode: soft

HIGH:
  inherits: MEDIUM
  capabilities:
    - write.create
    - mutate.graph
  denied_natives_when_extension:
    write: [create_text_file]
  denied_natives_mode: soft
```

The `memory.write` and `admin.serena.write` capabilities are gated to MEDIUM+
because their tools live in `SERENA_WRITE_TOOLS` per source policy. Promoting
them to READ_ONLY would be a behavior change and must not happen by default.
The byte-equivalent snapshot test in §7 step 2 enforces this.

Specialists can opt into harder policy. Recommended first override:
`explorer.denied_natives_mode = hard` for `grep`, `find`, and `ls` while keeping
`read` soft until Serena `read_file` output behavior is verified across large
files and non-code files.

Rollout note: explorer hard-deny is isolated in specialist permissions only. Revert by
removing explorer permissions block; generic deny engine stays unchanged.

### 3.2 "Denied native when extension available" semantics

This is the core behavioral change. The explorer-uses-grep problem stems from
the runtime exposing both `grep` and `gitnexus_query` with no preference
signal.

Two enforcement options:

1. **Hard deny** — strip `grep` from `--tools` when pi-gitnexus is loaded.
   Problem: GitNexus index may be stale and the agent has no fallback.
2. **Soft deny via prompt** — both tools available; system-prompt instruction
   tells the agent to prefer GitNexus and reach for grep only on stale-index
   warnings or when scope is outside the indexed tree.

Recommended: **soft deny by default, with hard-deny opt-in** per tier. The
manifest exposes both modes.

### 3.3 Fallback behavior

Represent extension state explicitly in the resolver:

| State | Meaning | Policy |
|-------|---------|--------|
| `not_installed` | package/extension path absent | warn in `--resolved`; remove its tools; do not deny native fallbacks |
| `disabled` | specialist YAML or manifest excludes it | show disabled source; remove its tools; do not deny native fallbacks |
| `loaded_healthy` | extension registered and probe passed | apply preferred/denied-native policy |
| `loaded_unhealthy` | extension registered but health probe failed | keep tools if calls may self-recover, but downgrade hard denies to soft and print warning |

Specifics:

- GitNexus missing index: `pi-gitnexus` returns visible text
  `No GitNexus index found. Run: /gitnexus analyze`. Treat as
  `loaded_unhealthy` for the repo. Native `grep`/`find` must remain available
  unless the specialist explicitly sets `fallback_on_extension_failure: error`.
- GitNexus stale index: if a tool returns a stale-index warning, keep the graph
  tools but add a prompt-visible warning and allow native fallback for that turn.
- Serena LSP offline: health probe should call `get_current_config` or
  `check_onboarding_performed`. Failure marks Serena `loaded_unhealthy`; native
  `read`, `grep`, `find`, `ls`, and `edit` are not hard-denied.
- Package not installed: current code silently skips packages via
  `existsSync(...)` in `src/pi/session.ts:657-672`. New resolver should make
  that visible in `sp config show --resolved` but should not fail session start
  unless manifest says `fallback_on_extension_failure: error`.

---

## 4. Tool catalog schema

Stored at `.specialists/catalog/{native,serena,gitnexus}.json` (or single
`catalog.json` keyed by source). Editable by hand; loaded at session start.

```json
{
  "version": 1,
  "source": "pi-gitnexus",
  "tools": [
    {
      "name": "gitnexus_query",
      "capabilities": ["search.symbol", "analyze.graph"],
      "preferred_over": ["grep"],
      "stale_index_behavior": "warn",
      "description": "Find code by concept; returns process-grouped results."
    },
    {
      "name": "gitnexus_impact",
      "capabilities": ["analyze.graph"],
      "description": "Blast radius for a symbol."
    }
  ]
}
```

Native tools live in `.specialists/catalog/native.json` shipped with the
package; extensions can declare their own catalog file in their npm package
root (`pi-catalog.json`) which the runtime merges.

---

## 5. Manifest extension (on top of existing overthinker design)

The existing manifest schema (in `unitAI-gzrx` description) defines:

```json
"permissions": {
  "READ_ONLY": {
    "extensions": { "mode": "none|allowlist", "allowlist": [...] },
    ...
  }
}
```

This is **incomplete** — it specifies extension *availability* but not
tier *capabilities* or *denied natives*. Extend to:

```json
"permissions": {
  "READ_ONLY": {
    "capabilities": ["read", "search.text", "search.symbol", ...],
    "denied_natives_when_extension": ["grep", "find", "ls", "read"],
    "denied_natives_mode": "soft|hard",
    "extensions": { "mode": "allowlist", "allowlist": ["pi-gitnexus", "pi-serena-tools"] },
    "fallback_on_extension_failure": "warn|error|silent",
    "beads": { "can_close": false },
    "behavior": { "auto_append_output_to_bead": true }
  }
}
```

Per-specialist override extends the same shape:

```json
"specialists": {
  "explorer": {
    "denied_natives_mode": "hard"
  }
}
```

---

## 6. Resolved-debug surface

`sp config show <name> --resolved` must print:

1. Effective manifest (defaults + tier policy + specialist override merged).
2. Tier policy file path used.
3. Extension availability (loaded / not installed / disabled).
4. Final `--tools` string passed to pi.
5. Native tools denied (with reason: which extension preempts each).
6. Per-layer attribution: which value came from which precedence layer.

Sample output sketch:

```
specialist: explorer
permission_required: READ_ONLY
sources:
  manifest_defaults:        .specialists/config.json
  tier_policy:              .specialists/config.json#permissions.READ_ONLY
  specialist_override:      .specialists/config.json#specialists.explorer
  yaml:                     config/specialists/explorer.specialist.json

extensions:
  pi-gitnexus              loaded   (via npm global)
  pi-serena-tools          loaded   (via npm global)
  quality-gates            disabled (tier disallows)

capabilities (effective):
  read, search.text, search.symbol, analyze.graph, analyze.refs,
  nav.fs, memory, meta

natives denied (mode=hard, source=specialist override):
  grep      -> preempted by gitnexus_query, search_for_pattern
  find      -> preempted by find_file
  ls        -> preempted by list_dir
  read      -> preempted by read_file (serena)

--tools (effective):
  gitnexus_query,gitnexus_context,gitnexus_impact,gitnexus_detect_changes,
  gitnexus_list_repos,find_symbol,find_referencing_symbols,read_file,
  get_symbols_overview,search_for_pattern,list_dir,find_file,
  list_memories,read_memory,serena_list_tools,...

behavior:
  auto_append_output_to_bead: true   (from tier READ_ONLY)
```

---

## 7. Migration plan

1. Add catalog files only, with no runtime behavior change:
   - `.specialists/catalog/native.json`
   - `.specialists/catalog/serena.json`
   - `.specialists/catalog/gitnexus.json`
   - Optional package-side `pi-catalog.json` discovery for future extensions.
2. Implement `src/specialist/manifest.ts` (or `tool-manifest.ts`) that loads
   catalogs and the default permission manifest, then emits the exact same
   tool strings as `src/pi/session.ts:225-243` for the default configuration.
   Add snapshot tests for READ_ONLY/LOW/MEDIUM/HIGH byte equivalence.
3. Thread manifest resolution into `src/pi/session.ts` behind a feature flag or
   internal option. Keep the hardcoded arrays as fallback for one release.
4. Add `sp config show <specialist> --resolved` beside existing
   `src/cli/config.ts` get/set commands. It should print effective manifest,
   layer attribution, extension health, denied natives, and final `--tools`.
5. Add health probes for GitNexus and Serena. Show `not_installed`, `disabled`,
   `loaded_healthy`, and `loaded_unhealthy` in resolved output.
6. Enable `denied_natives_when_extension` in soft mode for all tiers. Validate
   no behavior break: tools remain callable, but prompts/debug output express
   preferences.
7. Add hard-deny support in resolver. Smoke-test with explorer: verify `grep`,
   `find`, and `ls` are removed from final `--tools` when GitNexus/Serena are
   healthy, and restored when they are unhealthy.
8. Add per-specialist overrides. First migration candidate: explorer hard-deny
   `grep/find/ls`; keep `read` soft until large-file/non-code Serena behavior
   is verified.
9. Move docs from this design into `docs/manifest.md` and link from
   `docs/cli-reference.md` under `sp config show --resolved`.
10. Remove old hardcoded arrays from `src/pi/session.ts` after one release with
    resolved-debug output available.

---

## 8. Open questions and decisions

1. `bash` and `execute_shell_command` should not be marked equivalent yet.
   They share the `shell` capability, but native `bash` is the proven specialist
   LOW-tier tool and may differ in cwd/env/output handling. Keep both when both
   are allowed; prefer native `bash` for operator commands.
2. Pi's `--tools` should be treated as an allowlist contract. This session
   showed denied native `read` failing visibly at call time, so hard deny is
   observable to the agent rather than silent. The design should still verify
   this with a specialist subprocess test during implementation.
3. Native-tool blocking is visible as a tool error in this harness. That is
   acceptable for hard-deny mode, but the error text should name the preferred
   replacement tool.
4. `serena_list_tools` is a meta tool and may report the Serena server's full
   surface rather than the current `--tools` allowlist. `sp config show
   --resolved` must therefore be the authoritative debug surface for effective
   tool access.
5. Keep `meta` tools on for READ_ONLY+ by default. They are essential for
   debugging loaded/unhealthy extension states. If security becomes a concern,
   add a separate `meta` deny list rather than hiding them implicitly.

---

## 9. Non-goals

- No change to specialist YAML schema for `model`, `prompt`, `output_schema`,
  metadata.
- No replacement of the YAML-as-identity model. Manifest is overlay.
- No new CLI surface beyond `sp config show <name> --resolved` and the
  catalog files.
- No change to mandatory rules system or beads context loading.
