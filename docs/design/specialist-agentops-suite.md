# Specialist AgentOps Suite — Evaluation, Improvement & Optimization

> Status: foundational design draft (2026-06-05).
> Purpose: define the **Evaluation** and **Optimization** pillars of an AgentCore-like
> management suite for specialists, on top of the telemetry/forensics foundation already
> shipped. Intended as a base to build on, not a one-off pilot spec.
> Supersedes the narrow framing of bead `unitAI-my1li` (post-v4 SkillOpt pilot) — see §11.
> Sources: `docs/design/post-aws-summit-research-findings.md` §3 (SkillOpt) + §5 (AgentCore
> Evaluation), `config/specialists/*.specialist.json`, `github.com/microsoft/SkillOpt`.

---

## 0. Why now (the defer was half-wrong)

The prior call (`unitAI-my1li`, §3 of the research doc) deferred this to "post-v4" on two
fears: **(a)** overfitting to transient traces, **(b)** no real A/B harness, plus an
implicit assumption of **low data volume**. Three facts overturn the part that matters:

1. **Volume is high.** A specialist runs **hundreds of times per week — sometimes per day —
   across all repos.** This is not a quarterly-anecdote regime; it is enough for genuine
   batched evaluation with held-out splits and statistical power. Volume is now the
   *justification* for a managed suite (ad-hoc prompt tweaking does not scale at this rate),
   not just an enabler.
2. **Forensics/telemetry already ship.** `observability.db`, `sp log`/`sp feed`, the
   channels/wakes/memory tables, and the `using-kpi` analysis layer already capture per-run
   runtime, tokens, tool-calls, waiting, and outcomes. The scored-trajectory substrate
   SkillOpt requires mostly **exists**.
3. **The reward function already runs.** The canonical QA+Iron pipeline (seconder dual
   verdict → test-engineer/test-runner pass/fail → obligations-scanner → reviewer
   PASS/PARTIAL/FAIL + Release Checklist) is a per-run scorer over a chain. A chain run *is*
   a rollout; the gate verdicts *are* the reward.

What was correctly deferred: **live autonomous self-editing** (SkillOpt's `update` stage
committing a winning candidate unsupervised). That stays deferred — `config/specialists` is
a sensitive surface and a specialist rewriting its own prompt is the agentops equivalent of
a model editing its own loss function. What should **not** wait: capturing proposals,
tracking maturity, and standing up the evaluation pillar. Deferring *capture* has an ongoing
cost — every run that finishes without recording its self-assessment is signal lost forever.

---

## 1. Framing: an AgentCore-like suite for specialists

AWS Bedrock AgentCore (research §5) is a set of platform pillars: Runtime, Memory, Gateway,
Identity, Observability, Policy, **Evaluations**, **Optimization**, … xtrm already has most
of the analogues; the two it lacks as first-class capabilities are exactly the two this doc
defines.

| AgentCore pillar | xtrm analogue | State |
|---|---|---|
| Runtime | `sp` job lifecycle, runner, worktrees | shipped |
| Memory | substrate memory (§10) | designed |
| Observability | `observability.db`, `sp log`/`feed`, `using-kpi`, forensics | **shipped** |
| Policy | permission tiers (LOW/MEDIUM/HIGH) + SCRUTINY + hooks | shipped |
| Identity / authority | participant authority model (channels §10.1) | designed |
| Gateway / MCP | 7-tool MCP layer, `use_specialist` | shipped |
| **Evaluations** | **this doc — §8 harness** | **gap** |
| **Optimization** | **this doc — §4–7 loop + governance** | **gap** |

This document is therefore the base layer for "specialist management as a product": it turns
the forensic data into an evaluation pillar and the evaluation pillar into a *governed*
optimization pillar. The console (§9) is its UI.

---

## 2. Configs are skills

A `.specialist.json` is a skill in SkillOpt's exact sense — a text instruction doc fed
in-context to a frozen model. The optimizable surface, from `executor.specialist.json`:

- **`prompt.system`** — the large instruction body (principles, naming, error handling,
  anti-patterns table, self-review checklist, obligations discipline). This *is* SkillOpt's
  `SKILL.md` body.
- **`mandatory_rules.template_sets`** — shared, reusable rule packs (`code-quality-defaults`,
  `executor-delivery`, `per-turn-handoff-schema`, …) composed into many specialists.
- **`prompt.task_template`**, `prompt.system_prompt_mode` (`append`/replace).

**Optimization granularity is a real choice.** Optimizing a per-specialist `prompt.system`
is isolated and safe to A/B. Optimizing a *shared* `template_set` (e.g.
`code-quality-defaults`) improves every consumer at once — higher leverage, but a regression
hits all of them, so shared packs require multi-specialist A/B before apply. The unit of
optimization must be declared per proposal.

---

## 3. The signal: scored trajectories from the pipeline

SkillOpt assumes labeled task sets with exact-match ground truth. xtrm work is open-ended, so
the reward is **composite and already produced**:

- **Outcome reward (from gates):** seconder `scope/quality/overall_verdict`, test-runner
  pass/fail + failure-owner classification, obligations clean, reviewer
  PASS/PARTIAL/FAIL, Release Checklist.
- **Efficiency reward (from KPI/forensics):** tokens, turns, waiting time, tool-call count,
  retries, fix-loops triggered (`using-kpi`, `observability.db`).

A trajectory = one chain run = `{bead contract (task), specialist config version (skill),
transcript + result (output), gate verdicts + KPI (reward)}`.

**Volume caveats (honest):** these trajectories are **not i.i.d.** — different repos, beads,
task types — and the reward (a gate verdict) is itself a **noisy LLM judge**. So:
- **Stratify** per-specialist, optionally per-task-type/per-repo; do not pool blindly.
- High volume *helps* average out judge noise but does not eliminate label bias.
- Treat the reward as composite (outcome × efficiency), not a single scalar, so a prompt that
  passes review by burning 3× tokens does not read as "better."

---

## 4. The SkillOpt loop, adapted

| SkillOpt stage | xtrm adaptation |
|---|---|
| **rollout** | Real chain runs (no synthetic benchmark). Scored by the pipeline (§3). Volume is organic — hundreds/week — stratified per specialist. |
| **reflect** | Two sources (§5): an offline **evaluator** specialist over many trajectories, *and* **self-proposals** from the specialist at end-of-run. Output is a candidate patch (add/delete/replace), bounded in size. |
| **aggregate** | Cluster proposals + recurring failure patterns per specialist into a single candidate patch dict. |
| **select** | Synthesize `candidate config` (a prompt variant), versioned, never written to the live registry. |
| **update** | **Replaced by a governed apply (§5).** Never autonomous. The "rejected-edit buffer" becomes closed/declined proposal beads — themselves forensic signal. |
| **evaluate_gate** | Golden-set A/B (§8): run candidate vs current on a frozen held-out bead set, score with the same pipeline, accept **iff** composite reward improves with no gate regression. Human-approved. |

The "train like a neural net" framing (epochs, minibatch, textual learning rate, validation
gate) maps to: batched stratified rollouts, bounded patch size as the learning rate, and the
golden-set gate as held-out loss. The one piece that **does not** carry over is auto-commit.

---

## 5. Governance invariant: propose → escalate → review → gated apply

**Hard invariant: no specialist may edit any `.specialist.json`, least of all its own.**
Optimization always terminates in a *proposal*, never a write.

```
rollout (scored runs)
  → reflect (evaluator OR self-proposal)
    → proposal artifact (standardized bead, §6)
      → escalation + human/review gate
        → specialists-creator applies the approved patch  [SCRUTINY: config surface]
          → golden-set A/B validates before/after (§8)
```

Two proposer roles (the dual-source model):

1. **Evaluator-driven (top-down, offline, statistical).** A READ_ONLY `prompt-optimizer`
   analyst reads `observability.db` + verdicts + KPI for one specialist, aggregates recurring
   friction across many runs, files a candidate-patch proposal. This is also the correct home
   for the AgentCore evaluator-vs-diagnostic split (§5 of research): an *evaluator* path that
   scores, distinct from a *diagnostic* path that triages plumbing failures.
2. **Self-proposed (bottom-up, online, contextual).** A specialist, at end of a chain turn,
   escalates a proposal about its *own* prompt when it hit a prompt-level problem (ambiguous
   or contradictory instruction, a rule that forced a wasteful loop, missing guidance). This
   is *beyond* SkillOpt (which is purely optimizer-driven) and is valuable precisely because
   the specialist holds the live trajectory context the offline optimizer lacks.

Transport for self-proposals: the channels `proposal` kind (channels.md §5.3), extended with
a `skill-patch` shape; and/or the standardized bead in §6. Authority is safe because channels
§10.1 already rejects body-text authority — a proposal cannot smuggle itself into a write.

The apply step has a natural gated owner: **`specialists-creator`** (already authors/edits
`.specialist.json`), dispatched only on an approved proposal, through normal review plus the
config-surface SCRUTINY auto-escalation.

---

## 6. The mandatory-rules proposal mechanism (capture = telemetry)

The elegant part: reuse the **`mandatory_rules.template_sets`** infrastructure that already
injects shared rule packs (`per-turn-handoff-schema`, `bead-id-verbatim`, …) into specialists.

Add a sibling pack — **`improvement-proposal-schema`** — included by every specialist. It
instructs: *when you detect prompt-level friction during a run, file a standardized, named
bead* (filing a bead is already allowed — it is exactly the existing `discovered-from`
follow-up pattern the executor prompt teaches; **applying** it is not):

- **Title convention (named/standard):** `sp-improve(<specialist>): <one-line>`
- **Type/tags:** `decision` (or a new `improvement` type), tag `prompt-optimization`
- **Links:** `discovered-from:<current-bead>`, scoped to the specialist's config file
- **Structured body:** trajectory ref (job/result id), the offending instruction verbatim,
  the proposed patch (candidate text), evidence (what went wrong, KPI cost)

Because these beads are **named and standardized**, they become first-class telemetry:

- **Count** of open `sp-improve(<specialist>)` beads = pending improvement work per specialist.
- **Trigger:** when the count crosses a threshold (or on a schedule), the suite dispatches an
  evaluation run for that specialist. The board *tells* you where work is.
- **Forensic trace:** every proposal links back to the run that produced it, so you can see
  which prompt rules generate the most friction across the fleet.

This is the answer to "how do we know if there's any work to evaluate": **the standardized
proposal bead IS the captured signal.** The mandatory rule enforces *capture*; the permission
model + the §5 invariant enforce *non-application*.

---

## 7. Optimization maturity as first-class metadata

The product insight: **shipped default specialists are continuously optimized; a user who
runs `sp create` gets a primitive, unoptimized specialist that needs work.** Make that state
detectable and trackable as a metadata field on the config (the schema already carries
`metadata.{name,version,category,updated,tags}` — room to extend):

```jsonc
"metadata": {
  "name": "executor",
  // ...
  "optimization": {
    "status": "primitive | candidate | optimized | regressed",
    "eval_score": 0.0,            // last golden-set composite reward
    "baseline_version": "1.0.0",  // prompt version the score is against
    "optimized_at": "2026-06-05T...",
    "pending_proposals": 0,       // open sp-improve(<name>) beads (from §6)
    "golden_set_ref": "golden/executor.v1"
  }
}
```

- **Shipped defaults** ship as `optimized` with a known `eval_score` and a frozen golden set.
- **`sp create` / `sp edit`** (user-tier) initializes new specialists as **`primitive`** —
  visibly "born unoptimized, work to do."
- The field is **detectable** (lint/doctor can flag primitive specialists), **trackable**
  (forensics trends `eval_score` over versions), and **drives the console** (§9).
- `regressed` is set when a later eval drops below baseline — a signal to re-open optimization.

This belongs on the specialist **configuration page** (the user's explicit ask): a specialist's
config view shows its maturity, its score history, and its pending proposals.

---

## 8. The evaluation harness (the one real build)

The genuinely new engineering, and what §3 correctly flagged as missing. Since there is no
exact-match ground truth, the xtrm analogue of a held-out val split is a **frozen golden-bead
set per specialist**:

- **Golden set:** a curated, frozen snapshot of past beads with known-good outcomes (drawn
  from the high-volume history — §0). Versioned, referenced from `metadata.optimization`.
- **A/B run:** execute the candidate-prompt variant and the current prompt against the golden
  set (`sp run` with a prompt-override / candidate config), under a frozen registry snapshot.
- **Score:** the same pipeline gates + KPI deltas (§3), composite reward.
- **Gate (strict, SkillOpt-style, human-approved):** accept iff candidate beats current on the
  golden set with **no gate regression** and no unacceptable efficiency cost.
- **Shadow mode first:** like the `node_memory` derivation plan in channels.md, run candidates
  in shadow (score without applying) before any apply is offered.

At hundreds of runs/week, golden sets can be refreshed and stratified cheaply; the harness can
run **continuously in shadow**, with apply still strictly human-gated.

---

## 9. The console as the suite UI

The console (the read-only dashboard, soon `packages/console`) is where the suite becomes
usable:

- **Fleet maturity view:** every specialist with its `optimization.status`, `eval_score`
  trend, and `pending_proposals` count.
- **Proposal queue:** open `sp-improve(<specialist>)` beads, grouped by specialist, with the
  trajectory evidence inline.
- **Run the suite:** trigger an evaluation/A-B run for a specialist from the UI; watch it
  stream over `sp feed`/`sb feed`.
- **Before/after diffs:** candidate vs current prompt, with golden-set score deltas, presented
  for the human apply decision.

This is the user-facing half of "we ship optimized defaults; you optimize your own."

---

## 10. How it composes with the rest of xtrm

- **substrate** — proposals are issues/contracts; the apply goes through the Stage-1/Stage-2
  validator and review like any change. Golden sets and eval runs are containers.
- **channels** — `proposal` kind carries self-proposals; authority model prevents body-text
  escalation into a write.
- **specialists** — the gated apply owner is `specialists-creator`; the runner permission
  model + the §5 invariant block self-edits.
- **observability / using-kpi** — the trajectory store and reward source.
- **AgentCore (research §5)** — evaluator-vs-diagnostic split lands as the two analyst paths
  in §5; this suite is the xtrm realization of AgentCore's Evaluations + Optimization pillars.

---

## 11. Sequencing + re-scope of `unitAI-my1li`

`unitAI-my1li` is currently scoped narrowly as a *post-v4 SkillOpt pilot* (P4, deferred). It
should be re-scoped as the **parent of the AgentOps suite**, split into:

**Now — groundwork (additive, reversible, no autonomous behavior):**
- `improvement-proposal-schema` mandatory-rules pack + standardized `sp-improve(<name>)` bead
  convention (§6).
- `metadata.optimization` maturity field; `sp create`/`sp edit` initialize `primitive` (§7).
- Forensic tracking of proposal counts + per-rule friction (§6).
- This design page on the configuration docs.

**Post-v4 — the loop (gated, builds on groundwork):**
- `prompt-optimizer` evaluator specialist (§5.1).
- Golden-set A/B harness + shadow mode (§8).
- Gated apply via `specialists-creator` under SCRUTINY (§5).
- Console suite UI (§9).

**Invariant across both:** apply is always human-gated. Volume changes the *cadence* of
capture/evaluation (continuous, not quarterly), never the apply gate.

---

## 12. Open questions

- **Optimization unit** — per-specialist `prompt.system` vs shared `template_set`. Different
  A/B blast radius; declare per proposal (§2).
- **Reward weighting** — outcome vs efficiency blend; how to prevent token-burning "wins" (§3).
- **Golden-set drift** — how often to refresh, and how to avoid leaking recent prod beads that
  the prompt has effectively memorized (§8).
- **Self-proposal noise** — rate-limit / dedupe `sp-improve` beads so a flaky run does not spam
  the queue; cluster before surfacing (§6).
- **New `improvement` bead type** vs reusing `decision` — schema decision.
- **Cross-repo aggregation** — proposals/forensics span all repos; where does the suite's
  store live (ties to substrate single-store, §13 of the IT doc)?

## 13. Next actions

- [ ] Re-scope `unitAI-my1li` to point at this doc + split now/post-v4 (command below).
- [ ] Spec `improvement-proposal-schema` template set + `sp-improve(<name>)` convention.
- [ ] Add `metadata.optimization` to `src/specialist/schema.ts`; default `primitive` on create.
- [ ] Forensic query: open `sp-improve` beads per specialist + per-rule friction histogram.
- [ ] Design the golden-set format + the A/B run command (`sp run --candidate-config`).
- [ ] Console: fleet maturity view + proposal queue (post-`packages/console`).
