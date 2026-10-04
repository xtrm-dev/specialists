# Registry and locations

Do not maintain a static role/model/permission table in this skill.

Use `specialist_list` (one compact line per role with a dispatchability verdict;
`name` for one full record, `detail: "full"` for everything). Operators diagnosing an
environment from a shell use `sp config show <name> --resolved` and `sp help`.

Package-canonical definitions and rules live in the Specialists package/source; global and
repo overlays may alter effective fields. The resolved config is therefore more useful
than opening one package JSON file when diagnosing a running environment.

For tracked-work discovery inside an agent session, use the typed Substrate service:
`substrate_issue_get <ref>` for contract/readiness/claim/attestation,
`substrate_issue_search <project>` for targeted discovery, and
`substrate_issue_resume <ref>` for the Resume Capsule. Do not shell out to `sb`
or parse CLI text to reconstruct authority. The `sb` CLI is an operator/debug surface;
`bd ready`/`bd show`/`bd prime` describe the retired Beads board;
use them only for migration/history work.)

Core/XTRM may vendor selected Specialist-owned **skills** for distribution. That vendored
snapshot is not the Specialist runtime definition source. Its pinned upstream commit and
destination are recorded by Core's Specialists source/ownership manifests.
