# Specialists Roadmap v2 — Reconciliation against substrate rev-9 closed decisions

> **Role.** Decision-delta to apply to the agent's revised friction-audit/roadmap (the v2 with bd-primitive reuse, Opportunity 10, §12 epic decoration, §13 thirteen templates). Produced by the substrate-design (rev-9) author after integrating review steps 1/2/3/4/6 into the canonical design.
>
> **How to read.** §A = where v2 already converged with our decisions (confirm, no change). §B = deltas to apply (our closed decisions not yet reflected, or contrary in v2). §C = definitive answers to the two "questions for the rev-9 author." §D = the new `recommended_template` planner addition. §E = consistency issues I found (internal to v2 and cross-doc) that need an operator/author call — flagged, not silently changed. §F = the runway recalibration framing.

---

## §A. Already converged — confirm, no change

v2 independently reached several decisions we had closed. These are correct; keep them:

- **D13 (warn vs refuse) = our decision.** Hybrid: hard-refuse for the data-loss class (C1 cwd-mismatch, R5 reviewer cwd-mismatch, write-capable-without-`--chain`), warn for soft-precondition. Matches "warn-only except data-loss" exactly.
- **D14 (grace period) = our decision.** One-release deprecation of `--force-stale-base`. Matches.
- **D3 (keep-alive unchanged) + Opp 1+2 decoupling cross-job liveness only** — correct and sharper than our framing; intra-job resume is preserved. Keep.
- **bd-primitive reuse (§3.0, D4)** — `merge-slot` / `mol` / `formula` / `swarm` instead of net-new sp tables. This is the reuse discipline applied better than my version did (I had proposed net-new lease columns and a `chain_shapes` table; bd already has both). **Adopt v2's approach over my earlier Opportunity 1/3.**
- **Opportunity 10 (`--chain` redesign, write-capable refuses without `--chain`)** — this is the concrete realization of the workspace-identity answer in §C below. Keep; it closes the cwd-write-to-master safety hole, which is real.
- **§12 sp epic decoration (drop merge/abandon/sync, keep thin readers)** — reads forward cleanly to substrate `sb container merge` (§6.10). Keep.
- **§5.6 sp ps hygiene hooks** — good addition; preserves keep-alive value while making the discipline self-enforcing. Keep.

---

## §B. Deltas to apply (our closed decisions, not yet in v2)

1. **Verb naming → `sp chain review / approve / insert`** (v2 still uses `plan / dispatch / insert`; §11.1 #1 still lists it open). **Decision: closed — align to substrate.** substrate §6.9.5 uses `sb chain review/approve/insert`; matching the bridge 1:1 makes migration `sp`→`sb` only, no command remapping. Map: `review`←`plan` (show the shape), `approve`←`dispatch` (execute it), `insert`=`insert`. Apply throughout §3.1 Opp 4, §4.4, §5.4, §10.

2. **`sp chain <bead>` accepts root beads only** — refuse step-beads with a hint to the root (§11.1 #1's sub-question). Closed: root-only. (v2's molecule model makes this cleaner: `sp chain <molecule-id>` is the chain identity; a step-bead arg is rejected with "this is a step of <molecule>; did you mean <molecule>?".)

3. **Bootstrap location → BOTH** (v2 §6 still says "create skill OR extend `xt init`"; §11.1 #4 open). Closed: discoverable skill **and** automatic on `xt init`. With a month across ~10 repos the automatic-on-init path matters; the standalone skill serves already-existing repos.

4. **`kind:step` label is the authoritative discriminator — title pattern is only a hint.** v2 §4.3 #6 and Opp 5 still say "detected by tag `kind:step` OR by title pattern." Closed (discipline, substrate §6.9.7: the name is not the semantics): the **tag/label is truth**, the `<role>:<root-id>` title pattern is only what the Claude hook uses to *propose* a template. Never the source of the step-vs-root decision. **The catalog already does this right and better than the prose** — every formula step carries `labels: ["kind:step", "role:X", "edge:validates->root"]`, and the `sp chain wire-edges` post-pour helper reads the **labels** (not the title) to apply the semantic edges. So the fix is only to align the §4.3 #6 / Opp 5 *detection prose* to the label-as-truth the formulas and the helper already use; the title pattern stays a convenience for the hook's template proposal, nothing more.

5. **D2 elevated to principle, not "small adjacent."** v2's cross-ref matrix still calls it "Opportunity adjacent; small." Closed: moving `tests_pass` off the executor onto an independent gate is the runtime application of substrate §3.1 (advance only on persisted evidence) + §6.9.2 (a gate is `done` only when *satisfied*). **Verification authority belongs to an independent gate, never the verified actor.** It lands inside Opportunity 8's `step_completed` payload: the executor's self-reported result is informational; the chain advances on the gate's persisted verdict. Promote D2 from a matrix footnote to a named principle in §2.D and §3.1 Opp 8.

6. **Bootstrap (§6 / v2 Phase 5) vs `xtrm-h9hqg` split — now confirmed against the ticket.** (Note: in v2, Phase 4 is the `sp epic` decoration rewrite; the bootstrap work is Phase 5 §10.5. The split below concerns §6 / Phase 5, not Phase 4.) `xtrm-h9hqg` (P0, IN_PROGRESS) covers **B-A1/A2/A3** — bd auto-stage config flip + pre-commit shim, *and explicitly* the three hooksPath/third-party cases v2 catalogs (core.hooksPath honored; hooksPath misconfigured at `.beads/hooks` in mercury/{market-data, market-data-uuj, platform, terminalbeta}; non-bd pre-commit at target: precommit.com framework → plugin, security-pipeline wrapper → safe append, custom fast-unit-tests runner → manual decision) — *plus extra scope* (bd/gitnexus version + migration verification) the audit hadn't listed. It does **NOT** cover **B-A4** (orphan worktree cleanup), **B-A5** (`.worktrees/` test excludes), **B-A6** (osv-scanner wrapper). Those stay friction-audit-side: file separately or extend h9hqg. (The h9hqg sweep findings — 12/23 patched, 4 stuck on hooksPath, 7 on third-party hooks — are authoritative environment data.)

7. **R5 dedup.** R5 (reviewer cwd-mismatch) appears in both §7 and §5.3's cwd-mismatch check. Make it one check (the data-loss hard-refuse in §5.3); §7's R5 references it. Note also that **Opportunity 10 partly dissolves R1/R2/R5** — once `--job` is gone and `--chain` drives workspace binding, the cwd-mismatch and stale-`--job`-HEAD surfaces shrink. v2 already says this for R1/R2 ("dissolved under --chain"); apply the same to R5 and don't build it twice.

8. **`sp merge` dirty-index diagnostic → LAND** (v2 §5.5 / §10.5 still "OPTIONAL, may skip"). Recalibrated (see §F): A1 recurred 5× in one session and the runway is a month over 10 repos, so the recurrence cost justifies the half-day. Skip only if h9hqg's auto-stage lands first and A1 stops recurring (same root cause, two angles).

---

## §C. Definitive answers — the two "questions for the rev-9 author"

**§11.2 — Workspace identity: internal to substrate, NOT exposed in the API.** Operations are container-scoped; there is no first-class `workspace_id`. A participant never names a workspace — it is spawned into a container (substrate §7.1), the container holds the worktree + lease (§6.9.6), substrate resolves the rest. This is the second of the two options v2 posed, and **it is exactly what Opportunity 10 implements**: `--chain` becomes the container handle, `--job`-as-workspace-handle dissolves. The current half-and-half (`--job` as both workspace and liveness handle) is what produced the six asymmetries; substrate commits to the clean side. So Opportunity 10 is not just a bridge — it is the runtime adopting the substrate identity model early. Close §11.2.

**§11.3 — Migration shape: aligns, with one correction.** v2 §11.3 still proposes `opened_by: <first-job-id>` for legacy chains. In substrate, `opened_by` is *provenance* — immutable, normally a seed/node/operator (§2.6). For legacy chains with no seed this is acceptable **only marked `opened_by: synthetic-pre-substrate:<first-job-id>`**, not conflated with the real provenance a seed will later write. Otherwise the mechanical migration is correct — and with v2's molecule model it is even cleaner: **`bd molecule` → substrate `kind: chain` container**, step-beads → step-issues (their `parent-child`/`validates` edges already pre-populate the step relationship). The bridge value holds: the data is already substrate-shaped, migration is a rename pass. Close §11.3.

---

## §D. New: `recommended_template` on the planner (two-pass planning)

Decided this session. The planner gets a structured Pass-2 output, now cleaner because templates are real bd formulas:

- **Pass 1 (already does it):** PRD → epic + child root beads (each a future substrate root issue). This is substrate Moment-1 composition (§6.9.5); zero debt.
- **Pass 2 (teach now):** for each child root, annotate **`recommended_template: <one of the 13 formula names>`** (`code-standard`, `debug`, `quant-validation`, …) + optionally `recommended_extra_steps` for classes the formula doesn't include but the scope needs (the L3-judgment delta over the L1 template, §6.9.5).

Three disciplines, so this stays a *proposal* not a *materialization*:
- **It is a formula NAME, not a step list.** The name resolves to the shape at `sp chain review` / `bd mol pour`, not at planning time. No premature step-bead materialization, no orphans.
- **`recommended`, not `resolved`.** The orchestrator at dispatch can override it with sibling-chain information (substrate Moment-2). If it reads as decided, someone skips the dispatch-time judgment.
- **The enum is the 13 formula names + `on-the-run`** (the escape valve: when none fits, the shape is specified explicitly at dispatch, not as a template name). The enum is now *concrete and checkable* — `bd formula list` returns exactly these names, so the hook and `sp chain review` can validate `recommended_template` against a live list rather than a hard-coded table. Don't let the planner invent formula names the resolver can't find.

This is zero-debt: `recommended_template` is a field substrate's planner uses identically (§6.4 carries `recommended_template`), and the values point at real bd formulas that exist today (`bd formula list`). Add a short subsection (Opportunity-adjacent, or a note in §4/§13) and one line in the rollout.

Worth noting in passing: several of the 13 templates are **deliberative/maintenance** chains (`planning`, `premortem`, `research-only`, `triage`, `doc-sync`, `memory-hygiene`) that produce a decision or a maintenance artifact, not a code diff. These map cleanly onto substrate §6.9.8 deliberative issue types (`design`/`research` → deliberative template, closing with a `decided` outcome, §6.10) — so the catalog independently validates §6.9.8. And `security-deep`'s `security-auditor` ×2 (advisor pre-, gate post-) is exactly substrate §6.9.10's "same role at two classes" point realized as a real formula. The catalog is substrate-aligned beyond just the count question in §E1.

---

## §E. Consistency corrections — RESOLVED (apply the text below)

These were flagged for a decision; the operator has made the calls. E1 is applied to substrate; E2 and E3 are corrections to apply to v2 — concrete replacement text given so the agent can drop them in.

**E1 — Six vs thirteen templates (cross-doc) — APPLIED to substrate.** substrate §6.9.10 now frames the six as *conceptual archetypes / floor* and adds: the runtime ships a larger evidence-backed `bd formula` catalog (currently thirteen) — the six archetypes plus deliberative/maintenance chains (planning, premortem, research-only, triage, doc-sync, memory-hygiene, release-prep, restitch); the deliberative ones realize §6.9.8, and `security-deep` realizes the same-role-two-classes point. No further action in v2 — the two docs now agree (six archetypes in design, thirteen concrete formulas in the runtime catalog, related by the §6.9.4 promotion cycle).

**E2 — chain ≡ molecule, resolved everywhere (apply to v2 §1.1.1 / §1.3 / §3.0).** Adopt §13.3's conclusion as the single story. Replace the §1.1.1 mental model with:

> **The chain ≡ bd molecule mental model (today's reality).** A chain's identity is a bd **molecule** — `bd mol pour <formula>` creates an `issue_type=molecule` parent (the chain) with one child bead per formula step (`parent-child` edges; `blocks` edges between siblings per `needs`). An **epic** is the *organizational parent above chains* — the broad grouping (`--type=epic` + `--parent`) that holds multiple chain-molecules for a single PRD/initiative. Nesting: top epic (organizational) → chain-molecule (per root issue) → step beads. The quick-chain variant is a bare molecule with no organizational epic; the ultra-quick single-shot is a lone task bead (READ_ONLY dispatch only, §3.10).
>
> **Substrate migration mapping:** organizational epic → container `kind: epic`; chain-molecule → container `kind: chain`; molecule's root child → substrate root issue; step beads → step issues (parent-child/validates edges pre-populate the step relationship); `bd dep tree` → `sb container ps <id> --tree`.

Then sweep §1.3 and §3.0 to say "chain ≡ bd molecule" wherever they currently say "chain ≡ bd epic." Migration is unaffected (both map cleanly); the doc just tells one story.

**E3 — Opportunity 9 matcher is external config, not formula sections (apply to v2 Opp 9).** Opp 9's "Update from reconciliation" note contradicts §13.2 (verified against the bd binary: `applies_when` is not a supported formula field and is silently dropped). Replace that note with:

> **Update from reconciliation:** bd formula does **not** support `applies_when` (§13.2, verified against the bd binary — it is silently dropped). The selection/nudge matcher therefore lives in a **separate selection-config file** consumed by the Claude hook (§4) and the `sp chain review` dispatcher, not inside the formulas. "One matcher language across the system" still holds — applied at the selection layer, exactly as substrate §6.9.5 L1 nudges are a lookup table evaluated at the composition gate, not part of any template.

This also tightens §13.6 / the catalog README, which already describe selection as external — Opp 9 was the lone stale spot.

---

## §F. Runway recalibration (frames §B.8 and §7's R-checks)

Substrate may be a month or more away, during which the operator works ~10 repos in parallel. This flips the leverage-per-day math: friction-removed-per-day × days-until-substrate × repos is large, so even an honest throwaway bridge repays many times before it retires. Crucially, **the bd-layer patches are keepers until the substrate §13.7 bd→substrate migration — which is *later* than substrate landing**, not at landing. bd remains the issue store *and* (via mol/formula/swarm) the chain-shape store throughout the substrate adoption period.

Two conclusions this changes:
- **`sp merge` dirty diagnostic: skip → land** (§B.8).
- **Reviewer R-checks: "build only 2-3" → build more, but dedupe R5 and skip the ones Opportunity 10 dissolves.** With the runway, the reviewer mistakes recur across 10 repos and the checks pay off — but Opp 10 (`--chain` deprecating `--job`) genuinely removes the surface R1/R2/R5 fire on, so build R3/R6/R7/R8 (survive Opp 10) and reduce R1/R2/R5 to warns/hints that retire with `--job`.

The bd-primitive reuse (§3.0) is itself a runway win: building on `merge-slot`/`mol`/`formula`/`swarm` means the bridges are thin glue over primitives that already exist and are maintained, not new infrastructure to carry for a month.

---

## §G. Net: what to hand the implementer

v2 is sound and mostly ready. Apply §B (eight deltas), close §C (two author answers), add §D (`recommended_template`), and apply §E (E1 is already done in substrate; E2/E3 have concrete replacement text — drop them into v2 §1.1.1/§1.3/§3.0 and Opp 9), then thread §F's framing into the rollout. Nothing in v2's architecture needs to be undone — the bd-reuse discovery, Opportunity 10, the epic decoration, and the 13-template catalog are all keepers and substrate-aligned. After these edits, the two canonical docs (substrate-design + this roadmap) and the catalog tell one consistent story.