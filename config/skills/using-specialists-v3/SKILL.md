---
name: using-specialists-v3
description: >
  Canonical specialist orchestration skill. Use for substantial work that should
  be delegated, tracked, reviewed, or merged through specialists instead of
  handled directly.
version: 3.0
---

# Using Specialists v3

You are orchestrator. Pick role, set contract, launch specialist, monitor result, merge work. Do not turn orchestration into hidden implementation.

Use this skill for code review, debugging, implementation, test generation, planning, doc sync, and multi-step specialist chains. Do small deterministic edits directly only when scope is already obvious.

## Core Rules

1. Track substantial work through bead-first specialist runs.
2. Bead is prompt surface. Keep task contract in bead notes when scope needs precision.
3. Do not use `--prompt` for tracked work.
4. Do not self-investigate when specialist route fits; dispatch role instead.
5. Keep specialist output on bead notes for audit trail.
6. Do not do destructive or irreversible operations through specialists.
7. Merge through specialist publish flow, not manual git merge, for specialist-owned work.
8. Keep scope tight; one bead, one responsibility.

## Role Selection

Use live registry, not static catalog:

```bash
specialists list --full
```

Choose role by task shape:

- `explorer` — unknown code path, architecture mapping, scoped discovery.
- `debugger` — failing test, stack trace, regression, root cause.
- `executor` — clear implementation path, concrete file edits.
- `reviewer` — verify executor output against bead contract and diff.
- `test-runner` — run checks, interpret failures, isolate infra vs code.
- `planner` — break work into beads, deps, sequencing.
- `overthinker` — design choice, tradeoff, risk critique.
- `code-sanity` — quick smell pass before review.
- `security-auditor` — safe audit only.

If unsure, start with `explorer` or `debugger`, then hand off to executor.

## Command Surface

Use help, not memorized catalogs:

```bash
sp help
sp run --help
sp feed --help
sp result --help
sp resume --help
sp epic --help
```

Read subcommand help for flags before dispatching. Prefer current CLI help over stale docs.

## Canonical Flow

1. Create or claim bead.
2. Write contract in bead notes if prompt is vague.
3. Select role from live registry.
4. Dispatch specialist with `--bead`.
5. Wait, poll result, steer or resume if needed.
6. Review output, run merge path, close bead.

## Minimal Contract Template

```text
PROBLEM: what is wrong or needed.
SUCCESS: observable end state.
SCOPE: files, symbols, commands, docs.
NON_GOALS: out of scope.
CONSTRAINTS: safety, compatibility, sequencing.
VALIDATION: checks expected before close.
OUTPUT: handoff format.
```

## Decision Rule

If work is unclear, delegate discovery first. If work is clear enough to code, delegate implementation. If work is only a quick deterministic tweak, do it directly.
