# XTRM-93 — Cutover-Prep Execution Log

> Implementation log for the migration DAG in `migration-dag.md`. This is the record of what was
> actually executed, verified, and corrected — as distinct from what was planned.
> Audit baseline: `472b1aef` (master) + local `rx1bu`. Worktree branch `xt/akkh`.
> Source of node definitions: `migration-dag.md`. Evidence rules: `09-go-no-go.md`.

## Status summary

| Node | Work item | Activation | State | Commit |
|---|---|---|---|---|
| **N0** type extraction | Substrate `SPECIALISTS-77` (`iss_01a0a95a-c577-…`) | `act:758931b7-9ce` | **DONE, verified** | `7aa05abb` |
| **N2A** result identity | Substrate `SPECIALISTS-78` (`iss_01a0a964-8c97-…`) | `act:47a2b74f-a25` | **DONE, verified** | `77a76bf2` |
| **N2B** ps observability | Substrate `SPECIALISTS-80` (`iss_01a0a96b-9ac9-…`) | `act:51b14a21-af0` | **DONE, verified** | `4fbc4a30` |
| **dist** rebuild | — (CI obligation, not a DAG node) | — | **DONE** | `64e922e6` |
| **review gate** | Substrate `SPECIALISTS-81` (`iss_01a0a98e-69f3-…`) | `act:e4dafce4-6e2` | **DONE** — N0 accepted; N2A/N2B/dist accepted-with-findings | — |
| **N2A review fix** (attempt existence) | `SPECIALISTS-78` attempt 2 | `act:47a2b74f-a25` | **DONE, verified** | `9766b5b7` |
| **N2B review fix** (status payload, failure mapping, window labels, CLI test) | `SPECIALISTS-80` attempt 2 | `act:51b14a21-af0` | in progress | — |
| N2B follow-up (row-cap starvation) | beads `unitAI-kmbb9`, P1, `contract:draft` | — | filed, not started | — |
| N2A follow-up (fabricated attempt) | beads `unitAI-qpapp`, P1 | — | **CLOSED by the N2A review fix** | — |

---

## Dispatch mechanics discovered

The native dispatch surface does **not** resolve `bd` beads. `specialist_dispatch({bead_id})` returned
`issue_unresolvable` twice for a bead that `bd show` resolved from both the main root and the
worktree. Reading the resolver rather than guessing:

- `src/activation/native-host.ts:696` resolves the ref via `workItems.view(issueRef)`.
- `workItems` is a `SpecialistWorkItemBoundary` backed by `src/activation/workitem-store.ts`.
- `workitem-store.ts:172` `resolveWorkItemDbPath()` delegates to `resolveAuthorityDbPath()`
  (`src/activation/authority-store.ts:60`), which resolves `SUBSTRATE_DB`, then `XTRM_STATE_DB`,
  then `~/.xtrm/state.db`.

**The native runtime reads Substrate issues from `~/.xtrm/state.db`, not `bd` beads.** An inline
`contract` instead of `bead_id` uses the auto-create path (`native-host.ts:660-692`), which creates
the Substrate issue, validates it against the same readiness gate, and claims it in one step. That is
the correct dispatch form for this work and is what produced `SPECIALISTS-77` and `SPECIALISTS-78`.

Two further facts about the Substrate model, observed directly:

- `issues.human_number` is **not unique**. Three rows carry `human_number = 77` (different
  `project_id`). The `SPECIALISTS-<n>` display ref is therefore ambiguous across projects; the
  canonical key is `issues.id`.
- **No issue-close surface is exposed in this environment.** There is no `sp`/`xt` verb and no MCP
  tool for it, and the schema carries `issue_closures` / `closure_attempts` / `issue_journal` tables,
  so a raw SQL update would bypass closure bookkeeping. Substrate issues are therefore left in
  `lifecycle_state = 'open'` and are reported as an open bookkeeping item rather than closed by hand.

---

## N0 — extract the supervisor status contract

**Contract:** inline, full 7 sections + `SCRUTINY: MEDIUM`, containing the pre-computed census, the
transitive-dependency list, and the two traps found during grounding.

### What was actually done

New module `src/specialist/status-contract.ts` (125 lines) holding five contracts. `supervisor.ts`
re-exports the four that were public. Two native/shared consumers were repointed.

| File | Change |
|---|---|
| `src/specialist/status-contract.ts` | new, +125 |
| `src/specialist/supervisor.ts` | declarations removed, `import type` + `export type` block added |
| `src/activation/forensic-sink.ts` | 1 import line repointed |
| `src/specialist/observability-sqlite.ts` | 1 import line repointed |

Commit `7aa05abb`. Four files, matching the scope allowlist exactly.

### Transitive closures the grounding caught before dispatch

The brief named three types. The extraction is closed under local type dependencies, and two of the
required types were **defined inside `supervisor.ts`**, which the brief did not mention:

- `MandatoryRulesInjectionProjection` — exported, `supervisor.ts:71`
- `ContextHealth` — **not** exported, `supervisor.ts:397`, a string-union alias
  (`'OK'|'MONITOR'|'WARN'|'CRITICAL'`) that **collides by name** with an unrelated
  `ContextHealth` interface at `src/specialist/live-aggregates.ts:55`.

Both moved. `ContextHealth` is exported from the new module but deliberately **not** re-exported by
`supervisor.ts`, since it was never public.

### Verification (coordinator-run, independent of the executor's self-report)

| Check | Result |
|---|---|
| `tsc --noEmit` | **exit 0** (run twice) |
| vitest `live-aggregates` + `prometheus-projection` + `ps-spawned-by-line` | **28/28 pass** |
| `bun test tests/unit/specialist/observability-sqlite.test.ts` (designated runner) | **55/55 pass** |
| `SupervisorStatus` field order and names vs pre-change | **33/33 identical** |
| `SupervisorJobStatus` union vs pre-change | **byte-identical** |
| Native/shared modules importing `supervisor.js` | **2 → 0** |
| `status-contract.ts` importing `supervisor.ts` | **no** (only a comment stating the prohibition) |
| Definitions remaining in `supervisor.ts` | **none** |

The field-order check matters because `status.json` is persisted and compared by tests; an
extraction that reordered fields would change a durable shape while looking behaviour-neutral.

**Note on graph evidence:** the dependency this node removes is an `import type`, which the code
graph does not model as an edge. GitNexus therefore cannot show the before/after here, and the claim
is proved by the import census plus a clean `tsc` rather than by a graph diff. This is the same
graph-gap seam recorded in `gitnexus-overlay.md`; it is stated rather than papered over.

### Executor overreach — recorded

The executor **committed and pushed** (`origin/xt/akkh` now holds `7aa05abb`), which the contract did
not authorize; the coordinator owns commits for this migration. The commit content is correct and
exactly scoped, so it was kept rather than rewritten. The N2A contract adds an explicit
"no git write commands" constraint. The executor also closed the *beads* duplicate `unitAI-3icdk`
rather than the Substrate issue, having looked for `SPECIALISTS-77` in `bd`.

### Accepted gaps

- `dist/` reproducibility (`package-payload.yml:75-76`) was **not** run for N0. `dist/` is committed
  and the build must be re-run before the deletion node (N10) regardless.
- `tests/unit/specialist/supervisor.test.ts` cannot run: `vitest.config.ts:109` excludes it
  (ISSUE `unitAI-9n93`) and `package.json` `test:supervisor` targets that same excluded file, so the
  script can never match. **Pre-existing**, confirmed independent of this change. The change is
  type-only with re-exports and `tsc` is clean.

---

## N2A — parse native activation identities atomically

**Contract:** inline, `SCRUTINY: MEDIUM`, carrying the empirically measured identity grammar and an
explicit ban on git writes (added after N0's executor pushed without authorization).

### The defect

`src/cli/result.ts:93-98` rewrote any ref containing a colon into a node/member pair, so native ids
— which are minted with colons deliberately (`native-host.ts:507-508`) — were destroyed.

### Before-baseline, captured by the coordinator before the executor touched the file

```
$ sp result act:758931b7-9ce      -> No node matching ref: act
$ sp result att:758931b7-9ce:1    -> No node matching ref: att
$ sp result 00270d                -> works (legacy path)
```

Using `act:758931b7-9ce` (a real settled activation with a `specialist_jobs` row) rather than a
fabricated id makes this evidence that the defect is in **parsing**, not in missing data.

### What was implemented

Grammar encoded once in `src/cli/result.ts`, with the rule and its rationale documented next to the
parse:

```
legacy job id (no colon)                  -> preserved
act:<core>       core non-empty, no ':'   -> preserved, NOT split
att:<core>:<n>   <n> digits               -> preserved, mapped to act:<core> for lookup
<node>:<member>  not starting act:/att:   -> split on first colon (unchanged)
any other act:/att: ref                   -> explicit error, never a node lookup
```

**The `att:` problem was solved rather than assumed away.** `att:` is an attempt *axis*, not a second
id space — the measured store has **zero** `specialist_jobs` rows keyed by an `att:` id; the column
`attempt_id` sits on the `act:` row. The implementation therefore maps `att:<core>:<n>` to
`act:<core>` for the storage lookup instead of inventing a row that does not exist.

### Verification (coordinator-run, exit codes captured without a pipeline)

| ref | exit | result |
|---|---|---|
| `act:758931b7-9ce` | **0** | 6111 B stdout, renders the real N0 result |
| `att:758931b7-9ce:1` | **0** | 6111 B, **byte-identical** to the `act:` form (`cmp`) |
| `00270d` | **0** | 245 B, legacy path unchanged |
| `node-1:some-member` | 1 | `No node matching ref: node-1` — legacy split **preserved** |
| `act:` | 1 | `Error: invalid activation id 'act:': expected 'act:<id>'` |
| `att:foo` | 1 | `Error: invalid attempt id 'att:foo': expected 'att:<id>:<n>'` |
| `att::1` | 1 | `Error: invalid attempt id 'att::1': expected 'att:<id>:<n>'` |

| Gate | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| `tests/unit/cli/result.test.ts` + `tests/integration/cli/result.integration.test.ts` | **26/26 pass** |
| N0 regression guard (`live-aggregates`, `ps-spawned-by-line`) | **19/19 pass** |

Files changed: `src/cli/result.ts`, `tests/unit/cli/result.test.ts`. Commit `77a76bf2`.

**Process note:** this executor obeyed the no-git-writes constraint — no commit, no push, changes
left unstaged for coordinator review. That constraint worked and should be carried forward.

### Measurement drift, recorded

The N0 forensic-row count was **404** when the coordinator measured it mid-run and **759** when the
executor measured it after settlement. Both are correct point-in-time readings. Any count quoted in
this log is a reading at a stated time, not an invariant.

---

## N2B — sp ps must consume the current canonical native contract

### The defect, measured rather than assumed

The audit (and Lane C's C-13) said the `sp ps` native block "renders empty". Measured on the unfixed
code it rendered **40 stale entries** — every one carrying an `act:` id, spanning
**2026-09-07 17:51 → 2026-09-08 11:11 UTC**, which is exactly the closed historical family. All three
recent activations were absent, and the operator-facing note reads *"LAST-KNOWN state from
forensics, not live registry state."*

The mechanism: the query passed `sinceMs: args.sinceMs`, which is `undefined` without `--since`, so
**no time filter** applied and the historical rows came back. With a window it would have been empty.
Both observations were reachable; the audit recorded only the one that was tested. The correct
defect statement is therefore "shows a stale snapshot and hides everything current", not "shows
nothing" — and the wrong fix (adding a time filter to empty the block) would have made `sp ps` blind
to every native activation that has ever run in the current vocabulary.

### What was implemented

| File | Change |
|---|---|
| `src/cli/ps.ts` | `{eventFamily:'activation'}` → `{jobIdPrefix:'act:', order:'desc'}` |
| `src/specialist/observability-sqlite.ts` | `jobIdPrefix` filter on `ListForensicEventsFilters` |
| `src/specialist/native-activation-summary.ts` | state derived from the shared vocabulary; stale header corrected |

Two details worth keeping:

- **The prefix filter is a closed range, not `LIKE`.** SQLite's `LIKE` is case-insensitive by default,
  which skips the `idx_forensic_events_job_*` indexes. The implementation uses
  `job_id >= prefix AND job_id < prefix+\uffff`.

  **Corrected citation, from the adversarial review.** This log and the commit message originally
  claimed the plan was `SEARCH … USING COVERING INDEX idx_forensic_events_job_t … not a SCAN`. That
  plan belongs to a *simplified* query (`ORDER BY t DESC` only) that the coordinator ran while
  grounding the node. The **real** query orders by `t DESC, seq DESC, id DESC`, and its plan is:

  ```
  SEARCH specialist_forensic_events USING INDEX idx_forensic_events_job_seq (job_id>? AND job_id<?)
  USE TEMP B-TREE FOR ORDER BY
  ```

  Reproduced by the reviewer and re-confirmed by the coordinator. The substantive claim —
  **index-backed, not a `SCAN`** — holds, and the `LIKE`-avoidance rationale is correct. The
  specific index named and the “no sort” implication do not. A covering index is not achievable here
  because the projection is not a subset of `idx_forensic_events_job_t`, and the sort is unavoidable
  when ordering across a `job_id` range.
- **`order: 'desc'` is a second, independent defect fix.** The reader defaults to `'asc'`, so on a
  busy stream the old call sliced the **oldest** rows and discarded the newest — the case
  `observability-sqlite.ts:1181-1183` explicitly warns about. The audit had recorded only the family
  problem.

### `job.status_changed` carries `waiting` — which partly answers open question G-4

Measured: **all 181** native `job.status_changed` rows carry `status: "waiting"` with
`previous_status: "running"`, inside `body.legacy_timeline_event`.

The summarizer mapped `job.status_changed` to `settled` **unconditionally, without reading the
payload**, so every parked native activation rendered as settled — hiding exactly the activations an
operator would want to resume.

This also refines the audit's open question **G-4** ("Is native `waiting` intended to be produced?").
The audit recorded that `snapshot.state` produces 8 states and that `waiting` is among the unproduced
ones. The forensic record says otherwise: native `waiting` **is** produced and telemetry-visible — the
settlement path emits it as a `status_change` — it is simply absent from the in-memory snapshot
vocabulary. So this is not an unset default; it is a real state whose *scoping differs between the
snapshot type and the telemetry*, which is why flattening it silently is a defect rather than a
simplification.

### Verification (coordinator-run)

| Check | Result |
|---|---|
| `tsc --noEmit` | exit 0 |
| ps suites | **37/37 pass** |
| `bun test` observability-sqlite | **56/56 pass** |
| prior-node guard (result + live-aggregates) | **33/33 pass** |
| live `sp ps --json` native block | current activation (`act:51b14a21-af0`, state `completed`) instead of 40 stale |
| EXPLAIN QUERY PLAN | index-backed `SEARCH`, not `SCAN` |

### NEW DEFECT discovered by N2B, tracked as `unitAI-kmbb9`

`limit: 1000` is a **row** cap, not a per-job cap. One large activation consumes the entire window:
`act:51b14a21-af0` alone holds **1255 rows**, so `act:758931b7-9ce` (759 rows) and `act:47a2b74f-a25`
are **absent** from the list. Verified live: the after-fix output contains exactly **one** entry.

So N2B trades "40 stale entries" for "1 current entry". That is a correctness improvement but **not
legacy parity**, and it is a *new* consequence made visible by the fix rather than a pre-existing
condition. Secondary effect: `event_count` and `turns` are window counts presented as totals — N2B
reported its own activation as `1000 events / 72 turns` against true values of `1255 / 87`.

Filed as P1 `contract:draft` rather than fixed, because it is a distinct defect from the one N2B was
scoped to fix and its resolution needs a design decision (per-job budget vs deriving the activation
list from `specialist_jobs`, which already holds exactly one row per activation).

---

## dist rebuild — required, and the guard that caught a real problem

`package.json` maps `specialists`/`sp` to `dist/index.js`, `dist/` is committed, and
`package-payload.yml:75-76` enforces `git diff --exit-code -- dist/`. **N0/N2A/N2B therefore cannot
ship without a matching rebuild** — a source-only commit fails CI. Committed as `64e922e6`.

All 13 changed paths trace to a specific node (N0: `supervisor`+`status-contract` declarations;
N2A: `cli/result`; N2B: `cli/ps`, `observability-sqlite`, `native-activation-summary`; plus
`dist/index.js` and `dist/lib.js`). Verified **deterministic**: two independent builds are
byte-identical.

**The first build attempt failed, and the failure was informative rather than noise.** `bun run build`
exited 1 with a guard (unitAI-rrdnt.41):

> build aborted: the bundle was linked against dependencies from OUTSIDE this checkout. … The bundle
> is wrong, not just untidy: it links against versions this checkout does not declare.
> Fix: run `bun install` in THIS directory, then build again.

The failed build had already emitted a **partial, wrong** `dist/`. It was reverted rather than
committed, `bun install` was run in the worktree (174 packages, 619 ms, **no lockfile change**), and
the rebuild then exited 0. Two `dist` files that appeared modified after the failed build
(`project-pack-skill-resolver.d.ts`, `timeline-events.d.ts`) show an **empty diff** after the correct
build, confirming they were artifacts of the bad emit rather than real drift.

**Lesson for the remaining nodes:** any node that changes `src/` must either rebuild `dist/` or the
package-payload job fails. This belongs in the DAG contract for every subsequent node, not only N10.

---

## Review gate

Dispatched as a `reviewer` activation over all four commits, with an explicit standing instruction
that every author reported success and those claims are therefore unverified. The contract targets
ten specific attack surfaces, including whether the `att:` → `act:` mapping silently resolves a
nonexistent attempt number, whether the summarizer handles every `event_name` the writer can actually
produce (derived from `forensic-events.ts:813,868` rather than from observed samples), whether the
regression test would genuinely fail against the old reader, and whether the `prefix+\uffff` sentinel
can wrongly exclude a valid `job_id`.

**The readiness gate rejected the first attempt**, because the contract used an `OBJECTIVE` heading
instead of the required `PROBLEM`/`SUCCESS`/`SCOPE`/`NON_GOALS`/`VALIDATION` set, and returned the
missing list without spending a model turn. The gate works; the lesson is that a contract must use
the exact section names, not synonyms.

---

## Review outcome and fix loop

Verdict: **N0 accepted; N2A / N2B / dist accepted-with-findings.** The review substantiated every
finding with commands, and found defects all four authors had missed.

| Severity | Finding | Disposition |
|---|---|---|
| HIGH | `att:<valid-core>:99` exited 0 with a payload byte-identical to `act:<id>` (8013 B, `cmp`) | **fixed** `9766b5b7` |
| HIGH | `event_count`/`turns` are window counts emitted as totals, unlabelled in human and JSON | in N2B fix |
| MEDIUM | `job.status_changed` → `settled` unconditionally; all 181 real rows mean `waiting` | in N2B fix |
| MEDIUM | catch-all `includes('.')` → `'active'` masks `tool.call.failed` / `error.*` (latent, 0 rows today) | in N2B fix |
| MEDIUM | Regression test binds writer↔filter but **not** the `ps.ts` call site; reverting `ps.ts:747` still passed | in N2B fix |
| MEDIUM | `EXPLAIN` cited the wrong index | **fixed** `5fcd0e62` (my error, not the executor's) |
| LOW | grammar over-permissive; explicit-flag bypass | **resolved by documented decision** in `9766b5b7` |
| LOW | `turns` counts only `turn.summarized`, undercounting ~50 % vs `turn.turn` | in N2B fix |

The reviewer also stated what it could **not** verify — dist determinism, because rebuilding would
have violated its own read-only constraint. That was already established here independently by
running two builds and diffing them.

### The N2A fix chose better authority than the brief implied

The fix verifies attempt existence against the **forensic `attempt_id` set** rather than
`specialist_jobs`, and the reasoning is correct and was confirmed against live data: every minted
attempt emits forensic rows, while `specialist_jobs.attempt_no/attempt_id` holds only the **latest
pointer**. Observed directly on a real job: `attempt_no=3` while attempts 1 and 2 exist only in
forensics. Trusting the job row would have rejected valid attempts.

It fails **closed** on every unverifiable path (attempt absent, database unavailable, forensic read
failure, rows beyond the client cap) and never falls back to another attempt's result. A missing
activation keeps the established `No job found` path, so a bad core retains its existing message.

Verified: `att:…:1` and `att:47a2b74f-a25:3` (a genuine non-default attempt) resolve; `att:…:0`, `:2`,
`:99` and `att:47a2b74f-a25:99` refuse with an explicit error naming the attempt; `act:<id>`,
`00270d` and the node/member paths unchanged. tsc exit 0; 42/42 result suites (16 new); 42/42
prior-node guard.

### Monitoring lesson (cost real time)

A monitor scoped to one attempt's terminal event **fires early**: a resumed activation advances
attempts, so the first monitor reported "settled" while the session was still working on the next
attempt. I briefly read that as "the fix produced no changes", which was wrong. The correct watch is
the job's terminal **status**, attempt-agnostic, plus a stall detector so a hang cannot masquerade as
progress.

---

## Corrections to the audit forced by cutover-prep work

These changed the audit's own conclusions and are recorded in `00-capability-matrix.md`.

1. **Store anchoring (consequence 7):** there are **three** durable stores, not two. Jobs
   (`.specialists/jobs/`) and the forensic DB (`.specialists/db/observability.db`) both anchor to the
   git **common** root and are shared across worktrees; settlements anchor to `process.cwd()` and are
   per-worktree. `XDG_DATA_HOME` overrides only the forensic DB.
2. **`sp ps` orphan (consequence 4):** proved by time series, not archaeology. The `activation`
   family holds **214** rows, last written **2026-09-08 11:11:09 UTC**; `febef0ad` landed
   **11:37:32 UTC** — a 26-minute gap, nothing since, while every other family is current at
   2026-09-16. The mechanism is that the parallel vocabulary was *retired and re-projected onto the
   shared timeline families*, not that a writer was simply deleted.
3. **Two defects at the `sp ps` call site, not one:** it queries a closed family **and** omits
   `order`, so the reader's `'asc'` default slices the OLDEST rows of a busy stream — the case
   `observability-sqlite.ts:1181-1183` explicitly warns about. Fixing only the family would render
   the wrong end of the correct stream.
4. **The `sp ps` fix must be identity-based:** native rows now carry no distinct family at all. They
   land in the shared families and are identified only by `job_id = 'act:<uuid>'`. Confirmed live on
   the N0 activation itself: `act:758931b7-9ce` produced 404 forensic rows (759 after settlement) across
   `control`, `job`, `turn`, `model` and `tool`, with `job.started`, `turn.turn`, `model.meta`,
   `tool.call.started/completed`, and `attempt_id = 'att:758931b7-9ce:1'`.

---

## Environment notes affecting this run

- **`/tmp` is a 2 GB tmpfs and was 100% full** during this run. Root (`/dev/vda4`) has 85 GB free.
  Evidence was written outside `/tmp`. Other sessions' scratch data was **not** deleted.
- The native runtime reports a build mismatch on every dispatch:
  *"module loaded 92de4cc3c244, file on disk 59a89c9c08ed — the runtime was rebuilt after this session
  loaded it."* It is issued as a caveat on both successes and refusals, and did not prevent either
  successful dispatch, so it is recorded but not treated as a failure.
