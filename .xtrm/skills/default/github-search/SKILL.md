---
name: github-search
description: >-
  Search real-world GitHub code examples from bash using the ghgrep CLI wrapper
  for the github-grep MCP server. Use when you need implementation patterns,
  API usage examples, or production snippets from public repositories.
---

# GitHub Code Search (ghgrep)

Use `ghgrep` to query `mcp.grep.app` without requiring MCP tool access.

## Usage

```bash
ghgrep <query> [options]
```

## Options

```bash
--lang <langs>       Comma-separated languages (TypeScript,TSX,Python)
--repo <repo>        Repository filter (facebook/react)
--path <path>        File path filter
--regexp             Regex mode (auto-prefixes (?s) for multiline)
--case               Case-sensitive match
--words              Whole-word match
--limit <n>          Max formatted results (default: 10)
--json               Raw MCP JSON payload
```

## Recommended workflow

1. Start with a literal code pattern (`useEffect(`, `createServer(`, `router.get(`).
2. Add `--lang` and `--repo` filters to reduce noise.
3. Use `--regexp` for multi-line patterns.
4. Re-run with narrower `--path` once you identify likely file locations.

## Examples

```bash
ghgrep "useEffect(" --lang TSX,TypeScript --limit 5

ghgrep "createMiddleware" --repo vercel/next.js --lang TypeScript

ghgrep "try {.*await" --regexp --lang TypeScript --path src/

ghgrep "z\.object\(" --regexp --lang TypeScript --json
```
