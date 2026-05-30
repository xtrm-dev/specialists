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
Phase 4  Create bd issues        → epic + tasks with logs + validation contracts
Phase 5  test-planning           → companion test, smoke, and E2E issues per layer
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
6. What logs/telemetry are required so agents and humans can debug the work later?
7. What smoke/E2E checks prove the integrated behavior works, not just the unit seam?
8. What is the blast-radius summary from GitNexus? (direct callers, affected processes, risk level)
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

### Mandatory observability + validation planning

Every implementation plan must include a logging/telemetry contract and an integration validation contract. Do this during planning, not as a reviewer afterthought.

**Logging / telemetry contract (write into `CONSTRAINTS`, `VALIDATION`, or `OUTPUT`):**
- What events must be logged or emitted, and at which boundaries: start/end, decision points, external calls, retries, failures, fallbacks, cleanup.
- Required format: follow the repo's existing structured log format first; otherwise require consistent fields such as `timestamp`, `level`, `component`, `event`, `bead/job/session/request id`, `action`, `outcome`, `duration_ms`, and redacted error context.
- Where the evidence is visible: log file, stdout/stderr, trace JSONL, metrics endpoint, Prometheus/Grafana label, specialist/job feed, or CI artifact.
- What must never be logged: secrets, tokens, credentials, raw PII, or full unredacted payloads.
- How an automated run can self-check it: a grep/query/assertion command or expected artifact path.

**Smoke / E2E contract (write into `VALIDATION`):**
- Unit/type checks are not enough for user-facing, shell, boundary, deploy, agent, hook, MCP, or workflow changes.
- Include at least one smoke check that exercises the integrated path end-to-end enough to catch wiring failures.
- Include E2E or live-contract checks for critical paths when the system boundary is available. If not available, document the fallback and create a follow-up test bead.
- Name the specialist gate that will run it (`test-runner` for suites/check interpretation; reviewer consumes the evidence). Do not treat `pyright`, `tsc`, or lint alone as the test gate.

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
- <Epic-level logging/telemetry convention and artifact/query location expected from children>

## VALIDATION

- [ ] <Observable criterion 1>
- [ ] <Observable criterion 2>
- [ ] <Test suite green / drift checks clean / smoke pass>
- [ ] <Smoke/E2E evidence covers the critical integrated path>
- [ ] <Required logs/telemetry emitted in the planned format and location>

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
- <Logging/telemetry contract: events, fields/format, emission points, redaction rules, and artifact/query path>

## VALIDATION

- [ ] <Lint / typecheck / unit test for this surface>
- [ ] <Regression test for the specific failure mode being fixed>
- [ ] <Smoke check that exercises the integrated user/agent/workflow path>
- [ ] <E2E or live-contract check for critical boundary paths, or documented fallback + follow-up bead>
- [ ] <Log/telemetry evidence is emitted in the required format and can be found by the named command/query>

## OUTPUT

<What the executing specialist hands back: changed files list, verification evidence (command output / smoke/E2E/test summary), log/telemetry artifact paths or sample lines, residual risks. This is what `bd show <id>` will surface to reviewer at gate.>

## APPROACH NOTES

<Optional: relevant code paths (file:line), patterns to follow, discovered risks from Phase 2 exploration. Advisory only — not a contract.>
EOF
)" \
  --type=task \
  --priority=<same or +1 from epic> \
  --parent=<epic-id>
```

### Wire dependencies and relationships

Use the right edge type when creating the board. `blocks` is only for hard
must-happen-before sequencing; overusing it makes `bd ready` untrustworthy and
hides review/test/follow-up meaning.

```bash
# B depends on A; A blocks B. Use only when B cannot start until A is done.
bd dep add <B-id> <A-id> --type blocks

# Epic ownership. Prefer --parent at create time when possible.
bd create --parent <epic-id> --title "Implement parser" --type task --priority 2
bd dep add <child-id> <epic-id> --type parent-child

# Follow-up discovered while working/reviewing another bead. Not a blocker.
bd dep add <follow-up-id> <source-id> --type discovered-from

# Reviewer/test/sanity/security bead verifies implementation. Not a blocker.
bd dep add <verification-id> <impl-id> --type validates

# Failure symptom points to root cause.
bd dep add <failing-test-id> <root-cause-id> --type caused-by

# Replacement work supersedes obsolete or wrongly scoped work.
bd supersede <old-id> --with <new-id>
bd dep add <new-id> <old-id> --type supersedes

# Non-blocking context or overlap.
bd dep relate <issue-a> <issue-b>
bd dep add <local-id> <external-or-upstream-id> --type tracks

# Temporary precondition that expires when a named event/condition lands.
bd dep add <chain-id> <precondition-id> --type until
```

Relationship cheat-sheet for planner-created boards:

| Type | Use when |
|---|---|
| `blocks` | Real sequencing gate: dependent work cannot begin until prerequisite closes |
| `parent-child` | Epic owns child tasks/chains; prefer `bd create --parent <epic>` |
| `validates` | Test, reviewer, code-sanity, or security bead proves an implementation |
| `discovered-from` | New follow-up was found while handling another bead |
| `caused-by` | Failure/symptom bead points at a root-cause bead |
| `supersedes` | New bead replaces older/wrong/abandoned work; prefer `bd supersede` |
| `tracks` | Local issue mirrors external/upstream work without owning or blocking it |
| `relates-to` / `related` | Soft context/overlap with no scheduling effect; prefer `bd dep relate` |
| `until` | Temporary precondition that matters only until a stated event/condition lands |

Planning-specific patterns:

- Companion test/reviewer/sanity/security issues should usually use `validates`,
  not `blocks`. Gate execution order in prose or with explicit acceptance criteria
  if a test truly must land first.
- Follow-up issues spawned by exploration or review should use `discovered-from`,
  not `blocks`.
- Duplicate or obsolete scopes should be collapsed with `bd duplicate` or
  `bd supersede` before planning parallel work.
- After writing edges, run `bd dep cycles` and fix accidental cycles before
  handing the board off.

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
1. Classify each implementation issue by layer (core / boundary / shell / operational)
2. Pick the right testing strategy per layer, including smoke/E2E and live-contract checks
3. Require log/telemetry assertions where debugging or autonomous self-checking depends on them
4. Create companion test issues batched by layer and phase
5. Gate next-phase issues on test completion when the risk warrants it

**When to call it:**
- Always after creating an epic with 3+ implementation tasks
- When creating any agent/workflow/devops/deploy/hook/MCP task that needs smoke/E2E evidence
- Inside a specialist chain after implementation when the executor/debugger discovered what actually changed and tests now need to be written or corrected
- When closing an implementation issue (test-planning checks for gaps)
- When you realize tests weren't planned upfront

**Layer signals to include in your issue descriptions** (helps test-planning classify correctly):
- Core layer: "transforms", "computes", "parses", "validates", no HTTP/DB/filesystem
- Boundary layer: "API", "endpoint", "client", "query", "fetch", URLs, ports
- Shell layer: "CLI command", "subcommand", "orchestrates", "wires together"
- Operational layer: "deploy", "hook", "agent chain", "devops", "telemetry", "metrics", "logs", "runbook", "health check"

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
    bd dep add <wiring-id> <scaffold-id> --type blocks    # wiring depends on scaffold
    bd dep add <fix-id> <wiring-id> --type blocks         # fix depends on wiring
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
- [ ] Relationships are typed correctly (`blocks` only for hard sequencing; `validates`/`discovered-from`/`caused-by`/`supersedes` used where appropriate)
- [ ] No task is more than "one session" of work (split if needed)
- [ ] GitNexus evidence captured (query/context/impact) or fallback path explicitly stated
- [ ] If refactor scope exists, rename/extract safety checks were included in plan
- [ ] test-planning was invoked (or scheduled as next step), including smoke/E2E and log/telemetry requirements
- [ ] First implementation issue is ready to claim

If any issue description is empty or just restates the title — it's not ready.
The test of a good issue: could another agent pick it up cold and succeed?
