# Release flow

Two-step release flow for tag-driven publishes.

## 1) Prepare

```bash
sp release prepare --patch
```

What it does:

- resolves most recent semver tag as `prev_tag`
- computes `next_tag` from `--major|--minor|--patch` (`--patch` default)
- runs `changelog-keeper` via `runScriptSpecialist`
- prefers structured JSON output, falls back to markdown body if needed
- renders Keep-a-Changelog section format
- inserts new release section above previous release in `CHANGELOG.md`
- bumps `package.json` version
- stages `CHANGELOG.md`, `package.json`, and `dist/index.js`
- does **not** commit

Example section format:

```md
## [v3.8.1] - 2026-04-30

### Added
- **Prepare flow**: single entry point for tag-driven release prep
```

Operator next step:

```bash
git commit -m "release: v3.8.1"
sp release publish
```

## 2) Publish

```bash
sp release publish
```

What it checks:

- HEAD commit message matches `release: v<version>`
- `package.json` version matches commit version
- `CHANGELOG.md` has top release section for `v<version>`
- working tree is clean before publish work starts

What it does:

- creates annotated git tag `v<version>`
- uses release section body as tag message
- pushes tag to `origin`
- if `gh` is authenticated, creates GitHub Release with same body
- otherwise prints manual `gh release create ...` command
- leaves `[Unreleased]` placeholder empty for next cycle

## Re-run behavior

`sp release prepare` is safe to re-run on staged-but-uncommitted draft changes. It rewrites release section instead of appending duplicate sections.

## Notes

- No automatic version inference.
- No registry/image push.
- Single-package repo only.
