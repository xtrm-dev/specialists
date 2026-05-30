# Chain Templates — Canonical Reference

> **Status.** Canonical. Living document — updated as new templates, new pipeline lessons, and the (currently pending) DevOps gates emerge. Last revision: 2026-05-30 (initial promotion absorbing `iron-review-hardening.html` + `iron-review-hardening-qa-chain-substrate.md`; restructure same-day to drop the "overlay" framing — Iron is canonical via `using-specialists-v3`, QA is imminent-canonical via `unitAI-sfwe1`; the only genuine pending gap is DevOps gates, §4).
>
> **Audience.** Operator (deciding which template fits a given bead), planner (composing chains), specialist authors (knowing where their role fires in the pipeline), substrate designers (the catalog substrate §6.9.10 absorbs at landing).
>
> **Scope.** This document is the source of truth for: (a) **the canonical pipeline** every production-diff chain runs (§2); (b) **the template catalog** of 13 named chain shapes (§3); (c) the **DevOps gates gap** that is the only currently-pending design (§4); (d) the **composition mechanism** the dispatcher uses (§5); (e) the **evolution protocol** that folds new lessons back (§6).
>
> **Reference layout.** Foreground (today): `docs/design/roadmap/chain-templates/*.formula.json` — executable formula files; `docs/design/roadmap/chain-templates/README.md` — operator quick-start. Background (substrate-canonical): `docs/design/substrate/substrate.md` §6.9.10 — the substrate-side framing of the same catalog. This document is the **conceptual bridge** between them — neither implementation detail nor substrate primitive, but the *philosophy* both sides agree on.
>
> **Companion file** `docs/design/chain-templates.html` exists as an editorial snapshot in `substrate.html` visual style. It is **not maintained** going forward — this Markdown is the only living source. The HTML is preserved as initial editorial framing for external reading.

---

## Table of contents

1. **Concept** — what a chain template is, and why templates instead of ad-hoc dispatch
2. **The canonical pipeline** — what every production-diff chain runs, severity-modulated
3. **The template catalog** — the 13 templates with their canonical resolved chains
4. **DevOps gates — design pending** — the only genuine gap left to fill
5. **Composition mechanism** — how the dispatcher resolves a chain shape
6. **Evolution protocol** — how new templates and lessons are absorbed
7. **Cross-references**

---

## 1. Concept

A **chain template** is a named, reusable shape for a multi-step specialist chain. It encodes:

- **The resolved canonical chain** — the full sequence of steps the dispatcher runs for that template at a given severity (writer-role, behavioral validation, code-quality gates, security checks if applicable, obligations gate, reviewer with Release Checklist).
- **Per-step contracts** — each step's bead carries a MANDATE/INPUTS/OUTPUTS/SCOPE/NON_GOALS; the root carries the change-contract.
- **Severity sensitivity** — which steps fire is modulated by the bead's `SCRUTINY` field, with auto-escalation on sensitive surfaces.

Templates exist because **ad-hoc dispatch produced inconsistent chains**. Across 96+ session reports (explorer pass 2026-05-27 over mercury / gitboard / specialists) the same recurring shapes emerged. Naming them — and making each a versionable `.formula.json` artifact — turns *"what chain do I run"* from per-bead reasoning into per-bead *selection*.

**Three phases, three concerns.**

1. **Selection.** Given a bead (its type, scope, scrutiny, keywords), which template fits? Lives in: the Claude Code `bd create` hook (roadmap §4) + `sp chain plan` dispatcher (roadmap Opp 4). **NOT** in formula files — `bd formula` does not support `applies_when`.
2. **Composition.** Given a selected template, the dispatcher resolves the canonical chain for the bead's actual severity, pours the formula → creates the molecule (the chain identity bd issue) + child step beads with the right dependency edges. Reviewed / approved / insert-mutated via `sp chain review/approve/insert` (roadmap Opp 4).
3. **Execution.** The composed chain runs step-by-step; gates fire at the right points; coordinator (post-substrate-landing, substrate §4.3) judges borderlines.

This document concerns itself with **what the canonical pipeline is** and **what templates exist** — it does not redocument the formula schema (that's in `chain-templates/README.md`) or the dispatcher semantics (that's in the roadmap).

**One source of truth principle.** When this document and a `.formula.json` disagree on step shape, **the formula wins** for executable shape (it is the executable artifact). When this document and `using-specialists-v4` SKILL disagree, **this document wins** for canonical intent (the SKILL is the operator how-to derived from this). When this document and `substrate.md` §6.9.10 disagree, **substrate wins post-substrate-landing**, **this document wins pre-substrate-landing** (substrate is the future canonical; this is the bridge canonical).

---

## 2. The canonical pipeline

Every chain that produces a production diff runs the same canonical pipeline. The pipeline is **canonical**, not optional, not pluggable, not "overlaid." Severity modulates depth (which steps fire); it does not modulate whether the pipeline exists.

> **Already in production.** The pipeline below is taught and enforced by `config/skills/using-specialists-v3/SKILL.md` (canonical operator skill). `test-engineer` + the upgraded `test-runner` ship via `unitAI-sfwe1` (in-flight). The only step still under design is **§4 DevOps gates**; everything else is current canonical behavior.

### 2.1 The shape

```mermaid
flowchart LR
  planner[planner + test-planning<br><i>pre-impl, optional</i>] --> writer[executor or debugger]
  writer --> test-engineer
  test-engineer --> test-runner
  test-runner --> verdict{verdict}
  verdict -- test wrong --> test-engineer
  verdict -- source wrong --> writer
  verdict -- clean --> code-sanity
  code-sanity --> security[security-auditor<br><i>if sensitive surface</i>]
  security --> obligations
  obligations --> reviewer
  reviewer --> release[Release Checklist]
```

The pipeline has six roles past the writer (test-engineer, test-runner, code-sanity, security-auditor, obligations-scanner, reviewer) plus the writer itself (executor or debugger). The writer's choice is template-determined (`debug` uses `debugger`, others use `executor`); the rest is the same across every production-diff template.

### 2.2 Severity modulates depth

`SCRUTINY: low|medium|high|critical` is a **required field** on every bead's change-contract. It governs which canonical steps fire and how strict the gates are.

| Tier | Cost-of-being-wrong | What runs |
|---|---|---|
| `low` | Trivial — single-file, easily-reverted | writer → obligations-scanner → reviewer (code-sanity advisory; test-engineer skippable with reason; security N/A) |
| `medium` | Normal — production code | writer → test-engineer → test-runner → code-sanity (gate) → obligations → reviewer |
| `high` | Significant — cross-cutting, library boundary, public API, persistence | + security-auditor on sensitive surfaces; Release Checklist enforced |
| `critical` | Severe — auth, money, data integrity, irreversible state, security | + security-auditor runs **twice** (advisor pre-impl + gate post-impl); behavioral QA evidence required in Release Checklist |

**The operator never lowers a tier the reviewer raises.** Auto-escalation can promote `medium` to `critical` when scope hits a sensitive surface (see §2.4); declared scrutiny is the *floor*, the reviewer may raise it, never lower it.

**The operator can declare any bead `critical`.** Cost-of-being-wrong is operator judgment — a small bead in a sensitive area is `critical` if the operator says so, regardless of file count.

### 2.3 Roles in the canonical pipeline

| Role | Permission | Phase | Owns | Must not do |
|---|---|---|---|---|
| `planner` + xtrm `test-planning` | LOW | pre-impl | Phase-level decomposition; logging/telemetry + smoke/E2E contracts; initial test strategy | Write final tests from an unknown future diff |
| `executor` | HIGH | impl | Production implementation from clear bead contract; static lint/typecheck | Own full behavioral validation or broad test writing |
| `debugger` | HIGH | impl (bug chain) | Root-cause fixes for symptoms/failing tests; targeted repro verification | Run broad suites or redesign unrelated tests |
| `test-engineer` | MEDIUM | post-impl | Reads actual diff; writes/updates tests + fixtures + smoke scripts + telemetry assertions; emits exact `test-runner` commands | Patch production source by default; decide release readiness |
| `test-runner` | LOW | post-test-write | Executes exact commands; captures log/telemetry artifacts; classifies failures by owner | Write tests; fix source; silently expand scope |
| `code-sanity` | LOW | post-QA | Cheap implementation quality / simplicity / type-safety pass (mandatory seconder on production diffs) | Validate product behavior or test coverage |
| `security-auditor` | LOW | conditional (sensitive surface) | Threat-model the diff (advisor pre-impl) + verify diff matches model (gate post-impl) | Bless release; write fixes |
| `obligations-scanner` | LOW | pre-reviewer | Scans diff for newly-introduced `TODO/FIXME/HACK/XXX/TEMP/WIP/NOTE(release)`; distinguishes production vs test; recognizes structured `TODO(<bead-id>)` format | Act as test gate |
| `reviewer` | LOW | final gate | PASS/PARTIAL/FAIL verdict; mandatory Release Checklist; ddiff re-review on PARTIAL | Write missing tests itself |

### 2.4 Auto-escalation on sensitive surfaces

The reviewer raises the SCRUTINY floor when scope hits a sensitive surface. The bead's declared scrutiny is the floor the reviewer can raise; never lower.

| If scope touches | Minimum SCRUTINY |
|---|---|
| `src/auth/**`, secrets / token / credential code | `critical` |
| `config/specialists/**` | `high` |
| `package.json`, `*lock*`, `bun.lock`, `package-lock.json`, requirements files | `high` |
| `migrations/**`, schema files | `high` |
| `.claude/**`, `.xtrm/hooks/**`, `permissions/**` | `high` |
| Default | bead-declared `SCRUTINY` |

When the floor is raised to `critical`, the `security-deep` template's twice-running `security-auditor` shape applies regardless of which template was originally selected — the gate composes onto the chain at the post-`code-sanity` position, and additionally a pre-implementation `security-auditor` advisor is inserted before the writer.

### 2.5 The behavioral-validation contract

`test-engineer` reads the *actual* diff (not the bead's planning-time test plan in isolation) and produces:

```json
{
  "status": "tests_written|blocked|source_bug_suspected",
  "files_changed": ["tests/..."],
  "coverage_map": [
    {"impl_path": "src/...", "test_path": "tests/...", "critical_path": "..."}
  ],
  "smoke_e2e_commands": ["..."],
  "telemetry_assertions": [
    {"event": "...", "fields": ["..."], "query_or_grep": "...", "redaction": "..."}
  ],
  "test_runner_commands": ["..."],
  "known_deferred_paths": [
    {"path": "...", "reason": "...", "follow_up_bead": "..."}
  ],
  "source_bug_suspicions": ["..."]
}
```

If `test-engineer` finds the implementation not testable without a source change, it returns `source_bug_suspected` + files a discovered-from followup. **It does not silently patch production code.**

`test-runner` executes exact commands and classifies failures by owner:

| Finding | Routes to | Example |
|---|---|---|
| Test expectation wrong | `test-engineer` | "Expected JSON field renamed by accepted implementation; update assertion only." |
| Fixture/harness broken | `test-engineer` | "Fixture omits required env var; fix setup/teardown, rerun same command." |
| Required telemetry missing | `debugger`/`executor` | "Implementation never emits `component=runner event=job_finished`; add source instrumentation." |
| Source behavior regression | `debugger` | "Smoke exits 0 but state is stale; root-cause before edits." |
| New source feature untested | `test-engineer` | "Diff added retry fallback; add failure-path test + log assertion." |
| Infrastructure unavailable | orchestrator / reviewer note | "Prometheus unavailable; mark infra failure, use recorded fallback if defined." |
| Pre-existing unrelated failure | reviewer note | "Classify as pre-existing; do not block unless critical-path overlap." |

`test-runner` never silently expands a pinned test scope. If no exact commands supplied, it runs safe manifest-detected smoke/default and **clearly labels it as fallback**.

### 2.6 The Release Checklist

Every reviewer verdict produces a Release Checklist. Lines are mandatory; values are filled per chain.

```text
- [ ] SCRUTINY tier confirmed (auto-escalation triggered: yes|no, reason)
- [ ] code-sanity verdict: OK|FINDINGS|BLOCKED|skipped (reason)
- [ ] obligations-scanner verdict: CLEAN|OBLIGATIONS_FOUND|BLOCKED
- [ ] security-auditor (if applicable): PASS|FINDINGS|BLOCKED|N/A
- [ ] test-engineer required: yes|no|not-required (reason)
- [ ] test-engineer completed: yes|no|N/A
- [ ] test-runner commands executed: yes|no|N/A
- [ ] smoke/E2E evidence present: yes|no|N/A
- [ ] telemetry/log assertions present: yes|no|N/A
- [ ] failures classified and routed: yes|no|N/A
- [ ] obligations introduced: count + structured-vs-unstructured breakdown
- [ ] ddiff applied (on PARTIAL re-review): yes|no|N/A
```

At `SCRUTINY: high|critical`, missing behavioral QA evidence is a **PARTIAL verdict** unless the bead is explicitly docs-only or static-analysis-only.

### 2.7 The ddiff loop

On a `PARTIAL` verdict, the reviewer re-reviews **the delta only** — prior approvals on unchanged hunks carry forward. The chain does not restart; the writer (or test-engineer, per the failure-routing matrix in §2.5) addresses the findings and the reviewer re-audits the new hunks. This makes iteration cheap: a small fix doesn't pay the cost of a full re-review.

### 2.8 Manual git merge is canonical

Per CLAUDE.md rule #9 (current): `sp merge` and `sp epic merge` are **prohibited**. Manual `git merge --no-ff` per chain + the Cherry-Pick Playbook are the canonical multi-chain integration paths. The merge gate is the operator's, not the tool's.

### 2.9 Substrate alignment

The canonical pipeline in this section maps directly to substrate primitives when substrate lands:

- Each step in §2.1 becomes a `class:step` issue (substrate §6.2.1) with its `step-contract` populated (substrate §6.9.2).
- The severity-tiered depth rules in §2.2 become the chain template's `mandatory_layer` declarations (substrate §6.9.3).
- The auto-escalation rules in §2.4 become dispatcher policy on `recommended_template` selection (substrate §6.4).
- The Release Checklist in §2.6 is rendered by the reviewer-as-step from `issue.evidence_json` (substrate §6.8).
- The ddiff loop in §2.7 is the reducer's blocking-not-routine behavior (substrate §6.9.2 completeness contract).

Migration is naming + ownership-transfer; the canonical shape survives unchanged.

---

## 3. The template catalog

13 default templates ship in `docs/design/roadmap/chain-templates/`. Each is a `.formula.json` file using only `[package]`-tier specialists (cross-repo defaults). Per-repo extension is supported via `extends` (see `chain-templates/README.md` for the market-data `quant-validation` example).

The catalog is **evidence-backed** — every template name maps to a recurring chain shape observed in real session reports. New templates are added through the evolution protocol (§6), not on speculation.

> **What the mermaid diagrams show.** The diagrams below show the **resolved canonical chain** for each template at its default scrutiny floor — i.e. *what runs when you pour this template at default severity*. Severity-conditional steps (e.g. `security-auditor` at `high+` for sensitive scope) are marked. The full step list per template comes from §2.1 (the canonical pipeline) modulated by §2.2 (severity tiers); the templates differ primarily in: the writer-role choice, the advisor steps prepended, and whether the chain includes a production diff at all.

### 3.1 `code-quick`

```mermaid
flowchart LR
  root[root: change-contract] --> writer[executor or no-writer trivial]
  writer --> obligations
  obligations --> reviewer
```

**Use.** LOW-blast trivial change — one-line fix, typo, comment correction, log-message tweak.
**Variables.** `root_title`, `scope`.
**Severity floor.** `low`.
**Differences from §2 canonical:** at `low` scrutiny, `code-sanity` is advisory (not a gate), `test-engineer` is skippable with reason, `security-auditor` is N/A. Reviewer Release Checklist still required (minimal pass).
**Anti-pattern.** Using `code-quick` for anything that touches more than one file or any sensitive surface. Auto-escalation (§2.4) promotes to `code-standard` when the bead's scope hits an escalation trigger.

### 3.2 `code-standard`

```mermaid
flowchart LR
  root[root: change-contract] --> executor
  executor --> test-engineer
  test-engineer --> test-runner
  test-runner --> code-sanity
  code-sanity --> obligations
  obligations --> reviewer
```

**Use.** The default for any production diff with normal scrutiny. ~70% of dispatches across the evidence corpus.
**Variables.** `root_title`, `scope`, optional `notes`.
**Severity floor.** `medium`.
**Differences from §2 canonical:** none — `code-standard` IS the §2 canonical shape, minus security-auditor (which auto-escalates in when scope matches sensitive surface per §2.4).

### 3.3 `code-with-advisors`

```mermaid
flowchart LR
  root[root: change-contract] --> explorer
  root --> researcher
  root --> overthinker
  explorer --> executor
  researcher --> executor
  overthinker --> executor
  executor --> test-engineer
  test-engineer --> test-runner
  test-runner --> code-sanity
  code-sanity --> security[security-auditor<br><i>if sensitive</i>]
  security --> obligations
  obligations --> reviewer
```

**Use.** HIGH/CRITICAL blast radius — cross-cutting refactor, external-library integration, architecture-level change, anything where the bead author isn't sure the executor has full context.
**Variables.** `root_title`, `scope`, `external_libs` (optional).
**Severity floor.** `high`.
**Differences from §2 canonical:** three advisors run in parallel pre-executor (explorer, researcher, overthinker — each writes findings to the chain channel, or its own discovered-from bead in pre-substrate land). Executor reads all three before opening any file. `security-auditor` is mandatory if scope matches sensitive surface (high floor + auto-escalation triggers).

### 3.4 `debug`

```mermaid
flowchart LR
  root[root: change-contract + repro] --> debugger
  debugger --> test-engineer
  test-engineer --> test-runner
  test-runner --> code-sanity
  code-sanity --> obligations
  obligations --> reviewer
```

**Use.** Bug fix — root cause + targeted fix + regression test. `debugger` is non-skippable (cannot be inlined into `code-standard` even if the fix is small).
**Variables.** `root_title`, `failing_test_or_repro`, `scope`.
**Severity floor.** `medium` (raises to `high` if regression is severe — operator-declared).
**Differences from §2 canonical:** writer-role is `debugger` (not `executor`). Regression test is mandatory — a bug fix without a regression test produces a discovered-from followup.
**Critical orchestration rule.** Bug Diagnosis Chain (per `using-specialists-v3` Failure Recovery): orchestrator must NOT dispatch executor while bug cause is unknown. If `debugger` reports the root cause is architectural, escalate to `overthinker` / `planner` BEFORE attempting a code fix.

### 3.5 `security-deep`

```mermaid
flowchart LR
  root[root: change-contract] --> security-advisor[security-auditor: advisor]
  security-advisor --> executor
  executor --> test-engineer
  test-engineer --> test-runner
  test-runner --> code-sanity
  code-sanity --> security-gate[security-auditor: gate]
  security-gate --> obligations
  obligations --> reviewer
```

**Use.** Sensitive surface — auth, secrets, crypto, migrations, agent config, permissions, hooks, lockfiles.
**Variables.** `root_title`, `scope`, `sensitive_surface` (one of: auth, secrets, crypto, migration, hooks, permissions, lockfile, agent-config).
**Severity floor.** `critical`.
**Differences from §2 canonical:** `security-auditor` runs **twice** — as advisor pre-implementation (threat-model the diff before it's written), and as gate post-implementation (verify the diff matches the threat model). Reviewer Release Checklist gains explicit security-evidence lines. Behavioral QA evidence is required (smoke + telemetry assertions for security paths).

### 3.6 `release-prep`

```mermaid
flowchart LR
  root[root] --> changelog-drafter
  changelog-drafter --> changelog-keeper
```

**Use.** Release preparation — reconcile `[Unreleased]` CHANGELOG section against actual diff between previous tag and HEAD, then bump version + tag + push.
**Variables.** `prev_tag`, `next_version`.
**Severity floor.** `medium` (release artifacts are not production-code paths).
**Differences from §2 canonical:** this is meta, not production code — no §2 pipeline applies. Operator-gated by design (operator inspects staged changelog + bump diff before `changelog-keeper` pushes the tag).

### 3.7 `triage`

```mermaid
flowchart LR
  root[root: triage scope] --> explorer
  root --> overthinker
  explorer --> synthesis[implicit: orchestrator synthesis]
  overthinker --> synthesis
```

**Use.** Board hygiene — find duplicates / semantic clusters / orphans, propose rewires. Output is a recommended set of `bd dep` mutations (orchestrator applies after operator confirmation per `issue-triage` skill).
**Variables.** `triage_scope` (default: all open).
**Severity floor.** N/A (READ_ONLY chain — produces no code diff).

### 3.8 `research-only`

```mermaid
flowchart LR
  root[root: research question] --> investigator["{{specialist}}: explorer or researcher or overthinker"]
```

**Use.** Investigation that deliberately produces no code — answer a question, build a mental model, prepare for a future implementation epic.
**Variables.** `root_title`, `specialist` (one of `explorer` / `researcher` / `overthinker`).
**Severity floor.** N/A.

### 3.9 `restitch`

```mermaid
flowchart LR
  root[root: conflict context] --> debugger
  debugger --> code-sanity
  code-sanity --> reviewer
```

**Use.** Conflict recovery after a failed merge — `debugger` restitches the worktree against the new base, `code-sanity` verifies, reviewer confirms equivalence.
**Variables.** `original_chain_root`, `conflict_summary`.
**Severity floor.** Inherits original chain's SCRUTINY.
**Differences from §2 canonical:** this IS the recovery from a §2 pipeline that broke. Test-engineer / test-runner re-execution depends on whether the original chain's QA evidence is invalidated by the restitch (ddiff carry-forward applies).

### 3.10 `planning`

```mermaid
flowchart LR
  root[root: planning prompt / spec] --> planner
```

**Use.** Vague initiative → phased bd issue board. Planner produces decomposed bd issues with dependencies, contract drafts, recommended templates per leaf bead.
**Variables.** `root_title`, `spec_or_prompt`.
**Severity floor.** N/A.
**Note.** Planner output already proposes `recommended_template` per leaf bead (per roadmap D26 / Phase 0 bootstrap) — this is what makes template selection (phase 1 of §1) work without operator effort.

### 3.11 `premortem`

```mermaid
flowchart LR
  root[root: plan or decision] --> overthinker
```

**Use.** Devil's-advocate before risky design commits — "assume this failed in 6 months, work backward to find every reason why."
**Variables.** `root_title`, `plan_or_decision`.
**Severity floor.** N/A.
**Trigger.** Via `premortem` skill — high cost-of-being-wrong contexts (architecture commits, hire decisions, strategy pivots, irreversible refactors).

### 3.12 `doc-sync`

```mermaid
flowchart LR
  root[root: one doc path] --> sync-docs
```

**Use.** Single-document drift-aware update after code changes. Hard-scoped to exactly one doc per chain (the `sync-docs` mandatory rule enforces this).
**Variables.** `doc_path`, `change_window` (commits to consider).
**Severity floor.** N/A.

### 3.13 `memory-hygiene`

```mermaid
flowchart LR
  root[root: scope] --> memory-processor
```

**Use.** Post-epic stale memory consolidation — prune memories tied to closed beads, demote tier on inactivity, mark superseded vs preserved.
**Variables.** `scope` (default: all memories), `dry_run` (default true).
**Severity floor.** N/A.

---

## 4. DevOps gates — design pending

> **The only genuine gap.** Every other piece of the canonical pipeline (§2) and the template catalog (§3) is either shipping today (Iron via `using-specialists-v3`) or imminent (QA via `unitAI-sfwe1`). DevOps gates are the only part of the canonical pipeline still under design as of 2026-05-30.

**The problem.** Specialists touching operational surfaces — Dockerfile, compose, CI workflow, hook scripts, deploy scripts, agent-orchestration code, MCP servers — produce diffs whose correctness cannot be validated by behavioral tests alone. A change to a deploy envelope might pass `test-engineer` + `test-runner` (no test regression) and still break production because the actual deploy was never exercised. A hook change might lint-pass and still misfire in the agent harness because the test environment can't reproduce the hook context. A health-check change might be syntactically valid and silently miss a failure mode.

The canonical pipeline (§2) handles this gap partially: `test-engineer`'s `smoke_e2e_commands` + `telemetry_assertions` outputs CAN cover operational paths if the test-engineer is sophisticated enough to write them. But there is no specialist whose **dedicated mandate** is operational validation — verifying that the diff, when actually deployed/integrated/triggered, produces the expected operational behavior (log lines, telemetry events, health-check transitions, rollback paths, cleanup state).

**What's missing.** This section will be filled in the continuation of session 2026-05-30 (DevOps gates design segment). The fill will define:

- **The role(s).** Likely candidates: `ops-validator` (writes operational smoke harnesses against actual integrated boundaries — temp repo, container, hook context, fake-chain), `telemetry-validator` (verifies log/metric/event emissions at the integrated layer rather than at the unit-test layer), `deploy-rehearser` (dry-runs the deploy envelope + asserts pre/post state). Whether these are one specialist with broad scope or multiple narrow specialists is a design decision.
- **Where they fire in the canonical pipeline (§2.1).** Most likely between `test-runner` and `code-sanity` — after behavioral tests pass at the unit/integration layer, before code-quality gates fire. Alternative placement: between `code-sanity` and `obligations-scanner`, treating operational validation as a post-quality gate.
- **Severity sensitivity.** When are DevOps gates mandatory vs optional? Anticipated: mandatory when scope matches an ops-surface trigger (Dockerfile, compose, CI workflow, hook script, deploy script, MCP server, agent-orchestration code); optional otherwise. The trigger list will likely extend §2.4's auto-escalation table.
- **The contracts.** What does an `ops-validator` produce that `test-engineer`'s schema (§2.5) doesn't already cover? Likely: integrated-boundary smoke results + telemetry-from-real-emission (not from test stubs) + rollback/cleanup evidence + health-check transition traces.
- **Per-template applicability.** Which templates in §3 acquire DevOps gates? Anticipated: `code-standard`, `code-with-advisors`, `debug`, `security-deep` when scope is operational; opt-out otherwise. `release-prep` may acquire a DevOps preflight (verify deploy readiness before tag push).
- **Failure routing.** How does the failure-routing matrix (§2.5) extend? E.g., "integrated-deploy fails" → routes to `deploy-rehearser` (envelope wrong) or `executor` (source change broke deploy semantics) or `infrastructure` (transient).
- **Release Checklist additions.** What new lines (parallel to the QA evidence lines in §2.6) does the reviewer enforce on ops-shaped diffs?

**Until designed.** Specialists handling ops-shaped diffs use `test-engineer`'s `smoke_e2e_commands` + `telemetry_assertions` outputs as the best available substitute. This is a known gap, intentionally left for the upcoming design fill rather than papered over.

**Tracking.** A new bead will be filed at the start of the DevOps gates design segment; this section will be replaced with concrete content at that point.

---

## 5. Composition mechanism

The dispatcher resolves a chain shape deterministically — same inputs always produce the same chain. The composition order:

1. **Selected template's Layer-1 shape** from the `.formula.json` (the catalog declares this).
2. **Canonical pipeline application.** The dispatcher inserts the §2.1 canonical steps in their canonical positions for production-diff templates. (Read-only / decision / maintenance templates — §3.7–3.13 — don't trigger this; their chains are their full canonical shape.)
3. **Severity-tiered modulation.** §2.2 tier semantics decide which canonical steps fire. At `low`, code-sanity is advisory and test-engineer skippable; at `critical`, security-auditor runs twice and behavioral QA evidence is mandatory.
4. **Auto-escalation pass.** The reviewer's auto-escalation table (§2.4) runs against the bead's scope and raises the effective SCRUTINY floor when sensitive surfaces are touched. Floor changes promote conditional steps to mandatory.
5. **Operator inserts.** `sp chain insert <chain-id> <role> --before|--after <step>` (roadmap Opp 4) applies operator-requested additions. Operator inserts cannot remove canonical steps.
6. **Coordinator entry-gate** (post-substrate-landing only). The chain coordinator (substrate §4.3 role 1, §6.3.1) re-validates the composed chain from inside the container with fresh context; may propose additional `<insert-step>` elements within `autonomy_json` policy. Pre-substrate: this step does not exist.

**Idempotence.** Re-composing the same template against the same bead produces the same chain. `sp chain review` is read-only and can be run repeatedly. `sp chain approve` is the imperative gate that commits the resolved chain.

**Template extension** (per-repo). A per-repo `.formula.json` can `extends: ["code-with-advisors"]` and append additional steps. The extended template inherits the canonical pipeline application from §2. New steps added by extension declare their own canonical-pipeline relationship (e.g., `position: before-writer`, `position: after-test-runner`) via labels.

**Where canonical pipeline facts live.**

- **Template Layer-1 shape** → `.formula.json` (executable, versioned).
- **Canonical pipeline shape, severity tiers, auto-escalation, role contracts, Release Checklist, ddiff semantics** → this document §2 (canonical reference) + the operator-facing skill (`using-specialists-v4`, Phase 6 of roadmap).
- **Reviewer enforcement** → `config/specialists/reviewer.specialist.json` system prompt.
- **`bd create` hint** → Claude Code hook (roadmap §4) — proposes template + scrutiny at bead-create time.

**Substrate alignment of the composition mechanism.** Substrate §6.9.3 frames the canonical pipeline steps that compose onto Layer-1 templates as a **mandatory layer** — schema-declarative rules that the dispatcher applies. When substrate lands, the migration is: this §2 canonical pipeline → substrate's `mandatory_layer` declarative rows; §2.4 auto-escalation table → dispatcher policy on `recommended_template` (substrate §6.4); §3 catalog → `substrate.chain_templates` rows. The data is already shaped this way; substrate executes, this document teaches.

---

## 6. Evolution protocol

This document, the canonical pipeline, and the template catalog are **living artifacts** — they evolve as we learn.

**When to add a new template.** Three or more distinct chains across two or more repositories exhibiting the same Layer-1 shape that none of the existing 13 templates covers cleanly. The pattern must be repeated (not a one-off), stable (not in flux), and distinct (not a degraded form of an existing template). Evidence comes from `.xtrm/reports/*.md` across repos.

The new template is added by: (a) drafting a `.formula.json` in `chain-templates/`; (b) adding a §3.N entry to this document with mermaid + use + variables + severity floor + differences from §2 canonical; (c) updating `chain-templates/README.md`; (d) cross-referencing in `using-specialists-v4` SKILL; (e) noting in substrate.md §6.9.10 catalog.

**When to add a new canonical-pipeline step.** A new step is added to §2 only when a gate or set of gates applies **broadly to all production-diff chains** (not template-specific) and represents a **distinct concern** orthogonal to existing canonical steps. Iron's `code-sanity` + `obligations-scanner` + `reviewer` were the original canonical gates; `test-engineer` + upgraded `test-runner` (QA) are the imminent-canonical additions; DevOps gates (§4) are the next anticipated addition. Each was/is a distinct concern (code-quality, behavioral validation, operational validation) applicable across every production-diff template.

A new canonical step lands in: (a) §2.1 shape diagram; (b) §2.3 roles table; (c) §2.6 Release Checklist; (d) the reviewer prompt; (e) the relevant per-template §3 entries; (f) substrate.md §6.9.10 catalog and §6.9.3 mandatory-layer declaration.

**When to update a per-template canonical chain.** When a template's resolved chain changes (e.g., `code-quick` raises `code-sanity` from advisory to gate because we observed too many post-merge regressions on trivial-looking changes), the change lands in:

1. This document §3 entry (the canonical declaration of the template's resolved chain).
2. The §2.2 severity-tier semantics if the change reflects a tier-rule shift.
3. The reviewer prompt (enforcement gate).
4. The `bd create` hint (so operators see the new default at bead-create time).
5. A note in CHANGELOG for the next release.

**When to fold session findings.** Per-session: orchestrator captures observations as `bd remember` memories tagged `convention` or `behavioral`. Per-design-pass: a design session (like this one) reviews recent memories and folds durable lessons into this document, the reviewer prompt, and the chain-templates catalog.

This document's revision header lists the date of each substantive fold so the lineage is greppable.

**Substrate alignment.** When substrate lands, this document remains the *philosophy* that explains why the canonical pipeline and the catalog are shaped the way they are. Substrate.md §6.9 will execute the data shape; this document teaches the reasoning.

---

## 7. Cross-references

**Foreground (today):**
- `docs/design/roadmap/chain-templates/*.formula.json` — executable formulas.
- `docs/design/roadmap/chain-templates/README.md` — operator quick-start; catalog table points back here for canonical pipeline detail.
- `docs/design/roadmap/specialists-roadmap.md` — D-decisions (§0), the twelve opportunities (§3), Opp 4 (`sp chain review/approve/insert`), Opp 5 (step-bead conventions), Opp 13 (`sp stop --all` + `sp chain stop`), Opp 14 (QA pipeline integration), Phase 6 (`using-specialists-v4` SKILL).
- `config/skills/using-specialists-v3/SKILL.md` — the operator skill that already enforces the Iron portion of §2 canonical pipeline (in production today). `using-specialists-v4` (Phase 6 of roadmap, canonical post-roadmap) is the derived how-to once QA and the rest land.

**Background (canonical future):**
- `docs/design/substrate/substrate.md` §6.9 chain templates and composition (§6.9.10 catalog, §6.9.2 step-issues, §6.9.3 mandatory layer, §6.9.5 composition in three moments); §4.3 chain coordinator (entry-gate at container start); §6.3.1 third validation moment.

**Implementation tracking:**
- `unitAI-sfwe1` — test-engineer specialist + test-runner upgrade (epic with children).
- `unitAI-f9kku` — chain_template formula integration (blocked on sfwe1.1/.2).
- `unitAI-heukb` — Opp 13 sp stop --all and sp chain stop.

**Archived (this document supersedes):**
- `docs/archive/iron-review-hardening.html` — content absorbed into §2 (canonical pipeline) and §2.4 (auto-escalation) and §2.6 (Release Checklist).
- `docs/archive/iron-review-hardening-qa-chain-substrate.md` — content absorbed into §2 (canonical pipeline roles + behavioral validation contract + failure routing).

**Companion (non-maintained):**
- `docs/design/chain-templates.html` — editorial snapshot in `substrate.html` style; preserved for external reading; **not updated going forward**. This Markdown is the only living source.

---

## Revision history

- **2026-05-30 (initial).** Promoted from `iron-review-hardening.html` + `iron-review-hardening-qa-chain-substrate.md` absorption. Initial framing used "overlay" vocabulary (Iron / QA / DevOps as composable add-ons).
- **2026-05-30 (restructure same-day).** Dropped "overlay" framing. Iron is canonical via `using-specialists-v3` (in production); QA is imminent-canonical via `unitAI-sfwe1`; neither is opt-in or modular. Restructured: §2 is now "The canonical pipeline" describing what every production-diff chain runs (severity-modulated). §3 catalog entries describe each template's resolved canonical chain inline. §4 is the only genuine pending gap (DevOps gates — design fill follows in continuation of this session). §5 is engineering composition reference. Companion HTML retained as snapshot, not maintained going forward.
