#!/usr/bin/env bash
# Run semgrep against the diff between HEAD and origin/main.
# Used by pre-push hook so pre-existing debt doesn't block unrelated pushes.
# CI's full scan remains the source of truth for absolute findings.

set -euo pipefail

if ! command -v semgrep >/dev/null; then
    echo "semgrep not installed — skipping (CI covers it)"
    exit 0
fi

# Derive base ref dynamically. Order:
#   1. branch's tracked upstream ('@{u}') — most reliable
#   2. common default branches if their *remote* version exists (origin/*)
#   3. local default branches IF different from current branch
# We refuse to use the current branch as its own baseline because then
# merge-base resolves to HEAD and --baseline-commit=HEAD silently scans
# nothing on every push.
HEAD_BRANCH=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || true)
HEAD_SHA=$(git rev-parse HEAD)

upstream=$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null || true)
BASE_REF=""
if [ -n "$upstream" ]; then
    BASE_REF="$upstream"
else
    for cand in origin/main origin/master main master; do
        git rev-parse --verify "$cand" >/dev/null 2>&1 || continue
        # Skip a local-branch candidate that IS the current branch
        [ "$cand" = "$HEAD_BRANCH" ] && continue
        BASE_REF="$cand"
        break
    done
fi

[ -n "$BASE_REF" ] && git fetch "${BASE_REF%%/*}" "${BASE_REF#*/}" --quiet 2>/dev/null || true

SEMGREP_BASELINE_ARGS=()
if [ -n "$BASE_REF" ]; then
    BASE=$(git merge-base HEAD "$BASE_REF" 2>/dev/null || true)
    # merge-base==HEAD here means branch is at upstream tip — legitimate empty
    # diff. Pass --baseline-commit so semgrep produces an empty result rather
    # than falling back to a full scan.
    [ -n "$BASE" ] && SEMGREP_BASELINE_ARGS=(--baseline-commit="$BASE")
fi
# Last-resort: no upstream resolved at all. rev-list can equal HEAD on single
# -commit histories; reject and full-scan in that case.
if [ ${#SEMGREP_BASELINE_ARGS[@]} -eq 0 ]; then
    BASE=$(git rev-list HEAD --max-count=50 | tail -1)
    if [ -n "$BASE" ] && [ "$BASE" != "$HEAD_SHA" ]; then
        SEMGREP_BASELINE_ARGS=(--baseline-commit="$BASE")
    else
        echo "[semgrep-diff] no usable baseline (no upstream, single-commit branch, or pushing default branch directly) — running full scan"
    fi
fi

exec semgrep scan \
    --config=p/default \
    --config=p/security-audit \
    --config=p/secrets \
    --config=p/python \
    --config=p/dockerfile \
    --config=p/github-actions \
    "${SEMGREP_BASELINE_ARGS[@]}" \
    --error \
    --quiet \
    --skip-unknown-extensions
