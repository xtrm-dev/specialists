---
name: session-close-report
description: |
  Generate or update the structured technical handoff report at session close.
  Prefer one same-day SSOT report: update the latest report for today when it
  exists, otherwise run `xt report generate`, then fill every `<!-- FILL -->`
  section from orchestrator context.
---

# session-close-report

## When to use

Invoke this skill at the end of a productive session — after issues are closed,
code is committed, but before final push. It produces the handoff report that
the next agent reads to start cold without losing context.

## Report identity rule

Prefer a single same-day SSOT handoff report.

Before generating anything, check existing reports:

```bash
xt report list
ls -t .xtrm/reports/*.md 2>/dev/null | head
```

Decision:
- If a report for today already exists, update the latest same-day report.
- If multiple orchestrators ran today, merge your context into that same report;
  do not create a competing handoff unless the operator explicitly asks for a
  separate report.
- If no suitable same-day report exists, run `xt report generate` and fill the
  new skeleton.

When updating an existing report, preserve prior orchestrator content. Append,
merge, or revise sections so the file remains one coherent handoff package — do
not overwrite earlier waves, issue context, problems, or decisions unless they
are factually superseded.

## Workflow

### 0. Cleanup before reporting (MANDATORY)

A report on a dirty session is misleading. Before selecting or generating any
report, verify and clean up everything this session opened. The report must
reflect a clean terminal state.

```bash
# 0a. Worktrees opened during the session
git worktree list                  # any feature/fix/chore worktrees still here?
# Remove every worktree this session created (or that a stopped specialist left):
git worktree remove <path>         # for each stale entry
git branch -D <branch>             # only after confirming merged or abandoned
git worktree prune                 # drop stale metadata

# 0b. Specialist jobs still running or waiting
sp ps                              # MUST be empty (or only intentionally kept-alive jobs)
sp stop <job-id>                   # for any leftover running/waiting job
# After every sp stop, re-check sp ps and git worktree list — sp stop should
# clean its worktree, but verify.

# 0c. Stale background processes from the session
ps -ef | grep -E '(serena|gitnexus|specialists|sp-serve|sp-script|pi[ -]|claude)' | grep -v grep
# Kill anything you launched that is still running and no longer needed.
# Be especially careful with:
#   - serena MCP servers (often leak when an MCP host crashes)
#   - gitnexus index processes (`npx gitnexus analyze` can outlive its terminal)
#   - sp-serve / sp-script tmux sessions
#   - orphaned `pi` or `claude` processes from interactive sessions

tmux ls 2>/dev/null                # any sp-* or xt-* tmux sessions left?
tmux kill-session -t <name>        # for each stale session

# 0d. Tmp dirs the session created (only if large or sensitive)
ls -la /tmp/sp-serve-* /tmp/sp-script-* 2>/dev/null
```

Do not skip any sub-step. If a process refuses to stop cleanly, document it in
the **Problems Encountered** section of the report so the next agent knows.

A clean session ends with:
- `git worktree list` showing only the main worktree (plus any intentional ones)
- `sp ps` showing 0 jobs (or only intentional keep-alive)
- no leaked `serena` / `gitnexus` / `specialists` / `sp-serve` / `sp-script`
  processes from this session
- no orphaned tmux sessions matching `sp-*` or `xt-*`

### 1. Select report: update existing or generate new

For same-day update:

```bash
REPORT=$(ls -t .xtrm/reports/$(date +%F)-*.md 2>/dev/null | head -1)
```

If `$REPORT` is non-empty, read and update it.

If no same-day report exists:

```bash
xt report generate
```

This collects data from git log, bd, .specialists/jobs/ and writes a skeleton
to `.xtrm/reports/<date>-<hash>.md` with YAML frontmatter and pre-filled tables.

### 2. Read the target report

Read the chosen report completely enough to understand existing content.

Skeleton reports have `<!-- FILL -->` markers in every section that needs your
input. Existing same-day reports may already be partially filled; update those
sections with the new session context and remove any now-stale placeholders.

### 3. Fill or update every section from your context

You are the orchestrator. You have the full session context. The CLI only
collected raw data — you provide the meaning.

When updating an existing same-day report:
- Add new waves, issues, commits, problems, and decisions without duplicating
  existing rows.
- Update summary/frontmatter counts to cover the whole same-day handoff, not
  just your sub-session.
- Reconcile stale “open issues” entries if you closed them later in the day.
- Keep one chronological/coherent narrative instead of separate mini-reports.

**For each section, here is exactly what to write:**

#### Summary
One dense paragraph. What was accomplished, key decisions made, discoveries,
outcomes. Technical prose — no filler, no "in this session we...". Lead with
the most important result. For same-day updates, summarize the whole day’s SSOT
state, including earlier orchestrators and your additions.

#### Issues Closed
The skeleton has a flat table. Restructure it:
- Group by category: bugs discovered, backlog items, cleanup/closures, features
- If specialists were used, add Specialist and Wave columns
- Expand terse close reasons into useful context
- When updating an existing report, add newly closed issues and revise stale open
  entries that are now closed

#### Issues Filed
Add every issue you created this session. The **Why** column is mandatory —
explain the rationale for filing, not just what the issue says.

Update the `issues_filed` count in frontmatter.

#### Specialist Dispatches
If specialists were dispatched:
- Build a Wave summary table: Wave number, specialists, models, outcomes
- Add a Problems sub-table for any failed/stalled dispatches
- Update `specialist_dispatches` and `models_used` in frontmatter

If no specialists were used and the report has no prior specialist dispatches,
delete this section. If prior dispatches exist, keep and extend them.

#### Problems Encountered
Every problem hit during the session. Root Cause and Resolution columns are
mandatory. Include: bugs discovered, wrong approaches tried, blockers hit,
tooling failures, and any cleanup-step failures from Step 0 above. If no
problems exist anywhere in the same-day report, delete this section entirely.

#### Code Changes
The skeleton lists files. Add narrative:
- Explain key modifications (not every file — focus on the important ones)
- Group logically if many changes (e.g., "CLI commands", "Hook changes")
- Note architectural decisions embedded in the changes
- For same-day updates, include changes from all orchestrators that contributed
  to the final pushed stack

#### Documentation Updates
List doc changes, skill updates, memory saves, CHANGELOG entries
(see Step 5 — due-diligence sweep — and Step 6 — CHANGELOG sync).
Delete if no doc work happened.

#### Open Issues with Context
This is the most valuable handoff section. For each open issue:
- **Context / Suggestions**: What the next agent needs to know. Current state,
  blockers discovered, suggested approach, files to look at, gotchas.
- Group into "Ready for next session" and "Backlog" subsections
- Put the most actionable items first
- If an issue listed earlier in the day was closed later, remove it from open
  issues and move it to Issues Closed with closure context

#### Memories Saved
List all `bd remember` calls made this session. If the skeleton missed any,
add them. If none were saved, note why (nothing novel, or deferred).

#### Suggested Next Priority
Ordered list of 1-4 items with rationale for each. Based on:
- Dependency order (what unblocks the most)
- User's stated intent (if they mentioned what's next)
- Urgency of discovered issues
- Blocked items about to unblock

For same-day updates, make this the next priority from the final state of the
whole day, not from an earlier partial state.

### 4. Update frontmatter

Ensure all frontmatter counts are accurate after filling/updating:
- `issues_filed` — actual count represented in the report
- `specialist_dispatches` — actual count represented in the report
- `models_used` — list of models that did work represented in the report
- `issues_closed` — actual closed issue count represented in the report
- `commits` — commit count represented in the report, if known

### 5. Due-diligence sweep (paranoid mode — assume you forgot something)

Step 0 cleaned the *process* state. This step audits the *content* state.
Cleanup work the orchestrator usually forgets at session close, ranked by
how often it gets missed:

- **Service skills**: did this session touch any code under a service
  registered in `.claude/skills/service-registry.json` (or equivalent
  registry)? If yes, the service skill's SKILL.md or diagnostic scripts
  are likely drifted. Run `/updating-service-skills` (or
  `service-skills-sync` specialist) and let it scan. If no registry exists,
  skip — but check whether the project keeps service skills under
  `.xtrm/skills/user/packs/<service>/` and treat them the same.
- **Docs SSOT**: did the session change architecture, migrations, public
  APIs, or service ownership? If yes, run `/sync-docs` (or the
  `sync-docs` specialist) for any drifted doc. Skip if changes are
  pure-internal (refactors with no observable surface change).
- **Memories**: every `bd close` should have triggered a memory-gate ack.
  Run `bd memories <topic>` to confirm anything genuinely novel landed.
  If you saw a real surprise but acked "nothing novel" out of haste,
  go back and `bd remember` it now.
- **CLAUDE.md / project guide**: did this session add or remove a
  service, change a key port, change a top-level workflow command, or
  change how tools are wired? If yes, append/correct in CLAUDE.md before
  commit — the file is loaded automatically by every future session.
- **Evidence artifacts**: did the session generate reports, dashboards,
  CSVs, or figures intended to be persisted (`scripts/outputs/`,
  `docs/review/`, etc.)? Confirm they are committed; otherwise either
  commit them or document in the report why they were not kept.
- **Decisions**: did the session make a non-obvious architectural call
  (deprecating a service, schema choice, dependency swap)? Record via
  `bd decision` if the project uses it, otherwise note in the report.
- **Tests**: did new behavior land without tests? If yes, file a test
  follow-up bead (`discovered-from:<impl-id>`) before closing — do not
  let untested behavior leave the session silent.
- **Skill packs (`.xtrm/skills/`)**: did you edit a skill in this
  project? If the canonical version lives in xtrm-tools, mirror the edit
  there too (or note that `xt update` will overwrite the local mirror on
  next sync, which makes the local edit ephemeral).
- **Open beads created mid-session**: every bead filed this session
  should be either closed, scheduled with a parent, or marked with clear
  context. Run `bd list --status=open --created-by=me` (or equivalent)
  and confirm none are floating without a parent or follow-up note.

If any item above turns up real work, do it now or file a follow-up bead
linked `discovered-from:<this-session-root>` so the next agent picks it up.
A clean session means none of these were forgotten — the report should be
able to honestly claim "due-diligence sweep clean."

### 6. Sync CHANGELOG.md (MANDATORY when user-facing changes shipped)

The session report is for the next *agent*; CHANGELOG.md is for downstream
*consumers*. Both must stay in sync — the report alone is not enough.

```bash
ls CHANGELOG.md 2>/dev/null   # confirm the project keeps one
git tag --sort=-v:refname | head -3   # last release tag
git log <last-tag>..HEAD --oneline    # what is missing
```

Decision tree:

- **A release was cut this session** (new tag, e.g. via `/releasing` or
  `changelog-keeper`): the new version section already exists. Verify it
  contains every user-facing change from the session and that
  `[Unreleased]` is empty. Stop — release flow owns CHANGELOG.
- **No release was cut**: append every user-facing change from the session
  to the existing `[Unreleased]` block at the top of CHANGELOG.md. Use
  Keep a Changelog categories: `### Added` / `### Changed` / `### Deprecated`
  / `### Removed` / `### Fixed` / `### Security`. One bullet per change,
  lead with the affected subsystem or symbol, include the bead ID(s) when
  available — same prose density as prior `[Unreleased]` entries.
- **No user-facing change shipped** (pure orchestration, doc-only edits to
  internal-handoff files like reports/skills, refactors with no observable
  effect): skip — do not pollute `[Unreleased]` with internal noise. Note
  the skip in the Documentation Updates section so it is auditable.

What counts as user-facing for `[Unreleased]`:
- new or removed CLI flags, commands, env vars, config keys
- new or removed services / containers / jobs an operator deploys
- schema migrations that downstream consumers see
- new or removed API/MCP/REST endpoints, tools, or response fields
- bug fixes that change observable behavior
- security-relevant changes

What does NOT belong in `[Unreleased]`:
- session reports themselves
- skill or memory edits that only affect agents
- refactors with byte-identical observable behavior
- per-issue notes that already live in beads

If the project has no CHANGELOG.md, skip silently — do not create one
without operator direction.

### 7. Commit the report (and CHANGELOG if updated)

Reports are versioned handoff artifacts and should be tracked. If Step 5
modified `CHANGELOG.md`, fold it into the same commit so the report and
changelog ship together.

```bash
git add .xtrm/reports/ CHANGELOG.md   # CHANGELOG.md only if changed
git commit -m "session report: <date>"
```

If you updated an existing same-day report after an earlier report commit, commit
that update with the same message style or fold it into the current final commit
before push.

### 8. File a handoff bead (MANDATORY)

The report is a static artifact — the next agent will not find it unless something
in the live board points to it. Create a single handoff bead that anchors the
SSOT report and links to the suggested next work.

```bash
REPORT_PATH=".xtrm/reports/<date>-<hash>.md"   # the path you just committed
bd create \
  --title="Session handoff <date>: pick up next priorities" \
  --description="$(cat <<EOF
Handoff for session ending <date>.

**SSOT report:** \`$REPORT_PATH\`

Read the report first — it has the full summary, problems, open issues with
context, and the ordered next-priority list. This bead is the live pointer
into the board.

**Suggested next priorities (from report §Suggested Next Priority):**
1. <bead-id-1> — <one-line rationale>
2. <bead-id-2> — <one-line rationale>
3. <bead-id-3> — <one-line rationale>
EOF
)" \
  --type=task --priority=1
```

Then link the handoff bead to each suggested next bead with a non-blocking
relation so the graph shows the recommended pickup order:

```bash
bd dep relate <handoff-id> <next-bead-1>
bd dep relate <handoff-id> <next-bead-2>
bd dep relate <handoff-id> <next-bead-3>
```

Rules:
- Use `bd dep relate` (non-blocking), **not** `bd dep add` — the handoff bead
  is advisory; it must not artificially block work.
- Priority P1 so the handoff surfaces near the top of `bd ready` / `bv --robot-next`
  for the next session.
- One handoff bead per session, even when updating a same-day SSOT report — if
  an earlier handoff bead exists for today, update its description and relations
  instead of creating a duplicate.
- If §Suggested Next Priority lists fewer than 3 beads, link only what exists.
  If it lists none (truly nothing actionable left), still file the handoff bead
  so the report is discoverable, and note "no follow-up beads — see report for
  context" in the description.

Record the handoff bead ID in the report's frontmatter (`handoff_bead: <id>`)
so the link is bidirectional.

### 9. Final cleanup verification (MANDATORY)

After committing and filing the handoff bead, re-run the Step 0 checks one more time:

```bash
git worktree list
sp ps
ps -ef | grep -E '(serena|gitnexus|specialists|sp-serve|sp-script)' | grep -v grep
tmux ls 2>/dev/null
```

If any of these show session-leaked artifacts, stop them now or document them
in the report. Do not consider the session "closed" until this verification is
clean.

## Quality bar

The reference is `~/projects/specialists/.xtrm/reports/2026-03-30-orchestration-session.md`.
Every report must match that level of detail. Specifically:

- Step 0 cleanup performed before report generation; Step 9 verification clean.
- Step 5 due-diligence sweep performed; service skills, docs, memories, CLAUDE.md, evidence, decisions, tests, and skill mirrors checked (or skipped with reason).
- Step 6 CHANGELOG sync performed when user-facing changes shipped (or skip noted).
- Step 8 handoff bead filed (P1, `bd dep relate` to each suggested next bead, `handoff_bead` recorded in report frontmatter).
- No empty `<!-- FILL -->` markers left in the final output
- No duplicate same-day reports unless explicitly requested by the operator
- Every closed issue has context, not just an ID
- Every open issue has actionable handoff suggestions
- Problems section captures root causes, not just symptoms
- Summary is a dense technical paragraph, not a list of bullet points
- Same-day updates preserve earlier orchestrator context while making the final
  file read as one SSOT handoff package

## CLI commands

| Command | Purpose |
|---------|---------|
| `xt report generate` | Collect data, write skeleton when no suitable report exists |
| `xt report show [target]` | Display latest or specified report |
| `xt report list` | List all reports with frontmatter summary |
| `xt report diff <a> <b>` | Compare two reports |
