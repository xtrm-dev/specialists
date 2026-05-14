---
name: planning
description: >
  Structured planning skill for xtrm ecosystem projects. Creates a well-documented
  bd issue board from any task, feature, spec, or idea — with phases, dependencies,
  rich descriptions, and integrated test coverage via test-planning. MUST activate
  whenever the user wants to "plan", "design", "architect", "break down", "structure",
  "scope out", or "start" a feature or epic. Also activate when: the user describes
  a complex task without existing issues, pastes a spec or PRD to decompose, asks
  "how should I approach X" or "where do I start", mentions wanting to create
  implementation issues, or starts a new worktree session without a claimed issue.
  Activate even when the user says something like "I want to implement X" — if there's
  no existing issue board for X, planning comes first. Never skip planning when a
  task spans more than 2 files or 3 steps — that's when a structured board saves hours.
---

# Planning

Transform intent into a bd issue board: each issue self-contained, documented
enough for any agent or human to work independently.

## When This Fires

- `plan`, `design`, `architect`, `scope out`, `break down`, `how should I approach`
- Starting a new feature/epic from scratch
- Decomposing a spec, PRD, or long description into tasks
- Reviewing existing issues that lack documentation or structure
- Before `bd update --claim` — plan first, then claim

---

## Workflow

```
Phase 1  Clarify intent          → understand what, why, constraints
Phase 2  Explore codebase        → GitNexus + Serena, read-only
Phase 3  Structure the plan      → phases, deps, CoT reasoning
Phase 4  Create bd issues        → epic + tasks, rich descriptions
Phase 5  test-planning           → companion test issues per layer
Phase 6  Handoff                 → claim first issue, ready to build
```

---

## Phase 1 — Clarify Intent

Before touching any code, nail down:

<clarification_checklist>
  <item>What is being built? (feature, fix, refactor, migration)</item>
  <item>Why — what problem does it solve?</item>
  <item>Constraints (must not break X, must use pattern Y, deadline)</item>
  <item>Known unknowns — what needs investigation?</item>
  <item>Priority (P0 critical → P4 backlog)</item>
</clarification_checklist>

If the request is under 8 words or the scope is unclear, ask **one** clarifying question before exploring. Don't ask two.

---

## Phase 2 — Explore Codebase (Read-Only)

Use GitNexus and Serena to understand the landscape. No file edits.

### GitNexus-first protocol (mandatory when available)

```bash
# 1) Find relevant execution flows by concept
gitnexus_query({query: "<concept related to task>"})

# 2) Get full caller/callee/process context for likely symbols
gitnexus_context({name: "<affected symbol>"})

# 3) Assess blast radius before locking the implementation plan
gitnexus_impact({target: "<symbol to change>", direction: "upstream"})
```

### Refactor planning checks (when rename/extract/move is in scope)

```bash
# Preview safe multi-file rename plan first
gitnexus_rename({symbol_name: "<old>", new_name: "<new>", dry_run: true})

# Confirm context before extraction/split plans
gitnexus_context({name: "<symbol to extract/split>"})
gitnexus_impact({target: "<symbol to extract/split>", direction: "upstream"})
```

### Serena symbol-level inspection (targeted reads)

```bash
# Map a file without reading all of it
get_symbols_overview("path/to/relevant/file.ts")

# Read just the relevant function
find_symbol("SymbolName", include_body=true)
```

### Fallback when GitNexus MCP tools are unavailable

If MCP GitNexus tools are unavailable, use the GitNexus CLI first, then Serena symbol exploration if needed.

```bash
# Verify index freshness / repository indexing
npx gitnexus status
npx gitnexus list

# Concept and architecture exploration
npx gitnexus query "<concept or symptom>" --limit 5
npx gitnexus context "<symbolName>"

# Blast radius before committing to a plan
npx gitnexus impact "<symbolName>" --direction upstream --depth 3

# If index is stale
npx gitnexus analyze
```

Notes:
- In this environment, `detect_changes` and `rename` are available via MCP tools, not GitNexus CLI subcommands.
- If both MCP and CLI are unavailable, fall back to Serena search + symbols and state this explicitly in your plan output.

```bash
search_for_pattern("<concept or symbol>")
get_symbols_overview("path/to/relevant/file.ts")
find_symbol("<candidate symbol>", include_body=true)
find_referencing_symbols("<symbol>", "path/to/file.ts")
```

**Capture from exploration:**
- Which files/symbols will be affected
- Which execution flows/processes are involved (from `gitnexus_query`/`gitnexus_context`)
- What existing patterns to follow (naming, structure, error handling)
- Any d=1 dependents that require updates when you change a symbol
- Risk level from impact analysis: if CRITICAL or HIGH → warn user before proceeding
- If GitNexus fallback path was used, explicitly call it out in the handoff

---

## Phase 3 — Structure the Plan

Think through the plan before writing any bd commands. Use structured CoT:

<thinking>
1. What are the distinct units of work? (group by: what can change together without breaking other things)
2. What phases make sense?
   - P0: Scaffold (types, interfaces, file structure) — others depend on this
   - P1: Core (pure logic, no I/O) — depends on scaffold
   - P2: Boundary/Integration (HTTP, DB, CLI wiring) — depends on core
   - P3: Tests — companion issues, see Phase 5
3. What are the dependencies? (what must be done before X can start?)
4. What can run in parallel? (independent tasks → no deps between them)
5. What are the risks? (complex areas, unclear spec, risky refactors)
6. What is the blast-radius summary from GitNexus? (direct callers, affected processes, risk level)
</thinking>

<plan>
  <phase name="P0: Scaffold" issues="N">
    Setup that unblocks all other work
  </phase>
  <phase name="P1: Core" issues="N">
    Pure logic, data transforms, parsers
  </phase>
  <phase name="P2: Integration" issues="N">
    CLI wiring, API clients, I/O
  </phase>
</plan>

**Sizing guidance:**
- Prefer tasks completable in one session (1-4 hours of focused work)
- If a task has 5+ unrelated deliverables → split it
- If two tasks always ship together → merge them

---

## Phase 4 — Create bd Issues

### Determine epic scope

If the work fits under an **existing open epic** (`bd ready` to check), create tasks
under it with `--parent=<existing-epic-id>` and skip creating a new epic.

If this is genuinely new work with no parent, create the epic first.

### Bead contract format (aligned with `using-specialists-v3`)

Planner-created beads use the same 7-section contract that `using-specialists-v3` SKILL.md requires for orchestrator-written beads. Downstream executor / debugger / reviewer / code-sanity / security-auditor specialists read the bead via `bd show <id>` and expect this exact shape. Any drift between this template and the using-specialists-v3 contract creates partial contracts and weakens downstream specialist output.

The seven sections — `PROBLEM / SUCCESS / SCOPE / NON_GOALS / CONSTRAINTS / VALIDATION / OUTPUT` — are mandatory for every task and every epic. Optional auxiliary sections (`REFERENCES`, `APPROACH NOTES`) may follow at the bottom.

### Create the epic (new work only)

```bash
bd create \
  --title="<Feature name — concise verb phrase>" \
  --description="$(cat <<'EOF'
## PROBLEM

<2-3 sentences: what user/project problem this epic exists to solve. Why now.>

## SUCCESS

<End-state across all child beads. Observable, testable, in prose.>

## SCOPE

<Area of project affected. Name files, modules, packages, or bounded surfaces. Avoid generic paths like "src/". Cross-cutting epics may list multiple bounded surfaces.>

## NON_GOALS

- <Explicit boundary 1>
- <What this epic does NOT include even though tangentially related>

## CONSTRAINTS

- <Sequencing rules across children>
- <API / wire-format / migration compatibility requirements>
- <Branch / merge / release-gate rules>

## VALIDATION

- [ ] <Observable criterion 1>
- [ ] <Observable criterion 2>
- [ ] <Test suite green / drift checks clean / smoke pass>

## OUTPUT

<What the orchestrator reports back at epic close. Usually: a summary referencing each child's handoff + the integration evidence + residual risks.>

## REFERENCES

<Optional: links to specs, related issues, existing code paths, prior session reports.>
EOF
)" \
  --type=epic \
  --priority=<0-4>
```

### Create child task issues

```bash
bd create \
  --title="<Action phrase — what gets built>" \
  --description="$(cat <<'EOF'
## PROBLEM

<Why this task exists. What does it enable. Anchor to the epic's PROBLEM and name the specific gap this task closes.>

## SUCCESS

<Observable acceptance criteria in prose. The bar for "done" before VALIDATION checkboxes.>

## SCOPE

<Files, symbols, modules this task MAY touch. Be explicit — file:line or symbol-list when possible. Cross-cutting tasks list every surface; otherwise narrow. Forbidden boundary ("do NOT touch") goes in NON_GOALS or CONSTRAINTS.>

## NON_GOALS

- <Related improvement explicitly excluded from this task>
- <Surface that looks adjacent but is out of scope>

## CONSTRAINTS

- <Hard rule: API compatibility, error-text backward-compat, migration safety>
- <Style / pattern: follow existing convention in <file>>
- <Do-not-touch boundary outside SCOPE>

## VALIDATION

- [ ] <Lint / typecheck / unit test for this surface>
- [ ] <Regression test for the specific failure mode being fixed>
- [ ] <Integration / smoke check if applicable>

## OUTPUT

<What the executing specialist hands back: changed files list, verification evidence (command output / test pass summary), residual risks. This is what `bd show <id>` will surface to reviewer at gate.>

## APPROACH NOTES

<Optional: relevant code paths (file:line), patterns to follow, discovered risks from Phase 2 exploration. Advisory only — not a contract.>
EOF
)" \
  --type=task \
  --priority=<same or +1 from epic> \
  --parent=<epic-id>
```

### Wire dependencies

```bash
# B depends on A (A blocks B)
bd dep add <B-id> <A-id>

# Non-blocking relationship
bd dep relate <issue-a> <issue-b>
```

### Issue description quality bar (7-section contract)

Every task and epic description must fill all seven mandatory sections:

1. **PROBLEM** — why this exists, what user/project problem it solves
2. **SUCCESS** — observable acceptance criteria in prose
3. **SCOPE** — files / symbols / surfaces this work may touch (no generic "src/")
4. **NON_GOALS** — related improvements explicitly excluded
5. **CONSTRAINTS** — hard rules (API compat, style, do-not-touch boundaries)
6. **VALIDATION** — checkbox list of proof-of-done
7. **OUTPUT** — what the executing specialist hands back

If you cannot fill all seven, the scope is still unclear — go back to Phase 1.

**Why this matters**: the bead description is the only contract the executor / debugger / reviewer / code-sanity / security-auditor specialist sees via `bd show <id>`. The `using-specialists-v3` SKILL.md in the specialists project teaches the human orchestrator to write 7-section contracts; the planner must produce the same so the contract surface is uniform across human-orchestrated and planner-orchestrated chains. If this template drifts from `using-specialists-v3`, downstream specialists work against weaker contracts and produce noisier output. Any change to either skill must be mirrored in the other.

---

## Phase 5 — Test Planning Integration

After the implementation issues are created, invoke **test-planning**:

```
/test-planning
```

test-planning will:
1. Classify each implementation issue by layer (core / boundary / shell)
2. Pick the right testing strategy per layer
3. Create companion test issues batched by layer and phase
4. Gate next-phase issues on test completion

**When to call it:**
- Always after creating an epic with 3+ implementation tasks
- When closing an implementation issue (test-planning checks for gaps)
- When you realize tests weren't planned upfront

**Layer signals to include in your issue descriptions** (helps test-planning classify correctly):
- Core layer: "transforms", "computes", "parses", "validates", no HTTP/DB/filesystem
- Boundary layer: "API", "endpoint", "client", "query", "fetch", URLs, ports
- Shell layer: "CLI command", "subcommand", "orchestrates", "wires together"

---

## Phase 6 — Handoff

Present the board and transition to implementation.

Include a short **Architecture & Impact Summary** in your handoff message:
- Key execution flows/processes involved
- Top d=1 dependents to watch
- Highest observed risk (LOW/MEDIUM/HIGH/CRITICAL)
- Whether GitNexus-first or fallback exploration was used

```bash
# Show the full board
bd show <epic-id>

# Claim the first implementation issue
bd update <first-task-id> --claim
```

Then begin work on the first task. The planning phase is complete.

---

## Examples

### Example 1 — New CLI command

<example>
  <scenario>User: "add a `xtrm audit` command that checks for stale hooks"</scenario>

  <exploration>
    gitnexus_query({query: "hook wiring audit clean"})
    → finds: cleanOrphanedHookEntries, pruneStaleWrappers in clean.ts
    gitnexus_impact({target: "cleanOrphanedHookEntries", direction: "upstream"})
    → 2 callers, LOW risk
  </exploration>

  <plan>
    Phase 1: Add audit command skeleton (new file, register in index.ts)
    Phase 2: Implement hook validation logic (read config/hooks.json, compare installed)
    Phase 3: Add --fix flag to auto-remediate drift
    Phase 4: Tests — CLI integration test (shell layer)
  </plan>

  <bd_commands>
    bd create --title="xtrm audit: detect and report stale hook wiring" --type=epic
    bd create --title="Scaffold xtrm audit command" --description="Context: ..." --type=task
    bd create --title="Implement hook validation — compare config/hooks.json to settings.json" ...
    bd create --title="Add --fix flag for auto-remediation" ...
    bd dep add <wiring-id> <scaffold-id>    # wiring depends on scaffold
    bd dep add <fix-id> <wiring-id>         # fix depends on wiring
  </bd_commands>
</example>

### Example 2 — Bug fix with investigation

<example>
  <scenario>User: "bd close doesn't commit my changes"</scenario>

  <exploration>
    gitnexus_query({query: "bd close commit workflow"})
    → finds: beads-claim-sync.mjs, close event handler
    find_symbol("main", include_body=true)
    → discovers: bd close sets closed-this-session KV only; no git commit
  </exploration>

  <thinking>
    bd close does NOT auto-commit (removed in xtrm-wr0o).
    Correct workflow: bd close <id>, then git add + git commit separately, then xt end.
    No issue needed — this is expected behavior.
  </thinking>

  <bd_command>
    # No issue needed — explain the correct workflow to the user:
    # 1. bd close <id> --reason="..."   ← closes issue
    # 2. git add . && git commit -m "..." ← commit changes manually
    # 3. xt end                           ← push, PR, merge, worktree cleanup
  </bd_command>
</example>

### Example 3 — Greenfield feature from spec

<example>
  <scenario>User provides a 3-paragraph spec for a new xtrm status command</scenario>

  <approach>
    Phase 0: Define TypeScript interfaces (StatusReport, HealthCheck)
    Phase 1: Implement each health check function (hooks, settings, bd, mcp)
    Phase 2: Implement CLI command, output formatting, --json flag
    Phase 3: Tests — unit for each check fn (core), integration for CLI (shell)

    Create epic first, then 4 implementation tasks, then call /test-planning.
  </approach>
</example>

---

## Self-Check Before Finishing

Before presenting the plan to the user:

- [ ] Every issue has context / what / AC / notes
- [ ] Dependencies are correct (A blocks B when B needs A's output)
- [ ] No task is more than "one session" of work (split if needed)
- [ ] GitNexus evidence captured (query/context/impact) or fallback path explicitly stated
- [ ] If refactor scope exists, rename/extract safety checks were included in plan
- [ ] test-planning was invoked (or scheduled as next step)
- [ ] First implementation issue is ready to claim

If any issue description is empty or just restates the title — it's not ready.
The test of a good issue: could another agent pick it up cold and succeed?
