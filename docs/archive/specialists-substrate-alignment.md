> **ARCHIVED 2026-05-27** — content superseded by:
> - `docs/design/substrate/specialists-roadmap-revised.md` (canonical specialists roadmap; absorbed this file in §0/§3.2/§12/§13)
> - `docs/design/substrate/substrate.md` rev10 (canonical substrate design)
> - `docs/design/chain-templates/` (13 evidence-backed bd formulas)
>
> Preserved for historical context. Do not edit. Do not cite as authoritative.

---

# Specialists ↔ Substrate Alignment — What `sp` Can Adopt Today

> **⚠️ STATUS: SUPERSEDED — consolidated into `specialists-friction-audit.md` §3 (Substrate-aligned patch roadmap) and §10 (Master sequenced rollout).**
>
> The nine alignment opportunities described here have been folded into the canonical consolidated friction-audit, with each opportunity enriched by (a) the friction tag it closes, (b) the architectural asymmetry it removes, (c) explicit reads-forward note to a substrate rev-9 section. The sequencing has been unified with the orthogonal hook/hint/bootstrap layers into a single master rollout. New work should reference the consolidated audit, not this file. This file is preserved for git-history continuity (it shows the reasoning step that produced the alignment thinking) but is no longer source-of-truth.
>
> **Canonical replacements:**
> - `docs/design/specialists-friction-audit.md` §3 (opportunities, enriched with cross-references)
> - `docs/design/specialists-friction-audit.md` §10 (master sequenced rollout)
> - `docs/design/specialists-friction-audit.md` §11 (open questions, consolidated)
>
> ---
>
> *Original purpose (historical):* Substrate revision 9 has resolved the six architectural asymmetries called out in `specialists-runtime-critique.md`. The full container model is months away. This doc identifies the **alignment opportunities** — patches `sp` can take *today*, without substrate, that (a) reduce concrete friction now and (b) read forward unchanged into the rev-9 model, so we are not building bridges we'll demolish.
>
> **Method.** Cross-reference rev-9 specifically §3 / §6.9.2 / §6.9.5 / §6.9.6 / §6.9.7 / §11 against the current sp runtime (`src/specialist/{chain-identity,supervisor,runner,worktree}.ts`, `src/cli/{run,finalize}.ts`).
>
> **Selection criterion.** Each opportunity must (1) be implementable without the substrate daemon or `containers` table, (2) survive into the rev-9 world without rework, (3) close a friction the audit catalogued or remove an asymmetry the critique named.

---

## How rev-9 maps to the critique

For reference. Each asymmetry from `specialists-runtime-critique.md` has a rev-9 home:

| Asymmetry | Rev-9 answer |
|---|---|
| 1 — Executor as chain bootstrapper | §6.9.5 chain composition is an explicit step (`sb chain review` / `approve`); first dispatch is daemon-driven from resolved shape |
| 2 — Worktree owned by job | §6.9.6 worktree **lease** — owned by container, acquired by writer-steps, released on quiescence |
| 3 — Chain has no entity row | §6.9.2 resolved shape persisted on the container; §13.3 has the rows |
| 4 — Keep-alive paradox | §6.9.6 lease releases on `agent_end` (pi quiescence per §19) — pi keep-alive decouples from workspace persistence |
| 5 — `--bead` conflates contract+key | §6.9.2 dual contract: root carries **change-contract**, step carries **step-contract** (different shapes for different things) |
| 6 — Reviewer-as-parasite | §6.9.6 read-only steps **do not acquire** the lease; can coexist or run alone |

Now the bridges.

---

## Opportunity 1 — Worktree lease as a shimmed column on chain-identity

**Now.** Add `worktree_lease_held_by` and `worktree_lease_state` columns to the chain-identity / status row (today: jobs table; later: containers table). Patch `sp run`:

- Writer-step (executor, debugger) + lease is `free` → acquire on dispatch, release on `agent_end` (supervisor.ts:1658 is already the right hook).
- Writer-step + lease is `held` by another live job → **queue** the dispatch (refuse with `WAIT: lease held by <job>; queued, will dispatch on release`).
- Read-only step (anything tagged `permission: READ_ONLY` in its `.specialist.json`) → **do not touch** the lease; bind to the worktree path directly.

**Why.** Closes Asymmetry 2 + a big part of Asymmetry 4 and 6 in one shot. The `--worktree` and `--job` mutually-exclusive rule (CLAUDE.md gotcha) becomes derivable from lease state rather than from a flag combination. Debugger-restitch becomes natural: executor releases on quiescence, debugger acquires.

**Reads forward.** Rev-9 §6.9.6 *is* this column, moved from job to container. Implementation today on jobs table → migration is a rename + ownership transfer, no semantic change.

**Cost.** ~1 day. SQLite migration + 3 patches in supervisor/run/finalize.

---

## Opportunity 2 — READ_ONLY specialists bind by path, decoupled from owner keep-alive

**Now.** Today: reviewer/code-sanity using `--job <exec-job>` requires the executor to be in `keep-alive` (waiting state). The reason is workspace handle, not LLM-state reuse (audit §8.1, critique Asymmetry 4). Patch:

- When the dispatched specialist is `permission: READ_ONLY`, runner binds to the worktree **path** stored on `--job <owner>` (read once, cached) instead of requiring the owner to be alive.
- Owner can be `done`, `closed`, even kill -9'd — the read-only reviewer enters the worktree on its own pi session, reads the diff against the lease's base, produces evidence.
- `--job <owner>` becomes purely **workspace pointer**, no longer **liveness pointer**, for read-only roles.

**Why.** Removes the most expensive single dependency in the current runtime: forcing executor's pi session to stay loaded in memory only so reviewer can `--job` into it. Closes Asymmetry 6 (reviewer-as-parasite). Reduces resource leak when operator forgets `sp finalize` — executor can be reaped earlier.

**Reads forward.** Rev-9 §6.9.6: "read-only steps do not acquire the lease, do not require any writer to be live." Patch today implements the same semantics with `--job` becoming a workspace-path lookup. When containers land, the lookup target moves from job→container; the surface is identical.

**Cost.** ~1 day. Runner change + `permission: READ_ONLY` audit on each specialist .json (already exists per SKILL §Specialist File Locations).

**This is the highest-leverage runtime patch in the alignment set.**

---

## Opportunity 3 — Persist resolved chain shape as data, not as job-graph projection

**Now.** Add a thin `chain_shapes` table (or `~/.specialists/chains/<chain-id>.json` files) storing the *resolved* sequence of steps for a chain at the moment composition completed:

```jsonc
{
  "chain_id": "feature/forge-eorh.48",       // current chain-identity key
  "template_name": "code-standard",          // one of the 6 from review §25.3
  "resolved_steps": [
    { "role": "executor",          "status": "completed", "job_id": "cc5fcc" },
    { "role": "code-sanity",       "status": "completed", "job_id": "d6eacc" },
    { "role": "obligations-scanner", "status": "completed", "job_id": "..." },
    { "role": "reviewer",          "status": "running",   "job_id": "7b3775" }
  ],
  "composed_at_ms": 0,
  "composed_by": "orchestrator:auto" // or "operator:explicit" 
}
```

Written when the orchestrator dispatches the first step (or via the new `sp chain plan` command — Opportunity 5). Updated as steps run.

**Why.** Closes Asymmetry 3 (no entity row). Unlocks `sp chain <bead>` (audit §3.4) as a primary-key lookup instead of a graph walk. Makes the daemon-advances-chain promise of rev-9 §3 implementable on a small scale today — the daemon can read this row and know "next step is X" without orchestrator instruction.

**Reads forward.** Rev-9 §6.9.2 "resolved shape persisted as container state" *is* this row, attached to a container instead of a chain-identity blob. Migration: rename column, attach to container row.

**Cost.** ~2 days. Table + writer in `sp run`'s dispatch path + reader in `sp ps` / proposed `sp chain`.

---

## Opportunity 4 — `sp chain plan <bead>` as the composition gate, today

**Now.** New command. Resolves the chain shape for a bead before any `sp run`:

```
$ sp chain plan forge-eorh.48
Resolved template: code-standard (matched type=task, scrutiny=medium, scope=production)
  1. executor          (gpt-5.4-mini, ~3-6m)
  2. code-sanity       (gpt-5.4-mini, ~1-3m)        [mandatory gate, READ_ONLY]
  3. obligations-scanner (gpt-5.4-mini, ~30s)       [mandatory gate, READ_ONLY]
  4. reviewer          (gpt-5.3-codex, ~2-4m)       [scrutiny may auto-escalate]

Run `sp chain dispatch forge-eorh.48` to execute.
Run `sp chain insert forge-eorh.48 --role <r> --before <step>` to modify.
```

The plan is *persisted* (Opportunity 3) once approved. Dispatch follows the persisted shape.

**Why.** Closes Asymmetry 1 (executor as bootstrapper) — chain composition becomes an explicit operator action *before* any role is dispatched. The `executor` is no longer special; it's just the first step that happens to be next per the resolved template. Forces the orchestrator to articulate the chain shape (instead of "dispatch executor, see what happens").

**Reads forward.** Rev-9 §6.9.5 / §11.1 `sb chain review` + `sb chain approve` are exactly this command shape. Today's `sp chain plan/dispatch/insert` maps 1:1 to tomorrow's `sb chain review/approve/insert`. The CLI verbs survive the migration; just the binary changes (`sp` → `sb`) and the data layer flips (jobs-table → containers-table).

**Cost.** ~2 days. New CLI surface + reader of Opportunity 3 data + integration with the 6 hard-coded templates from review §25.3.

---

## Opportunity 5 — Split step contracts from root contracts in bd today

**Now.** Convention + tooling, not schema change:

- A **root bead** continues to use the change-contract sections (`PROBLEM/SCOPE/NON_GOALS/VALIDATION/ACCEPTANCE`).
- A **step bead** uses a different section set: `MANDATE/INPUTS/OUTPUTS/SCOPE/NON_GOALS`. Detected by tag `kind:step` or by title pattern `<role>:<root-id>` (e.g. `code-sanity:forge-eorh.48`).
- The Claude Code hook on `bd create` (friction-audit §7.3) detects the title pattern and proposes the step-contract template instead of the change-contract template.
- SKILL.md teaches the distinction; existing reviewer/code-sanity tracking-beads can be migrated lazily as they get touched.

**Why.** Closes Asymmetry 5 (`--bead` conflates contract+key). Reviewer beads stop producing the bad-fit "problem: do the review" — they have the right shape from the start. Operator can no longer confuse tracking-bead with target-bead because they *look different* (different sections rendered).

**Reads forward.** Rev-9 §6.9.2 dual-contract is exactly this split, formalized as schema. Today's tag-and-template convention reads into the rev-9 issue store cleanly — every step bead becomes a `class: step` issue with its `step_contract` populated from the existing fields.

**Cost.** ~1 day on the hook side; SKILL.md update is no-code. The migration of existing step-beads happens organically as they're touched.

---

## Opportunity 6 — Derive worktree/branch names from chain identity, not from creator role

**Now.** Today: branches named `feature/<bead-id>-<role>` (role of creator). Switch to `chain/<bead-id>` for the writer-branch — no role suffix. The worktree mirrors: `.worktrees/chain-<bead-id>`.

If a debugger takes over (post-executor quiescence per Opportunity 1), the branch name doesn't change — the *role of the current writer* moves through the same branch. This matches the rev-9 §6.9.6 "worktree handed off, not renamed."

**Why.** Closes part of Asymmetry 3. Stops surprising naming when a chain's identity-of-the-moment changes (executor → debugger). Aligns with rev-9 §6.9.7 names-derive-from-membership.

**Reads forward.** Rev-9 §6.9.7 names are `wt/epic-<id>/chain-<id>` — extends our `chain-<id>` cleanly when epics land. The names get richer as containers nest; the chain layer stays the same.

**Cost.** Half-day. Branch-naming template in worktree.ts.

---

## Opportunity 7 — `--accept-stale-base --reason` rename (audit §B5, restated as alignment)

**Now.** Per friction-audit §B5: rename `--force-stale-base` → `--accept-stale-base --reason "<text>"`. Refusal envelope gains structured fields (`{ ok: false, error_code: 'stale_base', blocked_by: [...], next_safe_action: 'diagnose|accept|abandon-chain' }`).

**Why.** Already documented; named here for completeness.

**Reads forward.** Rev-9 §21 (precondition violation as §6.4 gate) wraps this exactly. The refusal envelope matches channels.md §10.2 shape used throughout substrate. The `--accept --reason` pattern survives unchanged into `sb dispatch <issue> --allow-unready --reason "..."` of §11.2.

**Cost.** Half-day (the audit's existing estimate).

---

## Opportunity 8 — Emit a `step_completed` event with workflow-derived next-step recommendation

**Now.** When a specialist finishes (pi `agent_end`), supervisor already writes a status row. Extend with a `next_step_recommendation`:

- Look up Opportunity 3's resolved-shape row for this chain
- Find the just-completed step's index
- Compute the next step from the template
- Emit a `runner_event` of kind `step_completed` with `{ completed: <role>, next: <role-or-null>, next_dispatch_command: "sp run <next> --bead <root> --job <this-job> --background" }`

`sp result` (friction-audit §3.2) reads this and prints the next-step suggestion.

**Why.** Bridges to rev-9 §3's "daemon advances the chain on member agent_end" promise. Today it's a *recommendation* (the orchestrator still types the `sp run`); under substrate it becomes an *automatic dispatch*. Same data, two consumption modes.

**Reads forward.** When substrate's daemon takes over advancement, the same event payload flows into the daemon's auto-dispatch path. No data-shape change.

**Cost.** ~1 day. Supervisor write + sp-result read.

---

## Opportunity 9 — Composition-nudge table as a tooling layer

**Now.** Rev-9 §6.9.5 L1 nudges (programmatic deterministic suggestions: "no explorer-evidence in scope → consider explorer") are a small lookup table. Implementable today:

- `~/.config/specialists/composition-nudges.yaml`: rules with `applies_when` matchers (the same matcher syntax substrate uses everywhere — §5.2/§6.9.3) producing "consider X because Y" hints.
- Consumed by the `sp chain plan` command (Opportunity 4) and by the Claude Code hook on bd create (audit §7.3).
- The nudge is *informational*, not refusal. Same shape as substrate's L1 nudge.

**Why.** Closes the "orchestrator forgets the explorer on a HIGH blast" category of B-class friction (B2). The rule is in a config file, can be tuned per-repo. Most importantly: the rule *raises the question*, doesn't auto-add — preserving the orchestrator's judgment.

**Reads forward.** Rev-9 §6.9.5 L1 is the same table, evaluated by substrate's composition-gate. Today's YAML is the schema substrate adopts as-is.

**Cost.** ~1 day. YAML schema + matcher engine (reuse the matcher from existing seed-invite logic if any; otherwise minimal glob/regex/keyword evaluator).

---

## Sequencing — what to land first

Each opportunity is independent and reversible. Suggested order, by leverage-per-day:

| Stage | Opportunity | Cost | Unlocks |
|---|---|---|---|
| **0** | #2 — READ_ONLY binds by path, decouples from keep-alive | 1 day | Removes most expensive single asymmetry (4+6 partial); enables forgotten-finalize cleanup |
| **1** | #1 — Worktree lease columns | 1 day | Closes Asymmetry 2; makes #4 + #6 fully implementable |
| **2** | #3 — Persist resolved chain shape | 2 days | Closes Asymmetry 3; enables #4 and #8 |
| **3** | #4 — `sp chain plan` command + #8 next-step events | 2-3 days combined | Closes Asymmetry 1; gives `sp chain <bead>` from audit §3.4 |
| **4** | #5 — Step bead conventions in Claude hook | 1 day | Closes Asymmetry 5 (cheap, mostly tooling) |
| **5** | #6 — Branch name derives from chain | Half-day | Closes the naming part of Asymmetry 3 |
| **6** | #7 — `--accept-stale-base --reason` rename | Half-day | Friction audit B5 |
| **7** | #9 — Composition-nudge YAML | 1 day | Friction audit B2 + bridges L1 nudges to substrate |

**Total: ~10 days of focused work** to retire all 6 asymmetries' bridges and leave sp in a shape that maps 1:1 onto rev-9 when substrate's daemon and store land.

---

## What this does NOT do

Honesty about scope:

- **Does not implement the seed/planning container.** Seed lives in substrate proper (§5 of rev-9). The composition we're doing here is Moment 2 only (chain pre-dispatch); Moment 1 (seed → root issues) waits.
- **Does not implement the channel primitive.** Channels stay where they are (specialists already has the v0 sketch per channels.md §11 sequencing); the alignment work here is on chain shape and worktree, not on inter-specialist messaging.
- **Does not introduce a containers table.** All 9 opportunities work against the current chain-identity row shape, extended. The containers table comes with substrate Stage 4 of §15 sequencing.
- **Does not remove `sp finalize`.** Until container-level transactional close (substrate §22 of the review) lands, `sp finalize` is the close trigger. Opportunity 2 reduces the *urgency* of forgetting it (read-only specialists no longer hold executor alive), but the command itself stays for now.

These are the things to *not build bridges for*. They survive substrate intact; bridging them now means double-work.

---

## Open question for rev-9 author

When the containers table lands (substrate §15 Stage 4), the migration from "chain-identity row on jobs" to "containers table" needs to preserve evidence ordering and chain history. The current job table has implicit "first job = chain root" semantics; the containers table will have explicit `parent_id` + `opened_by` + `owned_by` (§2.6). Suggested migration path:

1. Stage 4 ships `containers` table empty.
2. Each existing `chain-identity` row is migrated to a synthetic container with `kind: chain`, `opened_by: <first-job-id>`, member jobs re-linked via `container_id`.
3. The 9 opportunities above produce data (#3, #5, #6, #8) in shapes that migrate trivially — they're already container-flavored even when sitting on jobs.

The migration is mechanical because the alignment work made the data already substrate-shaped. That is the value of the bridge: no double-write, no shim layer, just a rename pass when substrate is ready.
