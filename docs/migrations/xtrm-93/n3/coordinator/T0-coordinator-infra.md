# T0 — Coordinator infrastructure evidence (unitAI-9n93, dist provenance, main-checkout contention)

Lane type: coordinator-run, not a swarm lane. All results reproduced by the coordinator.

## 1. `unitAI-9n93` — the legacy Supervisor oracle is broken, and the root cause is exact

**Tree:** `feature/xtrm-93-n0n2-recon` @ `e1a463b8` (the N0/N2 reconciliation branch, PR #374).
Note: an earlier attempt measured `master` @ `40d7cbb7`, where `tests/unit/specialist/supervisor.test.ts` is still **unconditionally** excluded by `vitest.config.ts:109`, so `bun run test:supervisor` printed
`No test files found, exiting with code 1`. That is the pre-fix state. The fix is present only on the reconciliation branch. Do not confuse the two.

**Command:** `bun run test:supervisor`
**Result:** `exit 1` · `Test Files 1 failed (1)` · **`Tests 50 failed | 4 passed (54)`** · `Errors 1 error` · 5.56 s

### Failure signature histogram (parsed, not eyeballed)

| count | signature |
|---|---|
| 46 | `No "spawn" export is defined on the "node:child_process" mock` |
| 2 | `No "spawnSync" export is defined on the "node:child_process" mock` |
| 1 | `expected null not to be null` — `supervisor.test.ts:197`, test "crashRecovery repairs db-backed running job when file output off" |
| 1 | `expected [Function] to throw error including 'backend exploded' but got '[vitest] No "spawn" export is defined…'` — the assertion is itself masked by the spawn failure |

So **48 of 50 are one mechanical cause**, one is a masked assertion on the same cause, and one (`crashRecovery`) is a separate observation that must be classified as real-defect or downstream-of-mock before the suite is trusted as an oracle.

### The mechanism, pinned

| side | file:line | fact |
|---|---|---|
| test harness | `tests/unit/specialist/supervisor.test.ts:22` | `vi.mock('node:child_process', () => ({}))` — an **empty** factory, used (per the comment at `:20`) to make the ESM namespace mutable so `vi.spyOn(childProcess, …)` can install shapes. |
| test spy sites | `tests/unit/specialist/supervisor.test.ts:179`, `:1314`, `:1341` | only 3 spy sites: one on `spawn`, two on `spawnSync`. 6 spy references total in the file. |
| production | `src/specialist/supervisor.ts:22` | `import { spawn, spawnSync, execFileSync } from 'node:child_process'` |
| production | `src/specialist/supervisor.ts:181,191,217,231,402,449,463,…` | `spawnSync(...)` call sites reached by ordinary test paths |

An empty factory means every non-spied member of the namespace is `undefined`. Tests that never install a `spawn` spy (the large majority) therefore fail **inside production code**, not in their own assertions. Tests that spy `spawnSync` but not `spawn` fail the other way.

**Disposition rule for the N3 repair:** fix the test double — populate the mock factory with the real module and override only what each test replaces, or move to `vi.spyOn` on a real namespace without an empty factory. **Do not mutate `src/specialist/supervisor.ts` to satisfy the double.** Production gained the `spawn` dependency for the detached watchdog; that is real behaviour, and the whole point of this node is that the oracle must observe the real backend.

**Why this matters for N3:** the legacy engine is the only differential comparison partner available before N4. While 50 of 54 tests fail, `bun run test:supervisor` provides no assurance, so no N3 claim of differential telemetry parity against the legacy path can cite it.

## 2. `dist/index.js` is host-dependent — measured, with the mechanism

For **byte-identical source**, a linked-worktree build reproduces itself deterministically but produces a different `dist/index.js` than the main checkout.

| host | blob of `dist/index.js` | top-level `node_modules` entries |
|---|---|---|
| main checkout `/home/dawid/dev/specialists` | `4eca22d4933a0254fb6677c41748712364b75e4c` | 192 |
| worktree `.xtrm/worktrees/specialists-xt-pi-akkh` | `bb67c91e3f75c7ebcb75af138493e6c37323703b` | 151 |

Evidence:
1. Rebuilding **in the source worktree** reproduced `bb67c91e` exactly — so that build is deterministic, not noise.
2. Building **in the main checkout** produced `4eca22d4`, **reproduced across two consecutive builds**.
3. `src/`, `tests/`, `package.json` and `vitest.config.ts` are provably identical between the two trees (`git diff` empty).
4. `git diff` of the two bundles shows the differing region is the reachable **zod** module graph. `dist/lib.js` is identical in both hosts (`55153f92`).
5. `node_modules/zod` is byte-identical between the two hosts (596 files, `diff -rq` clean) — so the cause is not a zod version. It is **resolution completeness**: the worktree resolves a smaller reachable dependency set.
6. A fresh `bun install` in a worktree again produced 151 top-level entries, so this is reproducible and not a stale-install artifact.
7. **The main checkout is authoritative**: a build there **at master** reproduces master's committed `dist/index.js` exactly (working tree clean after the build).

**Consequence for N3:** every node that changes `src/` must regenerate `dist/` **in the main checkout**. Worktree-generated `dist/index.js` is not the shipped artifact, even though it is deterministic, even though `tsc`/tests pass with it, and even though `dist/lib.js` from the same build *is* correct.

## 3. Main-checkout contention — operational fact, not a theory

The main checkout `/home/dawid/dev/specialists` was switched from the reconciliation branch to `master` and advanced to a **new commit `40d7cbb7`** (`feat(fleet): show the dispatch identity as <specialist>:<activation-id> in the fleet row`) by a different session, some time between the reconciliation push and the next coordinator command. `origin/master` is still `2118b5a3`, so `40d7cbb7` is unpushed local work owned by that session.

Consequences:
- A coordinator command run in the main checkout after that point measures **that session's tree**, not the coordinator's branch. That is exactly how the first `test:supervisor` reading was taken, and it reported the pre-fix harness. Recorded here so the bad reading is not mistaken for a regression.
- The reconciliation branch was never at risk: it was already pushed as `origin/feature/xtrm-93-n0n2-recon` = `e1a463b8`.
- Any N3 step that requires a main-checkout build must first **verify which branch the main checkout is on**, build, and then confirm the produced blob is the one committed. Do not assume the main checkout is on your branch.

**Coordinator response:** all further N3 work happens in a dedicated worktree (`.xtrm/worktrees/specialists-xt-pi-8158-recon`), and the main checkout is touched only for the `dist/index.js` build step, with the branch verified immediately before and after.

## 4. Reconciliation branch gate results (this branch, not master)

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `bun run test` (full suite) | **237 files passed / 11 skipped** (248); **3015 passed / 34 skipped** (3049); exit 0; 65.81 s |
| `bun run test:supervisor` | 50 failed / 4 passed (54) — the defect above, now visible |
| `dist` determinism (main checkout, two builds) | byte-identical |
| merge conflicts | none; no unmerged paths; `scripts/probe-live-extension-admission.ts` preserved |
