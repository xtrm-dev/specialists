# Specialist contract precondition

The generic work-contract doctrine belongs to XTRM `/using-xtrm` and `/planning`.
Specialists does not maintain a second contract schema.

Before dispatching a Specialist, verify the Issue is ready (attested) and contains at least:
`PROBLEM`, `SUCCESS`, `SCOPE`, `NON_GOALS`, `CONSTRAINTS`, `VALIDATION`, and `OUTPUT`.
Add role/scrutiny/security/telemetry/rollback details when the task requires them.

A draft or title-only Issue is not dispatchable. Repair it through `/planning`: create/update a new Issue revision through the typed Substrate service, complete readiness/attestation there, then re-read that pinned revision from the recipient's point of view. Do not `exec("sb …")` or parse CLI text from an agent.

Do not use `--prompt` or another private message to supply requirements that belong in the
durable contract. A fresh worker should be able to execute from the Issue (pinned revision) plus referenced
artifacts and current repository state.

## Ad hoc dispatch under a parent (XT-108)

An inline contract can name a parent: pass `parent_ref` (any locator the work boundary
resolves) alongside `contract`, and the created Issue becomes a child of that parent in
one atomic step. The parent must exist and must not be terminal
(done/cancelled/archived; deferred is accepted) — the check runs BEFORE anything is
created, so a bad parent refuses with the board unchanged. `parent_ref` is refused
with `issue_ref` (an existing Issue already has its place) and without `contract`
(nothing to parent).

- `kind` (task|bug|research|decision|followup, never epic) flavours the created Issue.
  Absent it defaults from the Specialist's `output_type` (research/analysis give
  research, everything else gives task). Refused with `issue_ref`, like `parent_ref`.
- The default title names the worker and the work (`<specialist>: <first PROBLEM line>`);
  an explicit `title` still wins.
- `epic_context_depth` works for an inline contract ONLY when `parent_ref` is given
  (a parentless auto-created Issue has no lineage); still dropped otherwise.
- Creation writes a journal `note` recording surface, specialist, requested_by,
  parent_ref, kind and title-source — the auto-created Issue carries its ad hoc
  provenance instead of sitting parentless and unexplained.