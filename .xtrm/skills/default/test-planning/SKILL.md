---
name: test-planning
description: "Plans and creates test, smoke/E2E, and telemetry-validation issues alongside implementation work using bd issue tracker. Activates at three points: (1) issue-board creation from a spec/plan, (2) specialist-chain test authoring after executor/debugger work clarifies what changed, and (3) implementation closure to close coverage gaps. Use proactively whenever implementation issues lack tests, logs/telemetry assertions, smoke/E2E validation, or concrete test-runner command contracts."
---

# Test Planning

This skill ensures every implementation issue has appropriate test coverage planned — not as an afterthought, but wired into the issue board from the start. It is not unit-test-only: it plans unit, contract, integration, smoke, E2E, live checks, and log/telemetry assertions needed for autonomous debugging. In orchestrator mode it does not directly edit code; it classifies what needs testing, picks the right strategy, and creates or updates bd issues that another specialist or human will implement. Inside a specialist chain, it may be used after implementation to understand what actually changed and produce a concrete test-writing/test-runner contract.

## When This Fires

### Trigger 1: Planning phase (issue board creation)

When breaking a spec or plan into bd issues — typically during epic decomposition or `bd create --parent` sequences — scan each implementation issue and create companion test issues.

### Trigger 2: Specialist-chain test authoring (after implementation/debugging)

When an executor or debugger has produced a diff and tests were not already written, run test-planning inside the chain before final review. The test-planning pass must:
- Read the implementation bead, actual changed files, and verification already performed.
- Identify the critical paths introduced or modified by the diff.
- Specify which tests should be written now versus deferred, with explicit follow-up beads for deferred P2+ risk.
- Include log/telemetry assertions when logs are the only way an automated run can debug itself.
- Hand a concrete contract to the test-writing executor and a separate command contract to `test-runner`.

### Trigger 3: Closure gate (implementation complete)

When an implementation issue is being closed (`bd close`), check whether:
- A test issue already exists for it (created in Trigger 1)
- The test issue needs updating based on what was actually built (scope may have shifted)
- Test coverage gaps appeared during implementation (new edge cases, API quirks discovered)

If a test issue exists, review and improve it. If none exists, create one before or alongside closure.

## Layer Detection

Read the issue title, description, and any code paths mentioned to classify which architectural layer the work touches. This determines the testing strategy.

### Core layer — pure domain logic
Code that transforms data, computes values, manages state, with no I/O. Examples:
- Config parsing/merging
- Data formatting (output renderers, serializers)
- Computation (implied rates from prices, spread calculations)
- State machines (session tracking, log rotation)
- Validators, parsers, transformers

**Signals**: "implement", "compute", "format", "parse", "validate", functions that take data and return data, no HTTP/DB/filesystem in the description.

### Boundary layer — I/O interfaces and service contracts
Code that crosses a system boundary: HTTP clients, API routes, database queries, file I/O, message queues. Examples:
- API client methods (async_client, REST wrappers)
- API route handlers
- Database query functions
- File readers/writers
- External service integrations

**Signals**: "endpoint", "API", "client", "route", "fetch", "query", URLs, ports, service names, request/response shapes mentioned.

### Shell layer — orchestration and wiring
Code that glues core + boundary together into user-facing features. Examples:
- CLI commands that call a client, transform data, then output
- Pipeline orchestrators
- Command handlers
- Workflow coordinators

**Signals**: "command", "CLI", "subcommand", "mercury <verb>", user-facing behavior described, combines multiple components.

### Operational / agentic layer — deploy, hooks, observability, autonomous workflows
Code or configuration that makes agents, hooks, CI/CD, deploy, monitoring, or runtime operations work. Examples:
- Specialist chains, test-runner/reviewer gates, orchestration policies
- Hooks, MCP servers, background jobs, worktree/session runners
- Deploy scripts, health checks, runbooks, telemetry emitters
- Prometheus/Grafana/OpenTelemetry integrations, logs/traces/metrics

**Signals**: "agent", "specialist", "hook", "MCP", "deploy", "devops", "health check", "log", "metric", "trace", "smoke", "E2E", "runbook", "observability".

## Testing Strategy Selection

### By layer

| Layer | Primary strategy | What to assert | Mock policy |
|---|---|---|---|
| Core | Unit + property tests | Input/output correctness, edge cases, invariants | No mocking needed — pure functions |
| Boundary | Contract tests (live preferred) | Response schemas, field presence/types, status codes, param behavior | Live > contract > mock (see preference order below) |
| Shell | Integration + smoke tests | Exit codes, output format validity, end-to-end wiring, error messages | Test the real thing via subprocess or function call |
| Operational / agentic | Smoke + E2E + telemetry assertions | Health-check result, deploy/rollback envelope, hook/agent chain behavior, logs/metrics emitted | Prefer real command/workflow in an isolated temp env; mock only dangerous external side effects |

### By situation (override layer default when applicable)

| Situation | Strategy | When to pick it |
|---|---|---|
| Interface unclear/evolving | TDD | Spec is vague, requirements shifting — tests define the contract |
| Contract known up front | Spec-first | API routes documented, response shapes defined — write schema assertions |
| Parsers/transforms/invariants | Property-based | The function should hold for any valid input, not just examples |
| Service/API boundaries | Contract testing | Testing the seam between systems — assert schemas, not implementations |
| Agent/workflow/deploy changes | Smoke + E2E | Verify the chain actually runs: command → side effect/artifact → log/metric → cleanup |
| Logging/observability changes | Telemetry assertions | Verify event names, fields, redaction, correlation IDs, and query/grep path |
| Legacy code being wrapped | Characterization tests | Capture current behavior before changing it |
| Simple CRUD paths | Example-based | Straightforward input→output, a few examples suffice |

### Live-first preference

When services are accessible, prefer this order:

1. **Live tests** — hit real services, assert real responses. No mocking. This catches actual bugs: wrong URLs, changed schemas, auth issues, network edge cases. Mark with `@pytest.mark.live`.
2. **Contract tests with recorded fixtures** — if live access is intermittent, record responses once and replay. Still validates schema, but won't catch drift.
3. **Mocked tests** — last resort, only when no service access exists or for pure unit logic that has no I/O.

The rationale: mocks encode your assumptions about the system. If your assumptions were correct, you wouldn't need tests. Live tests validate reality.

### Smoke and E2E are mandatory for integrated behavior

For shell, boundary, operational, agent, hook, deploy, MCP, and devops work, do not stop at lint/typecheck/unit tests. Plan at least one smoke check, and plan E2E/live-contract coverage for any P0/P1 or user-facing critical path.

A good smoke/E2E plan names:
- Exact command(s) `test-runner` should execute.
- Required setup/bootstrap and safe cleanup.
- Expected observable result: exit code, stdout/stderr, generated file, API response, job state, metric/log line, or health-check result.
- What failure class means: product regression vs pre-existing failure vs infrastructure.
- How logs/telemetry prove the path was exercised.

Static gates like `pyright`, `tsc`, `ruff`, ESLint, or schema validation are valuable, but they are not substitutes for smoke/E2E evidence. Treat them as build/static checks that feed reviewer evidence; the test gate must still exercise behavior.

### Logging and telemetry assertions

If a future agent would need logs to debug or self-check the feature, the test plan must require log/telemetry evidence. Specify:
- Emission points: start/end, decisions, retries, external calls, failures, fallbacks, cleanup.
- Format: repo-standard structured logs first; otherwise require fields such as `timestamp`, `level`, `component`, `event`, `bead/job/session/request id`, `action`, `outcome`, `duration_ms`, and redacted `error`.
- Location/query: log file, stdout/stderr, trace JSONL, metrics endpoint, Prometheus/Grafana label, specialist feed, CI artifact, or grep command.
- Redaction: no secrets/tokens/credentials/raw PII/full unredacted payloads.
- Assertion: the test or smoke script must fail if the required event/field is missing or malformed.

## Creating Test Issues

### Naming convention

Test issues are children of the same parent epic as the implementation issue. Name pattern:

```
Test: <what's being tested> — <strategy>
```

Examples:
- "Test: rates/candles/stir/curve commands — CLI integration + contract tests"
- "Test: config system — unit tests for load/save/override/env precedence"
- "Test: async_client URL routing — live contract tests against all services"

### Issue structure

When creating a test issue with `bd create`:

```
bd create "Test: <description>" \
  -t task -p <same or +1 from impl issue> \
  --parent <same parent epic> \
  -l testing,<layer>,<phase> \
  --deps "blocks:<next-phase-issue-id>" \
  -d "<structured description>"
```

The description should contain:

1. **What implementation it covers** — reference the impl issue ID(s)
2. **Layer classification** — which layer and why
3. **Strategy chosen** — which testing approach and why
4. **Test file structure** — where tests go in the project
5. **What to assert** — specific assertions, not vague "test that it works"
6. **Smoke/E2E commands** — exact commands and safe setup/cleanup when applicable
7. **Log/telemetry assertions** — required events, fields, locations, redaction, and query/grep evidence
8. **AC** — when is this test issue done

### Batching

Don't create one test issue per implementation issue — that's overhead. Batch by layer and phase:

- Group all core-layer issues from the same phase into one test issue
- Group all boundary-layer issues into one contract test issue
- Group all shell-layer issues into one integration test issue

Example: if a phase ships 4 CLI commands + 1 client change + 1 config change:
- 1 test issue for core (config unit tests)
- 1 test issue for boundary (client contract tests)
- 1 test issue for shell (CLI integration tests for all 4 commands)

### Gating

Test issues should gate the next phase of work. Use bd dependencies or document in the issue description:

```
This issue gates: .17 (analyze runner), .18 (spread), .19 (charts)
Do not start Phase 3 until these tests pass.
```

For specialist chains, make the gate explicit:
- `test-runner` receives the exact command list and classification rules.
- Reviewer receives test-runner output plus log/telemetry artifact evidence.
- `code-sanity` remains the Iron seconder for implementation quality; it is not the test gate.
- `obligations-scanner` remains the Iron obligations gate; it is not the test gate.
- Typecheck-only evidence is insufficient for shell/boundary/operational changes unless the bead is explicitly static-analysis-only.

## Closure Gate Behavior

When an implementation issue is closed, check:

1. **Does a test issue exist?** Run `bd children <parent>` and look for test issues that reference this impl issue.

2. **Is the test issue still accurate?** Implementation often diverges from plan. Compare what was built (read the commit, check the code) against what the test issue specifies. Common drift:
   - New subcommands added that aren't in the test plan
   - API response shape different from what was expected
   - Edge cases discovered during implementation
   - Dependencies changed (a service turned out to be local-only)

3. **Update if needed.** Use `bd update <test-issue-id>` or `bd comments add <test-issue-id>` to add new assertions, remove obsolete ones, or note discovered quirks.

4. **If no test issue exists**, create one. Classify the layer, pick the strategy, write the assertions. This is the safety net for work that was done without planning tests upfront.

## Examples

### Planning phase — epic decomposition

Given an epic with these children:
```
.10 Scaffold CLI project structure
.11 Implement logging system
.12 Implement config system
.13 Implement output formatting
.14 Implement async HTTP client
```

Create:
```
bd create "Test: P1 core — unit tests for config, log, session, output" \
  -t task -p 1 --parent <epic> -l testing,core,phase-1 \
  -d "Unit + property tests for pure domain logic...
  Covers: .11, .12, .13
  Strategy: unit tests (core layer, pure logic, no I/O)
  ..."

bd create "Test: P1 boundary — live contract tests for async client" \
  -t task -p 1 --parent <epic> -l testing,boundary,phase-1 \
  -d "Contract tests against live services...
  Covers: .14
  Strategy: contract tests, live-first (boundary layer, HTTP I/O)
  ..."
```

### Closure gate — implementation done, test issue exists

Agent closes `.15` (data commands: rates, candles, stir, curve). Finds existing test issue `.26`. Reads `.26` description, compares against what `.15` actually built:

- `.15` added `rates iorb` subcommand not in original test plan → update `.26` to include IORB assertion
- `.15` discovered STIR implied rates are client-side computation → add property test: `implied_rate == 100 - price` for any valid price
- Update `.26` with `bd update` or add a comment

### Closure gate — no test issue exists

Agent closes a feature issue that was done ad-hoc. No test issue found. Agent:
1. Reads the implementation to classify the layer
2. Picks strategy
3. Creates test issue as child of same parent
4. Documents what to assert based on the actual code

## Anti-Pattern Checklist

Run this checklist at both trigger points (planning and closure review). Flag any anti-patterns in the test issue description before closing.

### 1. Assertion-free tests
**Detect**: Test body calls functions/methods but has no `assert`, `expect`, or equivalent statement.
**Fix**: Add at least one meaningful assertion. If the goal is "doesn't throw", assert that explicitly — `with pytest.raises(...)` or `expect(() => fn()).not.toThrow()`.

### 2. Tautological assertions
**Detect**: The assertion can only fail if the test framework itself is broken. E.g. `assert result == result`, `expect(true).toBe(true)`, asserting a value against the same expression used to produce it.
**Fix**: Assert against a concrete expected value derived independently from the production code. If you can't state what the expected value is without running the code, the test has no falsifiable claim.

### 3. Context leakage / shared mutable state
**Detect**: Tests share module-level variables, database rows, file state, or global config without reset between runs. Symptoms: tests pass individually but fail in suite order.
**Fix**: Use fixtures with setup/teardown (`beforeEach`/`afterEach`, pytest fixtures with function scope). Every test starts from a clean slate.

### 4. Over-mocking internal collaborators
**Detect**: Mocks are patching classes or functions that live in the same module under test — not external services. The test validates that internal wiring was called, not that the observable outcome is correct.
**Fix**: Only mock at system boundaries (HTTP clients, file I/O, external services). Test internal collaborators by letting them run. If they're hard to instantiate, extract the pure logic and test that directly.

### 5. Tests that cannot fail under realistic regressions
**Detect**: Remove the core logic being tested and re-read the test — would it still pass? If yes, the test provides no protection. Common form: only testing the happy path of a function whose bug would only appear in error paths.
**Fix**: Add at least one negative-path or edge-case assertion that would catch the most likely regression. Consult the implementation for obvious failure modes.

## Priority Heuristics

Test issues inherit priority from their implementation issues with bounded adjustment. The table below gives the deterministic mapping.

| Implementation risk | Test issue priority | Examples |
|---|---|---|
| Security / auth / protocol compat | P0 (equal) | Auth token validation, schema migration safety, API contract |
| Regression-critical boundary path | P0–P1 (equal) | Client URL routing, CLI exit codes used by external tooling |
| High-business-impact core logic | P1 (equal or +0) | Pricing computations, session state transitions |
| Standard domain logic | P2 (+0 or +1) | Config merge, output formatters, parsers |
| Low-risk internals / non-critical adapters | P3 (+1) | Helper utilities, optional UI formatting |
| Polish / test debt cleanup | P4 | Improving existing test coverage, test naming |

**Inheritance rule**: start from the implementation issue's priority. Apply +1 if the test is covering a well-understood path with low regression risk. Never go lower than P2 for boundary or shell layer tests — integration tests are load-bearing.

**Equal priority examples**:
- Impl is P1 (auth endpoint) → test issue is P1 (auth contract test must ship with the feature)
- Impl is P0 (critical fix) → test issue is P0 (regression test must land in same PR)

**+1 priority examples**:
- Impl is P2 (output formatter) → test issue is P3 (unit tests are useful but not blocking)
- Impl is P3 (optional config key) → test issue is P4 (test debt, tackle in cleanup)

## Definition of Done Templates

Use these templates verbatim in test issue descriptions. Replace `<...>` placeholders.

### Core layer DoD

```
Layer: core
Strategy: <unit | property-based | example-based>
Covers: <impl issue IDs>

Assertions required:
- [ ] Positive path: <expected output for valid input>
- [ ] Negative path: <expected error/output for invalid input>
- [ ] Edge cases explicitly enumerated: <list: empty input, zero, max boundary, ...>
- [ ] Invariants/properties included: <e.g. "result is always sorted", "output length == input length">

Fixture policy:
- [ ] No shared mutable state between tests
- [ ] Deterministic fixtures (no random, no time.now() without injection)
- [ ] Each test constructs its own input independently

Done when: all assertions above are implemented and passing in CI.
```

### Boundary layer DoD

```
Layer: boundary
Strategy: <live-contract | recorded-fixture | mock (last resort)>
Covers: <impl issue IDs>

Assertions required:
- [ ] Schema/contract assertions: <field presence, types, required vs optional>
- [ ] Error codes and retry/fallback: <e.g. 404→empty list, 500→raises ServiceError>
- [ ] Drift-safe: assertions check field presence and types, not brittle internal structure
- [ ] Live-first policy documented: <live | recorded-fixture | mock — reason for choice>

Done when: contract assertions pass against live service (or recorded fixture if live unavailable).
Fallback documented in issue if live is not accessible.
```

### Shell layer DoD

```
Layer: shell
Strategy: integration + smoke (subprocess or function-level wiring test)
Covers: <impl issue IDs>

Assertions required:
- [ ] End-to-end observable outcomes: <what the user sees — output format, exit code>
- [ ] Failure-mode UX: <error messages, non-zero exit codes, stderr vs stdout>
- [ ] Cross-component wiring: <core + boundary are called and integrated correctly>
- [ ] At least one real-data scenario (not mocked) if service is accessible
- [ ] Smoke command named for test-runner: <exact command + expected output/artifact>

Done when: integration/smoke tests run against real components (not mocked internals) and cover
both success and at least one failure path.
```

### Operational / agentic layer DoD

```
Layer: operational/agentic
Strategy: smoke + E2E + telemetry assertions
Covers: <impl issue IDs>

Assertions required:
- [ ] Workflow smoke: <command/chain/hook/deploy path actually runs>
- [ ] E2E critical path: <trigger → action → observable result → cleanup>
- [ ] Failure-mode path: <bad config, missing service, non-zero exit, rollback, or blocked permission>
- [ ] Logs/telemetry: <required events + fields + redaction + where to query>
- [ ] Health/runbook evidence: <health-check command, dashboard/query, or artifact path>
- [ ] Test-runner command contract: <exact command(s), setup, cleanup, failure taxonomy>

Done when: test-runner or equivalent smoke harness produces pass/fail evidence, logs/telemetry
prove the path was exercised, and failures are classified as in-scope/pre-existing/infrastructure.
```

## Critical-Path Coverage

Do not frame test issues around coverage percentages. Frame them around critical paths and risk rationale.

Every test issue description must include a **critical path map** and a **debuggability map**:

```
Critical paths covered:
- <path 1 and risk rationale>
- <path 2 and risk rationale>

Known deferred paths (with follow-up refs):
- <path not covered yet> → follow-up: <bd issue ID or "to be created">

Debuggability evidence required:
- <log/metric/trace/event and how the test proves it exists>
```

**Why**: a 90% line-coverage number says nothing about whether the one path that processes payments is tested. A critical path map forces explicit reasoning about what matters and what was skipped.

**What counts as a critical path**:
- Any path that involves auth, money, data loss, or external contract compliance
- Any path exercised by the user-facing CLI commands described in the issue
- Any path explicitly mentioned in the implementation issue's acceptance criteria

**What to do with deferred paths**:
- Document them — don't silently skip
- Create a follow-up test issue if the deferred path is P2 or higher risk
- Reference the follow-up issue ID in the current test issue's description

## Advisory vs Enforcement Boundary

This skill is advisory. It recommends test strategy, creates test issues, and flags anti-patterns. It does not block code execution or enforce pass/fail decisions — that is the job of hooks and quality gates.

| Concern | Who owns it | How enforced |
|---|---|---|
| Test strategy selection (TDD vs contract vs unit vs smoke/E2E) | This skill | Recommendation + bd issue contract |
| Log/telemetry assertions | This skill | Required in planned test issue when needed for debugging/self-checking |
| Anti-pattern detection in test issues | This skill | Checklist in issue description |
| Priority assignment | This skill | Heuristics table above |
| DoD template in issue description | This skill | Template pasted into bd issue |
| CI test pass/fail | quality-gates hook / CI | PostToolUse or CI blocks on configured failures |
| Test command execution + failure classification | test-runner specialist | Runs requested commands and classifies failures; requires explicit smoke/E2E command contract |
| Static type/lint checks | quality gates / executor | Evidence only; not enough for behavioral smoke/E2E gate |
| Reviewer release decision | reviewer + Iron gates | Consumes test-runner, code-sanity, obligations, security, and telemetry evidence |
| Claiming work without test issue existing | Not enforced | Human judgment — skill creates test issue at closure if missing |

**Example — advisory boundary in practice**:

You are planning tests for `.14` (async HTTP client). This skill:
- Classifies as boundary layer ✓
- Recommends live-contract tests ✓
- Creates a test issue with DoD template ✓
- Flags if you try to describe tests that only mock the HTTP layer ✓ (anti-pattern 4)

It does NOT:
- Block `.14` from closing if the test issue isn't done
- Fail the build if the test issue is open
- Require approval before the implementation is merged

The test issue is a tracked commitment, not a gate. Gating is opt-in via `bd dep` dependencies you set up during planning.

## v1.1 Format Examples

### Example A — Planning phase, boundary + shell epic

Epic: "Implement gitnexus MCP sync in xtrm install"

Children: `.1` (MCP config writer), `.2` (sync-on-install integration), `.3` (CLI `xtrm mcp` command)

Classification:
- `.1` → boundary (writes to `.mcp.json`, file I/O)
- `.2` → shell (orchestrates install flow)
- `.3` → shell (CLI command)

Test issues created:

```
bd create "Test: MCP config writer — contract tests for .mcp.json output" \
  -t task -p 2 --parent <epic> \
  -d "Layer: boundary
Strategy: example-based (file I/O, no external service)
Covers: .1

Assertions required:
- [ ] Positive path: valid servers config produces correct .mcp.json structure
- [ ] Negative path: invalid server entry raises validation error
- [ ] Edge cases: empty servers list, duplicate server names, existing .mcp.json is merged not overwritten
- [ ] Drift-safe: assert on field presence (name, command, args), not internal object identity

Critical paths covered:
- gitnexus server entry written with correct stdio transport — risk: wrong transport breaks MCP
- existing user entries preserved during merge — risk: data loss

Known deferred paths:
- test with malformed existing .mcp.json → follow-up: to be created (P3)

Done when: all assertions pass, no shared state between tests."
```

```
bd create "Test: xtrm install MCP sync + xtrm mcp CLI — integration tests" \
  -t task -p 2 --parent <epic> \
  -d "Layer: shell
Strategy: integration (subprocess)
Covers: .2, .3

Assertions required:
- [ ] End-to-end: xtrm install writes correct .mcp.json in temp project dir
- [ ] CLI: xtrm mcp list outputs expected server names
- [ ] Failure-mode: xtrm mcp add with duplicate name exits non-zero with clear error
- [ ] Cross-component: install flow calls MCP writer with correct config

Critical paths covered:
- full install → .mcp.json present and readable by Claude Code — risk: MCP servers not available
- CLI add + list roundtrip — risk: user cannot inspect installed servers

Known deferred paths:
- test with no write permission on project dir → follow-up: to be created (P4)

Done when: integration tests run against real file system in temp dir, no mocked internals."
```

---

### Example B — Closure gate, core layer, implementation diverged

Closing `.22` (config merge logic). Existing test issue `.31` was written before implementation.

What `.22` actually built:
- Added precedence chain: env > file > defaults (original plan had only file > defaults)
- Added type coercion for boolean env vars ("true"/"false" → bool)
- Removed support for `.xtrm.yaml` (only `.xtrm/config.json` now)

Updated test issue `.31`:

```
bd update xtrm-31 --notes "Scope updated after .22 completed:
+ Add test: env var takes precedence over file config (new precedence chain)
+ Add test: 'true'/'false' env vars coerced to bool correctly
+ Add test: 'TRUE', '1', '0' edge cases for bool coercion
+ Remove test: .xtrm.yaml loading (format removed in .22)

Anti-pattern check:
- [ ] tautological: none detected
- [ ] over-mocking: env injection via monkeypatch only, no internal mocking
- [ ] shared state: each test resets env via fixture

Critical paths covered:
- env > file > defaults chain — risk: wrong precedence silently overrides user config
- bool coercion — risk: 'false' string treated as truthy in Python

Known deferred paths:
- test with missing HOME dir (pathlib resolution edge case) → follow-up: xtrm-4x (P4)"
```
