---
name: releasing
description: >-
  Cut a release end-to-end via the changelog-keeper specialist. Use when the
  operator wants to publish a new tag (vX.Y.Z) — drafts CHANGELOG section
  from xt reports, bumps package.json, rebuilds dist, commits, tags, pushes,
  optional GH release. Strict scope: only CHANGELOG.md + package.json + dist/.
version: 1.0.0
---

# releasing

One-step release publication via specialist delegation.

## When to use

The operator wants to cut a release. They say "release it", "ship vX.Y.Z", "cut a tag", or just "release".

## How

1. Determine the target version. Default is patch bump from the most recent semver tag. Operator may specify `--minor`, `--major`, or an explicit version.

2. Determine the tag range. Default is `<latest-tag>..HEAD`. For backfills, operator names `--from` / `--to` explicitly.

3. Create a release bead. Template:

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

4. Dispatch the specialist:

   ```bash
   sp run changelog-keeper --bead <bead-id> --background
   ```

   No worktree (release work is on the active branch). No reviewer chain — the verification is the diff check below.

5. **Verify the diff after the specialist completes.** This is the critical operator gate.

   ```bash
   git diff --stat HEAD~1 HEAD
   ```

   The output MUST show ONLY:
   - `CHANGELOG.md`
   - `package.json`
   - `dist/index.js`, `dist/lib.js`, `dist/types/**`

   If ANY other file appears (`src/**`, `docs/**` other than CHANGELOG, `config/**`, `tests/**`, `README.md`, etc.), the specialist violated scope. Action:

   ```bash
   git push --delete origin vX.Y.Z   # delete remote tag
   git tag -d vX.Y.Z                 # delete local tag
   git reset --hard HEAD~1           # discard the release commit
   git push --force-with-lease       # only if push already happened
   ```

   Then file a bug bead naming the offending paths and revisit the specialist's mandatory rule.

6. If the diff check passes, the release is shipped. Confirm:

   ```bash
   git tag --list 'v*' | tail -3     # new tag present
   git log --oneline -1              # message starts with "release: vX.Y.Z"
   ```

## Why this design

- Specialist does the work itself (Read xt reports, Edit files, Bash for build/commit/tag/push). No CLI plumbing, no template substitution, no JSON output schema, no two-phase prepare/publish gate.
- Mandatory rule `changelog-keeper-scope` enforces the edit whitelist at the specialist level.
- Operator gate is the single `git diff --stat HEAD~1 HEAD` check after the specialist finishes. If it shows only whitelisted paths, the release is correct.
- xt reports are the synthesis input, not git log + bd query. Reports are pre-curated, signal-rich, written in user-facing language.

## Parallel sessions

Each orchestrator runs this skill in its own session. The specialist commits + tags + pushes atomically. If two sessions try to release the same version, whichever pushes first wins; the other sees a remote tag conflict on push and aborts with a clean error. Operator picks the next version and retries.

## Don't

- Don't manually `sp release prepare`/`publish` — those CLIs are removed in v3.X.Y (TBD).
- Don't edit CHANGELOG.md outside the specialist run — manual edits leak into the next release's diff and break scope verification.
- Don't pre-stage files. The specialist stages exactly what it commits.
