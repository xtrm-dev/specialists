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
| **N2B** ps observability | Substrate `SPECIALISTS-80` (`iss_01a0a96b-9ac9-…`) | `act:51b14a21-af0` | in progress | — |

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
