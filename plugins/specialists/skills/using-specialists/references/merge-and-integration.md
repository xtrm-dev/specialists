# Integration and publication

Integration is owned by the parent XTRM workflow/operator policy, not by a memorized
`sp merge` recipe.

Before integrating Specialist-owned changes:

1. verify the final Specialist result against the actual diff/tree;
2. confirm required test/review/security gates are satisfied;
3. confirm the target branch/base is current enough for integration;
4. use the repository's current merge/PR workflow;
5. re-run integration-level smoke/evidence when rebasing/merging changes the tested base;
6. clean Specialist worktrees/jobs only after their results/changes are durable and no
   fix/review continuation is needed.

Native activations write in the coordinator's worktree under the writer lease, so their
changes are already on the coordinator's branch: integrate them with the repository's
PR workflow. Stop each activation (`specialist_stop_activation`) once its result is durable.
Use current `xt`, `git`, and repository help/policy for exact commands. If an
installed merge helper is documented as broken/disabled by current runtime evidence, do
not use it merely because an older skill version did.

## Review publication: one formal review at the reviewed head

A review is a formal review, never a conversation comment: a comment carries no commit and
no review state, so nothing can prove which head was reviewed or tell an approval from a
remark.

```bash
gh pr review <pr> --repo <owner/repo> --comment|--approve|--request-changes --body-file <findings>
```

`PASS` → `--approve`, `PARTIAL` → `--comment`, `FAIL` → `--request-changes`. The reviewer
model writes findings only; the `gh` shim prepends `Review by <role> (<model>) at head
<sha12>`, sets `commit_id` to the reviewed head, refuses a head that moved since the review
was prepared, and refuses a review of the PR the same holder opened. Never author the header
yourself: attribution is not typed in. Verify the post by reading it back —
`gh pr view <pr> --repo <owner/repo> --json reviews` must show `<slug>[bot]` and the reviewed
`commit_id`. The pr-reviewer definition carries the exact body lint; run it before posting.
A `gh pr comment` is invisible to the merge guard.
