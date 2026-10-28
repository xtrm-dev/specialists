# Specialist definitions

Use when adding, inspecting, or changing a Specialist definition against the current
Specialists schema and installed runtime. This advanced authoring material belongs under
`/using-specialists`; it is not a separate default skill.

Start from live truth:

```bash
specialists list --full          # what this machine resolves, with tier/lease/waiver tags
sp help                          # the current command surface, never memorized
pi list                          # every extension source pi has installed, with its path
sp doctor --catalogs             # catalog pins vs the versions the runtime actually resolves
pi --list-models                 # models the runtime can serve
```

When a field or behavior matters, inspect the current schema/runtime and the resolved
configuration:

- `src/specialist/schema.ts` — accepted definition shape (authoritative; the example below
  tracks it, the schema still wins);
- `src/specialist/runner.ts` and session/runtime code — execution semantics;
- `sp config show <name> --resolved` — effective definition after overlays. It resolves
  package and project specs only: a specialist that exists solely under
  `~/.specialists/user/` is not visible to it, so verify those structurally (the bundled
  validator) and by dispatching them.

Where definitions live, lowest precedence to highest: package `config/specialists/` ->
`~/.config/specialists/user.json` (sparse overrides) -> `~/.specialists/user/` (full spec,
discovered in every repository) -> `<repo>/.specialists/user/` (full spec). A repo
definition of the same name wins over the home one, and the collision warns naming both
paths. Override layers may set only the fields listed in `OVERRIDE_ALLOWED_*` in
`schema.ts`; anything else stays package-canonical, so a sparse override cannot quietly
re-grant a capability.

Authoring flow:

1. define the role boundary, including when and when not to choose it;
2. reuse an existing role when only prompt wording differs;
3. inventory the tools and extensions the role needs (see below — a Specialist does not
   inherit your interactive session's extensions);
4. scaffold/repair the definition with the bundled deterministic helper when useful;
5. make narrow changes through current `sp edit` surfaces where practical;
6. validate against the actual schema;
7. inspect the resolved runtime view;
8. decide the capability tier AND whether the role needs a workspace lease (see below — a
   read-tier role that must run its own commands does);
9. smoke the role on a representative bounded task.

Bundled helpers live under `scripts/specialist-definitions/`:

```bash
bun scripts/specialist-definitions/scaffold-specialist.ts <file>
bun scripts/specialist-definitions/validate-specialist.ts <file>
node scripts/specialist-definitions/audit-spec-uniformity.mjs
```

Select only models reported by the current Pi/runtime inventory. Grant the least capability
that can complete the role. Shared XTRM work-contract, coordination and safety doctrine
belongs to XTRM-owned surfaces rather than duplicated in every Specialist prompt.

## Extensions: a Specialist does not inherit your session

This is the most common authoring mistake, and it fails quietly. A Specialist session is
built from three sets and nothing else:

1. the **curated set** the runtime always loads — `quality-gates`, `python-kernel`,
   `caveman`, the gitnexus package when the tool contract resolves it, the built-in
   `codemode` when the tier grants it, and the permission guard for `READ_ONLY`;
2. whatever the definition **declares** in `execution.extensions`;
3. built-in tools granted by the tier.

Ambient discovery is fenced off. The extensions your own interactive session has loaded —
the ones `pi list` prints — are not in that list unless they are curated or the definition
declares them. So a role that needs `BashBackground`, an ast-grep tool, or any other
extension-provided tool must name the source, or the tool simply does not exist for it.

Inventory the machine first, then declare:

```bash
pi list                       # installed sources and their resolved paths
sp doctor --catalogs          # version pins the runtime resolves for catalogued extensions
ls ~/.pi/agent/extensions ~/.pi/agent/npm/node_modules   # loose and npm-installed extensions
cat ~/.pi/settings.json .pi/settings.json                # user- and project-level sources
```

`execution.extensions` is a map from source to boolean. The keys are not all the same kind
of thing:

```json
"extensions": {
  "gitnexus": false,
  "/path/to/core/packages/pi-extensions/extensions/background": true,
  "npm:pi-ast-grep": true,
  "git:github.com/owner/repo": true
}
```

- `gitnexus` is a toggle: `false` removes the gitnexus package (and restores the native
  tools its catalog would otherwise deny).
- A local path is used as-is. Absolute paths are the honest choice for a checkout that is
  not installed; they do not survive a different machine.
- `npm:<pkg>` resolves from the global modules roots, `git:<host>/<path>` from the pi git
  cache. Both must already be installed there (`pi install <source>`).
- `serena` is accepted for legacy overrides and ignored.
- **A source that cannot be resolved is skipped with a stderr line, not an error.** The
  role then runs without that tool. If a role's behavior depends on an extension, smoke it
  once and confirm the tool is actually present — a missing declaration and a missing
  install look identical from the definition file.

Worked case: a read-tier watcher that must sample on a timer needs both the lease waiver
(next section) and the background extension, because `BashBackground` is extension-provided:

```json
"execution": {
  "permission_required": "LOW",
  "lease_waiver": true,
  "extensions": { "/path/to/core/packages/pi-extensions/extensions/background": true }
}
```

Declaring the extension without the waiver gives the role the tool and no admitted shell;
declaring the waiver without the extension gives it a shell and no way to wait for a timer.


## Capability tiers and the workspace lease

`execution.permission_required` selects the tool grant; the workspace lease is a separate
fact. A `MEDIUM` or `HIGH` specialist resolves to `access: "write"`, is provisioned an
isolated per-Issue worktree and MUST acquire that worktree's lease before an AgentSession
exists. Every other tier runs `access: "read"`, acquires nothing, and is refused EVERY
`bash` call by admission — the tier grant alone does not make a shell usable.

That matters when authoring a self-sampling observer: a watcher, a durable monitor, a
reviewer or any read-tier role whose job is to run its own commands (`docker ps`, `mcpq`,
`git fetch`, a test runner) rather than to read artifacts someone else collected. Handing
such a role pre-collected evidence is not the role; the role is the sampling.

Declare `execution.lease_waiver: true` for it. The specialist then provisions its own
isolated per-Issue worktree and acquires that lease despite the read tier, so its `bash` is
admitted there. The one-writer invariant holds per workspace: no other activation ever uses
that worktree. This is not an admission carve-out — unlike the permission guard, which may
admit READ_ONLY `bash` because bwrap proves each call harmless, raw `bash` cannot prove
anything, so isolation carries the guarantee instead.

Rules of use:

- Set it only on roles that must sample live state themselves. A role that reads worktree
  files, an injected diff, or MCP extension tools needs no waiver and should not have one.
- The waiver admits ALL `bash` inside the isolated worktree, so production-read-only
  remains a prompt-level constraint. State the prohibitions in the prompt explicitly; do
  not assume the tier enforces them.
- `READ_ONLY` + waiver is coherent (read tools plus admitted `bash`); `LOW` + waiver is the
  common observer shape; `MEDIUM`/`HIGH` are already write-tier, so the flag there only
  records intent.
- Settable per user in `~/.config/specialists/user.json` (`execution.lease_waiver`); any
  other override path ignores it, so a sparse override cannot waive a shipped definition.
- Visible where an operator looks: `sp list --full` prints `[worktree:auto+waiver]`, registry
  rows carry `lease_waiver: true`, and a live activation projects the same flag.

A definition is ready only when schema validation passes, resolved config shows the
intended tools/model/skills/permissions, referenced dependencies exist, and a representative
smoke produces the expected output contract.

## Full definition shape

One file holds exactly one key, `specialist`. The example below is complete and valid
against `src/specialist/schema.ts`; omit optional fields rather than inventing values, and
let the schema stay authoritative if the two ever disagree.

```json
{
  "specialist": {
    "metadata": {
      "name": "deploy-watcher",
      "version": "1.3.0",
      "description": "Watches one production window and reports the first abnormal sample.",
      "category": "observability",
      "updated": "2026-10-21",
      "tags": ["watch", "read-only"]
    },
    "execution": {
      "mode": "tool",
      "model": "provider/model-id",
      "surface_models": { "claude": "provider/other-model" },
      "fallback_model": null,
      "fallback_models": ["provider/backup-model"],
      "timeout_ms": 0,
      "stall_timeout_ms": 180000,
      "max_retries": 0,
      "interactive": true,
      "prompt_limit_bytes": 120000,
      "stdout_limit_bytes": 200000,
      "response_format": "markdown",
      "output_type": "analysis",
      "expected_output_keys": ["status", "summary", "verification"],
      "permission_required": "LOW",
      "requires_worktree": true,
      "lease_waiver": true,
      "bare": false,
      "thinking_level": "high",
      "auto_commit": "never",
      "extensions": {
        "/path/to/core/packages/pi-extensions/extensions/background": true
      }
    },
    "prompt": {
      "system": "You watch one window. Report the first abnormal sample; never mutate.",
      "system_prompt_mode": "append",
      "task_template": "Watch $bead_id: $prompt",
      "output_schema": { "type": "object" },
      "skill_inherit": "deploy-monitoring"
    },
    "skills": {
      "paths": ["sre-ops", "deploy-monitoring"],
      "scripts": [
        { "run": "bun scripts/preflight.ts", "phase": "pre", "inject_output": true, "required": false, "label": "preflight" }
      ]
    },
    "capabilities": {
      "required_tools": ["bash", "read"],
      "external_commands": ["docker", "mcpq", "gh"]
    },
    "validation": {
      "files_to_watch": ["docker-compose.yml"],
      "stale_threshold_days": 30
    },
    "stall_detection": {
      "running_silence_warn_ms": 60000,
      "running_silence_error_ms": 300000,
      "waiting_stale_ms": 3600000,
      "waiting_auto_close_ms": null,
      "tool_duration_warn_ms": 120000
    },
    "mandatory_rules": {
      "template_sets": ["per-turn-handoff-schema", "core-session-boundary"],
      "disable_default_globals": false,
      "inline_rules": [
        { "id": "no-mutation", "level": "error", "text": "Never restart, redeploy or scale anything.", "when": "always" }
      ]
    },
    "permissions": {
      "LOW": { "denied_natives_when_extension": ["grep"], "denied_natives_mode": "soft" }
    },
    "notes_mode": "full-trail"
  }
}
```

Which fields actually change behavior:

- `permission_required` — the tool grant and the lease decision (next section). Everything
  else about capability is downstream of it.
- `requires_worktree` — a write tier provisions its own per-Issue worktree; leave `true`.
- `lease_waiver` — the read-tier escape valve for a role that must run its own commands.
- `extensions` — the only way an extension-provided tool reaches the session.
- `prompt.task_template` — required. Placeholders are dollar-sign tokens (`$issue_ref`
  where supported, `$bead_id`, `$prompt`, `$cwd`); a mustache form like `{{bead_id}}` is
  not substituted and reaches the model literally.
- `skills.paths` — pack names or paths; a role that reads service knowledge must name the
  pack or it will not have it.
- `capabilities.required_tools` / `external_commands` — the dispatch contract's tool gate.
  Naming a tool the session cannot load refuses the dispatch, which is the useful failure.
- `mandatory_rules.template_sets` — surviving `bare: true`; keep the fleet boundary.
- `beads_integration` / `beads_write_notes` — legacy `sp` only; the native runtime reports
  a non-default value as a config note and ignores it. Do not set them for new roles.

## Bare-mode invariant

`execution.bare: true` removes ordinary Specialist framing, default rules, and specialist-selected rules, but it does **not** remove package `required_template_sets`. Bare workers are still XTRM system participants and always receive the fleet boundary.
