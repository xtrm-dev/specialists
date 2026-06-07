# Agent docs audit rules

## Budgets

| Metric | Good | Warning | Rewrite |
|---|---:|---:|---:|
| Lines | <=300 | 301-500 | >500 |
| Command refs | <=20 | 21-60 | >60 |
| Code fences | <=8 | 9-20 | >20 |
| Table lines | <=30 | 31-80 | >80 |

These are heuristics. A short but stale file still needs cleanup.

## Bloat signals

- Headings named `Command Reference`, `Quick Reference`, `Common Query Patterns`, `Docker Operations`, `Testing` with many commands.
- More than 10 consecutive lines inside a shell code fence.
- Multiple managed blocks for the same system.
- Generic xtrm/beads/GitNexus instructions repeated before and after project-specific sections.
- Old project names that do not match the repo/package.

## Rewrite priorities

1. Remove duplicated managed blocks.
2. Replace CLI manuals with a tiny essential command surface plus pointers to `--help` and skills.
3. Keep project-specific operational facts.
4. Move service-specific runbooks into service skills/docs.
5. Delete stale history and completed work notes.

## Required final shape

Every cleaned agent doc should have:

- project summary
- rules
- skill/workflow routing
- project map
- runtime-specific notes, if needed
- essential commands: enough for safe work inspection/claim/delegation/validation/close, not a full manual
- current gotchas
- references

## Managed xtrm block source

The bd/bv/xtrm top blocks in `CLAUDE.md` and `AGENTS.md` are managed content. Durable edits belong in the canonical xtrm instruction templates for the current installation/package, then `xt update --apply` regenerates project copies.

Do not hard-code machine-specific template paths in user-facing docs: installation layouts differ. The GitNexus block is regenerated separately by GitNexus hooks.
