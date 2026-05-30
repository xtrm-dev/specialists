# Design — navigation index

Three layers in this directory:

## 📐 Cross-cutting design canon (TOP-LEVEL)

Documents that span both the pre-substrate roadmap and the substrate-canonical future. These are the *shared philosophy* both sides agree on.

- **[`chain-templates.md`](chain-templates.md)** — CANONICAL chain-template catalog + overlay system (Iron, QA, DevOps). Source-of-truth for chain shapes, severity-tiered depth, per-template overlay matrix, composition rules, evolution protocol. Living document — updated as new templates / overlays / per-template lessons emerge.
- **[`chain-templates.html`](chain-templates.html)** — editorial mirror of the same canon (substrate.html visual identity).

Both the roadmap (`roadmap/chain-templates/README.md`, `roadmap/specialists-roadmap.md` Opp 14) and substrate (`substrate/substrate.md` §6.9.10) reference these as the authoritative catalog + overlay declarations.

## 🛠 `roadmap/` — workaround/adaptation to ship now (FOREGROUND)

The specialists-runtime cleanup + substrate-alignment effort designed in the 2026-05-27/28 sessions. **This is the actionable work.** Bridges from today's runtime to substrate without waiting for substrate to land.

- **[`roadmap/specialists-roadmap.md`](roadmap/specialists-roadmap.md)** — CANONICAL roadmap. 12 opportunities, 8 phases, ~3–4 days wall-clock in specialists-auto mode. Decisions D1–D30 in §0.
- **[`roadmap/chain-templates/`](roadmap/chain-templates/)** — 13 evidence-backed `bd formula` files (verified vs `bd` binary). Phase 0.a installs them to `~/.beads/formulas/`.
- **[`roadmap/README.md`](roadmap/README.md)** — roadmap-area navigation (what each file does, when to read it).
- **[`roadmap/history/`](roadmap/history/)** — context-only artifacts that produced the roadmap (the substrate-author's review and handoff). Already applied. Read for context, do NOT act on.

Active execution handoff: bd bead `unitAI-wxi9e` (P0).

## 🏗 `substrate/` — canonical future target (BACKGROUND)

The substrate design (revision 10). **This is what the system migrates TO** when bd→substrate ships (months out, outside the roadmap's scope). The roadmap above produces data shapes that migrate to substrate as a rename pass, not a rewrite.

- **[`substrate/substrate.md`](substrate/substrate.md)** — rev10 canonical (1813 lines, 18 sections). Chain-coordinator §4.3, memory-as-capability §10.2.
- **[`substrate/substrate-it.md`](substrate/substrate-it.md)** — Italian translation (lags rev10 by chain-coordinator + memory sections; re-sync when working in Italian).
- **[`substrate/substrate.html`](substrate/substrate.html)** — rendered.
- **[`substrate/channels.md`](substrate/channels.md)** — channel primitive design (substrate-coupled). v0 subsumes roadmap Opp 8.
- **[`substrate/channels.html`](substrate/channels.html)** — rendered.
- **[`substrate/handoff-html.md`](substrate/handoff-html.md)** — handoff for the HTML/typesetting work.

## 📦 `../archive/` — superseded artifacts

Earlier design iterations that have been absorbed into canonical sources. Redirect headers in each file point at the canonical source. Do NOT cite as authoritative.

Notable recent absorptions (2026-05-30):
- `iron-review-hardening.html` → absorbed into `chain-templates.md` §3.1 (Iron overlay)
- `iron-review-hardening-qa-chain-substrate.md` → absorbed into `chain-templates.md` §3.2 (QA overlay)

## Other design docs (unrelated to specialists/substrate work)

Top-level files in this directory not listed above are unrelated design notes (darth-feedor migration, gzrx tool catalog, issuetracking, shepherd, specialists-service evaluation, test-writer specialist).
