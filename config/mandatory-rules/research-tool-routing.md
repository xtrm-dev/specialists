---
name: research-tool-routing
kind: mandatory-rule
---
Pick the right source before invoking research. Default to the project knowledge graph and repo evidence first; reach for external tools only when the answer cannot come from local sources.

- `find-docs` / context7 — library, framework, SDK, CLI, or cloud-service docs (API syntax, config, migration).
- `deepwiki` — public GitHub repo internals (architecture, conventions, code paths).
- `github-search` (ghgrep) — real-world code patterns and API usage examples.
- `ddgs` — general web search, no API key (`ddgs text -q "<query>" -m 8`). Discover authoritative URLs for vendor docs, blogs, papers, or proprietary products the above don't cover.
- `agent-browser` — read/interact with any URL, including JS-rendered pages (`agent-browser open <url>` → `get text body`; close with `agent-browser close --all`).
- `last30days` — recent web/social signals (Reddit, X, HN, YouTube). Early-warning only, never authoritative.

General web (not a library/repo/social topic): use `ddgs` to discover URLs, then `agent-browser` to read them. Never point `agent-browser` at a search engine — headless Chrome gets CAPTCHA-blocked; search with `ddgs` instead. If `ddgs`/`agent-browser` aren't installed, report the gap (`uv tool install ddgs`; `npm i -g agent-browser && agent-browser install`) rather than answering from memory.

Invoke skills on demand, not by default. Cite the source for every external claim.
