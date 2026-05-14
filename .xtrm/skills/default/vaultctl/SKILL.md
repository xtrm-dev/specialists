---
name: vaultctl
description: >
  Use this skill whenever you need to search, read, write, or manage notes in an Obsidian vault
  using the vaultctl CLI. Trigger whenever the user asks to find a note, search the vault, create
  or update a note, check vault stats, navigate the vault structure, or audit note health.
  Also trigger when the user asks "how do I use vaultctl" or wants to understand vault CLI usage.
  If you're about to run any vault operation and aren't sure of the right command or flags,
  consult this skill first.
---

# vaultctl — Vault CLI for Agents

`vaultctl` is a zero-dependency CLI for searching and managing an Obsidian vault using SQLite FTS5.
No server, no embeddings, no container — fast local BM25 search with full CRUD.

## Config

`~/.config/vaultctl/config.toml` — check this if unsure which sources are active:

```toml
[[sources]]
id = "vault"
root = "$HOME/second-mind"
include_glob = "**/*.md"
exclude_glob = ".worktrees/**"

[[sources]]
id = "transcripts"
root = "$HOME/dev/transcriptoz/transcripts"
include_glob = "**/*.analysis.md"
```

Database: `~/.local/share/vaultctl/index.db`

## Core Commands

Always use `--json` when consuming output programmatically.

### Search
```bash
vaultctl "query terms" --json                          # search all sources
vaultctl "query" --folder concetti-schemi --json       # scope to subfolder
vaultctl "query" --tag mechanics --json                # filter by frontmatter tag
vaultctl "query" --status permanent --json             # filter by status field
vaultctl "query" --source transcripts --json           # specific source only
vaultctl "query" -n 10 --json                          # more results (default: 5)
```

**Result shape:**
```json
[
  {
    "score": -4.84,
    "source_id": "vault",
    "rel_path": "concetti-schemi/repo-market.md",
    "title": "repo-market",
    "snippet": "...matched text with context...",
    "tags": ["mechanics", "repo"],
    "status": "permanent"
  }
]
```

Score is negative BM25 — less negative = more relevant. Top result is index 0.

### Index
```bash
vaultctl index --json                  # incremental (skips unchanged files by mtime)
vaultctl index --full --json           # full rebuild
vaultctl index --source vault --json   # single source only
vaultctl status --json                 # check index health before querying
```

Run `vaultctl index` if search returns stale or missing results. Index auto-bootstraps on first use.

### Note Operations
```bash
vaultctl note read "path/to/note.md" --json
vaultctl note write "path/to/note.md" --text "# Title\ncontent" --json
vaultctl note append "path/to/note.md" --text "\n## New section\n..." --json
vaultctl note delete "path/to/note.md" --yes --json
vaultctl note index "path/to/note.md" --json   # re-index after external edit
vaultctl note links "path/to/note.md" --json   # suggested wikilinks
```

Paths are relative to the source root. Write/append/delete auto-reindex after the operation.

**Read result shape:**
```json
{
  "success": true,
  "source": "vault",
  "file_path": "concetti-schemi/repo-market.md",
  "content": "...",
  "metadata": {
    "note_title": "repo-market",
    "folder": "concetti-schemi",
    "tags": ["mechanics", "repo"],
    "status": "permanent",
    "wikilinks": ["[[primary-dealer]]"]
  }
}
```

### Navigation
```bash
vaultctl find "pattern" --source vault --json      # glob file search
vaultctl tree concetti-schemi --depth 2 --json     # directory tree
vaultctl context vault:path/to/note.md --json      # note + backlinks context
```

`context` TARGET format: `source_id:relative/path.md`

### Vault Analytics
```bash
vaultctl stats --json                    # document/section counts per source
vaultctl status --json                   # db path, doc count, last indexed
vaultctl audit orphans --json            # notes with no incoming wikilinks
vaultctl audit linked -n 20 --json       # most-linked notes
vaultctl audit duplicates --json         # near-duplicate content candidates
```

### MCP Bridge
```bash
vaultctl mcp serve --transport stdio
```

Exposes vault operations as MCP tools over stdio for MCP client compatibility.

## Common Agent Patterns

**Search then read:**
```bash
vaultctl "repo market mechanics" --folder concetti-schemi --json
# use rel_path from result[0]:
vaultctl note read "1-projects/trading/concetti-schemi/repo-market.md" --json
```

**Write a note and confirm it's searchable:**
```bash
vaultctl note write "1-projects/research/new-topic.md" --text "# New Topic\n..." --json
vaultctl "new topic" --json   # verify indexed
```

**Stale index guard:**
```bash
vaultctl status --json   # check stale_documents count
vaultctl index --json    # run if stale_documents > 0
```
