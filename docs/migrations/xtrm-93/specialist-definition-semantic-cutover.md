# XTRM-93 — Specialist Definition Semantic Cutover

Status: implementation lane in progress on `fix/xtrm-93-specialist-semantic-cutover`.

## Authority

This lane follows the current XTRM doctrine:

- **Substrate owns durable work.**
- A **pinned ready Issue revision** is the executable contract.
- The **Journal** records continuity, progress, findings, decisions and results; it does not rewrite Issue authority.
- Specialist **settlement/result/WorkReceipt/provenance are evidence**.
- **Issue Closure is explicit durable authority** and is not implied by activation settlement, PASS, commit or push.
- Messages coordinate. They do not silently change SCOPE/SUCCESS/NON_GOALS/CONSTRAINTS/VALIDATION/OUTPUT/SCRUTINY.
- Git remains code/integration truth.

Canonical doctrine inputs:
- xtrm-dev/core `using-xtrm`
- xtrm-dev/xtrm `packages/substrate/skills/using-substrate/SKILL.md`
- this repo `config/skills/using-specialists/SKILL.md`

## Disposition classes

| Class | Meaning | Action in this lane |
|---|---|---|
| CURRENT_WRONG_AUTHORITY | Agent-facing text teaches Beads/Supervisor lifecycle as current authority | Fix now |
| CURRENT_SUBSTRATE | Already consistent with Issue/Journal/settlement/Closure | Keep |
| LEGACY_COMPATIBILITY | Real legacy `sp`/Supervisor/NodeSupervisor behavior still reachable | Keep, label explicitly legacy |
| COMPATIBILITY_DATA | Schema/config field retained only because old backend still consumes it | Keep until N8/N9; do not teach it |
| HISTORICAL | Reports/archive/migration evidence | Preserve |
| DEAD_ZERO_CONSUMER | Proven unused after cutover | N8/N10 deletion lane, not this semantic pass |

## Immediate semantic changes

1. `core-session-boundary` now names the pinned Substrate Issue revision as authority.
2. `git-workflow-safe` no longer equates commit/settlement with Closure.
3. `executor-delivery` uses Issue SCOPE, Journal/result evidence, and coordinator-owned follow-up creation.
4. `issue-ref-verbatim` replaces `bead-id-verbatim` in canonical role definitions.
5. `bead-id-verbatim` remains only as an explicitly legacy compatibility rule.
6. The global `workflow-quick-rules` Beads injection is retired from prompt compilation.
7. Planner/reviewer/seconder/executor/debugger/test/security/docs/service-sync/coordinator definitions are migrated to pinned-Issue semantics.
8. Default markdown output uses `## Work`, not `## Beads`.

## Compatibility fields deliberately retained

The following are **not** removed here:

- `specialist.beads_integration`
- `specialist.beads_write_notes`
- legacy `inputBeadId` / `--bead` adapter surfaces
- Beads-backed Supervisor/Runner lifecycle
- NodeSupervisor `create-bead` command

Reason: XTRM-93 still keeps the legacy backend reachable until N8/N9. Removing fields before the consumer is unreachable would break the strangler contract. These fields must be documented as legacy-only and deleted only after zero-consumer proof.

## Native/current role contract

Every canonical role must satisfy:

```text
pinned Issue revision
  -> role-bounded execution
  -> findings/progress in Journal/result evidence
  -> settlement / WorkReceipt / provenance
  -> coordinator verifies
  -> explicit Closure by authorized owner
```

Role-specific rules:

- **executor/debugger/test roles:** never widen Issue SCOPE through chat; report follow-up candidates instead of creating tracker work ad hoc.
- **reviewer/seconder:** review the exact pinned revision used by the writer; never re-query mutable tracker state to reconstruct requirements.
- **planner:** may author durable contracts only through an actually available typed Substrate surface; otherwise returns complete proposed Issue contracts for the coordinator to persist.
- **research/explorer/read-only:** results are evidence; no task closure authority.
- **coordinators:** may route work and decisions but do not derive authority from panes/messages/runtime status.
- **specialists-creator:** must reject new native/current definitions that teach `bd show/update/close/create` as work lifecycle.

## Deferred/legacy surfaces

- `node-coordinator`: NodeSupervisor is an explicit legacy compatibility surface until N7. Its existing `sp node create-bead` command is not mechanically renamed to a nonexistent Substrate command.
- Beads-backed `sp run` docs/flags remain compatibility documentation until N4/N9, but must be labeled as such.
- schema/config removal remains N8/N10 work.

## Anti-regression requirement

Canonical current surfaces must not newly introduce Beads lifecycle authority. Tests should fail when current mandatory rules or current role prompts contain unqualified `bd create`, `bd update`, `bd close`, or `bd show` instructions outside an explicitly declared legacy-compatibility surface.
