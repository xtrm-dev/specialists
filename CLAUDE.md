# Project: specialists

> Skills are loaded on demand — don't duplicate skill content here.
> If a section grows past 30 lines, it probably belongs in a skill.

## Session start

```bash
bd prime                        # workflow context + active claims
bv --robot-triage --format toon # ranked work + project health
bd update <id> --claim          # claim before any file edit
```

`bv` ONLY with `--robot-*` flags — bare `bv` opens a TUI and blocks the session.

## Active gates (hooks enforce — not optional)

| Gate | Trigger | Required action |
|------|---------|-----------------|
| Edit | Write/Edit without active claim | `bd update <id> --claim` |
| Commit | `git commit` while claim is open | `bd close <id>` first |
| Memory | `bd close <id>` without ack | `bd remember "..."` then `bd kv set "memory-acked:<id>" "saved:<key>"` (or `"nothing novel:<reason>"`) then close |
| Stop | Session end with unclosed claim | `bd close <id>` |

## Execution policy

- Proceed by default once scope is clear. No repetitive "Proceed? Yes/No" prompts.
- Confirm only for destructive/irreversible/high-risk actions (rm, history rewrite, mass deletes, credential rotation, prod ops).
- Ask only when requirements are genuinely ambiguous.

## Branching

```bash
git checkout -b feature/<issue-id>-<slug>   # fix/... chore/... etc.
# work, close bead, commit
xt end                                      # push + PR + merge + worktree cleanup
```

Never continue new work on a previously used branch.

## Code intelligence (mandatory before edits)

Before modifying any function/class/method:
- `gitnexus_impact({target: "X", direction: "upstream"})` — blast radius
- `gitnexus_context({name: "X"})` — callers/callees/flows
- `gitnexus_detect_changes()` before commit

Use Serena symbolic tools (`find_symbol` → `replace_symbol_body`) instead of grep-read-sed when available. Stop and warn if impact returns HIGH/CRITICAL.

## Quality gates (automatic on edit)

| Language | Tools |
|---|---|
| TS/JS | ESLint + tsc |
| Python | ruff + mypy |

Hook output appears as context. Fix failures before committing.

## Skills (load on demand)

| When | Skill |
|---|---|
| Specialist orchestration (run/review/merge) | `/using-specialists-v2` |
| Specialist authoring (`.specialist.json`) | `/specialists-creator` |
| Worktree session lifecycle | `/using-xtrm`, `/xt-end`, `/xt-merge` |
| Code exploration / impact / debugging / refactoring | `/gitnexus-exploring`, `/gitnexus-impact-analysis`, `/gitnexus-debugging`, `/gitnexus-refactoring` |
| GitNexus CLI (analyze/index/wiki) | `/gitnexus-cli` |
| Pre-PR review / security review | `/review`, `/security-review` |
| Release | `/releasing` |
| Session close | `/session-close-report` |
| Plan a feature/epic from scratch | `/planning` |
| Premortem a plan | `/premortem` |

Run `bd memories <keyword>` or `bd recall <key>` for prior insights before substantial work.

## Specialist orchestration in one paragraph

`--bead` is the prompt — don't run a specialist until the bead is a usable task contract (PROBLEM / SUCCESS / SCOPE / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT). Edit-capable specialists auto-provision a worktree from `--bead`. Reviewer reuses the executor workspace via `--job <exec-job>` — `--worktree` and `--job` are mutually exclusive. Keep executor/debugger jobs alive with `--keep-alive` so they're resumable. Default `--context-depth` is 3. Merge via `sp merge <chain-root>` or `sp epic merge <epic>` — never manual `git merge` for specialist branches. Per-turn output auto-appends to bead notes; `bd show <id>` is the canonical way to read a handoff. Full reference: `/using-specialists-v2`.

## Common gotchas (project-specific)

- **`sp stop` cleans `status.json`; `sp merge` then can't resolve the chain.** For doc-only chains, fall back to manual `git merge --no-ff` (skips tsc + conflict gates).
- **`--worktree` and `--job` are mutually exclusive.** First executor: `--worktree`. Reviewer/fix: `--job <exec-job>`.
- **Stale-base guard** blocks worktree dispatch if sibling epic chains have unmerged substantive commits. Override with `--force-stale-base` only with cause.
- **Manual `git merge` of feature branches breaks sp's epic bookkeeping.** Use `sp merge` / `sp epic merge` when possible.
- **GitNexus index goes stale on commit.** PostToolUse hook normally re-indexes after `git commit`/`git merge`; if not, `npx gitnexus analyze` (add `--embeddings` only if `.gitnexus/meta.json` shows `stats.embeddings > 0`).
- **`bd close` blocks until `memory-acked:<id>` kv exists.** Each id in a batch needs its own ack.
- **Specialists are JSON** (`config/specialists/<name>.specialist.json`) — YAML is a deprecated legacy fallback (`loader.ts:101 deprecatedYaml`).

## Project-specific

- gzrx manifest system: see `docs/design/gzrx-tool-catalog.md` (canonical), `docs/design/gzrx-completion-critique.md` (gap analysis), bead `unitAI-qujxo` (completion epic).
- Specialists project guide / runtime architecture / key files: `docs/ARCHITECTURE.md`, `docs/cli-reference.md`, `docs/features.md`.
