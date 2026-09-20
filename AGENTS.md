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

1. Identify repository/branch and the bound/pinned Substrate Issue revision.
2. Read Issue readiness/claim and current Resume Capsule or Journal delta when resuming.
3. Check recent commits/PRs and live workers before planning.
4. Correct stale inherited summaries against live state.
5. Before editing, verify ownership: Issue → participant → workspace/branch → expected output.

## Execution

- Work only inside pinned SCOPE/NON_GOALS/CONSTRAINTS.
- If the contract is materially ambiguous, stop and repair/re-attest it through planning; do not patch authority with chat prose.
- Use Journal/checkpoints for continuity and durable findings.
- Use GitNexus before modifying shared symbols and re-check blast radius when evidence is UNKNOWN.
- Do not parallelize writers on the same mutable surface without explicit ordering/ownership.
- Before completion, verify current tree, real tests/gates, durable work state, and unresolved workers/replies.

## Handoff / closeout

A durable handoff includes Issue revision + claim state, changed artifacts, validation including failures/skips, active workers, blockers/decisions, and next action. Chat summary alone is not a handoff.

Specialist settlement/result is evidence. Issue Closure is explicit and separate.

## Repository-specific execution invariants

- Use GitNexus/code-intelligence before changing shared symbols; UNKNOWN is not evidence of low impact.
- Canonical Specialist definitions live under `config/specialists/*.specialist.json`; package-tier changes are direct source edits plus validation, not user override edits.
- Preserve the staged review chain for substantive production diffs: seconder, test-engineer/test-runner, security when sensitive, obligations scan, then reviewer.
- `sp merge` / `sp epic merge` remain legacy/broken integration surfaces; Git/Core owns integration.
- Native write-capable activations use the admitted workspace and writer lease. Legacy per-job worktree behavior must not be generalized into native doctrine.
<!-- xtrm:end -->

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

<!-- BEGIN BEADS INTEGRATION -->
## Legacy Beads compatibility

Beads (`bd`) is not the durable-work authority for current/native XTRM work. Use it only when an explicitly legacy Specialists/NodeSupervisor command or migration/history task requires it. Never dual-write work lifecycle into Beads and Substrate.

## Specialists (`sp` / `specialists`)

**At session start, run:**

```bash
sp help
```

`sp help` is canonical and always current. Do not rely on memorized command lists — the command surface changes between releases. `CLAUDE.md` contains project-specific specialist context but may drift; `sp help` never does.

Also explore subcommand surfaces before using them:

```bash
sp run --help
sp epic --help
sp edit --help
sp ps --help
```

**Key facts:**
- MCP exposes only `use_specialist` — use CLI (`sp run`, `sp feed`, `sp result`, `sp resume`, `sp steer`, `sp stop`, `sp edit`) for all orchestration (`sp steer` is the live mid-run control surface)
- Tracked work requires `--bead <id>`; `--prompt` is for untracked one-offs only
- Specialist configs live in `config/specialists/` (shipped) and `.specialists/user/` (overrides); use `sp edit` — not direct JSON edits — to change fields
- `sp edit --list-presets` shows available model presets for the current install
- `sp epic abandon <id> --reason "..."` closes stale epics; live members require `--force`. Listed in `sp epic --help`.
- `sp finalize <any-chain-job-id>` cascades — closes every waiting keep-alive member of a chain after reviewer PASS. Use this when auto-finalize misses (e.g. PASS delivered via `sp resume` instead of streaming output).
- Epic state is **derived live**, not driven by operator transitions. Only `merged` / `abandoned` are persisted-terminal. Persisted soft `failed` markers are recoverable: the next `sp epic merge` retries fresh.
