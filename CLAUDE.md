<!-- BEGIN INJECTED BLOCK -->
## Communication Style

Use controlled, precise, and direct language throughout the work session, including plans, progress updates, analysis, reviews, implementation notes, documentation, handoffs, and final reports. Prefer explicit subjects, active voice, consistent terminology, concrete statements, and logically ordered sentences. Keep the writing natural and concise. Avoid conversational filler, ornamental language, vague qualifiers, unnecessary jargon, and exaggerated certainty.

Adapt the level of rigor to the context. Use clear technical prose for analysis, architecture, debugging, design discussion, and collaboration. Use a stricter ASD-STE100-oriented style for procedures, commands, migrations, deployments, security requirements, destructive operations, rollback instructions, acceptance criteria, and operator handoffs. In these cases, state conditions before actions, identify the responsible actor, express one principal action per sentence, preserve the required sequence, and describe expected results and failure conditions explicitly.

Clearly distinguish verified facts, observations, assumptions, inferences, recommendations, and unresolved questions. Do not report an action as successful without evidence. Preserve exact names for repositories, services, contracts, routes, identifiers, configuration fields, and work items. Do not omit material ownership, dependencies, risks, preconditions, rollback requirements, or verification criteria for the sake of brevity.

## Durable work — Substrate

Substrate owns durable work in this repository. Load `/using-xtrm` for system doctrine and `using-substrate` for exact work semantics.

- A **ready pinned Issue revision** is the executable contract.
- Hold the live claim before mutation when the runtime requires it.
- Journal/checkpoint records continuity, progress, findings and decisions; it does not rewrite the Issue contract.
- Worker/Specialist result and settlement are evidence.
- Commit/push/PASS/settlement do **not** close the Issue.
- Closure is explicit durable authority by the authorized owner after required validation/evidence.
- Runtime-local task lists are ephemeral execution tracking and never replace the Issue.
- Historical Beads IDs may resolve as aliases; Beads is compatibility/migration state, not current authority.

Use the current typed Substrate surface when available. For exact CLI syntax use `sb help --json`; do not preserve stale command recipes in this file.

<!-- END INJECTED BLOCK -->

<!-- xtrm:start -->
# XTRM Agent Workflow

> System doctrine: `/using-xtrm`. Durable work doctrine: `using-substrate`.

## Session start

- Resume from the pinned Substrate Issue revision + Journal/checkpoint, not Beads state or chat memory.
- Verify claim/workspace ownership before editing.
- Use current code/runtime/tests as implementation truth.

## Execution policy

Proceed once the Issue contract is executable. Ask only for genuine ambiguity or destructive/irreversible decisions. Scope expansion requires a new/revised Issue revision, not an informal message.

## Branching

Use the branch/workspace admitted by the XTRM/Core session topology. Git integration truth is separate from durable Issue Closure.

## Code intelligence (mandatory before edits)

Before modifying any function/class/method:
- `gitnexus_impact({target: "X", direction: "upstream"})` — blast radius
- `gitnexus_context({name: "X"})` — callers/callees/flows
- `gitnexus_detect_changes()` before commit

Use GitNexus for graph-aware navigation and impact analysis. Use the runtime's native read and edit tools for file operations. Stop and warn if impact returns HIGH/CRITICAL.

## Quality gates (automatic on edit)

| Language | Tools |
|---|---|
| TS/JS | ESLint + tsc |
| Python | ruff + mypy |

Hook output appears as context. Fix failures before committing.

## Skills (load on demand)

| When | Skill |
|---|---|
| Specialist orchestration (run/review/merge) | `/using-specialists` |
| Specialist authoring (`.specialist.json`) | `/specialists-creator` |
| Worktree session lifecycle | `/using-xtrm`, `/xt-end`, `/xt-merge` |
| Code exploration / impact / debugging / refactoring | `/gitnexus-exploring`, `/gitnexus-impact-analysis`, `/gitnexus-debugging`, `/gitnexus-refactoring` |
| GitNexus CLI (analyze/index/wiki) | `/gitnexus-cli` |
| Pre-PR review / security review | `/review`, `/security-review` |
| Release | `/releasing` |
| Session close | `/session-close-report` |
| Plan a feature/epic from scratch | `/planning` |
| Premortem a plan | `/premortem` |

## Specialist orchestration in one paragraph

Native activation is primary for Substrate-backed work: the ready pinned Issue revision is the prompt, the activation runs in the admitted workspace, mutating roles use the writer lease, and settlement/result/provenance return evidence to the coordinator. The legacy `sp run --bead` Supervisor/worktree lifecycle remains reachable only as XTRM-93 compatibility while N4–N9 cut it over. Do not teach its Beads notes/auto-close/worktree semantics as native behavior. Full procedure: `/using-specialists`.

## Common gotchas (project-specific)

- `settled != published != closed`: no Specialist verdict or terminal state is Issue Closure.
- Review/test/security must use the same pinned Issue revision as the writer, not a later mutable tracker read.
- `--bead` / `bead_id` may be a compatibility alias; inspect the live backend before inferring Beads lifecycle.
- Native writer activation uses the coordinator workspace + writer lease; legacy `sp run --worktree` is not the native model.
- `sp merge` / `sp epic merge` remain legacy/broken surfaces; Git/Core owns integration decisions.
- Canonical role definitions are JSON under `config/specialists/*.specialist.json`.
- New/current role prompts must not introduce `bd create/update/close/show` as lifecycle doctrine.

## Commit messages ARE the changelog

`CHANGELOG.md` is generated from commits by git-cliff (`changelog/cliff.toml`). Write the
commit once; never hand-write a changelog entry for the same change.

| Prefix | Lands in |
|---|---|
| `feat:` | **Added** |
| `fix:` | **Fixed** |
| `perf:` | **Performance** |
| `revert:` | **Reverted** |
| `docs: chore: build: ci: test: refactor: style:` | **Project maintenance** |
| `checkpoint:` `merge:` `release:` `bump:` | *skipped — never in the changelog* |
| anything else | **Other changes** ← means "you used a prefix with no parser". Fix the message or add a parser. |

**The commit BODY is rendered into the changelog verbatim** (indented under the bullet), so
put the real rationale there — what broke, why, bead id, PR. That body is the changelog entry.
Keep the subject one line, imperative, no trailing period.

Release regenerates with `git-cliff --config changelog/cliff.toml --prepend CHANGELOG.md --unreleased`.
**Never** run git-cliff with `-o` / plain generate on this repo — it rebuilds from the git log and
drops every hand-written line (measured: 362 lines would be lost).

## Project-specific

- gzrx manifest system: see `docs/design/gzrx-tool-catalog.md` (canonical), `docs/design/gzrx-completion-critique.md` (gap analysis), bead `unitAI-qujxo` (completion epic).
- Specialists project guide / runtime architecture / key files: `docs/ARCHITECTURE.md`, `docs/cli-reference.md`, `docs/features.md`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **specialists** (16684 symbols, 39758 relationships, 813 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "master"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "master" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/specialists/context` | Codebase overview, check index freshness |
| `gitnexus://repo/specialists/clusters` | All functional areas |
| `gitnexus://repo/specialists/processes` | All execution flows |
| `gitnexus://repo/specialists/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
