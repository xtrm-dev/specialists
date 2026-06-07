---
name: issue-triage
description: >
  Board hygiene pass for a beads project. Walks every open issue, detects
  duplicates via mechanical `bd find-duplicates`, graph signals via `bv`,
  and semantic clusters via explorer/overthinker specialists, then rewires the dependency graph using the full
  `bd dep --type` vocabulary (blocks, tracks, related, parent-child,
  discovered-from, until, caused-by, validates, relates-to, supersedes) plus
  `bd duplicate` and `bd supersede`. Each rewire is confirmed with the user
  before it's applied. Ends with an AskUser to mint a P0 "next-session
  pickup" bead. Activate when the user says "triage the board", "clean up
  issues", "the backlog is a mess", "rewire dependencies", "find duplicate
  issues", "what should I work on next", or starts a session with a board
  that has > 15 open issues and weak structure. Never skip when the user
  reports duplicate/overlapping work or asks for board orientation.
---

# Issue Triage

Turn a flat backlog into an ordered graph. Every open issue ends the pass
either: (a) deduped, (b) parented to an epic, (c) wired with the right
relationship to its neighbours, or (d) flagged stale.

## When This Fires

- `triage`, `clean up the backlog`, `rewire deps`, `find duplicates`
- "What should I pick up next?" with no obvious top of stack
- Session start with > 15 open issues and no claim
- After a long sprint where issues piled up without structure
- User reports overlap, ambiguity, or duplication in the board

---

## Workflow

```
Phase 1  Snapshot                → enumerate, detect existing cycles
Phase 2  Cluster discovery       → mechanical prefilter + bv graph + explorer/GitNexus + overthinker
Phase 3  Rewire (confirm each)   → apply edges using the right relationship type
Phase 4  Verify                  → cycles, lint, stale
Phase 5  Handoff                 → triage report + P0 next-session pickup
```

---

## Phase 1 — Snapshot

Capture the starting state. Read-only.

```bash
bd list --status=open --json   > .triage/open.json
bd dep cycles                   > .triage/cycles.before.txt
bd graph --json                 > .triage/graph.before.json   # if supported
bd stale --json                 > .triage/stale.json
bd lint                         > .triage/lint.txt
```

If `bd dep cycles` returns existing cycles, surface them to the user
**before** rewiring — fix or note them first.

---

## Phase 2 — Cluster Discovery

Mechanical duplicate prefiltering, graph context, then specialist synthesis.

`bd find-duplicates --method ai` is **not** the default path. It depends
on provider configuration and gives pairwise judgements, while this skill
needs no-key, cluster-level board reasoning. Use specialists for semantic
duplicate and relationship decisions.

### 2a. Mechanical pre-filter (cheap, no API)
```bash
bd find-duplicates --status open --method mechanical --threshold 0.4 --json \
  > .triage/dup-mechanical.json
```

### 2b. Graph signals (bv)

Use bv for topology-aware context before asking specialists to cluster.
Never run bare `bv`; use robot flags only.

```bash
bv --robot-triage  > .triage/bv-triage.json
bv --robot-alerts   > .triage/bv-alerts.json
```

These artifacts surface blockers, stale items, priority mismatches, and
existing graph structure that title-similarity cannot see.

### 2c. Codebase overlap (explorer specialist OR GitNexus inline)

Mechanical similarity reads titles + descriptions only. Issues touching
the same files/functions but worded differently slip through. Two paths:

**Path A — GitNexus inline (fast, when an index exists for this repo).**
For each pair of issues sharing at least one surface token (file/symbol from
title or description), run:
```
gitnexus_query({query: "<shared token>"})
gitnexus_context({name: "<symbol>"})      # if a specific symbol is named
```
This surfaces execution-flow overlaps the LLM can't infer from issue text.
If the index is unavailable or stale, fall back to Path B and flag the
report as "no GitNexus reinforcement".

**Path B — explorer specialist (when no index, or for very large boards).**
Dispatch an explorer to scan the repo:

```bash
sp run explorer --bead <triage-bead-id> \
  --prompt "Read .triage/open.json plus .triage/bv-triage.json and .triage/bv-alerts.json. Cluster issues by shared implementation surface, file paths, symbols, feature area, and graph context. Return JSON: [{cluster_id, issues:[], shared_files:[], shared_symbols:[], graph_signal:[], confidence:0-1, rationale}]." \
  --context-depth 0 --background
```

Save the result as `.triage/code-overlap.json` either way — Phase 2d
consumes the same shape from either source.

### 2d. Synthesis (overthinker specialist)

Hand the mechanical prefilter, bv graph artifacts, and code-overlap
clusters to an **overthinker** for final cluster judgement and
relationship-type selection:

```bash
sp run overthinker --bead <triage-bead-id> \
  --prompt "Inputs: .triage/dup-mechanical.json, .triage/bv-triage.json, .triage/bv-alerts.json, .triage/code-overlap.json. For each cluster, recommend ONE action from: duplicate, supersede, new-epic, parent-child, blocks, discovered-from, caused-by, validates, tracks, until, relates-to, related, no-op. Prefer cluster-level semantic judgement over pairwise title similarity. Return JSON: [{cluster_id, issues:[], action, justification, target?, source?}]." \
  --context-depth 0 --background
```

---

## Phase 3 — Rewire (Confirm-Each)

For every recommendation, present it to the user with `AskUserQuestion`
before writing. Each apply mode maps to one command:

| Recommendation | Command |
|---|---|
| `duplicate` | `bd duplicate <new> <canonical>` |
| `supersede` | `bd supersede <old> <new>` |
| `new-epic` | `bd create --type=epic --title=...` then `bd dep add <child> <epic> --type parent-child` for each member |
| `parent-child` | `bd dep add <child> <parent> --type parent-child` |
| `blocks` | `bd dep add <blocked> <blocker> --type blocks` |
| `discovered-from` | `bd dep add <new> <source> --type discovered-from` |
| `caused-by` | `bd dep add <effect> <cause> --type caused-by` |
| `validates` | `bd dep add <test> <impl> --type validates` |
| `tracks` | `bd dep add <a> <b> --type tracks` |
| `until` | `bd dep add <a> <b> --type until` |
| `relates-to` | `bd dep relate <a> <b>` (bidirectional) |
| `related` | `bd dep add <a> <b> --type related` |
| `no-op` | record + skip |

Confirm-each batches: show up to 3 proposals per `AskUserQuestion`, allow
accept-all/skip-all per cluster to avoid prompt fatigue.

### Generate `apply.sh` alongside (machine-readable contract)

After (or before) confirming, emit `.triage/apply.sh` capturing the same
mutations the user will approve. The script is the auditable record of the
pass and the operator's escape hatch — they can review every line, comment
out anything they don't want, and re-run it.

```bash
#!/usr/bin/env bash
# Generated by issue-triage skill — apply mutations from <triage-bead-id>
# Review before running. Each command is on its own line.
set -euo pipefail

# Cluster 1: status-line near-duplicates
bd supersede fix-old fix-new

# Cluster 2: hook-runner siblings — new epic + reparent
EPIC=$(bd create --type=epic --title="hook-runner hardening" --json | jq -r .id)
bd dep add fix-a "$EPIC" --type parent-child
bd dep add fix-b "$EPIC" --type parent-child

echo "Applied ${BASH_LINENO[0]} mutations from <triage-bead-id>."
```

Cite the triage bead ID in the header. Use `$(bd create … --json | jq -r .id)`
when capturing IDs needed by later lines (epic creation is the common case).
Mention the script's path in the triage bead body under an "## Apply" heading.

---

## Phase 4 — Verify

After rewiring, sanity-check:

```bash
bd dep cycles                                    # MUST be empty (or unchanged from .before)
bd dep tree <each-new-epic>                      # visual spot-check
bd graph --json   > .triage/graph.after.json     # diff vs before for the report
bd lint                                          # flag template gaps introduced
```

If cycles appeared, revert the most recent edges interactively and re-run.

---

## Phase 5 — Handoff

### 5a. Triage report

Print a structured summary:

```
Snapshot:    N open → M after dedup
Clusters:    C clusters across F issues
Edges added: K (blocks=…, parent-child=…, discovered-from=…, …)
Duplicates:  D merged
Stale:       S issues > 30 days untouched
Lint gaps:   L

Top 3 candidate next-pickups (after rewire):
  1. <id> P<n> <title>  — why
  2. …
  3. …
```

### 5b. P0 next-session pickup

`AskUserQuestion`: offer to mint a P0 task pointing at the top recommendation.

```bash
bd create \
  --title="Next session: pick up <id> — <slug>" \
  --description="Triage on <date> identified <id> as highest-leverage next move because <reason>. Context: <bullets>." \
  --type=task --priority=0
```

---

## Specialists Used

| Specialist | Role | Mode |
|---|---|---|
| explorer | Read repo to find file/symbol overlap that text similarity misses | READ_ONLY, `--context-depth 0` |
| overthinker | Synthesise mechanical prefilter + bv graph signals + code-overlap into cluster recommendations with relationship types | READ_ONLY, `--context-depth 0` |
| researcher (optional) | Pull domain context for ambiguous beads (only if registered) | READ_ONLY |

All specialists run with `--bead <triage-bead-id>` so their output appends
to the triage bead notes for audit.

---

## Boundaries

- **Never** delete issues. Use `bd duplicate` / `bd supersede` / status changes only.
- **Never** apply rewiring without per-cluster confirmation.
- **Never** introduce a cycle — abort and surface to user.
- **Always** snapshot `graph.before.json` and `cycles.before.txt` before phase 3.
- Run `mkdir -p .triage` at start; `.triage/` is the working directory for the pass.

---

## Failure Modes

- Do not rely on `bd find-duplicates --method ai` for the default path. If someone explicitly asks to try it and the repo has a configured provider key, treat it as optional advisory input only; specialists remain the semantic source of truth.
- If explorer or overthinker can't dispatch (`sp ps` shows no slot), fall back to inline reasoning over `.triage/open.json` and flag the report as "specialist-skipped".
- If the project has < 5 open issues, abort with "board too small to triage" rather than running the full pipeline.

---

## Relationship Vocabulary Cheat-Sheet

A common failure mode is reaching for `blocks` on every edge — the board
ends up semantically thin and `bd ready` stops being trustworthy. Each
type carries weight; pick the one that matches the real relationship.

| Type | When to use |
|---|---|
| `blocks` | A genuinely gates B — B cannot start until A closes |
| `tracks` | A should be aware of B's state but doesn't gate on it |
| `relates-to` (also `bd dep relate`) | Non-blocking "see also" — siblings on same surface |
| `parent-child` | Epic → child structural edge |
| `discovered-from` | A was spawned while working on B; provenance, not blocking |
| `until` | A applies up to a time or condition, then becomes inert |
| `caused-by` | Bug A is the root cause of symptom B |
| `validates` | Test/check A verifies feature/implementation B |
| `supersedes` | A replaces an older issue B that should be closed |
| `related` | Generic non-blocking link when no other type fits |

---

## Pitfalls

**Over-blocking.** Tempting to mark every same-surface pair as `blocks`.
Use `relates-to` or `tracks` unless there's a real ordering constraint.
If `blocks` exceeds ~70% of new edges, you're stacking, not triaging.

**Defaulting to `blocks`.** Re-read the cheat-sheet. `caused-by`,
`validates`, `supersedes`, and `discovered-from` each capture meaning
`blocks` loses.

**Inventing epics.** Don't propose an epic for 2 issues. 3+ siblings on
the same surface is the working threshold. Smaller clusters → `relates-to`
edges, not a parent.

**Triaging in-progress work.** If an issue is `in_progress` and the claim
isn't yours, propose changes in the bead but do not apply without explicit
operator OK. Use `bd update <id> --notes "Triage suggestion: …"` so the
assignee sees it.

**Chasing perfection inline.** If you find yourself reading >5 file bodies
to map surface area, switch to the explorer specialist (Phase 2c Path B)
rather than burning context inline.

**Skipping Phase 4.** Always re-run `bd dep cycles` after rewiring. New
edges plus existing ones can introduce cycles that weren't possible before.

---

## Output Checklist

Before declaring the pass done:

1. Triage bead exists with summary, per-cluster findings, vocabulary used.
2. `.triage/` directory contains: open.json, cycles.before.txt, dup-mechanical.json, bv-triage.json, bv-alerts.json, code-overlap.json, graph.before.json, graph.after.json, apply.sh.
3. All applied mutations are confirmed in `apply.sh` and the triage bead's "## Apply" section.
4. `bd dep cycles` returns clean (or unchanged from `.before`).
5. P0 next-session pickup bead created (or operator declined).
6. Triage bead closed with `--reason="Applied N mutations"` — memory gate acked first.
7. `bd stats` delta reported back to operator.
