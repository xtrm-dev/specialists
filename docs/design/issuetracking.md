# Agent-Native Issue Tracking Contract Board

Status: deferred design. Do not implement now.

This document captures a future direction for the xt/sp ecosystem after the current specialists and xtrm backlogs settle, conversations layer lands, and preflight/long-run stress testing has exposed more orchestration friction.

The idea is likely a third package in the xt/sp ecosystem, not an immediate replacement of bd.

## Problem

Specialist job quality depends heavily on issue quality.

A vague issue produces vague prompts, weak specialist behavior, missing validation, and reviewer ambiguity. A precise issue behaves like an executable contract: it gives the orchestrator a clear chain, gives specialists tight scope, gives reviewers evidence targets, and makes failures diagnosable.

Current bd usage gives us useful IDs, status, dependency links, JSONL export, and CLI ergonomics, but bd is still primarily an issue tracker. The emerging need is a contract runtime for agent work.

## Core Thesis

Job quality is roughly:

```text
issue contract quality × orchestration discipline × specialist prompt invariants
```

The issue/prompt determines the job heavily. Therefore issue creation and update should not be a passive write. It should trigger contract validation before any specialist dispatch.

## Future System Shape

The future system should treat issues as executable job contracts.

```text
issue contract → validator → specialist chain → evidence graph → review → merge/close
```

Key properties:

- Contract-first: every dispatchable issue has enough information for an AFK specialist chain.
- Validator-gated: a small/simple model validates readiness and blocks dispatch if required fields are missing or vague.
- Issue-local prompt rules: issue-specific mandatory rules append into spawned specialist prompts at job start.
- State-aware: readiness, work state, review state, dependency state, and evidence state are distinct.
- Auditable: every validator verdict, override, dispatch, result, review, and close reason is persisted.
- Conversation-aware: later conversations/agent-mail layer can coordinate clarification, handoff, and cross-agent review around the same contract.

## Contract Readiness States

These are conceptual states, not a final schema.

Work state:

```text
draft
ready
claimed
running
waiting
reviewing
blocked
failed
done
archived
```

Contract readiness:

```text
invalid
partial
ready
waived
```

Review state:

```text
unreviewed
partial
pass
fail
```

Execution readiness:

```text
blocked_by_dependencies
blocked_by_contract
blocked_by_workspace
ready_to_dispatch
```

The important split: `ready` should not mean only “not blocked by deps”. It should mean the issue contract is specific enough to launch the right specialist chain.

## Dispatchable Issue Contract

A dispatchable issue should include, either explicitly or derivable from structured fields:

```text
PROBLEM
Current bad/missing behavior. Why work exists.

DESIRED OUTCOME
Observable behavior after completion.

SCOPE
Allowed files/modules/surfaces. Use likely scope when discovery is expected.

NON-GOALS
What must not be changed.

ACCEPTANCE CRITERIA
Concrete behavior checks, preferably user-visible or externally observable.

VALIDATION
Commands, tests, smoke path, or manual verification instructions.

CONTEXT
Relevant previous jobs, commits, issues, reports, decisions, known failures.

DEPENDENCIES
Blocking issues and why they block.

RISK
Auth/data/destructive/perf/migration/UI/security/config/etc.

SPECIALIST ROUTING
Suggested chain: explorer/debugger/executor/test-writer/test-runner/code-sanity/security-auditor/reviewer/etc.

ISSUE-LOCAL MANDATORY RULES
Extra prompt invariants appended to every job spawned from this issue.
```

## Contract Validator

On issue create/update, a small model should validate the contract and write a structured verdict.

Example output:

```json
{
  "contract_status": "not_ready",
  "dispatch_allowed": false,
  "blocking_gaps": [
    "Acceptance criteria are not observable",
    "Validation command missing",
    "Scope mixes two unrelated runtime surfaces"
  ],
  "suggested_rewrite": {
    "problem": "...",
    "scope": "...",
    "non_goals": "...",
    "validation": "..."
  },
  "recommended_chain": ["explorer", "executor", "test-writer", "test-runner", "reviewer"]
}
```

Dispatch should be refused when `dispatch_allowed=false` unless the orchestrator explicitly records an override reason.

```bash
sp run executor --issue X
# refuses: contract not ready

sp run executor --issue X --allow-unready --reason "emergency prod hotfix; validation is manual"
# allowed, but override is persisted and review confidence is reduced
```

## Issue-Local Mandatory Rules

Global and role mandatory rules help specialists, but issue-local rules can make each job much tighter.

Example:

```text
ISSUE_MANDATORY_RULES:
- Do not touch source files outside src/specialist/runner.ts and tests/unit/specialist.
- Preserve DB-first behavior; file fallback remains legacy-only.
- Reviewer must verify staged diff and branch-vs-base diff.
```

At specialist spawn time, these rules should append alongside package mandatory rules, after global and role rules, so the specialist starts with exact constraints.

## Orchestrator Guardrails

The orchestrator should behave like a workflow engine, not a heroic manual driver.

Expected loop:

1. Read issue contract.
2. Validate or refresh readiness verdict.
3. Improve contract before dispatch if validator blocks.
4. Decide specialist chain.
5. Launch first specialist.
6. Monitor job state and consume structured handoff.
7. Decide next edge in the chain.
8. Route missing tests to test-writer/test-runner.
9. Route risky diffs to code-sanity/security-auditor.
10. Route final diff to reviewer.
11. File friction bugs discovered during long runs.
12. Close only with evidence mapped to acceptance criteria.

Principles for a future `using-specialists-v4`:

```text
1. No specialist dispatch from vague contract.
2. Issue contract is source of truth; job prompt is generated from it.
3. Readiness is validated before dispatch.
4. Orchestrator must repair contract before launching.
5. Issue-local mandatory rules append into every job spawned from issue.
6. Every specialist output maps back to acceptance criteria.
7. Reviewer checks contract compliance, not vibes.
8. Long runs are expected; orchestration must tolerate context, process, and state friction.
9. Friction discovered during runs becomes first-class follow-up issues.
10. Merge/close requires evidence, not completion claims.
```

## Long Runs as Stress Harness

Long specialist/test runs are valuable. They are not just slow validation; they are chaos engineering for orchestration.

They expose:

- context rot
- missing progress semantics
- malformed handoff JSON
- weak issue contracts
- reviewer evidence gaps
- process leaks
- stuck waiting states
- bad retry/resume semantics
- tool/runtime drift
- model-specific failure modes

Future preflight may include soak mode:

```bash
sp preflight --soak
```

Possible checks:

- no orphan processes
- no unconsumed jobs
- no missing timeline events
- no invalid handoff JSON
- no unresolved issue states
- reviewer can reconstruct evidence
- contract validator blocks intentionally bad issues

## Relationship to bd

Do not replace bd now.

Near-term, bd remains the tracker and dependency store. The contract-board idea should influence orchestration docs, hooks, and specialist prompts first.

Long-term options:

1. Build a new package that wraps bd initially, adding validator state and contract metadata.
2. Migrate to a separate issue store only once contract runtime semantics are proven.
3. Keep export/import compatibility so current repositories can transition gradually.

## Near-Term Work Before the New Package

These ideas should land incrementally in current surfaces:

### `using-specialists` / `using-specialists-v4`

- Make issue contract quality a first-class orchestration step.
- Refuse vague/title-only beads before dispatch.
- Define required bead contract fields.
- Teach orchestrator to improve a bead before launching specialists.
- Teach chain selection from issue shape.
- Treat long-run friction as source of follow-up issues.

### `CLAUDE.md` / `AGENTS.md`

- Add issue-contract expectations for any agent creating bd issues.
- Tell agents not to dispatch specialists from vague issues.
- Require acceptance criteria, validation, non-goals, and scope for implementation beads.

### Hooks

Potential Claude orchestrator hook set:

- On `bd create`: inspect created issue and nudge if contract is weak.
- On `bd update`: re-check when description/scope/acceptance criteria changed.
- On `specialists run` / `sp run`: block or warn if bead is not contract-ready.
- On session stop: warn about in-progress issues without contract/readiness notes.

Initial hooks should be nudges, not hard blockers, until false positives are understood.

### Mandatory Rules

- Add compact issue-contract mandatory rule for orchestrators and planning specialists.
- Allow issue-local mandatory rules to flow into specialist prompt at job start.

## Open Questions

- Should readiness validation be deterministic schema checks first, then small-model review?
- Where should validator verdicts live while bd remains the tracker?
- How are issue-local mandatory rules represented in bd descriptions without becoming fragile prose?
- What override levels are acceptable, and who can waive readiness?
- How does conversations/agent-mail attach clarification threads to a contract?
- Should evidence be stored as timeline events, issue comments, or a separate evidence graph?
- How much of this belongs in specialists vs a third package?

## Non-Goals For Now

- Do not build the new issue system now.
- Do not replace bd now.
- Do not make all hooks blocking immediately.
- Do not require every small chore/doc edit to pass heavyweight validation.

The current goal is to preserve the design, then backport the most valuable constraints into existing specialist orchestration docs and prompts.
