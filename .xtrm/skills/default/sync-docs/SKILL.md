---
name: sync-docs
description: >-
  Single-doc documentation sync specialist for xtrm projects. Each invocation
  operates on exactly one doc named in the bead's SCOPE. Source files are
  off-limits to every tool — context comes from a pre-script (xt report
  excerpt + commits) and per-commit `git show <hash> -- <paths>` for at most
  3 unclear commits. Hard runtime cap. Use when one specific doc needs
  syncing after code changes — never for whole-tree audits.
gemini-command: sync-docs
version: 3.1.0
---

# sync-docs

Single-doc sync specialist. One invocation = one doc.

## The single-doc invariant

The bead's `SCOPE` field MUST name exactly one doc path. If SCOPE names zero docs, multiple docs, or a non-doc path, emit `BLOCKED: scope-violation` in Phase 1 and stop. There is no other mode. There is no "audit" or "area" path. Multi-doc updates are N parallel sync-docs runs orchestrated externally.

The mandatory rule (`sync-docs-scope-discipline`) appended after this skill is enforced. Read it. It encodes the hard tool bans, the budget, the steer-obey rule, and the compaction-STOP rule.

## How you read code

You don't, broadly. Source files under `src/`, `tests/`, `pi/`, `packages/`, `config/specialists/`, `.specialists/default/` are off-limits to **every tool**: `Read`, `Grep`, `Glob`, `find`, `cat`, `head`, `tail`, `sed`, `awk`, `rg`, `git grep`, `python -c open(...)`, and any `Bash` redirection that pipes a source file.

The legal channels for understanding what changed:

1. **Pre-script context** (already injected above): latest xt report excerpt + `git log master --oneline -20`.
2. **Your one doc's content** (`Read`).
3. **Filtered drift**: `python3 .xtrm/skills/default/sync-docs/scripts/drift_detector.py scan --json`, filtered through `jq` or `python -c` to YOUR ONE DOC. Discard everything else.
4. **Filtered context_gatherer** (only if pre-script context is insufficient): `python3 .xtrm/skills/default/sync-docs/scripts/context_gatherer.py --doc <YOUR_DOC>` — that flag only.
5. **Per-commit diff** for unclear claims: `git show <hash> -- <path1> [<path2>...]`. Maximum 3 such calls per run. NEVER `git diff <a>..<b>`. NEVER `git show <hash>` without `--`.

## Phases

| Phase | Action | Budget |
|---|---|---|
| 1 | Verify SCOPE names exactly one doc. STOP if not. | 0 tools |
| 2 | Filtered drift scan for that one doc. | 1 call |
| 3 | Per-commit `git show <hash> -- <paths>` for unclear commits. | ≤3 calls |
| 4 | Edit the one doc. Bump `version` + `updated`. Stamp via `drift_detector.py update-sync <path>`. | edits to one doc only |
| 5 | Re-run filtered drift; confirm cleared. Emit final report. | 1 call |

After Phase 5, stop. Do not look at other docs. Do not propose new beads.

## Phase 1: SCOPE check

Read the bead's SCOPE field. It must name exactly one doc path. Examples of valid SCOPE:

```
SCOPE: docs/cli-reference.md
SCOPE: CHANGELOG.md
```

Examples that are `BLOCKED: scope-violation`:

```
SCOPE:                                  # empty
SCOPE: docs/cli-reference.md docs/features.md   # multiple
SCOPE: docs/                            # directory
SCOPE: src/cli/run.ts                   # non-doc
```

If blocked, emit:

```
DOC: <whatever was in SCOPE, or empty>
VERDICT: BLOCKED
EDITS: none
NOTES: scope-violation — <reason>
```

and stop.

## Phase 2: Filtered drift

```bash
python3 .xtrm/skills/default/sync-docs/scripts/drift_detector.py scan --json \
  | jq '[.stale[]? | select(.doc == "<YOUR_DOC>")]'
```

If your doc reports stale, capture the list of commits since `synced_at` — those are your candidate commits for Phase 3.

If your doc is not in the drift output (no `source_of_truth_for` declared, or no commits since `synced_at`), use the pre-script's recent commits + your reading of the doc's content to form a candidate list.

## Phase 3: Per-commit diff (unclear cases only)

For commits whose subjects don't make the impact on your doc obvious, run:

```bash
git show <hash> -- <path1> <path2>
```

The `<paths>` should be paths your doc actually claims about (e.g. if the doc is `docs/cli-reference.md`, paths under `src/cli/` and `src/index.ts` are reasonable; paths under `pi/` are not unless the doc covers pi).

Maximum 3 such calls per run. If 3 calls aren't enough, the commit set is too broad — emit `BLOCKED: too-many-unclear-commits` and ask for a narrower bead.

## Phase 4: Edit

For your one doc:
- Update content based on the gathered context.
- Bump frontmatter `version` (patch/minor/major per change) and `updated` (today).
- Stamp:
  ```bash
  python3 .xtrm/skills/default/sync-docs/scripts/drift_detector.py update-sync <YOUR_DOC>
  ```

Edit nothing else. CHANGELOG, README, other docs, source files — all off-limits.

## Phase 5: Validate

Re-run the filtered drift scan from Phase 2. Confirm your doc is no longer stale.

## Final report

```
DOC: <path>
VERDICT: <UPDATED | NO_CHANGE_NEEDED | BLOCKED>
COMMITS_REVIEWED: <hash1>, <hash2>, ...
EDITS: <one-line summary, or "none">
DRIFT_BEFORE: <stale | clean | unknown>
DRIFT_AFTER: <clean | n/a>
SUGGESTED_FOLLOWUPS: <other doc names that may need separate sync-docs runs — names only, never edited>
```

## References

- [Frontmatter schema](references/schema.md) — required/optional fields, categories, version-bump rules
- [Doc structure](references/doc-structure.md) — INDEX block regen, structure analyzer

## Anti-patterns (forbidden by the mandatory rule)

- Reading source files by **any** tool, not just `Read`
- `git diff <a>..<b>` (range diffs) or `git show <hash>` without `--`
- Editing CHANGELOG / README / other docs / source files (unless that file IS the SCOPE doc)
- Auditing the docs/ tree
- Running `context_gatherer.py` with `--scope-path` or `--since-days` (broad)
- Re-fetching after compaction
- Continuing after a steer/stop
- "Let me also check X" loops
