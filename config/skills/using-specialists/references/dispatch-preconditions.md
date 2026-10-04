# Dispatch preconditions

Before a dependent Specialist dispatch, verify the state the new worker will actually
receive:

- correct repository/worktree/branch;
- required prior commits/results present;
- no unresolved conflict or dirty state that changes the contract;
- Issue is attested/ready and the pinned revision still matches current code;
- no existing worker unexpectedly owns the same mutable surface;
- required tools/package/runtime are healthy enough to start.

Use `specialist_status` for live activations (`full: true` adds uncertain writer leases), plus `git`, `git worktree`,
and XTRM topology as needed. A writer lease left uncertain by a crash refuses the dispatch;
resolve it with `specialist_lease_reconcile` (operator CLI: `specialists lease list|reconcile`).
Do not dispatch from a stale base because the previous job “said it finished.”

If the next lane depends only on a durable result/report rather than source changes,
verify that result exists and is the intended final version before launching the consumer.