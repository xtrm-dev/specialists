---
name: service-skills
description: >-
  Operational service-knowledge system for a project's services. One skill that
  creates, discovers, activates, updates, and scopes per-service expert skill
  packages (SKILL.md + diagnostic scripts + references), kept in sync with the
  code via a GitNexus-aware drift engine. Use when onboarding to a service,
  routing a task to the right expert, scaffolding a missing skill, or syncing a
  skill after the implementation drifted. Triggers: /service-skills,
  /creating-service-skills, /using-service-skills, /updating-service-skills,
  /scope, or any task that touches a registered service territory.
allowed-tools: Bash(python3 *), Read, Grep, Glob, Write
---

# Service Skills

The single entry point for a project's **service-skills** system. Each service gets a
dedicated expert package — architecture, data flows, failure modes, runnable health checks,
deploy/runbook, and diagnostic scripts — that agents load on demand instead of re-deriving
the service every session. This router tells you **which flow to run** and points at the
detailed reference for each.

> **Two skills share the `service-skills` name by design, at different layers:**
> - **This machinery skill** (`service-skills`) — the create/use/update/scope tooling. Shipped once.
> - **The per-repo umbrella** (`<repo>-services`) — one generated skill per repo that maps that
>   repo's services and links their per-service skills. Repo-qualified name avoids collision.

---

## Pick the Flow

| You want to… | Flow | Reference | Trigger |
|---|---|---|---|
| Stand up a new service skill (scaffold + deep dive) | **create** | [references/creating.md](references/creating.md) | `/creating-service-skills` |
| Find & activate the right expert for a task | **use** | [references/using.md](references/using.md) | `/using-service-skills` (auto at session start) |
| Sync a skill after the code changed (drift) | **update** | [references/updating.md](references/updating.md) | `/updating-service-skills` (auto on Write/Edit) |
| Scope a task to the right service(s) before touching files | **scope** | [references/routing.md](references/routing.md) | `/scope "task"` |

Supporting references: [system-guide.md](references/system-guide.md) (how the whole system fits
together), [script_quality_standards.md](references/script_quality_standards.md) (diagnostic-script
templates), and the canonical section contract `references/service_skill_contract.json` (SSOT for
SKILL.md headings, order, and the `<!-- SEMANTIC_START/END -->` protected region).

---

## Scope First (absorbed routing)

Before any investigation, feature, refactor, config-change, or exploration task that involves a
service, **ground it in the right expert context before touching files**. Read the registry, detect
intent, map to service(s), emit a scope plan, load the skills, then act.

Detect intent from the task description:

| Intent | Signal keywords |
|---|---|
| `investigation` | broken, error, failing, not working, crash, down, missing, slow, 502, 404, 429, timeout |
| `feature` | add, implement, create, new, build, support |
| `refactor` | refactor, restructure, clean, reorganize, rename, extract |
| `config-change` | update, change, modify, set, configure, tune |
| `exploration` | how, explain, understand, what is, why, walk me through |

**Default when ambiguous → `investigation`** (check first, act second). Map symptoms to services,
confirm ownership with the graph when a task names a *symbol* rather than a path, then run the full
scope flow in [references/routing.md](references/routing.md) (intent workflows, XML scope block,
regression-test binding).

```bash
python3 "$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/scope.py"   # registry + routing footer
```

---

## Navigate With the Graph, Not Just Globs

The registry maps a service to its territory **globs** — enough to *find* the skill, not to
understand cross-service reach. Once an expert is active, navigate with the **GitNexus** graph:

| Question | Use |
|---|---|
| "What else breaks if I change this symbol?" | `gitnexus impact <symbol> --direction upstream` |
| "Who calls / is called by this?" | `gitnexus context <symbol>` |
| "Which service owns this execution flow?" | `gitnexus query "<concept>"` |
| "Trace the full flow end to end" | `READ gitnexus://repo/<repo>/process/<name>` |

**Fallback:** with no GitNexus index, route by registry globs + `cross_territory` hints in drift
output. The graph is an enhancement, never a hard dependency.

---

## Drift Cadence (update flow)

The automatic sync pipeline runs **post-merge on master only** (not on feature-branch merges) —
the single point where code is final. Drift is measured **semantically** since each service's
`last_sync_ref` (committed range `last_sync_ref..HEAD`), not by file mtime alone, and tiered
`cosmetic | medium | high | unknown` with explicit provenance. See
[references/updating.md](references/updating.md).

```bash
python3 "$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/drift_detector.py" scan
```

---

## Scripts

All machinery scripts live together under `scripts/` (no cross-skill imports):

| Script | Role |
|---|---|
| `bootstrap.py` | Path/registry resolvers (`get_project_root`, `get_pack_path`, `get_registry_path`), gitnexus helpers |
| `scaffolder.py` | Phase-1 skeleton from compose/Dockerfile/deps |
| `deep_dive.py` | Service-type classification + Phase-2 research agenda |
| `drift_detector.py` | GitNexus-aware drift scan / sync / `check-hook` |
| `skill_migrator.py` | Upgrade a pre-devops SKILL.md to the current section contract (idempotent, SEMANTIC-preserving) |
| `cataloger.py` | Session-start service catalog injection |
| `skill_activator.py` | PreToolUse territory → load-skill enforcement |
| `scope.py` | Registry read + routing footer for the scope flow |

Install machinery (hooks + settings + git-hooks) lives under `install/`; see
[install/service-skills-readme.md](install/service-skills-readme.md).

`umbrella_generator.py` renders the per-repo umbrella (below).

---

## Per-Repo Umbrella (generated)

Each repo gets **one** umbrella skill — `name: <repo>-services` — at
`.xtrm/skills/user/packs/<pack>/service-skills/SKILL.md`. It is **generated from
`service-registry.json`** (service table + cross-service health + navigation) so it
can never drift from the registered services. The human cross-service narrative lives
in a `<!-- SEMANTIC_START -->` / `<!-- SEMANTIC_END -->` block preserved verbatim across
regeneration — edit only there.

```bash
python3 scripts/umbrella_generator.py <repo-name>   # regenerate (idempotent)
```

`install-service-skills.py` regenerates the umbrella on install/upgrade. Load the
umbrella first when a task spans services; it links each per-service skill.

---

## Installation

```bash
cd ~/projects/my-project
python3 /path/to/xtrm-tools/skills/service-skills/install/install-service-skills.py
```

Idempotent — wires `settings.json` hooks (SessionStart catalog · PreToolUse activator ·
PostToolUse drift), activates git hooks, and migrates already-installed skills to the current
section contract. Safe to re-run after upgrades.
