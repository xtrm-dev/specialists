---
name: releasing
description: >-
  Cut a release end-to-end via the changelog-keeper specialist. Use when the
  operator wants to publish a new tag (vX.Y.Z) — drafts CHANGELOG section
  from xt reports, bumps package.json, rebuilds dist, commits, tags, pushes,
  optional GH release. Strict scope: only CHANGELOG.md + package.json + dist/.
version: 1.1.0
---

# releasing

One-step release publication via specialist delegation.

## When to use

The operator wants to cut a release. They say "release it", "ship vX.Y.Z", "cut a tag", or just "release".

## How

1. Determine target version. Default is patch bump from most recent semver tag. Operator may specify `--minor`, `--major`, or explicit version.

2. Determine tag range. Default is `<latest-tag>..HEAD`. For backfills, operator names `--from` / `--to` explicitly.

3. Create release bead. Template:

   ```
   PROBLEM: Cut release vX.Y.Z covering <prev-tag>..HEAD.
   SUCCESS: CHANGELOG.md updated with new section above prior release; package.json bumped; dist rebuilt; commit `release: vX.Y.Z` pushed with tag.
   SCOPE: CHANGELOG.md, package.json, dist/. Synthesis input: xt reports under .xtrm/reports/ dated within <prev-tag-date>..HEAD.
   NON_GOALS: No source/docs/config edits. No retroactive changes to prior release sections.
   CONSTRAINTS: Keep-a-Changelog v1.0.0 format. One-line bullets. Default bucket Changed. Deprecated only for explicit sunsets.
   VALIDATION: git diff --stat HEAD~1 HEAD shows only CHANGELOG.md, package.json, dist/.
   OUTPUT: Final report with VERSION, COMMIT, TAG, PUSHED status.
   GH_RELEASE: <true|false>   # whether to also `gh release create`
   ```

4. Dispatch specialist:

   ```bash
   sp run changelog-keeper --bead <bead-id> --background
   ```

   No worktree (release work is on active branch). No reviewer chain — verification is diff check below.

5. Verify diff after specialist completes.

   ```bash
   git diff --stat HEAD~1 HEAD
   ```

   Output MUST show only:
   - `CHANGELOG.md`
   - `package.json`
   - `dist/index.js`, `dist/lib.js`, `dist/types/**`

6. If diff check passes, release shipped. Confirm:

   ```bash
   git tag --list 'v*' | tail -3
   git log --oneline -1
   ```

## Why this design

- Specialist does work itself. No CLI plumbing, no template substitution, no JSON output schema, no two-phase prepare/publish gate.
- Mandatory rule `changelog-keeper-scope` enforces edit whitelist.
- Operator gate is single `git diff --stat HEAD~1 HEAD` check after specialist finishes.
- xt reports are synthesis input, not git log + bd query. Reports are pre-curated, signal-rich, written in user-facing language.
- New pre-script injects a bounded xt report bundle first so changelog bullets can reflect intent and post-mortem context, not just file diffs.

## Parallel sessions

Each orchestrator runs this skill in its own session. Specialist commits + tags + pushes atomically. If two sessions try same version, first push wins; second sees remote tag conflict and aborts cleanly. Operator picks next version and retries.

## Don't

- Don't manually `sp release prepare`/`publish` — those CLIs are removed in v3.X.Y (TBD).
- Don't edit CHANGELOG.md outside specialist run — manual edits leak into next release diff and break scope verification.
- Don't pre-stage files. Specialist stages exactly what it commits.
