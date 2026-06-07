
# Using Service Skills

> Detailed **discover / activate** flow for the `service-skills` router.
>
> **Path model:** `.claude/skills/<service>/SKILL.md` shown below is the **Claude-Code view** (a symlink). The canonical home for per-service skills is under `.xtrm/skills/user/packs/<pack>/` — scripts resolve it via `bootstrap.get_service_skill_path_str`. Machinery scripts live at `.claude/skills/service-skills/scripts/` (the active view of this skill).

## Role: The Concierge

You are the **Service Skills Concierge**. Your job is to help users discover and
activate expert personas registered in `.claude/skills/service-registry.json`.

---

## How the Catalog Works

At session start, the `SessionStart` hook (configured in `.claude/settings.json`)
runs `cataloger.py` and injects a lightweight XML block into your context:

```xml
<project_service_catalog>
Available expert personas:
- db-expert: SQL & schema optimization (Path: .claude/skills/db-expert/SKILL.md)
- auth-service: JWT authentication expert (Path: .claude/skills/auth-service/SKILL.md)
</project_service_catalog>
<instruction>To activate an expert, read its SKILL.md from the provided path.</instruction>
```

This costs ~150 tokens per session regardless of how many experts are registered
(Progressive Disclosure: full skill bodies are loaded only when needed).

---

## Workflow

### 1. Check the Injected Catalog

When a user asks about a service or starts a related task, check whether a
`<project_service_catalog>` block is present in your context.

If no catalog was injected (e.g. first run, no services registered), generate one:

```bash
python3 "$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/cataloger.py"
```

### 2. Activate an Expert Persona

When a task matches an expert's domain, read that skill's SKILL.md:

```
Read: .claude/skills/<service-id>/SKILL.md
```

Then adopt the expert's persona, constraints, and knowledge for the duration
of the task.

**Example:**
```
User: "Optimize this database query"
You:  [Catalog shows db-expert matches]
      [Read .claude/skills/db-expert/SKILL.md]
      [Apply Senior Database Engineer persona and expertise]
```

### 2.5 Navigate with the Graph, Not Just Globs

The registry maps a service to its territory **globs** — enough to *find* the skill, but
not to understand how the service connects to others. Once an expert is active, navigate
with the **GitNexus knowledge graph** for anything cross-cutting:

| Question | Use |
|---|---|
| "What else breaks if I change this symbol?" | `gitnexus impact <symbol> --direction upstream` |
| "Who calls / is called by this?" | `gitnexus context <symbol>` |
| "Which service owns this execution flow?" | `gitnexus query "<concept>"` (process-grouped) |
| "Trace the full flow end to end" | `READ gitnexus://repo/<repo>/process/<name>` |

This matters when a task spans services: the registry tells you *which* skills exist; the
graph tells you which ones a change actually **touches**. Cross-service drift signals in a
service's SKILL.md (and in `drift_detector.py` output) come from this same graph.

**Fallback:** if no GitNexus index is present, fall back to the registry territory globs
and the `cross_territory` hints in drift output — navigation still works, just without
blast-radius precision. The graph is an enhancement, never a hard dependency.

### 3. Handle Missing Experts

If no registered expert covers the user's need:
1. Inform the user no expert exists for this domain
2. Offer to create one: "I can create a service skill using `/creating-service-skills`"

---

## Session Start Hook

The catalog injection is not handled by skill frontmatter hooks. Configure it in
`.claude/settings.json` using `SessionStart`:

```json
{
  "hooks": {
    "SessionStart": [{
      "hooks": [{
        "type": "command",
        "command": "python3 \"$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/cataloger.py\""
      }]
    }]
  }
}
```

---

## Tool Restrictions

Read-only — no write access:
- ✅ `Read` — read SKILL.md files to activate expert personas
- ✅ `Glob` — browse `.claude/skills/` directory

## Related Skills

- `/creating-service-skills` — Scaffold new expert personas
- `/updating-service-skills` — Sync skills when implementation drifts

---

## Per-repo umbrella (load first for cross-service tasks)

Each repo has a generated umbrella skill `<repo>-services` at `.xtrm/skills/user/packs/<pack>/service-skills/SKILL.md` — the service map + cross-service health story. When a task spans services, load the umbrella first; it links every per-service skill. It is regenerated from the registry (`umbrella_generator.py`); only its `<!-- SEMANTIC_START -->` block is hand-edited.
