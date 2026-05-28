# Chain Templates — Default Catalog

> **Status:** design deliverables, evidence-backed from 96+ session reports across 9 repos (explorer pass 2026-05-27).
>
> **Schema:** verified `bd formula` schema. Pour mechanism creates a `molecule` parent issue (the chain identity) + one bd issue per formula step as children with `parent-child` edge. `needs` produces `blocks` edges between siblings. Per-step `labels` carry role identity for the post-pour edge-wiring helper (Opportunity 5).
>
> **Reference:** `docs/design/roadmap/specialists-roadmap.md` §3 (10 alignment opportunities), §3.1.10 (--chain redesign), §12 (sp epic decoration).

## What's in this directory

13 default chain template files, named `<template>.formula.json`. Each uses only `[package]` tier specialists from `config/specialists/` — these are the cross-repo defaults. Per-repo overrides via `extends` can add custom specialists (see market-data example pattern in roadmap §3 Opportunity 4).

| File | Roles in chain | Use case |
|---|---|---|
| `code-quick.formula.json` | root → reviewer | LOW-blast trivial change (one-line fix, typo) |
| `code-standard.formula.json` | root → executor → code-sanity → obligations-scanner → reviewer | Production diff default (Iron pipeline) |
| `code-with-advisors.formula.json` | root → [explorer + researcher + overthinker] → executor → code-sanity → obligations-scanner → reviewer | HIGH/CRITICAL blast, cross-cutting refactor, external-library work |
| `debug.formula.json` | root → debugger (non-skippable) → code-sanity → obligations-scanner → reviewer | Bug fix (root cause + targeted fix + regression test) |
| `security-deep.formula.json` | root → security-auditor (advisor) → executor → code-sanity → security-auditor (gate) → obligations-scanner → reviewer | Sensitive surface (auth/secrets/crypto/migrations/agent-config); scrutiny=critical default |
| `release-prep.formula.json` | root → changelog-drafter → changelog-keeper | Release prep — reconcile [Unreleased] CHANGELOG.md |
| `triage.formula.json` | root → explorer → overthinker | Board health: clustering + dup detection + rewire recommendations |
| `research-only.formula.json` | root → {explorer or researcher via `{{specialist}}` var} | Investigation that deliberately produces no code |
| `restitch.formula.json` | root → debugger → code-sanity → reviewer | Conflict recovery after failed merge |
| `planning.formula.json` | root → planner | Vague initiative → phased bd issue board |
| `premortem.formula.json` | root → overthinker | Devil's-advocate before risky design commits |
| `doc-sync.formula.json` | root → sync-docs | Single-document drift-aware update |
| `memory-hygiene.formula.json` | root → memory-processor | Stale memory consolidation (post-epic-close) |

## Shipping path

Templates land in one of three bd formula search paths (resolution order):

1. **`<repo>/.beads/formulas/`** — per-repo, highest priority. Use for project-specific extensions (e.g. mercury's `quant-validation` extending `code-with-advisors`).
2. **`~/.beads/formulas/`** — user-global. Use to install personal preferences.
3. **`$GT_ROOT/.beads/formulas/`** — orchestrator-global (if `GT_ROOT` env set).

**Recommended shipping mechanism:** package these defaults into the `@jaggerxtrm/specialists` npm package and have `xt init` / `xt update` copy them to `~/.beads/formulas/` (or per-repo, behind a flag). Per-repo customizations live in `<repo>/.beads/formulas/` and `extends` the package defaults.

## How to use a template

```bash
# List available formulas
bd formula list

# Inspect a formula
bd formula show code-standard

# Dry-run pour (preview)
bd mol pour code-standard --dry-run --var root_title="Fix Treasury rounding" --var scope="analytics/**"

# Actual pour (creates the chain: molecule + step beads)
bd mol pour code-standard --var root_title="Fix Treasury rounding" --var scope="analytics/**"
# → returns the molecule id (this IS the chain identity)
# → produces N child beads (root step + step beads) with parent-child edges + blocks edges

# After pour: run the post-pour helper to apply semantic edges (validates/informs/etc.)
sp chain wire-edges <molecule-id>
# → reads each child's labels (role:X, edge:validates->root, etc.)
# → applies the semantic edge types beyond bd's native blocks-on
```

## Post-pour helper — `sp chain wire-edges`

bd formula's `needs` field only produces `blocks-on` edges (ordering). For the richer semantic edges from Opportunity 5 (`validates`, `informs`, `discovered-from`), each step's `labels` carry the intended edge type as `edge:<type>-><target-step-id>`. A small post-pour helper script applies these:

**Pseudocode:**
```
sp chain wire-edges <molecule-id>:
  for each child of <molecule-id>:
    for each label matching `edge:<type>-><target>`:
      target_bead_id = resolve <target> step within molecule
      bd dep add <child> <target_bead_id> --type <type>
```

The helper is ~50 LOC in shell or node. It runs immediately after `bd mol pour` (chained or called by `sp chain plan`). Idempotent: re-running is safe (bd dep add deduplicates by source+target+type).

**Why labels not formula extension:** bd formula's edge support is limited to `needs` (blocks-on). Putting edges in labels keeps formulas portable to vanilla bd while letting our helper layer richer semantics on top. When substrate lands and absorbs chain composition (§22 of friction audit), the edge information ships natively as substrate step-issue relationships — no helper needed at that point.

## Selection logic — NOT in formula

bd formula does NOT support `applies_when` matcher fields at the formula level. The choice of WHICH template to use for a given bead lives elsewhere:

1. **Claude Code hook on `bd create` (roadmap §4)** — detects bead type/scope/scrutiny/keywords and proposes a template. Highest-leverage layer.
2. **`sp chain plan <bead>` (roadmap §3.1.4)** — explicit composition gate; resolves template from bead attributes; pours; wires edges.
3. **Operator override** — `sp chain plan <bead> --template <name>` or direct `bd mol pour <template>`.

The selection matchers (scope_matches, type, scrutiny_gte, etc.) ship as a separate config file consumed by the hook + dispatcher. **One matcher language across the system** (substrate-review §18 reuse audit) — but applied at the selection layer, not encoded in each formula.

## Per-repo extension example

Market-data extends `code-with-advisors` with `quant-methodologist` and `quant-researcher`:

```jsonc
// ~/projects/mercury/market-data/.beads/formulas/quant-validation.formula.json
{
  "formula": "quant-validation",
  "type": "workflow",
  "version": 1,
  "description": "Per-repo quant chain extending code-with-advisors with mercury's domain specialists.",
  "extends": ["code-with-advisors"],
  "steps": [
    {
      "id": "quant-methodologist",
      "title": "quant-methodologist:{{root_title}}",
      "type": "task",
      "needs": ["root"],
      "description": "MANDATE: lock numerical methodology before executor. Define rounding policy, tick grid, statistical assumptions, real-data smoke requirements.\nINPUTS: root contract.\nOUTPUTS: methodology memo with concrete formulas/policies; required test vectors; smoke-data requirements.",
      "labels": ["chain-step", "kind:step", "role:quant-methodologist", "edge:informs->root", "advisor:pre-impl"]
    }
  ]
}
```

The child template's steps APPEND to parent's. Behavior: bd cook resolves parent + child steps into the full chain shape; pour creates the molecule with all steps.

## Limitations + future evolution

1. **`needs` is `blocks-on` only.** Semantic edges via labels + post-pour helper (above). Acceptable bridge; substrate §22 absorbs natively.
2. **`extends` APPENDS child steps** (not prepend, not replace). To put advisors BEFORE executor when extending, the child must duplicate the executor's `needs` to depend on the new advisors. We avoided extends in defaults; per-repo extension still uses it with this caveat.
3. **No `applies_when` in formula.** Selection logic external. Documented above.
4. **`bd mol pour` creates a NEW molecule** every time — operator can't pour into an existing molecule. For chain insertion (Opportunity 4 `sp chain insert`), helper logic creates step beads directly and wires edges, bypassing pour. Documented in roadmap §3.1.4.
5. **Variables substitute at pour time only.** No runtime variables; no late-binding from bd context. Fine for chain shape; selection logic handles dynamic context.

## Cross-reference

- **Friction audit** `docs/design/roadmap/specialists-roadmap.md`:
  - §3 alignment opportunities (especially #3 mol pour, #4 sp chain plan, #5 step bead conventions)
  - §12 sp epic decoration (chain ≡ bd molecule replaces the old chain ≡ bd epic mental model where molecule auto-creates)
- **Substrate design** `docs/design/substrate.md`:
  - §6.9.2 step-issues (the substrate analog of step beads)
  - §6.9.3 mandatory layer (Iron pipeline gates overlay)
  - §6.9.5 composition in three moments
- **Substrate review** `docs/design/substrate-review.md`:
  - §25 workflow definition language (initial 6-template draft, now superseded by these 13 evidence-backed templates)
