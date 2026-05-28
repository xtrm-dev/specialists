# Roadmap — specialists-runtime cleanup + substrate-alignment

Workaround/adaptation we designed to bridge today's runtime to substrate without waiting for substrate to land. **This is the actionable work for the next ~3–4 days of specialists-auto execution.**

## What to read when

| When | File | What it gives you |
|---|---|---|
| **You're picking up the work** | bd bead `unitAI-wxi9e` (P0) | Handoff: pointer index + 3 meta-phases (validation → planning → auto-execution) + per-phase smoke checkpoints + do-not list |
| **You want the plan** | [`specialists-roadmap.md`](specialists-roadmap.md) | Canonical roadmap — 12 opportunities, 8 phases (0–7), decisions D1–D30, parallelization map, friction catalog, reads-forward to substrate |
| **You're about to install chain templates** | [`chain-templates/README.md`](chain-templates/README.md) + the 13 `.formula.json` | Phase 0.a target — copy to `~/.beads/formulas/`; substrate-aligned shape; post-pour wire-edges spec |
| **You're cross-checking design history** | [`history/substrate-reconciliation.md`](history/substrate-reconciliation.md) | The substrate-author's decision-delta against the roadmap. Already applied to the canonical roadmap. Read for context only. |
| **You're cross-checking handoff context** | [`history/handoff-from-substrate-design.md`](history/handoff-from-substrate-design.md) | The handoff from the substrate-design author to the specialists-runtime work. Names the open questions deferred to the next-agent-with-code-visibility. Already addressed in the roadmap. |

## What this is NOT

- Not substrate design — that's [`../substrate/`](../substrate/). The roadmap reads forward to substrate sections.
- Not implementation — the roadmap is the plan; implementation happens via the handoff bead.
- Not retrofit of existing artifacts (specialists, beads, etc.) — the roadmap is forward-only where retrofit cost would dominate.

## Key inputs (live system state, not files in this directory)

- `config/specialists/*.specialist.json` — 19 package-tier specialists (the dispatch catalog)
- `config/mandatory-rules/` — 20 rule files (template_sets injection)
- `config/skills/` — operator-facing skills (canonical sources)
- `src/specialist/` + `src/cli/` — runtime + CLI surface to modify
- `~/.beads/formulas/` — chain template install target (Phase 0.a populates from `chain-templates/`)
- `bd memories <keyword>` / `bd recall <key>` — persistent project memory (576+ entries)

## Active bead

`unitAI-wxi9e` (P0) — HANDOFF: specialists-runtime cleanup + substrate-alignment — fresh-session validation → planning → specialists-auto execution.
