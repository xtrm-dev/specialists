---
name: releasing
description: >-
  Cut a release end-to-end. Promotes the existing [Unreleased] CHANGELOG block
  to a dated [vX.Y.Z] section, bumps the package version, rebuilds dist,
  commits, tags, pushes, and publishes to npm. Optionally dispatches the
  changelog-keeper specialist to fill gaps in [Unreleased] from xt reports
  before promotion.
version: 2.0.0
---

# releasing

End-to-end release skill. Drives the release directly with bash; no `xt release`
wrapper. Assumes `[Unreleased]` in `CHANGELOG.md` is already populated by the
`session-close-report` skill (Step 6) across the contributing sessions.

## When to use

The operator says "release it", "ship vX.Y.Z", "cut a tag", or just "release".

## Preconditions

- Working tree clean except whitelisted release artifacts.
- `CHANGELOG.md` exists with an `[Unreleased]` block.
- On the publish branch (usually `master`).
- npm auth set up (`npm whoami` succeeds).

If the project has no `CHANGELOG.md`, stop and ask the operator.

## Flow

### 1. Decide version

```bash
git tag --sort=-v:refname | head -3        # last release
git log <last-tag>..HEAD --oneline | wc -l # commit count since
```

Default is patch bump. Operator may say `--minor`, `--major`, or specify
`vX.Y.Z` explicitly. If the in-range work added user-facing surface (new flags,
new endpoints, new commands), bump minor unless operator says otherwise.

### 2. Inspect [Unreleased]

```bash
sed -n '/## \[Unreleased\]/,/## \[/p' CHANGELOG.md
```

Decision:

- **Populated and complete** (covers the user-facing changes since last tag):
  proceed to Step 3.
- **Populated but gappy or sparse** (some sessions skipped Step 6, or the
  bullets do not match commits): dispatch `changelog-keeper` to reconcile from
  xt reports, then re-inspect. See "Optional: changelog-keeper dispatch".
- **Empty** but commits since last tag are pure-internal (refactors,
  doc-only): proceed; the released section will be near-empty.
- **Empty** but there are user-facing changes: dispatch `changelog-keeper`.

### 3. Promote [Unreleased] → [vX.Y.Z]

Edit `CHANGELOG.md`:

- Insert a new empty `## [Unreleased]` block at the top.
- Rename the previous `[Unreleased]` to `## [vX.Y.Z] — YYYY-MM-DD` (today's
  date).
- Keep the section bodies (Added / Changed / Fixed / etc.) untouched.

### 4. Bump version

```bash
# package.json: "version": "X.Y.Z"
# package-lock.json: "version" appears at top and inside packages[""]
```

Edit both. Other lockfiles (bun.lock, pnpm-lock) generally do not encode the
top-level version — skip unless the project does.

### 5. Build

```bash
npm run build
git status --short
```

Tracked `dist/**` may or may not change (often byte-identical when HEAD
already had a fresh build).

### 6. Verify release scope

```bash
git status --short
git diff --stat
```

Allowed paths only:

- `CHANGELOG.md`
- `package.json`
- `package-lock.json` (if tracked)
- `dist/**` (if tracked)

Anything else dirty → stop, fix scope, retry. Stash unrelated untracked files
(e.g. downstream specialist leakage in `.specialists/user/`) before continuing.

### 7. Commit, tag, push

```bash
git add CHANGELOG.md package.json package-lock.json dist/   # only what's tracked
git commit -m "release: vX.Y.Z"
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin <branch>
git push origin vX.Y.Z
```

### 8. Publish to npm

```bash
npm publish --access public    # --access public for scoped packages
```

### 9. Refresh global toolchain

If this project ships a CLI the operator uses globally:

```bash
npm i -g <package>@X.Y.Z
<cli> --version
```

### 10. Confirm

```bash
git tag --list 'v*' | tail -3
git log --oneline -1
git status --short
npm view <package> version
```

### 11. Optional: GitHub release

```bash
gh release create vX.Y.Z --notes "$(sed -n '/## \[vX.Y.Z\]/,/## \[/p' CHANGELOG.md | head -n -1)"
```

## Optional: changelog-keeper dispatch

When `[Unreleased]` is empty or sparse and user-facing work shipped, file a
small bead and dispatch `changelog-keeper`:

```text
TITLE: Fill [Unreleased] from <prev-tag>..HEAD
PROBLEM: [Unreleased] is missing entries for sessions <list> which shipped user-facing changes; release vX.Y.Z is being cut.
SUCCESS: [Unreleased] reflects every user-facing change in the range, in Keep-a-Changelog format.
SCOPE: CHANGELOG.md only.
REFERENCES: .xtrm/reports/<prev-tag-date>..<today> (filtered to in-range), recent commit subjects.
NON_GOALS: no version bump, no build, no commit, no tag — skill owns those.
CONSTRAINTS: edit CHANGELOG.md only; one bullet per change; bead refs in parens; sections Added / Changed / Fixed / Removed / Deprecated / Security; do not invent entries not grounded in reports or commits.
VALIDATION: diff shows only [Unreleased] body changed; bullets cover the report set.
OUTPUT: updated CHANGELOG.md with populated [Unreleased].
```

```bash
sp run changelog-keeper --bead <bead-id>
```

After it returns, re-inspect `[Unreleased]` and proceed to Step 3. Skill — not
keeper — owns version bump, build, commit, tag, push, publish.

## Why this design

- `session-close-report` already drafts user-facing prose per session and
  appends to `[Unreleased]` (Step 6 of that skill). The release-time work is
  therefore small: promote, bump, build, commit, tag, push, publish.
- Keeping the deterministic mutations in bash (driven by this skill) avoids
  three failure modes seen with the old `xt release` wrapper: hardcoded
  workspace paths, wrong specialist invocation, and a regex template engine
  that over-greedy-matches `$VAR` patterns inside report prose.
- The `changelog-keeper` specialist is now CHANGELOG-only and only invoked on
  demand to fill gaps. It does not own commits, tags, pushes, or builds.

## Parallel sessions

Two operators racing the same version: first `git push origin vX.Y.Z` wins;
second sees a non-fast-forward / tag-exists error and aborts. Operator picks
the next version and retries.

## Don't

- Don't call `xt release prepare` / `xt release publish` — retired. See
  `unitAI-g29jv`.
- Don't broaden the release diff with source/docs/config changes. File a
  separate bead.
- Don't pre-stage unrelated files. The release scope check should see a clean
  tree except whitelisted release artifacts.
- Don't invent CHANGELOG entries from `git log -p`. The reports + existing
  `[Unreleased]` are the input.
- Don't `git push --force` or rewrite tags. If a release ships wrong, cut a
  patch.
