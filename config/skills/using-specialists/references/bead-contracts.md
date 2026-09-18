# Specialist contract precondition

The generic work-contract doctrine belongs to XTRM `/using-xtrm` and `/planning`.
Specialists does not maintain a second contract schema.

Before dispatching a Specialist, verify the Issue is ready (attested) and contains at least:
`PROBLEM`, `SUCCESS`, `SCOPE`, `NON_GOALS`, `CONSTRAINTS`, `VALIDATION`, and `OUTPUT`.
Add role/scrutiny/security/telemetry/rollback details when the task requires them.

A draft or title-only Issue is not dispatchable. Attest/promote it through the XTRM
planning workflow (`sb issue attest`), then re-read the final Issue from the recipient's point of view.

Do not use `--prompt` or another private message to supply requirements that belong in the
durable contract. A fresh worker should be able to execute from the Issue (pinned revision) plus referenced
artifacts and current repository state.