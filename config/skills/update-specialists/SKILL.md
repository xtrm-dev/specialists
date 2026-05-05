---
name: update-specialists
description: >
  Reconcile all xtrm-managed asset drift across repos.
  Use this skill when user says "update specialists", "xtrm drift", "assets out of date",
  or when operator needs guided refresh across one repo or many.
version: 2.0
synced_at: 2026-05-05
---

# update-specialists

Interactive wrapper over `xt update` for xtrm-managed asset drift.

Canonical-live model:
- **Category A**: specialist runtime / loader-live surfaces. No refresh needed; verify only.
- **Category B**: xtrm-managed snapshots under repos (`.xtrm/skills/default/`, `.xtrm/hooks/default/`, and related managed assets). These can drift and need operator-confirmed refresh.

Skill goal:
1. find projects root,
2. inspect drift,
3. summarize per-repo state,
4. ask operator which repos to refresh,
5. run `xt update --apply`,
6. re-check,
7. report final state.

No automatic execution. Always operator-confirmed.

## Operator Flow

### 1) Discover projects root

Ask for root if user did not name one.

Default order:
1. explicit user root,
2. `~/dev`,
3. git-discovered repo root / workspace root,
4. current directory as last fallback.

If multiple candidate roots exist, ask which one to use.

### 2) Run doctor

Use:

```bash
xt doctor --cwd <root> --json
```

If `xt` is unavailable, stop and switch to fallback guidance below.

### 3) Summarize drift

Render clean table grouped by repo:
- repo path
- status
- drift count
- missing / extra / mismatched assets
- suggested action

Keep focus on operator action, not internal diagnostics.

### 4) Ask for confirm

Offer three paths:
- refresh all repos,
- refresh specific repos,
- dry-run only.

If user names one repo, keep flow narrow and confirm only that repo.

### 5) Apply refresh

Use:

```bash
xt update --apply --root <root>
```

Or for one repo:

```bash
xt update --apply --repo <repo>
```

For dry-run, omit `--apply`.

### 6) Re-run doctor

Run same doctor command again after update and confirm clean state.

### 7) Final report

State:
- what drift existed,
- what refreshed,
- what stayed untouched,
- any residual manual fixes.

## Fallback When xt Missing

If `xt` / `xtrm` not installed or doctor/update help unavailable:
- do not block user,
- switch to per-repo guidance,
- tell user to run repo-local checks manually,
- do not invent bulk repair commands.

Fallback response shape:
- identify likely drifted repos,
- point user at repo-local `sp doctor` / package-specific checks already available in that repo,
- say bulk refresh needs `xt` installed.

## Drift Review Rules

- Treat repo-custom overlays as intentional unless doctor marks them mismatched against managed snapshot.
- Do not overwrite user-owned layers.
- Prefer dry-run first when drift touches multiple repos.
- If only one repo needs refresh, keep output narrow and use single-repo update path.
- If doctor shows mixed drift across 3 repos, summarize each repo separately and ask which to refresh.

## Output Shape

Use this order:
1. root chosen
2. doctor summary
3. drift table
4. confirm prompt
5. update action
6. post-update doctor result
7. final status

## Example Operator Loop

```text
Root: ~/dev
Doctor: 3 repos checked

repo                      status      drift
repo-a                    drifted     4 assets
repo-b                    in-sync     0 assets
repo-c                    drifted     1 asset

Refresh all / specific repos / dry-run?
```

## Verification

After refresh:
- `xt doctor --cwd <root> --json` clean or reduced to intentional custom drift,
- repo-specific follow-up actions called out only when needed,
- single-repo case stays single-repo,
- missing `xt` path falls back cleanly.
