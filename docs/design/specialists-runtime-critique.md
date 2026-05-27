# Specialists Runtime — Architectural Critique

> **⚠️ STATUS: SUPERSEDED — consolidated into `specialists-friction-audit.md` §1 (Architectural framing).**
>
> The content of this doc has been folded — distilled and integrated — into the canonical consolidated friction-audit. New work should reference the consolidated audit, not this file. This file is preserved for git-history continuity (it shows the reasoning step that produced the critique) but is no longer source-of-truth.
>
> **Canonical replacement:** `docs/design/specialists-friction-audit.md` §1.
>
> ---
>
> *Original purpose (historical):* Identify the architectural shape errors in the current `sp` runtime, distinct from the symptom-level catalog in `specialists-friction-audit.md`. The audit asks "what hurts and what bridge fixes it"; this doc asks "what is the runtime *shape* getting wrong, and why does the container model in substrate fix it by inversion." Prepared as context for the substrate revision 9 review so the specialists-side cleanup is grounded.
>
> **Method.** Code reading of `src/specialist/{chain-identity, supervisor, runner, control, worktree}.ts` + `src/cli/run.ts` cross-referenced against observed friction in `.xtrm/reports/` and against the substrate-review document.
>
> **Scope.** Six asymmetries. For each: what the code does today, why it hurts, how the container model inverts it. The fix is structural — bridges that preserve the asymmetry are wasted effort.

---

## The shape problem in one sentence

The current runtime treats *jobs* as first-class entities and *chains* as a derived projection over the job graph. Substrate's container model inverts this: containers are first-class, jobs (participants) are tenants of containers. Six concrete asymmetries fall out of the inversion.

---

## Asymmetry 1 — Executor is the privileged chain bootstrapper

**What the code does.** `chain-identity.ts:38-39`:

```ts
const chainRootJobId = status.chain_root_job_id
  ?? status.worktree_owner_job_id
  ?? status.id;
const chainId = status.chain_id ?? chainRootJobId;
```

The chain id defaults to the worktree-owner job id, which defaults to the job's own id. There is no `chain` row; the chain is computed by walking back to the worktree-owning job, which in practice is the first specialist dispatched with `--worktree`. By convention that is the executor.

The CLAUDE.md gotcha **"--worktree and --job are mutually exclusive"** is the operator-facing surface of this asymmetry: only the first dispatch may carry `--worktree`; everyone after must use `--job <first-job>` to enter the workspace.

**Why it hurts.**

- Executor is structurally the chain owner even when the chain is *conceptually* something else (a debug investigation, a planning seed, a documentation sweep). The role gets uniform privilege regardless of fit.
- Killing the executor's job (`sp stop`) implicitly destroys the chain — every other specialist that referenced `--job <exec>` loses its anchor.
- A debugger that wants to *open* a fresh investigation worktree must also use `--worktree`, which means debugger becomes "the new executor" for chain-identity purposes. The role names become misleading.
- The first-dispatched role's identity is permanent (the job id never changes), so a chain originated by a *temporary* role (e.g., a probe-explorer that you wanted to throw away) cannot be cleanly demoted to a member.

**How containers invert.** The container is opened *before* any participant is dispatched (`sb container open --workflow X --issue Y`). Container has its own id (`chain:7f3a`), independent of any participant. Participants are spawned *into* the container; none of them is privileged. Executor becomes a role with no special powers — it can be dispatched first or after other roles (e.g., explorer-first, then executor) without changing the chain identity. The "first-job creates chain" coupling is removed.

---

## Asymmetry 2 — Worktree is owned by a job, not by the chain

**What the code does.** The worktree is created during the first `sp run --worktree` dispatch. The owning job id is stamped on the worktree via `worktree_owner_job_id`. When the job ends, the worktree is *not* automatically destroyed — but it is no longer owned by any live entity. Future specialists join via `--job <owner>`, even after the owner's pi session has gone to `waiting` (keep-alive) — that's why keep-alive must hold the owner alive.

**Why it hurts.** Observed in `.xtrm/reports/`:

- **Orphan worktrees from prior sessions** (mercury 2026-05-25 §"6 pre-existing orphan worktrees"): worktrees survive their owning jobs' termination; nobody cleans them up because they're no longer attached to anything actionable.
- **Stale-base guard false-positives** (audit §B5, §8.2): the orphan worktrees' branches still exist; the guard sees them as "unmerged sibling chains" and refuses dispatches — operator normalizes to `--force-stale-base`, the guard loses signal.
- **Keep-alive must hold the executor's pi session** (audit §8.1): not because the LLM needs to stay loaded, but because the *workspace handle* (the `--job` target) is bound to a job. Lose the job, lose the handle.

**How containers invert.** The container owns the worktree for its whole lifetime. When the container moves to a terminal state (`closed:merged`, `closed:abandoned`, `closed:failed`), the worktree is reaped per the container-teardown handler (substrate.md §5.10 already specifies this). Jobs come and go; the worktree persists across them. Keep-alive holds *pi sessions* alive for resume convenience but is no longer load-bearing for workspace identity — that lives in the container.

---

## Asymmetry 3 — Chain has no first-class entity row

**What the code does.** No `chains` table. `chain_id` is a column on jobs (`chain_id`, `chain_root_job_id`, `chain_root_bead_id` per chain-identity.ts:9-11). The chain is reconstructed by aggregating jobs that share a `chain_id`. Queries like `listEpicChainsWithLatestJob` walk the job table and project chain views.

**Why it hurts.**

- No place to attach chain-level state: resolved workflow, chosen scrutiny, collision matrix, accumulated evidence index, budget consumed. Substrate-review §25 (workflow definition) needs `resolved_workflow_json` on the container — there is no analog in current runtime.
- Chain advancement is *implicit*. The "what step is next" decision has no row to consult — it lives in operator's head or in the SKILL.md prose. This is the orchestrator-laziness root cause (audit §B): the runtime has no model of "where is this chain in its workflow," so the operator has to carry it.
- Reporting and dashboards (substrate.md §12) need a chain-level row to render against. The current job-graph projection is OK for `sp ps` (time-ordered list) but cannot answer "what's the state of chain X end-to-end" without expensive walks. Audit §3.4 (`sp chain <bead>`) is exactly this gap.
- Re-running a chain (re-dispatch after a failure that abandoned the workspace) creates a *new* chain id because the worktree creator changes. The chain has no continuity of identity across reattempts.

**How containers invert.** Container is a row in `containers` with stable id. All chain-level state (workflow, scrutiny, collision strategy, budget, evidence index) attaches to it. Jobs reference `container_id` instead of synthesizing chain identity. `sb container ps --tree` is a primary-key lookup, not a graph walk.

---

## Asymmetry 4 — Keep-alive paradox: pi session held alive because workspace has no other persistence handle

**What the code does.** `--keep-alive` makes the first specialist's pi session stay in `waiting` after `agent_end` (supervisor.ts:1658, 1974). This is what lets later specialists `--job <owner>` into the same workspace.

**Why it hurts.**

- The pi session holds context, memory, tool state — all expensive — *only because the workspace identity is bound to its job id*. The keep-alive is paying for workspace handle, not for LLM-state reuse.
- A simple "review this diff" chain that doesn't need executor resumability still holds executor's pi session in memory until `sp finalize` releases it. Operator-forgets-finalize = resource leak (audit §8.1).
- Re-spawning the executor after a crash means re-creating the chain identity (Asymmetry 1) — so transient crashes destroy chains. No graceful "the executor died, here's a fresh one for the same chain."
- Pi has its own keep-alive semantics around `agent_end` (per `pi-rpc.md` and `--keep-alive`); substrate-review §19 maps this 1:1. But conflating *pi session keep-alive* with *chain workspace persistence* forces the two lifetimes to be the same, when they are conceptually independent.

**How containers invert.** Workspace persistence is a *container* property. Pi keep-alive is a *participant* property (useful when the operator wants to resume that specific LLM session). The two are decoupled. A reviewer chain can open a container with no pi session kept alive — the workspace is held by the container regardless. Substrate-review §19 already establishes that substrate aligns to pi turns; this asymmetry is the missing piece — the workspace handle moves out of the pi-session lifetime.

---

## Asymmetry 5 — `--bead` conflates work contract with chain key

**What the code does.** `sp run <role> --bead <id>` passes the bead in two roles simultaneously:
1. **Contract**: what to do, success criteria, scope, validation — the prompt input.
2. **Identity key**: `chain_root_bead_id` is set from this bead, and all subsequent jobs in the chain inherit it (or override via `--bead` to a different bead, e.g., reviewer's own tracking bead).

The reviewer/code-sanity discipline (SKILL Rule 7) is: reviewer uses its *own* tracking bead via `--bead`, but enters executor's workspace via `--job`. So we end up with two beads in play: the *target* bead (executor's bead, which is the chain root) and the *tracking* bead (reviewer's bead, which is purely for audit).

**Why it hurts.**

- Audit §R4: operator confuses tracking-bead with target — passes `--bead <reviewer-tracking-bead>` instead of `--bead <target>`. The conflation makes this a natural error.
- The "chain root bead" is determined by whichever bead the first specialist received. If the first dispatch happens to be a probe-explorer for a different bead than the eventual target, the chain inherits the probe's bead as root — confusing later attribution.
- Followup beads (`discovered_from`) cannot cleanly join a running chain: there's no "the chain is doing work *for* bead X" abstraction; you'd have to dispatch a new specialist with `--bead Y` and somehow link it, but the chain's `chain_root_bead_id` is already fixed.
- Workflow defaults derive from the bead (its `type` resolves to a workflow per substrate-review §25), but the chain-level "this is the resolved workflow" has no place to live (Asymmetry 3).

**How containers invert.** Container has its own id and explicitly references its target issue(s) via the issue-membership edges (substrate §6.7). The container is not "named after" any one issue — it's named after itself. The reviewer's tracking bead and the executor's target bead are both *issues that are members of the container*, with explicit roles (`role: validates`, `role: implements`). No conflation possible because the chain key is not a bead at all.

---

## Asymmetry 6 — Reviewer-as-parasite: cannot exist without executor

**What the code does.** Reviewer must be dispatched with `--job <exec-job>` to enter the executor's workspace. Without it, reviewer runs in a clean checkout and reviews against the contract only, with no diff visible (audit §R1). The runtime structurally encodes "reviewer is a follower of executor."

**Why it hurts.**

- A reviewer cannot review *anything but executor output*. Cannot review a manually-applied patch, a PR from outside the sp flow, a debugger's diff, a cherry-pick attempt. The role is locked to one input shape.
- The Iron-style pipeline (substrate-review §25, "code-standard" workflow) wants `executor → code-sanity → security-auditor → obligations-scanner → reviewer`. Code-sanity is supposed to gate before reviewer. But code-sanity also uses `--job <exec-job>` — it shares the executor-parasite shape. None of the gate specialists can exist as first-class workspace inhabitants.
- A "fresh review of pre-existing code" use case (`sb container open --workflow security-audit-only --no-executor`) has no place in the current model. Reviewer cannot bootstrap a container.

**How containers invert.** Any participant kind can be the first or only participant of a container. A `security-audit-only` container has a reviewer (or security-auditor) as its sole participant, working on a worktree the container created from a specified base. No executor required. This is the *unbound participant* concept of substrate-review §15 generalized — participants don't have implicit ordering hierarchy.

---

## What collapses cleanly under containers

Each asymmetry above maps to a substrate primitive that already removes it:

| Asymmetry | Removed by |
|---|---|
| 1 — Executor as chain bootstrapper | Container open is a substrate-level action (§4 container kinds); specialists are spawned into existing containers (§7.1 spawn-into-container) |
| 2 — Worktree owned by job | Worktree owned by container; reaped on container terminal state (§5.10 teardown) |
| 3 — Chain has no entity row | `containers` table is canonical (§13.3) with `resolved_workflow_json`, `collision_strategy_json`, evidence index |
| 4 — Keep-alive paradox | Container workspace lifetime independent of any pi session; pi keep-alive becomes purely about LLM-state convenience (§19) |
| 5 — `--bead` conflation | Container has its own id; issues are members via edges (§6.7); reviewer-tracking-bead and target-bead are both members with explicit roles |
| 6 — Reviewer-as-parasite | Any participant kind opens any container; no implicit ordering (review §15 unbound participants) |

---

## What this means for the rev-9 review

When substrate revision 9 arrives, the specialists-runtime refactor that comes with it should:

1. **Stop adding bridges to the current asymmetries.** Each of the friction-audit §3/§7 patches (`sp chain`, post-dispatch hint, etc.) is fine *as long as* it does not entrench the executor-as-chain-root model. The proposed `sp chain <bead>` is at risk — it implicitly assumes one bead per chain, which is Asymmetry 5. Better surface eventually: `sb container ps <container-id>`.
2. **Plan an order of operations.** Container model can't land all at once. Suggested staging (parallel to substrate.md §15 Sequencing):
   - Stage A: introduce `containers` row (Asymmetry 3 fix) as additive — jobs still have `chain_id`, but it also points to a real container.
   - Stage B: move worktree ownership from job → container (Asymmetry 2 + 4). Keep-alive becomes optional.
   - Stage C: open containers explicitly before dispatch (Asymmetry 1 + 6). `sp run` becomes "spawn participant in container <id>" with `--container` flag.
   - Stage D: issue membership edges replace `chain_root_bead_id` (Asymmetry 5). Existing `--bead` flag becomes a shortcut for "open container from this bead's contract."
3. **Stop teaching the SKILL the workarounds.** Once Stage A lands, drop the "`--worktree` and `--job` are mutually exclusive" gotcha from CLAUDE.md — the workaround disappears with the asymmetry. Same for the keep-alive-must-be-on-first rule.
4. **The friction audit's Layer 3a (Claude Code hook on `bd create`) is unaffected.** It operates one layer above runtime — it suggests chain shape from bead content, no matter how the runtime executes it. Land it independently.
5. **The friction audit's Layer 3b (sp-runtime hints) needs re-targeting.** `sp run` post-dispatch hint currently says "next: code-sanity --job <this-job>." After Stage C it should say "next: code-sanity --container <id>" — the hint generator needs to know which world it's in. Plan for the migration in the hint template, not as an afterthought.

---

## Open question for the rev-9 author

The current runtime conflates *workspace identity* and *job identity* in subtle ways throughout (chain-identity.ts, branch naming `feature/<bead>-<role>`, the `--job` flag semantics). The rev-9 substrate design should make explicit: **is workspace identity exposed in the runtime API**, or is it strictly internal to substrate? If the former, the SDK gets a `workspace_id` first-class concept; if the latter, all operations are container-scoped and workspace is private. Either is defensible; the design should pick one and commit, because the half-and-half state (which is where we are now with `--job` as workspace handle) is what produced the six asymmetries above.
