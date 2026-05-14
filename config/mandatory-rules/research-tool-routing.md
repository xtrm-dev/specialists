---
name: research-tool-routing
kind: mandatory-rule
---
Pick the right source before invoking research. Default to the project knowledge graph and repo evidence first; reach for external tools only when the answer cannot come from local sources.

- `find-docs` / context7 — library, framework, SDK, CLI, or cloud-service docs (API syntax, config, migration).
- `deepwiki` — public GitHub repo internals (architecture, conventions, code paths).
- `github-search` (ghgrep) — real-world code patterns and API usage examples.
- `last30days` — recent web/social signals (Reddit, X, HN, YouTube). Early-warning only, never authoritative.

Invoke skills on demand, not by default. Cite the source for every external claim.
