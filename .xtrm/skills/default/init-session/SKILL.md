---
description: "Bootstrap context for a new session — load latest report, relevant memories, and orient to current project state."
---
# Session Start

Bootstrap context for a new session. Read the latest session report, load relevant memories, and orient to current project state.

## When to Use

**Trigger:** Start of any new session, after `/compact`, or when the user says "init", "start session", "what's the context?", "catch me up".

## Execution Flow

### 1. Read the latest session report

```bash
ls -t .xtrm/reports/ | head -1
```

Read the most recent report file. Pay attention to:
- **Summary** — what was done, what state the project is in
- **Open Issues with Context** — what's ready for next session
- **Suggested Next Priority** — recommended work order
- **Problems** — recurring issues to watch for

Do NOT read the entire report into your response. Internalize it and give a concise 3-5 line summary to the user.

### 2. Load relevant memories

```bash
bd memories <keyword>    # Search by topic
bd recall <key>          # Get specific memory
```

Search for memories relevant to the user's likely task:
- `bd memories specialist` — specialist workflow patterns
- `bd memories bug` — known gotchas and fixes
- `bd memories worktree` — worktree workflow notes
- `bd memories executor` — executor behavior patterns

If the user mentioned a topic, search for that specifically. Otherwise, load the 3-5 most recent/relevant memories.

### 3. Check active work

```bash
bd list --status=in_progress   # Any unclosed claims from prior sessions
bd ready                       # What's available to work on
bd stats                       # Project health overview
```

If there are unclosed in_progress issues from prior sessions, flag them — they may be stale claims that need closing or represent interrupted work.

### 4. Report to user

Give a concise briefing:
- What was done last session (from report)
- Any open claims or interrupted work
- Top 3 suggested next tasks (from report + `bd ready`)
- Any relevant memories that affect today's work

Keep it under 15 lines. The user wants orientation, not a novel.

## Memory Protocol

Throughout the session, use `bd remember` and `bd memories` for persistent knowledge:

- **Before investigating a topic**: `bd memories <topic>` — check if prior sessions already discovered this
- **After learning something non-obvious**: `bd remember "<insight>"` — save for future sessions
- **Before fixing a bug**: `bd memories <error keyword>` — check if fix is already known
- **After fixing a bug**: `bd remember "<what broke and why>"` — prevent rediscovery

The memory system is the project's institutional knowledge. Use it aggressively — a redundant memory costs nothing, a missing one costs a full rediscovery cycle.
