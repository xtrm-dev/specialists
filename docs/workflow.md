---
title: Substrate-First Specialists Workflow
scope: workflow
category: guide
version: 2.0.0
updated: 2026-09-20
description: Current tracked and compatibility workflow for Specialists.
source_of_truth_for:
  - "native activation workflow"
  - "legacy sp compatibility boundary"
domain:
  - workflow
  - substrate
---

# Substrate-First Specialists Workflow

> `sp` is an alias for `specialists`. For exact live commands, `sp help` wins.

## Authority

Current/native work is Substrate-first:

```text
ready pinned Substrate Issue revision
  -> native Specialist activation
  -> Journal/result evidence
  -> settlement / WorkReceipt / provenance
  -> verification
  -> explicit Issue Closure by the authorized owner
```

A Specialist does not acquire work authority from chat text, pane state, a Beads note, or
its own completion claim. `settled != published != closed`.

Use `using-xtrm` for system doctrine, `using-substrate` for durable work semantics, and
`using-specialists` for Specialist execution procedure.

## Native tracked work — primary

A ready Issue is the prompt. Dispatch through the current native surface exposed by the
runtime, for example `specialist_dispatch(issue_ref=...)`.

Native activation:

- validates and pins the Issue revision and contract hash;
- binds claim/participant/session/workspace identity through ExecutionBinding;
- runs in the admitted workspace;
- uses the workspace writer lease for mutating roles;
- records runtime/forensic evidence;
- publishes settlement/result/provenance through the Substrate boundary;
- never creates or closes durable work merely because the activation started or settled.

If the Issue is draft, stale, blocked, or materially ambiguous, repair/re-attest it through
planning before dispatch. Do not supplement an incomplete contract with hidden prompt prose.

## Findings and follow-up work

Progress, findings, decisions, blockers and results belong in the Journal/result evidence.

If a worker discovers independently durable work outside current SCOPE:

1. report the candidate and evidence;
2. do not widen the current Issue through chat;
3. coordinator/planning authority creates or revises a child/follow-up Issue through an
   available typed Substrate surface;
4. dispatch only after the new revision is ready.

## Review

Reviewer/seconder/test/security roles must evaluate the exact pinned Issue revision used by
the implementation activation. Do not re-query mutable tracker state and silently replace
the reviewed contract with a newer revision.

A PASS verdict is evidence, not Issue Closure.

## Legacy `sp run` workflow — compatibility during XTRM-93

The old Supervisor/Runner CLI remains reachable during the strangler migration. Its
Beads-backed behavior is compatibility, not current durable-work doctrine.

Examples such as:

```bash
sp run executor --bead <legacy-id-or-alias>
sp feed -f
sp result <job-id>
sp resume <job-id> "..."
sp stop <job-id>
```

may still exercise the legacy job/worktree/Beads lifecycle until N4/N9 removes that
backend. Do not infer from those flags that native activation is Beads-backed.

`--bead` / `bead_id` may also appear as compatibility aliases for an Issue ref on newer
frontends. Resolve the actual backend and authority from the live command/tool contract.

### Legacy-only semantics

These remain legacy concerns until their XTRM-93 node is complete:

- Supervisor job state and legacy keep-alive/waiting behavior;
- automatic Beads notes/closure;
- per-job worktree provisioning and stale-base flags;
- `--no-beads`, Beads dependency-context walks;
- legacy steer/stop/finalize semantics.

Do not copy these assumptions into new native roles, mandatory rules, or documentation.

## Observation

Prefer persisted evidence:

- native: `specialist_status`, persisted result/forensics, and the current Fleet/read model;
- CLI compatibility: `sp ps`, `sp feed`, `sp result`, `sp log`, `sp forensic`.

Runtime/UI state is not durable work authority.

## See also

- `config/skills/using-specialists/SKILL.md`
- `plugins/specialists/skills/supervising-activations/SKILL.md`
- `docs/native-activation.md`
- `docs/mcp-tools.md`
- `docs/authoring.md`
- `docs/migrations/xtrm-93/**`
