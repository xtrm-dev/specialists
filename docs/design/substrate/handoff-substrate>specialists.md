# Handoff — substrate / specialists-runtime / channels design work

> **Audience.** The agent picking up this work in the next session. You will have access to the actual repos (`xtrm-tools`, `specialists`, `mercury`, the runtime code, run transcripts) — the prior sessions did not. That access is the point of this handoff: several design decisions were *deliberately* deferred to "the next agent with code visibility," and you are that agent.
>
> **Operator.** Jaggerxtrm / dawid. Solopreneur, working across ~10 repos in parallel. The runway before substrate lands is on the order of a month, during which the friction-reducing bridges keep paying off daily.
>
> **Method that produced this state.** Italian conversation for deliberation, English canonical documents as source of truth. Decisions are deliberated to closure before being written; writing is `str_replace` / scripted block edits with grep-based invariant checks after each change. Bilingual: discuss in Italian, write canonical in English. The operator pushes back hard when a proposal drifts from principle; that pushback is the quality gate, not friction to route around.

## 1. Where to start — read these files in order

All on disk under the project, copies in `/mnt/user-data/outputs/`:

1. **`substrate-design.md` (revision 10)** — the canonical design. 18 top-level sections. The Italian translation `substrate-design-it.md` exists but lags rev10 by a couple of edits (E1 catalog reference + rev10 chain-coordinator/memory changes); if you do operator-facing work in Italian, re-translate or sync.
2. **`channels.md` (rev9-aligned, complete)** — the channel primitive design, v0→v3 sequenced. §15 is the substrate relationship + migration map. Container=channel and pulse are referenced into substrate, never duplicated.
3. **`specialists-roadmap-revised.md` (v2 by the specialists-runtime agent) + `specialists-roadmap-reconciliation.md` (my decision-delta against it)**. v2 is the agent's plan; the reconciliation is what to apply on top. The agent has not yet applied it; that may be your first concrete action (§4 below).
4. **`xtrm-h9hqg`** is the live P0 bd ticket in `xtrm-tools` covering the bd auto-stage bootstrap (Phase 5 of the roadmap, in progress as of session end).

## 2. The shape of the project, in one screen

**xtrm** is a personal agentic-coding orchestration system (the operator's). It is a **monorepo of five npm packages**, one binary each: `core`(`xt`) / `substrate`(`sb`) / `channels` (library) / `specialists`(`sp`) / `console` (web). One store, one daemon, one socket: `~/.xtrm/state.db` (today `observability.db`, which *becomes* `state.db` at substrate migration — rename + additive schema, not a data move; channels.md §5.1.1).

The current implementation is `sp` + `bd` (beads issue store) + manual git. **substrate is the in-progress design that replaces the tribal practices of the orchestrator with named runtime entities** — containers, issues, channels, pulses — that orchestrator, node-coordinator, chain-coordinator, and operator all read off the same surface. The CLI is `sp` today, becomes `sb` under substrate; the bridge work makes that migration a **rename pass, not a rewrite**, by producing already-substrate-shaped data from day one.

Core mental model (carry this through everything):
- **Container** is the unit of work — five kinds (seed / chain / epic / wave / node), four transient + one standing. Every container has a **channel** (its ID is the channel's workstream ID; they cannot drift).
- **Coordinators are the standing brains of containers.** Node coordinator (§4.2, long-lived). **Chain coordinator (§4.3, transient — spawned at composition completion, dies with the chain, four roles: entry gate / borderline judge / cross-chain hygiene via pulse / close-time judge).** The chain-coordinator is the newest first-class concept in rev10; absorb it before you do anything else.
- **Channels are container-scoped.** Cross-container coordination is by **pulse** (substrate §2.3), never by one coordinator watching another's channel. This is a permanent boundary.
- **Close is a derivation, not an imperative** (substrate §6.10). When all members are `close_ready`, `sb container merge` closes everything transactionally. The three bd shims (memory-ack, commit-gate, Stop hook) are deleted by reuse, not migrated.
- **Verification authority belongs to an independent gate** (substrate §3.1 + §6.9.2). The actor that did the work does not also judge whether it's done; a gate with persisted evidence does. The executor's `tests_pass` self-report is informational; the gate's verdict is authoritative.

## 3. What is decided, and what is genuinely open

### Decided (do not reopen unless you have new information)

- The 18 sections of substrate rev10. In particular: the abstract lifecycle (§3), pi runtime alignment (§3.1: event-driven on `agent_end` / pulse / `sb` command, never tick), the five container kinds (§4), seed (§5), node autonomy + respawn (§5.8 / §5.9), failure recovery binary (§5.10), the three issue classifiers class/type/role (§6.2.1), the precondition gate (§6.4), the nine relationship edges (§6.7) with `informs`/`spawned_by` as recorded-future-splits, chain templates two-layer (§6.9.3), composition in three moments (§6.9.5), worktree lease (§6.9.6), git two-axis (§6.9.7), the six template archetypes (§6.9.10, expanded to a 13-formula bd catalog by the specialists-runtime work), chain coordinator four roles (§4.3), close as derivation (§6.10), memory as capability + closing-judge distillation (§10.2), single store + ownership-in-code + no-cross-domain-FK (§13.1), the API three faces (§17).
- The specialists-roadmap **decisions** in `specialists-roadmap-reconciliation.md` §A–§F: verbs `sp chain review/approve/insert` (1:1 with `sb`), warn-default-except-data-loss-hard-refuses, grace period on `--accept-stale-base`, bootstrap both location + `xt init`, read-once v0 for `sp chain <bead>`, Phase 5 / `xtrm-h9hqg` split. Plus rev9-author answers: workspace internal/container-scoped; migration `opened_by: synthetic-pre-substrate:<first-job-id>`. Plus the four content adjustments: R5 dedup, `kind:step` label as truth (not title parsing), D2 elevated to principle, Opp 3 JSON aligned to `resolved_chain_json`. Plus the planner's `recommended_template` Pass-2 model.
- channels v0 — yes, but as a **substitution for roadmap Opportunity 8** (not addition), and gated behind roadmap Opportunity 2 (READ_ONLY binds by path). The richer `verdict` message subsumes the event-only `step_completed`.

### Open — Category A: substrate questions deferred deliberately to you (code + transcript visibility required)

These are substrate §14.1's "questions for the next agent." Each was left open because the armchair cannot answer them honestly — the actual code or actual run history will.

1. **Database engine choice.** Dolt vs SQLite vs dolt-on-sqlite (commits/push, doltlab), bun as framework, an automatic per-project versionable JSON backup. The global store will grow fast; versioning-native storage is attractive but needs real benchmarks under load. substrate §13 commits only to "single store, ownership-in-code, opaque-ID correlation so it can be re-separated later" — the engine is up to you. Run experiments. The operator is open.
2. **Explore the beads repo.** The nine-relationship model (§6.7) and the `issue_dependencies` edge table should be cross-checked against how beads actually handles dependencies. Don't reinvent what beads has solved. The reconciliation already taught us to reuse `bd merge-slot` / `bd mol` / `bd formula` / `bd swarm` — there may be more.
3. **Issue-system domain-neutrality.** `contract.scope` is a glob-list, which is code-specific; substrate is meant to serve non-coding work too (writing, research, ops). Decide whether contract fields become generic or grow per-domain variants. Part design, part the `config/substrate/` agent-guided per-repo skill that §6.6 implies.
4. **Cross-container pulse key conventions (substrate open-Q #8).** The mechanism is decided (cross-container is by pulse, not channel). What remains is the *convention* — key shape, authority across containers, who can subscribe. Resolve against the pulse/trigger implementation and channels.md §15.2.
5. **Where does the orchestrator actually go lazy?** §6.9.1 asserts the orchestrator skips reviewers and forgets debuggers under pressure. The transcripts should confirm *which* steps get skipped most, which validates (or corrects) which gates need to be mandatory (Layer 2) vs. merely default. This may also surface a seventh archetype to add to §6.9.10.
6. **Do the failure classes (§5.10) match observed failures?** The transient/semantic binary is a hypothesis. Real failures will show whether a third class emerges and whether `semantic_after`/`hard_cap` thresholds are calibrated right.
7. **Which chain_templates recur beyond the six archetypes?** The runtime catalog ships thirteen (specialists-roadmap §13). Mining a wider transcript corpus is expected to find more worth shipping. The promotion cycle (§6.9.4) is the formal path.
8. **Open-Q #12 — `dispatch_mode` predicate.** `direct | via_seed` is decided; whether a richer predicate is needed is deferred to whether transcripts show real task shapes that don't fit the two cases.

### Open — Category B: deliberately not done in this rev, waiting for someone

- **Substrate §23 (node nesting soft-cap exact threshold), §24 (memory pruning/promotion/identity tuning).** Both deferred to "the next memory pass" or "real runs show how much node autonomy is useful." You can address them when you have transcripts showing the actual patterns.
- **The Italian translation of substrate-design-it.md** lags rev10 by the chain-coordinator and memory-as-capability changes plus the §6.9.10 catalog reference. If the operator works in Italian on this, re-sync.

### Open — Category C: specialists-roadmap reconciliation not yet applied

The specialists-runtime agent produced `specialists-roadmap-revised.md` (v2). The reconciliation `specialists-roadmap-reconciliation.md` has eight deltas (§B), two author answers (§C), the planner addition (§D), and the three corrections (§E with concrete replacement text for the agent to drop in). **The agent has not yet applied them.** Your first concrete deliverable, if the operator agrees, is to either pass the reconciliation back to that agent, or apply it yourself if the operator prefers.

## 4. Concrete first actions (proposed — confirm with operator)

1. **Read the four files in §1, in order.** Verify the design is coherent against your now-fresh eyes. Push back on anything that looks wrong. The operator values pushback; this is not deference.
2. **Hand the reconciliation to the specialists-runtime agent** (or apply the deltas yourself). The result is a single coherent roadmap v3 to start implementing from.
3. **Phase 1 of the roadmap is the highest-ROI work** — Claude Code hook on `bd create` (§4 of the roadmap) and Opportunity 2 (READ_ONLY binds by path). These two close the largest amount of daily friction across the operator's 10 repos and unlock channels v0.
4. **Visit the §14.1 substrate open questions you can now answer** with code/transcript access (especially #1 database, #5 orchestrator laziness, #6 failure class calibration). The operator is open on the database choice; experiments and benchmarks are welcome.
5. **Address the runway recalibration items** — the bd-layer patches are keepers until substrate §13.7 migration (later than substrate landing); `sp merge` dirty-index diagnostic is now "land" not "skip" because A1 recurs daily.

## 5. How to work with this operator

- **Pushback is the quality gate.** When the operator proposes something that conflicts with a principle, push back with the principle named and the concrete consequence. The proposal usually survives, refined; sometimes it changes the principle. Either way, deliberation produces stronger outcomes than agreement.
- **Italian for deliberation, English for canonical.** Discuss in Italian. Write the canonical English document. The Italian translation lags but is maintained when the operator works in Italian.
- **One canonical source per concept; no drift.** If concept X is in substrate, channels.md references it with a forward-pointer rather than re-deriving. The reconciliation pattern — *delta* against an existing doc instead of rewriting — preserves this.
- **Honest about the source of authority.** When a fact came from another agent (the specialists-runtime review, the bd binary verification, the run transcripts), attribute it. Don't claim verification you didn't do. The operator notices and appreciates this.
- **Identifiers stay English in any translation.** Container kinds, lifecycle states, schema fields, CLI commands, class/type/role values, chain_template / worktree lease / step-issue / pulse / emitter / participant / tether / channel — all English.
- **Reads-forward must point to sections that actually exist.** Dangling forward-references to non-existent sections are a smell. If you write a bridge to "substrate §X," verify §X is in the canonical doc.
- **Context pressure is real.** The prior session went through multiple compacts and the agent (me) lost track of which edits had been done at least once. Verify with grep before you assert something is or isn't there.

## 6. The north star (visionary, not a question)

The substrate SDK + node + pulse + connectors (Discord, Gmail, GitHub) are shaped toward **agent-created automated pipelines** — n8n-style but agent-native. A node that watches PRs and opens chains; a node that scrapes a data source and opens seeds; connectors that emit pulses on external events. This is the direction the SDK surface (§2.4) is being shaped toward; when evaluating whether the SDK is complete enough, ask whether you could write a connector against it.

## 7. The state of trust

The operator has built this with care across many sessions and an even-keeled relationship with the agent. They will tell you when you're being sycophantic, when you're under-pushing, when you're missing context. Treat that as information, not criticism. Likewise, when you genuinely don't know — say so. When something feels off about a proposal — name it. The work is good because the deliberation is honest.

Go.