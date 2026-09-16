# XTRM-93 — Lane E: Worktree, Git, Review and Publication Behaviour

> **Status: LANE E AUDIT ARTIFACT — evidence only. Does not modify source.**
> Companion lanes: [`00-capability-matrix.md`](./00-capability-matrix.md),
> [`01-cli-surface.md`](./01-cli-surface.md),
> [`02-rpc-supervisor-lifecycle.md`](./02-rpc-supervisor-lifecycle.md),
> [`03-telemetry-observability.md`](./03-telemetry-observability.md).
> Destination enum is the one declared in
> [`00-capability-matrix.md`](./00-capability-matrix.md) §2
> (`PRESERVE_NATIVE | FRONTEND_ONLY | MOVE_TO_CORE | REUSE_EXISTING_NATIVE | INTENTIONAL_RETIREMENT | DEAD_AFTER_CUTOVER`).

---

## 0. Method and verified baseline

| Fact | Value | How verified |
|---|---|---|
| Audit worktree | `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh` | `pwd` |
| Worktree HEAD (audited tree) | `6553ef05` (`fix(unitAI-rx1bu): resolve npm: extension sources under native dispatch`) | `git log --oneline -3` |
| Upstream master (source of truth) | `472b1aef` (`test(parity): stop calling the contract quote a mechanical tie (#373)`) | `git log --oneline -3` |
| GitNexus index | **current for this tree** — `.gitnexus/meta.json` `lastCommit` = `6553ef05877a263384d6572980cc6e4affc3952a` = worktree HEAD; `gitnexus` CLI 1.6.11 | `cat .gitnexus/meta.json`; `gitnexus --version` |
| GitNexus MCP | **not exposed to this sub-agent session**; the equivalent `gitnexus` CLI was used in the worktree cwd (no `--repo` flag exists on this build; repo is selected by cwd). | `mcp status` → tool not found; `gitnexus impact resolveWorkingDirectory --direction upstream` → `risk: LOW`, `epistemic: exact` |
| GitNexus receipts used | `impact resolveWorkingDirectory` (LOW/exact, 1 caller), `impact resolveBasePin` (LOW/exact, 1 caller), `impact publishSettlement` (LOW/exact, 5 impacted), `impact provisionWorktree` (**ambiguous**: 2 symbols; disambiguated by text search per GitNexus doctrine — `worktree.ts:205` and a same-named symbol elsewhere; resolved callers are `run.ts:457`, `node-supervisor.ts:899`, `node-supervisor.ts:1617`) | tool output |

**Scope:** the CURRENT tree at `6553ef05` only. Nothing here is a proposal to edit source.

### 0.1 Path legend (every table cell below uses these aliases)

| Alias | Path |
|---|---|
| `run` | `src/cli/run.ts` |
| `wt` | `src/specialist/worktree.ts` |
| `wtgc` | `src/specialist/worktree-gc.ts` |
| `node-sup` | `src/specialist/node-supervisor.ts` |
| `prd` | `src/specialist/pr-drift-refresh.ts` |
| `gde` | `src/specialist/git-diff-evidence.ts` |
| `snd` | `src/specialist/snapshot-diff.ts` |
| `cite` | `src/specialist/citation-evidence.ts` |
| `sup` | `src/specialist/supervisor.ts` |
| `runner` | `src/specialist/runner.ts` |
| `launch` | `src/specialist/launch.ts` |
| `merge` | `src/cli/merge.ts` |
| `epic` | `src/cli/epic.ts` |
| `end` | `src/cli/end.ts` |
| `epl` | `src/specialist/epic-lifecycle.ts` |
| `epr` | `src/specialist/epic-readiness.ts` |
| `eprec` | `src/specialist/epic-reconciler.ts` |
| `bie` | `src/specialist/branch-integration-events.ts` |
| `clean` | `src/cli/clean.ts` |
| `dja` | `src/specialist/dead-job-audit.ts` |
| `integ` | `src/cli/integration.ts` |
| `host` | `src/activation/native-host.ts` |
| `wlease` | `src/activation/workspace-lease.ts` |
| `wrec` | `src/activation/workspace-reconcile.ts` |
| `spub` | `src/activation/settlement-publication.ts` |
| `sstore` | `src/activation/settlement-store.ts` |
| `slease` | `src/activation/settlement-lease.ts` |
| `types` | `src/activation/types.ts` |
| `obs` | `src/specialist/observability-sqlite.ts` |
| `doctor` | `src/cli/doctor.ts` |
| `console-rt` | `src/cli/console/runtime.ts` |
| `sysp` | `src/specialist/system-prompt.ts` |
| `taskp` | `src/specialist/task-prompt.ts` |
| `schema` | `src/specialist/schema.ts` |
| `index` | `src/index.ts` |

### 0.2 The single most important structural fact for this lane

**No production line under `src/activation/` invokes `git`.** A search of
`src/activation/*.ts` for `git diff`, `numstat`, `evidenceRefs`, `gitnexusSummary`,
`reusedFromJobId`, or `reviewer_diff` returns nothing. The native path:

- runs **in place** — `host:273-275` returns `{ repositoryRoot: cwd, worktreePath: cwd }` and
  `types.ts:100-106` records that `resolveWorkspace` deliberately carries no per-activation
  worktree ("A per-activation worktree was rejected deliberately, not forgotten
  (SPECIALISTS-21)");
- replaces the worktree with a **writer lease** keyed on the resolved worktree path
  (`wlease:1-30`, `host:874-900`);
- writes review/publication evidence only through the **Substrate settlement boundary**
  (`spub:515-683`, `host:1672-1714`), which is bounded-result + WorkReceipt/provenance +
  Journal result and explicitly needs **no Git commit** (`spub:502-514`, ADR §40).

Consequence: for this lane, the native column is frequently `NONE`, and "the native path
runs in place" is a deliberate design decision, not a gap to paper over.

---

## A) Behaviour table

> Exactly the required columns. One destination per behaviour.

| # | behaviour | legacy source (file:line) | trigger/flag | durable artifacts written | git side effects | native equivalent (file:line) | semantic delta | classification | destination | blocker? |
|---|---|---|---|---|---|---|---|---|---|---|
| WT-01 | Explicit worktree provisioning via `bd worktree create` (no git fallback; throws) | `wt:205-278`, `wt:377-391`; call site `run:444-471` | `sp run --worktree` | `git worktree` registry entry; `<commonRoot>/.worktrees/<bead>/<bead>-<slug>/`; branch `feature/<bead>-<slug>` | creates worktree dir + branch; `git -C <wt> update-index --skip-worktree`; `rm -rf <wt>/.beads` | `host:273-275` (returns cwd; no worktree) | **absolute delta**: legacy gives a separate checkout; native gives no checkout at all — the writer mutates the coordinator tree | Core-session-topology-concern | MOVE_TO_CORE | **YES** — `host:264-271` states reopening worktree provisioning requires first answering the merge-path problem |
| WT-02 | Auto-provision policy for edit-capable specialists | `run:1663-1680`; schema default `schema:42` (`requires_worktree: z.boolean().default(true)`) | `MEDIUM`/`HIGH` permission + `requires_worktree` + no `--job` | same as WT-01 | same as WT-01 | `host:622` (`WRITE_TIERS.has(tier) ? 'write' : 'read'`) + `host:874-900` | native substitutes a **lease** for a **checkout**; the isolation guarantee is different in kind | Core-session-topology-concern | MOVE_TO_CORE | **YES** |
| WT-03 | `--no-worktree` removal stub (hard error, exit 1) | `run:174-181`; test `tests/unit/cli/run.test.ts:1139-1156` | `sp run --no-worktree` | none | none | none | no native flag exists; the stub only exists because legacy used to honour it | compatibility-CLI-concern | DEAD_AFTER_CUTOVER | NO — proof of no consumer: the only `--no-worktree` occurrences in `src/` are the parser stub itself; the sole caller is a test asserting rejection |
| WT-04 | Branch naming convention `feature/<beadId>-<specialist-slug>` | `wt:57-59`, `wt:67-69`, `wt:72-77` | any worktree provision | branch ref | branch creation | none | **not equivalent**: Core worktree sessions use `xt/<slug>` (this audit's own branch is `xt/akkh`); `sp` uses `feature/<bead>-<specialist>` | Core-session-topology-concern | MOVE_TO_CORE | **YES** — branch naming is a cross-repo contract consumed by reviewers (`sysp:292` hardcodes `git diff master..HEAD` inside a reused worktree) |
| WT-05 | Worktree reuse discovery by branch (`git worktree list --porcelain`) | `wt:97-113`, `wt:210-214` | re-dispatch of same bead+specialist | none new (reuses existing path) | none | none | native has no per-bead/branch worktree to rediscover; `--job` reuse (WT-09) is the only reuse concept | Specialists-execution-concern | MOVE_TO_CORE | **YES** |
| WT-06 | Coordinator base inheritance + re-point new branch onto it (`checkout -B <branch> <base>`) | `wt:117-139` (`resolveCoordinatorBase`), `wt:176-189` (`rebaseNewBranchOnto`), `wt:226-233`; env contract `wt:120-128` | `XTMUX_AGENT_BRANCH` env or `@agent_branch` tmux pane option present | branch ancestry (merge-base relationship) | `git checkout -B branch base` inside the new worktree | none | native reads no coordinator branch and produces no branch ancestry; `XTMUX_AGENT_BRANCH` is written by **xt/Core**, not by this repo (`wt:120-122` cites core PR #465 / xtrm-6hey0.2) | Core-session-topology-concern | MOVE_TO_CORE | **YES** — producer is Core; consumer is `sp` |
| WT-07 | bd-in-worktree hazard fix: parent `core.hooksPath` normalization + `.beads` skip-worktree | `wt:297-313` (`normalizeParentHooksPath`), `wt:328-351` (`markBeadsSkipWorktree`), `wt:235-269` | any worktree provision | skip-worktree index bits in the new worktree; mutated parent `core.hooksPath` | `git update-index --skip-worktree`; `git config core.hooksPath <abs>` | none | hazard only exists *because* of per-worktree checkouts; native (in place) has no `.beads` duplication hazard | Specialists-execution-concern | MOVE_TO_CORE | **YES** — if Core owns worktrees it must inherit this fix or the merge hazard at `wt:251-259` (PR #39, 2026-05-12) reappears |
| WT-08 | `.pi/npm` cache symlink into each worktree | `wt:361-371`; caller `wt:275` | worktree provision | symlink `<wt>/.pi/npm → <commonRoot>/.pi/npm` | none | none | pure perf workaround for per-worktree npm install; no worktree ⇒ no need | Specialists-execution-concern | DEAD_AFTER_CUTOVER | NO — proof: single caller `wt:275`, no other reference in `src/` |
| WT-09 | `--job <id>` workspace reuse (worktree path + owner job + base pin + bead inference) | `run:473-530` | `sp run --job <id>` | job status row reuse; `reused_from_job`/`worktree_owner_job_id` provenance; `base_sha_pinned` inherited | enters an existing checkout; no git mutation | `host:960-986` (writer and reviewer share one in-place cwd as an emergent property, not a designed reuse protocol) | **accidental parity, not designed parity**: native writer and reviewer share the coordinator tree because *both* run in place; there is no reuse handshake, no owner id, no base-pin inheritance | Specialists-execution-concern | MOVE_TO_CORE | **YES** — the reviewer-reads-writer's-tree guarantee now rests on "both ran in the same directory", which a coordinator that switches trees between dispatches breaks |
| WT-10 | `--force-job` override of the worktree-entry gate | `run:490-511` | `sp run --job <id> --force-job` | none | allows entering an active/unknown-status worktree | none (native refuses concurrent writers via the lease, `host:874-893`) | legacy override grants entry to a possibly-live tree; native makes contention a **refusal**, not an override | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO — no native flag; lease contention is a refusal by design |
| WT-11 | Active-job pre-flight duplicate-dispatch guard (same bead+specialist) | `run:1682-1711` | `--bead` without `--job` | none (refusal before job creation) | none | `wlease:229-300` (`inspect`/acquire never steals), `host:874-893` | equivalent *intent* (one writer per workspace) at a **different key**: legacy keys on bead+specialist, native keys on worktree path | Specialists-execution-concern | REUSE_EXISTING_NATIVE | NO |
| WT-12 | Stale-base sibling guard (refuse dispatch when unmerged sibling chains have substantive commits) | `run:378-430`; call site `run:455` | `--worktree` without `--accept-stale-base` | error envelope only | none (refusal) | none | native has no epic/chain sibling concept and no base-freshness gate before dispatch | Specialists-execution-concern | MOVE_TO_CORE | **YES** — guard depends on worktree bases; with no worktrees there is no base to be stale relative to |
| BT-01 | Base pin resolution (`baseShaPinned`, `baseShaObserved`, `commitsBehind`, `override`) | `run:771-812`; envelope `run:725-751`; inherited form `run:753-769` | `--worktree`, or `--base-sha`, or `--base-ref`; auto-fallback to `resolveInheritedBasePin` (`run:1914-1915`) | `base_sha_pinned`, `base_sha_pinned_at_ms` on the job row (`launch:87-88,103-115`; `sup:1464-1465,1519-1520`; schema `obs:627-631`) | `git fetch origin [ref]`; `git rev-parse FETCH_HEAD` / `refs/remotes/origin/HEAD` / `refs/heads/<coordinatorBase>`; `HEAD`; `rev-list --count <head>..<pin>` | none — native settlement records `bindingBaseCommit` only if the **Substrate binding** exposes it (`host:1328-1330`, `spub:225-226`), and `resolveWorkspace` never sets `branch` (`host:273-275`) | **no native base pin exists**: "what this run measured against" has no native durable field unless Substrate supplies one | Specialists-execution-concern | PRESERVE_NATIVE | **YES** — see §B and §F |
| BT-02 | `--accept-stale-base --reason <text>` override; deprecated `--force-stale-base` alias | `run:187-194`, `run:795-806` | explicit refusal override | stderr warning line carrying pin/current/reason | none | none | no native equivalent; native has no stale-base state to override | compatibility-CLI-concern | MOVE_TO_CORE | **YES** — the override belongs where the guard lands |
| BT-03 | `base_fetch_failed` structured error envelope (`ok:false`, `error_code`, `blocked_by`, `next_safe_action`) | `run:725-751` | any `git fetch`/resolve failure during pinning | machine-readable error on the job launch path | none | none | native refusal codes are `DispatchRejectedError` reasons (`host:876-893`); no `base_fetch_failed` analogue | compatibility-CLI-concern | MOVE_TO_CORE | NO |
| BT-04 | PR drift refresh: `gh pr view` → `pr_classification`, `pr_base_ref`, `pr_base_sha`, `pr_head_sha`, `pr_state`, `pr_merge_state`, `pr_drift_checked_at_ms` | `prd:80-133`; schema `obs:611-641`; consumer `doctor:1046-1060` | `sp doctor` PR-drift pass | `specialist_jobs.pr_*` columns | none (read-only `gh` call; never mutates git) | none | native settlement publishes no PR linkage; `obs:1319` states `pr_url` is "as recorded by **xt** at PR creation" — PR creation is Core's, drift observation is Specialists' | Specialists-execution-concern | PRESERVE_NATIVE | NO (drift observation), but see PB-14 for PR creation ownership |
| AC-01 | Auto-commit checkpoints (`auto_commit: never \| checkpoint_on_waiting \| checkpoint_on_terminal`) | policy `schema:46`; passed `runner:1536`; runner `sup:533-611`; applied `sup:1929-1969` | specialist config policy + turn reaching `waiting`/terminal | `last_auto_commit_sha`, `last_auto_commit_at_ms`, `auto_commit_count` (`sup:1953-1958`); `auto_commit_success` timeline+forensic event (`sup:1960-1964`) | `git add -- <substantive files>`; `git commit -m "checkpoint(<specialist>): <bead> turn <n>"`; `git rev-parse HEAD` | none — native settlement explicitly requires **no** Git commit (`spub:508-510`, ADR §40) | **absolute delta**: legacy preserves work as commits on a feature branch; native stores the settlement in runtime storage + Substrate and produces no commit at all | Core-session-topology-concern | MOVE_TO_CORE | **YES** — the commit is what a reviewer's `git diff` range and the console fallback (PB-20) read |
| RV-01 | Changed-files/diff evidence bundle on each auto-commit (numstat + unified=0 hunks + artifact ref + PR evidence ref) | `sup:1885-1927`; builders `gde:83-105`, `gde:57-63`; inline limit `gde:21` | auto-commit success | `evidenceRefs[]` on the `auto_commit_success` event: `{evidence_kind:'diff', evidence_ref:'git:<sha>', diff:{base_ref,base_sha,head_sha,changed_files,hunks\|hunks_artifact_ref}}` + `{evidence_kind:'commit'}` + optional `{evidence_kind:'pr'}`; `artifacts/git-diff-<sha12>.patch` when hunks exceed `INLINE_HUNKS_LIMIT` | reads `git rev-parse <sha>^`, `git diff --numstat`, `git diff --unified=0` (no mutation) | none | **no native diff evidence exists**; the native column is empty for every review-evidence row | Specialists-execution-concern | PRESERVE_NATIVE | **YES** |
| RV-02 | Secret redaction of diff hunks (PEM, JWT, URL creds, env secrets, auth headers, tokens, emails) | `gde:23-50`, applied at `gde:41`, `gde:61`, `gde:92` | any hunk written inline or to an artifact | redacted hunks only | none | none | native stores raw model output in runtime storage and only bounded excerpts in the Journal (`spub:99-136`) — no diff text is published at all | Specialists-execution-concern | PRESERVE_NATIVE | NO |
| RV-03 | Injected reviewer diff context (three-source fallback: recorded-base range → unstaged → staged → branch-vs-base; obligations marker inventory; hunk completeness) | `run:1287-1574`; builders `run:1576-1591`; wiring `run:1951-1953` | `sp run reviewer --job <id>` (specialist name `reviewer` + `--job`) | prompt variables `reviewer_diff_source/stat/files/hunks`; not persisted | read-only `git rev-parse/status/symbolic-ref/merge-base/diff --stat/--name-only/diff/-U0/show` | `host:983-986` only (the shared hook, RV-05) | native has **no** `reviewer_diff_*` variables, **no** `recorded-base` range, **no** obligations inventory, and **no** hunk-completeness accounting | Specialists-execution-concern | PRESERVE_NATIVE | **YES** |
| RV-04 | Injected writer diff (`writer_diff`, for seconder) and obligations diff (`obligations_diff`, for obligations-scanner) | `run:1593-1618`, `run:1620-1651`, wiring `run:1954-1959` | `--job` + specialist `seconder` / `obligations-scanner` | prompt variables only | read-only git | none | native seconder/obligations-scanner receive no injected diff; the shipped templates list these placeholders as *optionally absent* (`taskp:22-32`), so the omission is silent | Specialists-execution-concern | PRESERVE_NATIVE | **YES** |
| RV-05 | Reviewer execution-only diff hook (shared factory; appends `Reviewer Diff Context` to the task prompt; failure keeps the prompt, does not refuse) | `runner:824-835`, context builder `runner:784-805`, sources `runner:745-777`; legacy call `runner:1173-1175`; native call `host:985` | specialist name == `reviewer` | appended task-prompt text (feeds `prompt_hash`) | read-only git in `cwd` | `host:985` — **same factory** | **the factory is shared, the inputs differ**: legacy `cwd` is the reused writer worktree; native `cwd` is `workspace.worktreePath` = coordinator cwd (`host:964`), so the "diff" is the whole uncommitted coordinator tree, not a writer-vs-base range | Specialists-execution-concern | REUSE_EXISTING_NATIVE | **YES** — parity is *of the hook*, not of the evidence it injects |
| RV-06 | `reviewed_job_id` prompt override (`reviewed_job_id: <id>`) + job linkage | `run:818-824`; wiring `run:1948-1967`; template var `taskp:28`; shipped reviewer template `config/specialists/reviewer.specialist.json:42` | reviewer/seconder with `--job` (or explicit `reviewed_job_id:` line in the prompt) | prompt variable `reviewed_job_id`; `reviewed_job_id_present` in status/timeline (`sup:162,1470`; `tl:100`; `result:267`) | none | **none** — `host` never sets `reviewed_job_id` | native reviewer has **no** job linkage at all; the shipped reviewer system prompt declares `reviewed_job_id` a *required* injected field for authoritative traceability | Specialists-execution-concern | PRESERVE_NATIVE | **YES** — highest-severity review-integrity gap in this lane |
| RV-07 | `gitnexus_summary` pre-injection from the reviewed job's `run_complete` event | `runner:273-306`; wiring `runner:1150-1151`; template var `taskp:24` and `taskp:199` | `--job <exec-job-id>` (any specialist whose template uses `$gitnexus_summary`) | prompt variable `gitnexus_summary` | none | `host` does **not** pass `gitnexusSummary`, although `renderTaskPrompt` supports it (`taskp:199`) | native drops the blast-radius shortcut the reviewer template explicitly consumes | Specialists-execution-concern | PRESERVE_NATIVE | **YES** |
| RV-08 | Reviewer patch-retrieval instruction appended to the system prompt for reused worktrees | `sysp:292` | specialist `reviewer` + `reusedFromJobId` | system-prompt text | none | none | instruction names `sp ps`/`git diff master..HEAD` inside a reused worktree — meaningless on the in-place native path | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| RV-09 | Reviewer verdict extraction (`Verdict: PASS\|PARTIAL\|FAIL`) → chain/epic readiness state | `epr:8-10`, `epr:53-62`, `epr:64-160` | `sp epic status/list/merge` | readiness projection (no separate store; derived live) | none | none | native settlements publish `outcome: completed \| completed_with_validation_errors` (`spub:104-136`); there is no PASS/PARTIAL/FAIL verdict concept and no native readiness gate | Specialists-execution-concern | PRESERVE_NATIVE | **YES** |
| RV-10 | Reused-worktree awareness block in the prompt (`git status/diff` pre-flight) | `run:822-833`; wiring `run:1963` | `--job` | prompt variable `reused_worktree_awareness` | none | none | native has no reuse handshake to warn about | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| RV-11 | Exact-line citation verification (deterministic file-read window, path containment, staleness re-check) | `cite:62-166`; exported `src/lib.ts:140-143` | SDK/public API call — **not invoked by any dispatch path** | `VerifiedCitationWindow` / `ExactLineCitationResult` in memory | none | none | neither legacy nor native dispatch calls it; it is an exported library capability | Specialists-execution-concern | PRESERVE_NATIVE | **NO** — see §G/UNKNOWN-3 (external consumers unproven) |
| RV-12 | `snapshotDiff`/`snapshotHash` job-list materializer | `snd:22-69`; consumer `src/cli/console/components.ts:49,371-377` | `sp console` re-render | in-memory upserts/tombstones/hash | none | none | **mis-anchored by this lane's brief**: this file diffs *job-list snapshots*, not git diffs, and is a verbatim port of a gitboard materializer (`snd:1-12`). Not a worktree/git behaviour at all | obsolete-duplicate | FRONTEND_ONLY | NO |
| PB-01 | Merge target resolution (chain root, epic membership, unresolved-epic guard) | `merge:206-344` (`parseChildBeadIds`, `resolveChainEpicMembership`, `checkEpicUnresolvedGuard`), `merge:489-535`; `end:136-149` | `sp merge <bead>`, `sp end` | none beyond epic/chain membership reads | none | none | native has no merge target concept | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | **YES** — cited product decision: `index:1197-1199` prints `[broken] Do not use this command.`; `CLAUDE.md:243` "Merge is manual. `sp merge` and `sp epic merge` are prohibited"; `docs/design/using-specialists-progressive-disclosure.md:131` rule 9 |
| PB-02 | Terminal-job enforcement and dependency-ordered chain sequencing | `merge:408-414` (`ensureTerminalJobs`), `merge:416-470` (`topologicallySortChains`), `merge:345-407` | `sp merge` | none | none | none | on the retired path | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| PB-03 | Main-repo dirty-state gate: overlap refusal, then stash/shelve + restore | `merge:563-687` (`classifyMainRepoDirtyState`, `shelveMainRepoDirtyState`, `restoreShelvedMainState`, `assertMainRepoCleanForMerge`), applied `merge:992-1007,1039-1043` | `--direct` publication (default) | `git stash` entry `sp epic merge <label> auto-shelve` | `git stash push --include-untracked`; `git stash apply --index`; `git stash drop` | none | on the retired path; the recovery instructions at `merge:664-673` are operator-facing only | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| PB-04 | Merge worthiness filter: empty delta / noise-only delta / already-published (ancestor or cherry-pick count 0) | `merge:705-799` | `sp merge`, `sp epic merge` | none | read-only `git merge-base --is-ancestor`, `git rev-list --right-only --cherry-pick` | none | on the retired path | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| PB-05 | Rebase-onto-default then `git merge --no-ff --no-edit`, with conflict listing and rebase abort | `merge:828-867` | `sp merge` | merge commit on the target branch | `git rebase <base>`; `git merge <branch> --no-ff --no-edit`; `git rebase --abort` on conflict | none | **explicitly contrary to the sanctioned path**: `CLAUDE.md:243` requires manual `git merge --no-ff` / `git update-ref`; the sanctioned multi-chain path is the Cherry-Pick Playbook (`CLAUDE.md:243`) | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | NO |
| PB-06 | Post-merge TypeScript gate and optional rebuild | `merge:869-884` (`runTypecheckGate`), `merge:886-909` (`runRebuild`), applied `merge:1024,1034-1036` | `sp merge`, `--rebuild` | none | `bunx tsc --noEmit`; `bun run build` (mutates `dist/`) | none | CI/operator concern on the retired path; native has no post-settlement build gate | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | **YES** — rebuild mutates the tree after a merge; if it is dropped without a CI substitute, merged-but-unbuilt states go unnoticed |
| PB-07 | Epic merge readiness gate (no running chains) | `epic:358-388` (`validateEpicMergeReadiness`), `epic:281-296` (`evaluateReadiness`), `epic:263-279` (`buildChainJobStatuses`); model `epl:80-113` | `sp epic merge` | none (refusal) | none | none | read-only readiness is also used by `sp epic list/status` (`epic:298-313`), which stay live | Specialists-execution-concern | PRESERVE_NATIVE | NO (read verbs preserved); merge gate retired with PB-01 |
| PB-08 | Epic state machine + persisted epic rows with transition audit | `epl:10-23` (`EPIC_STATES`, `VALID_EPIC_TRANSITIONS`), `epl:115-153` (audit append), `epic:390-412` (`updateEpicState`) | `sp epic merge`, `abandon`, `sync` | `epic_runs` rows with `status_json.transitions[]` | none | none | native has no epic state machine; persisted state is a view cache only (`epl:3-9`) | Specialists-execution-concern | PRESERVE_NATIVE | NO |
| PB-09 | Epic advisory lock around sync/abandon | `eprec:41-76` (`withEpicAdvisoryLock`); used `epic:665,715` | `sp epic sync --apply`, `sp epic abandon` | `locks/epic-<id>.lock` (OS-exclusive `openSync(...,'wx')`) | none | none | native has no equivalent single-writer lock for epic rows; no epic rows exist natively | Specialists-execution-concern | PRESERVE_NATIVE | NO |
| PB-10 | Epic drift detection + repair (dead jobs marked error, stale chain refs pruned, redirect markers cleared, readiness resynced) | `eprec:106-215` (`syncEpicState`) | `sp epic sync [--apply]` | repaired `epic_runs` / chain membership rows; forensic events via `isJobDead` (`sup:793`) | none | none | no native epic entity to reconcile | Specialists-execution-concern | PRESERVE_NATIVE | NO |
| PB-11 | Epic abandon (force gate on live members) | `eprec:247-284`; CLI `epic:692-737` | `sp epic abandon <id> --reason <text> [--force]` | `epic_runs` row → `abandoned` + transition audit | none | none | no native epic entity | Specialists-execution-concern | PRESERVE_NATIVE | NO |
| PB-12 | `sp end` bead inference from workspace/job status and epic redirect | `end:65-91` (`detectCurrentBeadIdFromWorkspace`), `end:131-151`; branch regex `^feature/(unitAI-[^-]+)-` `end:89` | `sp end` | none | none (delegates to merge/epic merge) | none | routes into the retired merge path; bead inference keys on a legacy branch-name regex that native worktrees (`xt/<slug>`) do not match | compatibility-CLI-concern | INTENTIONAL_RETIREMENT | **YES** — session-close helper; removing it without a replacement breaks agent session-close flows (see §E) |
| PB-13 | PR publication: publish branch `sp/publish-<label>-<ts>`, merge into it, `gh pr create` | `merge:1046-1125` (`executePublicationPlan`, `checkoutNewBranch`, `createPullRequest`) | `sp merge --pr`, `sp epic merge --pr`, `sp end --pr` | git branch `sp/publish-…`; PR URL returned in output | `git checkout -b`; merges; `gh pr create --base <base> --head <publish>`; `git checkout <base>` | none | `obs:1319` documents that PR creation belongs to **xt/Core** ("PR URL as recorded by xt at PR creation"); legacy `sp` duplicates it on a declared-broken path | compatibility-CLI-concern | MOVE_TO_CORE | **YES** — Core must own PR creation; this repo should only observe (BT-04) |
| PB-14 | Branch integration event `xtrm.branch.integration.v1` (observation only, never read back to drive merges) | `bie:11-75`; emitter `merge:958-984`; surface `integ:98-132` | `sp merge` success; manual `sp integration record` | `branch_integrations` row in `observability.db` | none — the module states it is "NOT a second Git authority" (`bie:5-9`) | none emitted natively | `bie:23-28` records that `target.role` for coordinator branches and manual-merge auto-emission are **owned by Core** (`xtrm-3xgs5`, Cluster B) and are not populated here | Core-session-topology-concern | MOVE_TO_CORE | **YES** — Core is the declared owner; the legacy emitter dies with `sp merge`, and the manual path depends on `sp integration record` (PB-15) |
| PB-15 | `sp integration record` (write verb) and `sp integration list` (read verb) — sanctioned shell-out surface for Core | `integ:1-216`; store `obs:2092-2137` | `specialists integration record\|list …` | `branch_integrations` rows | none by design (`integ:14-18`) | none | Core is "barred from writing `.specialists/db/observability.db` directly" (`integ:9-12`); this verb is the compatibility bridge, not a native behaviour | compatibility-CLI-concern | MOVE_TO_CORE | **YES** — Core `xtrm-vtqlg.2` unblock depends on this verb until the store moves |
| GC-01 | Worktree GC for terminal jobs (`sp clean`) | `clean:683-725`; collector `wtgc:59-107`; remover `wtgc:109-147` | `sp clean` (any mode except `--reap-orphans`) | removal of `<worktree_path>`; git registry pruned | `git worktree remove --force <path>` | none — the native lease store has **no** GC/reaper | native has per-activation lease files (`wlease:184-205`) and an uncertain-lease log (`wrec:295-330`) with no reaper; the only recovery is manual `reconcile` (`wrec:191`) | Specialists-execution-concern | PRESERVE_NATIVE | **YES** — while any worktrees exist this is load-bearing; after cutover it must be re-pointed at the lease store |
| GC-02 | Dead-job audit / container-restart orphan reap (`sp doctor`, `sp clean --reap-orphans`) | `dja:33-95`; consumers `doctor:1105-1130`, `clean:623-660` | `sp doctor`, `sp clean --reap-orphans` | `specialist_jobs` status → `cancelled`; `dead_declared` forensic event | none | none | the module's own header declares it a bridge: *"when substrate ships container-state reconciler … this audit retires … the logic is dropped, not renamed"* (`dja:1-3`) — and the native substrate reconciler **now exists** at `wrec:191` | Specialists-execution-concern | INTENTIONAL_RETIREMENT | **YES** — cited bridge note in source (`dja:1-3`); retire only once the uncertain-lease reconciler covers the same operator surface |
| GC-03 | Console diff view: worktree `git diff <base>` + `git status`, falling back to `last_auto_commit_sha` after worktree cleanup | `console-rt:448-494` | `sp console` job detail | none (rendered) | read-only `git diff --numstat`, `git status --porcelain`, `git show --numstat` | none | frontend surface over legacy worktree/auto-commit state; with no worktree and no auto-commit it has nothing to read | compatibility-CLI-concern | FRONTEND_ONLY | **YES** — frontend only if another source of changed-file truth (RV-01/native diff evidence) exists |
| NA-01 | Native workspace identity + writer lease (single writer per worktree path) | — | `host` write-tier dispatch | lease JSON file per worktree path (`wlease:110-140`); forensic `lease_acquired`/`lease_denied`/`lease_released` (`host:896-910`) | none | `host:273-275`, `host:622`, `host:874-900`; `wlease:229-300` | native-only; no legacy analogue | Specialists-execution-concern | REUSE_EXISTING_NATIVE | NO |
| NA-02 | Uncertain-lease reconciliation (proposal + validation + durable log; never a blind free) | — | operator/`specialist_status` reconciliation call | `<key>.reconcile.jsonl`; `UncertainWorkspaceProjection` in status | none | `wrec:89-200`, `wrec:377-473`, `host`/status projection | native-only; the closest legacy analogue is `sp clean --reap-orphans` (GC-02), which is strictly weaker (PID liveness only, no evidence requirement) | Specialists-execution-concern | REUSE_EXISTING_NATIVE | NO |
| NA-03 | Settlement publication: bounded Journal `result` + WorkReceipt allocation + artifact attach + provenance refs | — | every terminal `completed` settlement | runtime storage ref; Journal entry; receipt id; `artifact`/`receipt`/`provenanceRefs`; `settlement_publication_*` forensic events; settlement store record (`sstore:51-90`) | **none** — `spub:508-510` states publication requires no Git commit (ADR §40) | `spub:515-683`, called from `host:1672-1714` | **the native publication contract has no git commit, no branch, and no diff artifact**; `workspace.branch` is absent because `resolveWorkspace` never sets it (`host:273-275`, `types.ts:97-104`), and `baseCommit` appears only if the Substrate binding supplies it (`host:1328-1330`) | Core-session-topology-concern | REUSE_EXISTING_NATIVE | **YES** — see §D overlap analysis |
| NA-04 | Settlement exclusion (exactly-once publication under contention) + republish backlog | — | concurrent settle/republish | `pending`/`refused`/`published` state on the stored settlement; `republish_pass_*` events | none | `spub:674-682`, `spub:432-486`, `host:1394` | native-only | Core-session-topology-concern | REUSE_EXISTING_NATIVE | NO |
| NA-05 | Native reviewer diff injection (shared hook only) | — | native `reviewer` dispatch | appended prompt text | read-only git in the coordinator cwd | `host:957,983-986` | same hook as RV-05, different evidence (see RV-05) | Specialists-execution-concern | REUSE_EXISTING_NATIVE | **YES** — see RV-06/RV-07 for the missing linkage |

**Row count: 52.** Classification breakdown: Specialists-execution-concern 27;
Core-session-topology-concern 8; compatibility-CLI-concern 16; obsolete-duplicate 1.
Destination breakdown: PRESERVE_NATIVE 16; MOVE_TO_CORE 14; REUSE_EXISTING_NATIVE 7;
INTENTIONAL_RETIREMENT 11; FRONTEND_ONLY 2; DEAD_AFTER_CUTOVER 2. Row RV-11 carries
PRESERVE_NATIVE with an unresolved consumer question (§G/UNKNOWN-3).

---

## B) Branch and base pinning semantics

### B.1 What is pinned

Two distinct things are called "base" in this tree and they must not be conflated:

1. **Branch ancestry** — which branch a new worktree branch is created from. Resolved by
   `wt:135-139`: `XTMUX_AGENT_BRANCH` (env, inherited by the whole process tree) wins, then
   the `@agent_branch` tmux pane option. `@agent_worktree` is deliberately not consulted
   (`wt:126-129`). If the published branch does not resolve to a local branch in the target
   repo, the answer is `undefined` and the worktree keeps the git common root's HEAD
   (`wt:131-138`). Re-pointing is `git checkout -B <branch> <base>` (`wt:176-189`) and it is
   hard-failing on purpose.
2. **Base SHA** — the commit the run's diff evidence is measured against. Resolved by
   `run:771-812` with this precedence:
   `--base-sha` (operator literal) > `--base-ref` (`git fetch origin <ref>` then
   `FETCH_HEAD`) > coordinator local branch tip (`refs/heads/<coordinatorBase>`, no fetch) >
   `refs/remotes/origin/HEAD`.
   The observed SHA and the pinned SHA are recorded separately: `baseShaObserved` is what git
   reported, `baseShaPinned` is `args.baseSha ?? baseShaObserved` (`run:787-788`), so an
   operator pin can differ from the observed tip by construction.

### B.2 When it is pinned

- At dispatch, in `resolveBasePin` (`run:1914`), with `resolveInheritedBasePin`
  (`run:753-769`) as the fallback when `--job` reuse supplied a recorded `base_sha_pinned`.
- Persisted to the job row on job start (`launch:103-115`: `pr_base_ref`, `pr_base_sha`,
  `base_sha_pinned`, `base_sha_pinned_at_ms`) and mirrored into the Supervisor status
  (`sup:1464-1465`, `sup:1519-1520`). The columns are documented as a bridge that renames
  1:1 to `containers.pr_*` / `containers.base_sha_pinned*` when the Substrate daemon ships
  (`obs:611-613`, `obs:1302-1310`).
- Drift is measured later, not at pin time: `prd:80-133` calls `gh pr view` and writes the
  observed base tip to `pr_base_sha` for comparison against `base_sha_pinned`
  (`obs:1327-1330`).

### B.3 Who owns a divergent base

This is the weakest-specified area in the legacy path, and the artifact states it as such:

- **Detection** is a refusal. `resolveBasePin` throws a `stale_base` envelope when
  `currentSha !== baseShaPinned || baseShaObserved !== baseShaPinned` (`run:794-811`).
- **Override** is operator intent: `--accept-stale-base --reason <text>` records an override
  (`run:797-806`); the deprecated `--force-stale-base` alias maps onto it
  (`run:190-194`).
- **A second, independent guard** refuses dispatch when an epic has unmerged sibling chains
  with substantive commits (`run:378-430`), overridable by the same flag.
- **Nobody is declared the owner of the divergence.** `run:735-743` states explicitly that
  "whether the coordinator branch is itself current with origin is coordinator judgement
  (the P1-04 ladder), not this guard's call". Core publishes the branch
  (`wt:120-122`), Specialists refuses to proceed on it, and the reconciliation ladder is
  referenced but not present in this tree.
- **Inherited pins are never re-verified against origin.** `resolveInheritedBasePin`
  (`run:753-769`) resolves the recorded SHA locally and computes `commitsBehind`; it performs
  no fetch and no remote comparison. A reused worktree can therefore carry a base that was
  fresh when the writer started and is arbitrary now, and the reviewer's diff range is
  measured against it without revalidation.

**Native status: no equivalent.** `resolveWorkspace` returns `{repositoryRoot, worktreePath}`
(`host:273-275`); `WorkspaceIdentity.branch` is optional (`types:36-45`) and is never set on
the native path; `SettlementSubject.bindingBaseCommit` is populated only when the Substrate
binding exposes `baseCommit` (`host:1328-1330`, `spub:225-226`). If the binding does not carry
it, the native run publishes no "what this measured against" reference at all. This is
**BLOCKER-B** in §F.

---

## C) Review evidence

### C.1 How a reviewer's diff evidence is captured (legacy)

Three injection paths, all gated on the specialist name and `--job`:

1. **Reviewer** — `buildInjectedReviewerDiffVariables` (`run:1576-1591`) calls
   `buildInjectedDiffContext` (`run:1287-1574`) and produces
   `reviewer_diff_source/stat/files/hunks`. Source selection (`run:1453-1477`): if an explicit
   verified base SHA exists, a single `recorded-base diff` range source is used; otherwise it
   falls back through **unstaged → staged → `merge-base(default, HEAD)`** and takes the first
   source with files. Hunk budgets: 20 files, 2 000 chars/file, 12 000 chars total
   (`run:1307-1309`), with per-file and total coverage status recorded
   (`complete|truncated|omitted`, `run:1509-1541`). The same function computes an
   **added-marker obligations inventory** by exact delta (`run:1342-1451`) with
   `complete|incomplete|blocked` status.
2. **Seconder** — `buildInjectedWriterDiffVariables` (`run:1593-1618`), same context, rendered
   as `writer_diff`.
3. **obligations-scanner** — `buildInjectedObligationsDiffVariables` (`run:1620-1651`), same
   context plus the marker inventory section.

In parallel, at execution time, `createReviewerDiffAppendHook` (`runner:824-835`) appends the
`Reviewer Diff Context` block (`runner:807-809`) to the task prompt. `buildReviewerDiffContext`
(`runner:784-805`) prefers the **injected** context parsed from the variables
(`runner:722-743`), then falls through the same three live sources (`runner:745-777`). A
reviewer whose diff cannot be resolved keeps its task prompt and logs to stderr
(`runner:830-833`) — it is **not** refused.

The shipped reviewer system prompt
(`config/specialists/reviewer.specialist.json:41`) treats `reviewed_job_id` as a **required**
injected field and one of `reviewed_output` or the injected diff as a required evidence anchor,
and falls back to `sp ps` / `sp result` / `sp feed` (step 4-7) only when injection is absent.

### C.2 How evidence is linked to a job

- `reviewed_job_id` is resolved as `extractReviewedJobIdOverride(prompt) ?? args.reuseJobId`
  (`run:818-824`, `run:1949`), rendered as a template variable (`taskp:28`), and its presence
  is surfaced as `reviewed_job_id_present` on status/timeline/result
  (`sup:162,1470`; `tl:100`; `result:267`).
- `gitnexus_summary` is extracted from the reviewed job's last `run_complete` event
  (`runner:273-306`) and pre-injected (`runner:1150-1151`).
- `worktree_owner_job_id` carries chain provenance for `--job` reuse (`run:521`, mirrored in
  status).
- Diff evidence at write time is attached to the **auto-commit** event as `evidenceRefs[]`
  (`sup:1885-1927`), keyed by the commit SHA.

### C.3 How it is re-verified

- At write time: hunks are redacted (`gde:41`), inline vs artifact is decided by the 4 000-char
  limit (`gde:21,52-54`), and the actual files are the `git diff` output of a resolved range.
- At read time: the reviewer prompt requires confirming the writer's self-report against the
  full merge-base diff and the **live tree**, and states "the tree is the implementation truth"
  (`config/specialists/reviewer.specialist.json:41`, "Working-tree truth gate").
- `verifyExactLineCitation` (`cite:138-166`) re-reads the file at verify time and returns
  `stale_snapshot` if the line changed — but this is **not called by any dispatch path**
  (only `src/lib.ts:140-143` re-exports it, plus its own tests). It is a library capability,
  not a wired gate.

### C.4 Native equivalent and whether equivalence is proven

**Proven:** the *hook factory* is literally shared. `runner:824` is called by both
`runner:1173-1175` (legacy) and `host:985` (native), and `runner:811-823` states this
explicitly ("They are the same behaviour, so they are one function"; "the parity harness calls
this same factory (XTRM-84 4b)").

**Not proven — and in fact disproven on inputs:**

| Input to the shared hook | Legacy | Native | Verdict |
|---|---|---|---|
| `cwd` | the reused writer worktree (`run:525`) | `workspace.worktreePath` = coordinator cwd (`host:964`, `host:273-275`) | **different** — native diffs the coordinator's uncommitted tree, not a writer range |
| injected `reviewer_diff_*` variables | present (`run:1951-1953`) | **never set** (`host` sets no such variables) | **absent** |
| `reviewed_job_id` | set (`run:1949`) | **never set** | **absent** |
| `gitnexus_summary` | pre-injected (`runner:1150`) | not passed (`host` passes none; `taskp:199` supports it) | **absent** |
| obligations inventory | computed (`run:1342-1451`) | none | **absent** |
| hunk-coverage accounting | computed (`run:1543-1554`) | none | **absent** |

Because the injected context is absent on the native path, `buildReviewerDiffContext` always
falls through to live sources (`runner:758-776`), and the only source with content in an
in-place workspace is the "unstaged diff" of the shared tree. The reviewer therefore receives
the coordinator's whole working-tree delta, with no base pin, no changed-file attribution to
the writer, and no job linkage. `runner:819-821` records that before XTRM-84 4b "no test
exercised the branch, so deleting the hook from the native host would not have failed
anything" — i.e. the parity guard covers *hook presence*, not *evidence content*.

---

## D) Publication gates

### D.1 What must be true before merge/end (legacy), and who enforces it

| Gate | Enforcer | Evidence |
|---|---|---|
| Epic must be resolvable and not unresolved | `checkEpicUnresolvedGuard` | `merge:287-344`; `end:136-149` |
| All chain jobs terminal | `ensureTerminalJobs` | `merge:408-414` |
| Chains ordered by dependency | `topologicallySortChains` | `merge:416-470` |
| Epic has no running chains | `validateEpicMergeReadiness` | `epic:358-388`; model `epl:80-113` |
| Main repo clean (or overlap-free, shelved, restored) | `classifyMainRepoDirtyState` + `assertMainRepoCleanForMerge` + shelf/restore | `merge:563-687`, `merge:992-1007,1039-1043` |
| Branch carries a substantive, unpublished delta | `evaluateMergeWorthiness` | `merge:705-799` |
| Rebase then `merge --no-ff` succeeds | `rebaseBranchOntoMaster` + `mergeBranch` | `merge:828-867` |
| TypeScript compiles after merge | `runTypecheckGate` | `merge:869-884`, applied `merge:1024` |
| (optional) rebuild | `runRebuild` | `merge:897-909`, applied `merge:1034-1036` |
| Reviewer PASS is *not* a merge gate | — | reviewer PASS feeds **readiness** (`epr:64-160`), which `sp epic status/list` report; `validateEpicMergeReadiness` (`epic:358-388`) checks only running chains, **not** reviewer verdicts. The PASS gate is enforced operationally, not by the merge command. |

`sp end` adds no gate of its own: it infers a bead (`end:65-91`), applies the unresolved-epic
guard, and delegates to `merge` or `epic merge` (`end:99-151`).

**These gates are on a command declared broken.** `index:1197-1199` prints
`[broken] Do not use this command.`; `CLAUDE.md:243` says "**Merge is manual.** `sp merge` and
`sp epic merge` are prohibited… Use `git merge --no-ff feature/<bead>`… or `git update-ref`".
The sanctioned path therefore has **no code-enforced publication gate at all** — the gates
above are written but not exercised by the sanctioned workflow.

### D.2 Where native settlement/publication overlaps or conflicts

Native publication (`spub:515-683`) is a **different contract** and the overlap is nominal:

| Concern | Legacy publication | Native settlement publication | Conflict |
|---|---|---|---|
| Durable result store | timeline event + `specialist_results` + `artifacts/*.patch` + job dir | `SettlementStore` file record (`sstore:167-250`) + runtime result storage | none — separate stores, no shared key |
| Receipt | none | `boundary.allocateReceipt(executionBindingId)` → WorkReceipt id (`spub:603-605`) | none |
| Journal | `sp result` / `sp feed` / `sp log` read `observability.db` | `boundary.appendResult(issueRef, {result, executionContext, refs})` (`spub:629-639`) | none |
| Provenance | `base_sha_pinned` + `commit` + `evidence_ref` | `provenanceRefs: [executionBindingId, receipt.id]` (`spub:627`) | **no shared identifier** — legacy provenance is git-shaped, native provenance is substrate-shaped |
| Git commit required | yes (auto-commit RV-01; merge PB-05) | **no** — `spub:508-510` ("requires no Git commit (ADR §40): the zero-commit path publishes exactly like the code path") | **direct policy conflict**, resolved in favour of native (ADR §40); legacy auto-commit has no native successor |
| Workspace/branch in the envelope | `worktree_path`, `branch`, `base_sha_pinned` on the job row | `executionContext.workspace.{repoPath,worktree,branch,baseCommit}` — `branch` never set natively; `baseCommit` only from the binding (`spub:198-207`, `host:1689-1692`) | **native envelope is less specific than the legacy row** |
| Failure granularity | per-step refusal codes (`stale_base`, `base_fetch_failed`, merge worthiness) | `pending`/`refused` publication state with a bounded reason; `withSettlementExclusion` contention degrades to `pending` (`spub:674-682`) | different vocabularies; no mapping exists |
| Exactly-once | none claimed (auto-commit can repeat per turn) | exactly-once via exclusion lease + reconciliation read + receipt reuse (`spub:238-244`, `spub:674-682`) | native is strictly stronger |

**Verdict:** there is no functional overlap to reconcile — the two publication models do not
share a durable artifact, a commit, or an identifier. The conflict is **evidentiary**:
legacy evidence is *git-anchored* (commit SHA + base SHA + diff hunks), native evidence is
*substrate-anchored* (binding + receipt + Journal entry). A migration that retires the legacy
git artifacts without porting base pin and diff evidence loses the ability to answer "what
exactly did this run change, against what?" from native records alone. That is **BLOCKER-A**
and **BLOCKER-D** in §F.

---

## E) Core/`xt` ownership boundary

### E.1 What should move to Core

1. **Worktree provisioning, reuse, branch naming, and base re-pointing** (WT-01, WT-02,
   WT-04, WT-05, WT-06, WT-07). Core (`xt pi`/`xt claude`) already launches the coordinator
   into an isolated worktree — `host:259-262` states this as the reason a per-activation
   worktree was rejected ("isolation inside isolation"), and `wt:120-122` records that Core
   is the producer of `XTMUX_AGENT_BRANCH`. The legacy `sp` path duplicates Core's own
   topology. **Adapter required, not a lift-and-shift:** Core currently signals only the
   *branch*; migration needs Core to expose the session worktree path as a contract field so
   a Specialist can enter the right tree without re-deriving it from `git worktree list`.
2. **PR creation** (PB-13). `obs:1319` documents `pr_url` as "recorded by **xt** at PR
   creation". The legacy `sp --pr` path (publish branch + `gh pr create`) duplicates that.
3. **Branch-integration lineage ownership** (PB-14). `bie:23-28` already declares
   `target.role` and manual-merge auto-emission as Core-owned (`xtrm-3xgs5`, Cluster B) and
   unpopulated here.
4. **The compatibility bridge verbs** (PB-15) — until Core owns the store, `sp integration
   record|list` is the sanctioned shell-out (`integ:9-18`).
5. **Guard overrides and error envelopes tied to topology** (BT-02, BT-03) — they belong
   wherever the topology guard lands.
6. **Stale-base sibling guard** (WT-12) — it is a pre-dispatch topology check on sibling
   branches; with no worktrees there is no base to be stale relative to.
7. **The `--no-worktree` stub** (WT-03) is transitional and dies with the CLI; listed for
   completeness, not as a Core feature.

### E.2 What must stay in Specialists

1. **Base pin *as a review-evidence anchor*** (BT-01). Even if Core owns the session base,
   the *record of what this run measured against* is execution evidence and must survive in
   the Specialists record. Today it only exists on the legacy job row
   (`base_sha_pinned*`, `obs:627-631`) and is absent natively.
2. **Diff evidence bundle, redaction, and injected diff context** (RV-01, RV-02, RV-03,
   RV-04, RV-05 as an *input contract*). Review evidence is a Specialists concern; the shared
   hook factory should stay shared, but the **evidence** must be produced identically on both
   paths.
3. **`reviewed_job_id` job linkage and `gitnexus_summary` pre-injection** (RV-06, RV-07).
   Native-only gap, Specialists-owned contract.
4. **Reviewer verdict → readiness** (RV-09), epic state machine, epic advisory lock, epic
   drift/repair/abandon (PB-07, PB-08, PB-09, PB-10, PB-11) — live read/repair surfaces with
   no Core analogue.
5. **PR drift observation** (BT-04) — Core creates the PR; Specialists observes drift.
6. **Worktree GC and dead-job audit** (GC-01, GC-02) as long as any worktrees or legacy job
   rows exist; GC-01 must be re-pointed at the native lease store after cutover.

### E.3 Where equivalence could NOT be proven

| Claim | Why unproven |
|---|---|
| "The native lease replaces the worktree isolation guarantee" | The lease is a **single-writer** guarantee over a shared tree (`wlease:1-30`); a worktree is a **separate tree**. `host:264-268` names the accepted cost: "the coordinator is not a lease participant, so a coordinator edit and a write-tier activation can interleave." Different guarantees; substitution is asserted, not demonstrated. |
| "The reviewer sees the writer's changes natively" | True only because both run in place (`host:964`). There is no reuse protocol, no owner id, no base pin. If the coordinator switches trees between dispatches, the property breaks silently. |
| "Native settlement provenance replaces `base_sha_pinned` + commit SHA" | `provenanceRefs` are Substrate ids (`spub:627`); they do not name a git base or a commit. `workspace.branch` is never set (`host:273-275`) and `baseCommit` is binding-dependent. Not equivalent. |
| "`sp integration record` is a compatibility bridge to Core" | The direction is stated (`integ:4-18`) but no Core consumer was observable from this repo; see §G/UNKNOWN-1. |
| "The epic merge/PASS gates can be retired safely" | The commands are declared broken and the sanctioned path is manual (`CLAUDE.md:243`), but no code-enforced replacement gate exists. Retirement is a *deletion of written gates with no successor*, which must be an explicit decision. |

---

## F) GAPS + blocker list

| ID | Blocker | Evidence | Severity |
|---|---|---|---|
| **BLOCKER-A** | Native path produces **no diff evidence** of any kind | `src/activation/*.ts` contains no `git diff`, `numstat`, `evidenceRefs`, or diff-artifact reference | HIGH |
| **BLOCKER-B** | Native path pins **no base SHA and no branch**; `bindingBaseCommit` is binding-dependent | `host:1328-1330`, `host:273-275`, `spub:198-207,225-226` | HIGH |
| **BLOCKER-C** | Native reviewer has **no `reviewed_job_id`** and no `gitnexus_summary`, while the shipped reviewer contract declares `reviewed_job_id` required | `host:983-986`; `config/specialists/reviewer.specialist.json:41`; `runner:273-306` | HIGH |
| **BLOCKER-D** | Native publication requires **no git commit** (ADR §40) — deliberate — but the legacy commit+diff chain has no native successor, so "what changed" is unanswerable from native records alone | `spub:508-510`; `sup:1885-1927` | HIGH |
| **BLOCKER-E** | Worktree retirement cannot proceed until the **merge-path problem** is answered in Core | `host:264-271` ("Anyone reopening worktree provisioning must first answer the merge-path problem") | HIGH |
| **BLOCKER-F** | `sp merge`/`sp epic merge` are declared broken, so their gates are **not** enforced on the sanctioned manual path; retiring them removes written gates with no code successor | `index:1197-1199`; `CLAUDE.md:243`; `merge:287-909` | MEDIUM-HIGH |
| **BLOCKER-G** | GC-02 (`dead-job-audit`) declares itself a bridge that "retires" once the substrate reconciler ships (`dja:1-3`), and that reconciler now exists (`wrec:191`) — but the operator surfaces differ (`sp clean --reap-orphans` vs manual `reconcile`); the bridge can only retire after a surface mapping is settled | `dja:1-3`, `clean:623-660`, `doctor:1105-1130`, `wrec:191` | MEDIUM |
| **BLOCKER-H** | `sp end` is a **session-close** helper on the retired merge path with a legacy branch-name regex (`^feature/…`) that native `xt/<slug>` sessions do not match (`end:89`); removing it without a replacement breaks agent session-close flows | `end:89,131-151` | MEDIUM |
| **GAP-1** | `provisionWorktree` has **three** callers, not one: `run:457`, `node-sup:899`, `node-sup:1617`. Any ownership move must cover the `sp node` member-provisioning path, which has no native equivalent at all | GitNexus `impact provisionWorktree` (ambiguous, 2 candidates) + grep | HIGH (scope) |
| **GAP-2** | The console diff view (`console-rt:448-494`) depends on both the worktree and `last_auto_commit_sha`; it has no data source on the native path | `console-rt:473-482` | MEDIUM |
| **GAP-3** | No mapping exists between legacy refusal codes (`stale_base`, `base_fetch_failed`, merge-worthiness reasons) and native `DispatchRejectedError` reasons / settlement `pending`/`refused` states | `run:725-751`, `merge:774-799`, `host:876-893`, `spub:574-583` | MEDIUM |

---

## G) UNKNOWNs

| ID | Unknown | Reason it is unknown |
|---|---|---|
| UNKNOWN-1 | Whether any Core (`xt`) process consumes `xtrm.branch.integration.v1` today, which would pin the PB-14/PB-15 retirement order | The comments assert a Core consumer (`integ:6-12` cites `xtrm-vtqlg.2`, `xtrm-1pc8c`) but the Core repo is not in this workspace and was not read. `grep` in this tree finds only the producer and the `sp integration list` reader. |
| UNKNOWN-2 | Whether Core exposes the session worktree path as a contract field (needed for the E.1 adapter) | `wt:120-128` documents `XTMUX_AGENT_BRANCH` + `@agent_branch` and explicitly excludes `@agent_worktree` ("the branch is the contract, the path is informational"). Whether a path field exists in the current Core contract could not be verified from this repo. |
| UNKNOWN-3 | Whether `verifyExactLineCitation` has external consumers | It is exported from `src/lib.ts:140-143` (public SDK surface) and has unit tests, but no in-repo producer calls it. A public export is not proof of no consumer, so the row is PRESERVE_NATIVE with the proof gap stated rather than DEAD_AFTER_CUTOVER. |
| UNKNOWN-4 | Whether `--force-stale-base` (deprecated alias) still has external callers | `run:190-193` says "Aliased for one release"; release date of that change and any caller outside the repo were not checked. |
| UNKNOWN-5 | Whether the Substrate `ExecutionBinding` reliably carries `baseCommit` in practice | `host:1328-1330` reads it defensively and omits it when absent; the prevalence is a runtime/substrate property not observable from this tree. |
| UNKNOWN-6 | Whether the `stale_base` guard is reached on the targeted cutover path | `resolveBasePin` short-circuits unless `args.worktree || args.baseSha` (`run:772`); native never sets either, so the guard is silently inert natively rather than equivalent. |
| UNKNOWN-7 | Whether `.beads` skip-worktree/hooksPath fixes (WT-07) are still needed under the current bd version | The code itself writes "No-op for the vast majority of repos surveyed 2026-05-12" (`wt:291-293`) and calls itself "cheap insurance". |

---

## H) Unrelated findings

1. **`snapshot-diff.ts` is mis-anchored in this lane's brief.** `snd:22-69` is a job-list
   snapshot materializer used only by the console (`src/cli/console/components.ts:49,371-377`).
   It is a verbatim port of a gitboard materializer (`snd:1-12`) and performs no git work. It is
   recorded as RV-12 (`obsolete-duplicate` / `FRONTEND_ONLY`) only so the brief's anchor list is
   fully dispositioned. It has no worktree/git/review/release behaviour.
2. **`provisionWorktree` is shared with the `sp node` execution path** (`node-sup:899`,
   `node-sup:1617`), including a dynamic-member `worktree_from` inheritance mode
   (`node-sup:1605-1616`). This lane's brief named only `run.ts`, `worktree.ts`, and
   `worktree-gc.ts`; the node-supervisor consumers materially widen the blast radius of any
   WT-01 ownership move. Raised here because it is a scope discovery, not a worktree-only
   finding. GitNexus `impact provisionWorktree` returned `risk: UNKNOWN` with two ambiguous
   candidates, so the caller set was confirmed by text search per the GitNexus doctrine.
3. **The `sp merge` PR path creates the same `gh pr` artifact that `xt` is documented to
   own** (`merge:1072-1095` vs `obs:1319`). Two producers for one durable artifact
   (`pr_url`) is a standing duplication independent of the migration; it is captured as
   PB-13/BT-04 rather than as a defect, because the legacy command is already declared
   broken.
4. **`sp doctor` couples PR-drift refresh and dead-job audit into one command**
   (`doctor:1046`, `doctor:1117`), so the two have different native futures (PR drift is
   preserved; dead-job audit is a self-declared retiring bridge) while sharing one operator
   entry point. Whoever splits them must split the command, not just the code.
