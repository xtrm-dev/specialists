# XTRM-93 reconciliation onto `20b888b4`

Status: complete. This records what the audit and the N0/N2 work look like after being re-based
onto current remote `master`, and every correction this pass forced.

## 1. Base and branch

| Item | Value |
|---|---|
| Previous base | `6553ef05` (= `472b1aef` + local `rx1bu`) |
| New base | **`20b888b4`** — `merge: native dispatch exposes enabled extension tools (unitAI-1pqtl.2)` |
| Merge base of the two | `472b1aef` |
| Integration branch | **`xt/akkh-recon`** |
| Commit count on new base | 16 (15 cherry-picked + N0.1), before the doc/test commits |

`6553ef05` was **dropped deliberately, not lost**. `git merge-base --is-ancestor 6553ef05 20b888b4`
returns false: the two bases diverged at `472b1aef`. Master carries its own rx1bu fix
(`34d2ba79`, re-landed as `57a2c758`), which supersedes the local `6553ef05`. Rebuilding on
`6553ef05` would have re-introduced a fix master already has in a different form.

**Conflict risk was structurally low:** master's 8 commits touch
`src/activation/{native-host,pi-sdk}.ts` and `dist/**` — **none** of the nine files N0/N2 changed.
The cherry-pick of all 15 non-dist commits completed with **zero conflicts**.

## 2. Generated-dist handling

Per instruction, the two dist commits (`64e922e6`, `93f2cd37`) were **not** cherry-picked.
They remain evidence for the old base only. `dist/` on this branch is rebuilt from the reconciled
tree, and the rebuild is verified by two independent byte-identical builds.

Why this matters: the base merge itself changed `dist/index.js`, `dist/lib.js` and the activation
declarations, so replaying an old bundle would have been wrong even without the source changes.

## 3. Commit map (old → new)

Every cherry-pick used `-x`, so the new commits carry `(cherry picked from commit …)` trailers and
provenance survives without depending on this table.

| Kind | Old | New |
|---|---|---|
| docs audit | `7b177ae5` | cherry-picked |
| docs | `bfdaa09f`, `2ece7e15`, `ebf0950a`, `2c1ad22a`, `c863218e`, `dc814315`, `5fcd0e62`, `24015ef6`, `33b64502` | cherry-picked |
| **N0 source** | `7aa05abb` | cherry-picked |
| **N2A source** | `77a76bf2`, `9766b5b7` | cherry-picked |
| **N2B source** | `4fbc4a30`, `6113a710` | cherry-picked |
| dist | `64e922e6`, `93f2cd37` | **skipped — evidence only** |

## 4. N0.1 — the neutral contract still depended on the legacy session implementation

N0 removed the native compile path's dependency on `supervisor.ts`, but
`src/specialist/status-contract.ts:8` still imported `SessionRunMetrics` from `../pi/session.js`.
So the *supposedly neutral* contract depended on the legacy RPC session module. That is a hidden
deletion dependency: `pi/session.ts` could never be retired while a neutral contract imported it
merely to obtain metric types. N0 was therefore **not** complete.

Fix (commit `54b4186a`):

- New `src/specialist/session-metrics-contract.ts` owns exactly `SessionTokenUsage`,
  `SessionRunMetrics`, `SessionMetricEvent`. It has **no imports at all** — fully standalone.
- `src/pi/session.ts` imports the three from it and **re-exports** them (line 75), so every existing
  importer keeps working unchanged.
- Repointed: `status-contract.ts` (the actual leak), `supervisor.ts:54` (type-only), and
  `runner.ts:11-13` — which was **mixed**, keeping `SessionKilledError`,
  `resolveExecutionExtensionSelection` and `resolveRuntimeToolContract` on `pi/session.js` because
  they are the runtime substrate.
- `PiSessionOptions` deliberately **stays** in `pi/session.ts`: it describes how to *run* a session,
  not the metric shape, and no neutral module needs it.

Verified: the three declarations are **byte-identical** to the text removed from `pi/session.ts`
(the diff is the added header comment plus one trailing blank line); and a parse of every import
statement in `src/` naming `pi/session.js` shows **all seven remaining importers are runtime-only**.
No file imports metric types from it any more.

Acceptance from the brief:

| Requirement | Result |
|---|---|
| native/shared type graph has no dependency on `supervisor.ts` | satisfied by N0 |
| … no dependency on `pi/session.ts` merely to obtain metric types | satisfied by N0.1 |
| legacy imports remain source-compatible through re-export | line 75 of `pi/session.ts` |
| `tsc` clean | exit 0 |
| telemetry/status serialized shape unchanged | declarations byte-identical; no runtime moved |

## 5. N2B — row-cap residual kept open (option B)

The N2B fixes stand: the retired `event_family='activation'` read was replaced by an identity prefix,
`order:'desc'` was restored, `job.status_changed` became payload-aware, failure names stopped mapping
to `active`, and window counts are labelled. **None of those bound the enumeration defect.**

`ps.ts:749` still passes a global `limit: 1000`, and that limit applies to raw event **rows**, not
activation ids. Measured on the real canonical shared DB:

| Measure | Value |
|---|---|
| distinct activations in the global `LIMIT 1000` window | **1** (`act:9aeabf76-262`, 1000 rows) |
| distinct `act:` ids with rows | **249** |
| rows in the newest 3 activations | 1591 + 765 + 2006 = **4362** |

`latest 1000 events != latest N activations`. The decisive evidence is that the **same command
returned 3 activations earlier in this session and 1 now** — the enumeration varies with row density,
not with the data, so an operator cannot distinguish a quiet system from a hidden one.

Decision: **option B** — the defect stays open as `unitAI-kmbb9` (P1), and `CAP-TEL-057..064` carries
it as a residual `NATIVE_GAP`. It is **not** recorded as parity.

## 6. Test-infrastructure defect (`unitAI-9n93`) — worse than reported

Reproduced on `20b888b4`. `bun run test:supervisor` printed
`No test files found, exiting with code 1`.

`tests/unit/specialist/supervisor.test.ts` was in vitest's **unconditional** exclude list and was
**not** a member of `quarantined[]`. In default mode exclude wins; under
`SPECIALISTS_TEST_QUARANTINED=1` the include set becomes `quarantined[]`, which did not contain it
either. **Both paths were blocked — no configuration reached the file.** The config comment described
a repair path that did not exist, and the test file's own header told readers to run a script that
could not work. 54 tests executed in no CI path.

Fixed (commit `c8943f02`): the file moved into `quarantined[]`, its exclusion became conditional, the
script now sets the env var it needs, and the false header was corrected. The four bun-only sqlite/db
files stay unconditionally excluded — and already have a working command, `bun run test:bun`
(**75 pass / 0 fail / 4 files**).

Default run selection is provably unchanged: with the env var unset, `include` is byte-identical and
the conditional re-adds the file to `exclude` exactly where the literal used to be.

Result after the fix:

```
bun run test:supervisor
  Test Files  1 failed (1)
  Tests  50 failed | 4 passed (54)
  Errors  1 error
  6.35s
```

That is the **point** of the commit, not a regression. The suite was not hidden-but-green; **50 of 54
tests fail**, and nothing could see it.

**The cause is not the worktree/FIFO issue the old comment blamed.** All 50 failures share one
mechanical cause:

```
Error: [vitest] No "spawn" export is defined on the "node:child_process" mock.
```

The file does `vi.mock('node:child_process', () => ({}))` to make the ESM namespace mutable for
`vi.spyOn`. Production code has since gained a `spawn` dependency (detached watchdog), so the empty
mock now breaks nearly every test. One-line class of remedy, recorded on `unitAI-9n93`.

**Consequence for the migration: the primary Supervisor suite currently provides no assurance.** N3+
must not cite "full suite green" as evidence. The observability suites are the usable ones, and only
through `bun run test:bun`.

## 7. Unchanged and re-verified

- N2A identity grammar, including exact attempt validation. Attempt lookup must never collapse
  `att:<activation>:N` onto attempt 1 or the latest.
- The stale `activation` family is not read; shared families are, newest-first.
