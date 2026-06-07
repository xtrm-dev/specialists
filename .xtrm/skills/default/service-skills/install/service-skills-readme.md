# Service Skills

> **Path model:** the canonical home for per-service skills is `.xtrm/skills/user/packs/<pack>/<service>/`; `.claude/skills/<service>/` is a Claude-Code **view** (symlink). Scripts resolve real paths via `bootstrap` (`get_service_skill_path_str`) — they never hardcode `.claude/skills`. The machinery skill itself is at `.claude/skills/service-skills/` (active view) ↔ `.xtrm/skills/default/service-skills/`.

A system that gives Claude persistent, project-specific operational knowledge about your Docker services. Instead of re-explaining your architecture every session, each service has a dedicated skill package that Claude loads on demand.

---

## What It Does

**Three workflow skills** form the trinity:

| Skill | Role | When it runs |
|---|---|---|
| `creating-service-skills` | Builds new skill packages via 3-phase workflow (scaffold + Serena deep dive + hook registration) | Manually via `/creating-service-skills` |
| `using-service-skills` | Discovers and activates expert personas | Automatically at session start |
| `updating-service-skills` | Detects drift when code changes | Automatically on every file write |

**Five hooks** keep everything wired together:

| Hook | Type | Trigger | Effect |
|---|---|---|---|
| `SessionStart` | Claude Code | Session opens | Injects lightweight service catalog into context (~150 tokens) |
| `PreToolUse` | Claude Code | Any Read/Write/Edit/Grep/Glob/Bash | Checks if the operation touches a service territory; injects skill load reminder and enforcement |
| `PostToolUse` | Claude Code | Any Write/Edit | Checks if modified file belongs to a registered service; notifies Claude to sync docs |
| `pre-commit` | Git | `git commit` | Warns if source files changed without SSOT documentation update (non-blocking) |
| `pre-push` | Git | `git push` | Warns if service skills are older than the source files being pushed (non-blocking) |

**Each generated skill package** for a service contains:

```
.claude/skills/<service-name>/
├── SKILL.md                  — architecture, data flows, failure modes, common operations
├── scripts/
│   ├── health_probe.py       — container status + table freshness check
│   ├── log_hunter.py         — service-specific log pattern analysis
│   ├── data_explorer.py      — read-only DB inspection
│   └── <specialist>.py       — service-type-specific inspector
└── references/
    ├── deep_dive.md          — Phase 2 research notes
    └── architecture_ssot.md  — link to project SSOT if available
```

---

## Installation & migration (foolproof — no manual scripts)

From inside your target project, run your normal update:

```bash
cd ~/projects/my-project
xt update --apply
```

That's the whole thing. `xt update --apply` (and `xt init`) is **registry-gated and
idempotent**:

- delivers/updates the single `service-skills` machinery skill,
- **auto-migrates** any old-layout pack to the v2 umbrella layout (moves per-service
  skills under `…/service-skills/services/`, relocates + rewrites the registry to
  `.xtrm`, generates the per-repo `<repo>-services` umbrella, demotes any stale
  root/legacy registry),
- and the Claude hooks (SessionStart catalog · PreToolUse activator · PostToolUse
  drift) are wired automatically via the global service-skills policy — they no-op in
  repos with no service-registry.

There is **nothing to guess and no script to remember**. Repos without a
service-registry are completely unaffected. Re-running is a safe no-op.

> **Migrating an existing (pre-v2) repo:** just run `xt update --apply`. It detects the
> old flat layout and migrates in place. If a per-service `SKILL.md` already exists at
> the target with divergent content, the migrator **refuses that service and reports it**
> (no data loss) — resolve it and re-run.

**Manual fallback** (runtime-agnostic, only if you can't use `xt`):

```bash
python3 .xtrm/skills/default/service-skills/install/install-service-skills.py
```

---

## Creating a Service Skill

```bash
# In Claude Code, invoke the skill:
/creating-service-skills
```

The skill runs a **mandatory three-phase workflow**:

### Phase 1 — Automated Skeleton

```bash
python3 "$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/scaffolder.py" \
  create <service-id> <territory-path> "<description>"
```

Reads `docker-compose*.yml`, `Dockerfile`, and dependency files. Produces:
- `SKILL.md` with `[PENDING RESEARCH]` markers
- Script stubs in `scripts/`
- Official documentation links auto-detected from image tags and package files
- Entry in `.claude/skills/service-registry.json`

### Phase 2 — Agentic Deep Dive

Claude reads the actual source code to fill every `[PENDING RESEARCH]` marker.
Uses Serena LSP tools (not raw file reads) for efficiency:

```
get_symbols_overview   → map module structure
find_symbol            → read specific functions
search_for_pattern     → find log strings, SQL queries, env vars
find_referencing_symbols → trace data flows
```

### Phase 3 — Hook Registration

After the deep dive is complete, Claude verifies the auto-activation infrastructure:

1. Confirms the `PreToolUse` hook is present in `.claude/settings.json` (pointing to `skill_activator.py`)
2. Verifies the service entry in `.claude/skills/service-registry.json` has territory globs set
3. Informs you that the skill will now auto-activate whenever Claude:
   - Operates on a file matching the service's territory globs
   - Runs a Bash command that mentions the service name or container name

No manual registration step is needed — the installer wires the hooks at project setup time. Phase 3 is a verification and communication step only.

A skill is **complete** only when:
- No `[PENDING RESEARCH]` markers remain
- `health_probe.py` queries real tables with correct stale thresholds
- `log_hunter.py` patterns sourced from actual codebase error strings
- Failure Modes table (symptom/cause/fix) has ≥5 rows from real exception handlers
- Cross-Service Health Check + Deploy & Runbook sections present (per the section contract)
- Section order matches `creating-service-skills/references/service_skill_contract.json`
- All scripts support `--json` output
- `PreToolUse` skill activator hook confirmed in `.claude/settings.json`
- Service territory globs verified in `.claude/skills/service-registry.json`
- You have been informed: skill auto-activates on territory file access and service-name commands

---

## Using a Service Skill

At session start, Claude receives:

```xml
<project_service_catalog>
Available expert personas:
- db-expert: SQL & schema optimization (Path: .claude/skills/db-expert/SKILL.md)
- auth-service: JWT authentication expert (Path: .claude/skills/auth-service/SKILL.md)
</project_service_catalog>
```

Claude automatically loads the relevant skill when you ask about a covered service. You can also invoke explicitly:

```
Read .claude/skills/<service-name>/SKILL.md
```

### Auto-activation

Once a service skill is registered, you don't need to load it manually.
The `PreToolUse` hook (`skill_activator.py`) fires automatically whenever
Claude operates on a file in the service's territory or runs a Bash command
mentioning the service name. It injects:

```
[Service Skill] You are about to work with the 'auth-service' service territory.
  Load the expert skill before proceeding: Read .claude/skills/auth-service/SKILL.md
  Do not use ad-hoc approaches (raw SQL, improvised docker commands) when the
  skill defines the correct method.
```

This enforces that Claude uses the skill's defined diagnostic scripts and
operational procedures rather than improvising — e.g. running `health_probe.py`
instead of issuing direct `psql` queries, or checking `log_hunter.py` patterns
before reading raw docker logs.

### Run scripts directly

```bash
python3 .claude/skills/<service-name>/scripts/health_probe.py
python3 .claude/skills/<service-name>/scripts/log_hunter.py --errors-only
python3 .claude/skills/<service-name>/scripts/data_explorer.py --limit 20 --json
```

---

## Updating a Service Skill

When you modify service source code, the `PostToolUse` hook fires automatically and Claude sees:

```
[Skill Sync]: Implementation drift detected in 'auth-service'.
File 'src/auth/jwt.py' was modified.
Use '/updating-service-skills' to sync the Auth Service documentation.
```

To sync:

```bash
/updating-service-skills
```

To mark a service as synced after manual update:

```bash
python3 .claude/skills/service-skills/scripts/drift_detector.py sync <service-id>
```

To scan all services for drift:

```bash
python3 .claude/skills/service-skills/scripts/drift_detector.py scan
```

---

## Registry

`.claude/skills/service-registry.json` is the source of truth for registered services:

```json
{
  "services": {
    "auth-service": {
      "name": "Auth Service",
      "territory": ["src/auth/**/*.py"],
      "skill_path": ".claude/skills/auth-service/SKILL.md",
      "description": "JWT authentication and session management",
      "last_sync": "2026-02-23T19:00:00Z",
      "last_sync_ref": "0d241bc1"
    }
  }
}
```

> `drift_detector.py scan` is **gitnexus-default**: it measures the committed range since
> `last_sync_ref` (set by `sync` alongside `last_sync`) and tiers each drift
> (`tier_source`/`gitnexus_status`), falling back to mtime (`tier=unknown`) when no index is
> present. Installing/upgrading via `install-service-skills.py` runs the idempotent
> `skill_migrator.py` over existing per-service SKILL.md files to add any missing devops
> sections (Cross-Service Health Check, Failure Modes, Deploy & Runbook) without touching
> human content.

The `territory` globs determine which file paths trigger drift detection and skill auto-activation.

---

## Project Structure

```
project-skills/service-skills-set/      — this repository's source
├── install-service-skills.py           — installer (run from inside target project)
└── .claude/
    ├── settings.json                   — settings template with all 3 hook events
    ├── git-hooks/
    │   ├── doc_reminder.py             — pre-commit: SSOT reminder
    │   └── skill_staleness.py          — pre-push: stale skill warning
    ├── creating-service-skills/        — workflow skill: build new service skills
    ├── using-service-skills/           — workflow skill: catalog injection + skill activation
    └── updating-service-skills/        — workflow skill: drift detection

.claude/                                — installed into your project
├── settings.json                       — SessionStart + PreToolUse + PostToolUse hooks
└── skills/
    ├── service-registry.json
    ├── creating-service-skills/
    ├── using-service-skills/
    ├── updating-service-skills/
    └── <generated-service-skills>/
```
