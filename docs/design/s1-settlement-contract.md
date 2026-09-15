# S1 settlement publication — cross-repo contract note (XTRM-252.8)

Consumer: `xtrm-dev/specialists` worktree `xt/s1-xtrm252` (S1).
Producer: `@jaggerxtrm/substrate`, pinned at commit `a77d094`
(`fix(substrate): drain every entrypoint write before exit (XTRM-335)`),
which contains the X1 `ExecutionContext` envelope (`XTRM-252.6`, commit
`ec63fdf`). Structural consumption only: this repository keeps no static
dependency on the producer package. `openWorkItemBoundary` dynamic-imports
the producer modules at runtime from `XTRM_SUBSTRATE_DIR`; every other path
programs against the structural ports in
`src/activation/workitem-store.ts`. The producer validates all of the below
fail-closed on write.

## Exact producer surface consumed

1. `src/domain/execution-context.ts` — shape + bounds mirrored structurally in
   `src/activation/settlement-publication.ts` (`SettlementExecutionContext`,
   `SETTLEMENT_CONTEXT_VERSION = 1`, R4 env keys `XTRM_SESSION_ID` /
   `XTRM_SESSION_NAME`):
   `version`, `actor.{type,id,name}`, `participantId`, `xtrmSessionId`,
   `xtrmSessionName`, `host.{type,sessionId}`, `runId`, `chainRunId`,
   `coordinator.{participantId,sessionId}`, `specialist.{name,activationId,
   attemptId,agentSessionId}`, `workspace.{repositoryKey,repoPath,worktree,
   branch,baseCommit,headCommit}`, `timestamp`.
2. `src/domain/journal.ts` — closed `ResultPayload` field set mirrored as
   `BoundedResult` with the same bounds (`summary`/`attempted`/`outcome` ≤
   4000 chars; array fields ≤ 100 items × ≤ 1000 chars; `resultVersion: 1`):
   `summary`, `attempted`, `outcome`, `completed`, `validation`, `findings`,
   `artifactRefs`, `receiptRefs`, `provenanceRefs`. Journal kind `result`
   requires a payload; no other kind carries one.
3. `src/service/journal-service.ts` — `JournalService.appendEntry(issueId,
   { kind: 'result', result, executionContext, refs, participantId,
   activationId, sessionId })` via the `JournalServicePort` (wired in
   `openWorkItemBoundary`; `SubstrateIssueStore.addJournal` cannot carry a
   result payload and is not used for publication).
4. `src/service/provenance-service.ts` —
   `ProvenanceService.allocateReceipt(bindingId)` (issue/revision/hash copied
   from the binding row host-side, never from model output) and
   `ProvenanceService.attachArtifact(receiptId, kind, value)` with kind
   `artifact` for the runtime result ref, via `ProvenanceServicePort`.
   Commits are never attached here (`bindCommit` is out of scope; the
   zero-commit path publishes identically).
5. `src/workitems/dispatch-gate.ts` + `src/domain/execution-binding.ts` —
   the `ExecutionBinding` row (`id`, `issueId`, `issueRevision`,
   `contractHash`, `baseCommit`) pinned at activation start; S1 reads it,
   never re-derives it. The coordinator-leg rule (parent participant preserved
   only when it differs from the holder) is mirrored, not forked.
6. `src/service/issue-service.ts` — `resolveProject` remains producer-side.
   S1 never derives Project naming (ADR §20); the repository leg publishes
   only host-observed paths (`repoPath`, `worktree`) plus the binding's
   `baseCommit`. `branch` and `repositoryKey` stay absent until a host-known
   source exists (§98: unknown stays absent, never invented).

## Fields published per completed settlement

- Runtime result storage (`SettlementRecord`): full raw output, validation,
  activation/attempt/specialist/issue-ref/revision/hash/binding ids, plus the
  `receiptId` / `journalEntryId` / `artifactRef` links once resolved.
- Journal `result` entry: bounded payload above with
  `artifactRefs: [<runtime ref>]`, `receiptRefs: [<receipt id>]`,
  `provenanceRefs: [<binding id>, <receipt id>]`, `refs: [{kind:'artifact'},
  {kind:'receipt'}]`, the X1 envelope, and flat `participantId` /
  `activationId` / `sessionId` projections.
- `WorkReceipt` over the live `ExecutionBinding` + one `artifact` binding to
  the runtime ref. Failed attempts are stored only — never published.

## Explicitly out of scope (producer-owned)

Closure persistence (C1): S1 publishes the closure-linkable `outcome` plus
result/receipt refs (ADR §§41, 96) but never writes closure rows. Provenance
queries/traces (P1): S1 writes rows the producer trace reads; it implements
no query surface. Issue persistence and Project identity stay producer-side.
