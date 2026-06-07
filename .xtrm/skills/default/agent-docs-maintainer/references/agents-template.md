# AGENTS.md compact template

```md
# <Project> — Agent Guide

## Project summary
<2-5 lines for any agent/runtime. Avoid Claude-only tool names here.>

## Operating rules
- Use beads as the authoritative issue tracker; claim before edits and close before commit.
- Before proceeding on non-trivial/multi-step work, use runtime-local task planning when the runtime supports it; it must run alongside beads and does not replace beads.
- At session start, check handoff beads/recent reports/closed PRs and `bd list --status=in_progress`; run `/issue-triage` if board state is unclear.
- Ask before destructive or production-impacting actions.
- Use project quality gates after edits.
- Prefer project skills and CLI `--help` over copied manuals.

## Skill and workflow routing
| Need | Use |
|---|---|
| xtrm/beads workflow | `/using-xtrm`, `bd --help`, `xt --help` |
| Specialists | latest `/using-specialists-*`, prefer `/using-specialists-v3`; check `sp --help` and `sp list` |
| Service expertise and docs/project context | `/scope`, `/using-service-skills` if service skills are present |
| Planning/tests/docs | `/planning`, `/test-planning`, `/sync-docs` |
## Project map
- `<path>` — <purpose>
- `<path>` — <purpose>
- `<path>` — <purpose>

## Runtime notes
- Pi: use process tool for long-running commands.
- Generic agents: use available code navigation tools, but route project/service context through the canonical service-skills skill set.

## Essential commands
List only the handful needed every session: bd inspect/claim/close, specialist discovery/status if relevant, mandatory GitNexus calls, and project validation commands. For full syntax, use `--help`.

## Services
If service registry or service skills exist, route service tasks through `/scope` before touching service code; note stale/missing service skills before relying on them.

## Current gotchas
Max 5-10 active, current gotchas. No history.
```

`AGENTS.md` should be more portable than `CLAUDE.md`. Keep Claude-only instructions out unless explicitly scoped.
