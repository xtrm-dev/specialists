#!/usr/bin/env bash
# Release 4.2.0 of @jaggerxtrm/specialists (SPECIALISTS-4422 A6).
#
# The operator runs this. The agent does not.
#
# Publication happens in GitHub Actions: the tag push triggers `.github/workflows/publish.yml`,
# which checks the tag against package.json, checks the plugin manifests, rebuilds dist and
# requires it unchanged, then publishes with npm trusted publishing (OIDC). This script does the
# local pre-flight, then tags, then watches that run and verifies the registry.
#
# Every step stops the script on failure. Steps 1-5 all run BEFORE a tag exists, so a bad tree,
# a drifted dist or a missing attestation cannot leave a tag behind.
#
# Preconditions (checked, not assumed):
#   * HEAD is the approved release commit, and it is on origin/master
#   * the working tree is clean, including untracked files
#   * package.json is 4.2.0 and both plugin manifests already agree with it
#   * the committed dist rebuilds to itself (the publish workflow's own requirement)
#   * 4.2.0 is not already published
#   * tag v4.2.0 does not exist, locally or on the remote
#   * `gh` is authenticated for this repository
#
# Usage:
#   scripts/release-4.2.0.sh <release-commit-sha>
#   RELEASE_COMMIT=<sha> scripts/release-4.2.0.sh
#
# Exit codes: 1 precondition failed, 2 tag or version already taken, 3 build/pack failed,
#             4 publish workflow failed, 5 registry does not report 4.2.0.

set -euo pipefail

VERSION="4.2.0"
TAG="v${VERSION}"
PACKAGE="@jaggerxtrm/specialists"
COMMIT="${1:-${RELEASE_COMMIT:-}}"

step() { printf '\n== %s\n' "$*"; }
die() { printf 'FAILED: %s\n' "$*" >&2; exit "${2:-1}"; }

[ -n "$COMMIT" ] || die "usage: scripts/release-4.2.0.sh <release-commit-sha> (or RELEASE_COMMIT=<sha>)"

cd "$(git rev-parse --show-toplevel)"

step "1/8 commit is the approved, merged one"
HEAD_SHA="$(git rev-parse HEAD)"
[ "$HEAD_SHA" = "$COMMIT" ] || die "HEAD is ${HEAD_SHA}, expected the approved release commit ${COMMIT}"
git fetch -q origin
git merge-base --is-ancestor "$COMMIT" origin/master \
  || die "${COMMIT} is not on origin/master; a release cannot come from an unmerged branch"

step "2/8 working tree is clean"
[ -z "$(git status --porcelain --untracked-files=all)" ] || {
  git status --short --untracked-files=all
  die "working tree is not clean; commit or stash before releasing"
}

step "3/8 version is ${VERSION}"
PKG_VERSION="$(node -p "require('./package.json').version")"
[ "$PKG_VERSION" = "$VERSION" ] || die "package.json is ${PKG_VERSION}, expected ${VERSION}"
node scripts/sync-plugin-versions.mjs --check || die "plugin manifests disagree with package.json"

step "4/8 CI dist checks passed on this commit"
# CI is the dist gate. The committed dist is built in the CI image, and a host build can
# disagree with it (bun tree-shakes two unused pi-tui re-exports differently on a
# maintainer machine), so rebuilding here would test the host, not the artefact.
bun scripts/ci-dist-gate.ts --sha "$HEAD_SHA" \
  || die "CI dist checks (packed-smoke, payload-contract) are not green on ${HEAD_SHA}" 3

if [ "${RELEASE_HOST_DIST_WARNING:-0}" = "1" ]; then
  # Print-only. Never a gate: this is exactly the check that cannot hold on a host.
  NODE_ENV=test bun run build >/dev/null 2>&1 || printf 'WARNING: host rebuild failed\n' >&2
  if git diff --quiet -- dist/; then
    printf '   host rebuild matches the committed dist\n'
  else
    printf 'WARNING: a host rebuild differs from the committed dist (expected; CI is authoritative):\n' >&2
    git diff --stat -- dist/ >&2
  fi
  git checkout -- dist/
fi

step "5/8 pack and attest"
# Pack OUTSIDE the repository: the attestation generator refuses a dirty tree, and a tarball
# dropped in the checkout is exactly that.
PACK_DIR="$(mktemp -d -t release-pack-XXXXXX)"
TARBALL="$PACK_DIR/$(npm pack --silent --pack-destination "$PACK_DIR" | tail -n 1)"
[ -f "$TARBALL" ] || die "npm pack produced no tarball" 3
ATTEST="$(mktemp -t release-attestation-XXXXXX.json)"
trap 'rm -f "$TARBALL" "$ATTEST"; [ -n "$PACK_DIR" ] && rm -rf "$PACK_DIR"' EXIT
npm run --silent release:attest -- "$TARBALL" "$ATTEST" || die "attestation generation failed" 3
EXPECTED_SOURCE_COMMIT="$HEAD_SHA" npm run --silent release:attest -- --validate "$TARBALL" "$ATTEST" \
  || die "attestation validation failed" 3
printf '   tarball: %s\n   sha256:  %s\n   attest:  %s\n' "$TARBALL" "$(sha256sum "$TARBALL" | cut -d' ' -f1)" "$ATTEST"

step "6/8 ${VERSION} is not already published"
if npm view "${PACKAGE}@${VERSION}" version >/dev/null 2>&1; then
  die "${PACKAGE}@${VERSION} is already published; bump the version instead of republishing" 2
fi

step "7/8 tag ${TAG}"
git rev-parse -q --verify "refs/tags/${TAG}" >/dev/null && die "tag ${TAG} already exists locally" 2
if git ls-remote --exit-code --tags origin "refs/tags/${TAG}" >/dev/null 2>&1; then
  die "tag ${TAG} already exists on origin" 2
fi
git tag -a "$TAG" -m "Release ${VERSION}: Claude Code route, bridged-fallback fix, Specialist identities"
git push origin "$TAG" || die "tag push failed; the tag exists locally only (git tag -d ${TAG})"
printf '   pushed %s; publish.yml runs on the tag\n' "$TAG"

step "8/8 watch the publish workflow, then verify the registry"
RUN_ID=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  RUN_ID="$(gh run list --workflow=publish.yml --limit 20 --json databaseId,headBranch \
    --jq "[.[] | select(.headBranch == \"${TAG}\")][0].databaseId" 2>/dev/null || true)"
  [ -n "$RUN_ID" ] && [ "$RUN_ID" != "null" ] && break
  sleep 6
done
if [ -z "$RUN_ID" ] || [ "$RUN_ID" = "null" ]; then
  die "no publish.yml run appeared for ${TAG} after 60s; check https://github.com/$(gh repo view --json nameWithOwner --jq .nameWithOwner)/actions/workflows/publish.yml" 4
fi
RUN_URL="$(gh run view "$RUN_ID" --json url --jq .url)"
printf '   run: %s\n' "$RUN_URL"
if ! gh run watch "$RUN_ID" --exit-status; then
  die "publish workflow failed for ${TAG}. Run URL: ${RUN_URL}
  Option 1: re-run it for the existing tag: gh workflow run publish.yml -f tag=${TAG}
  Option 2: remove the tag and start over: git push origin :refs/tags/${TAG} && git tag -d ${TAG}" 4
fi

# The registry can lag a moment behind a successful publish job; retry briefly.
PUBLISHED=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  PUBLISHED="$(npm view "${PACKAGE}" version 2>/dev/null || true)"
  [ "$PUBLISHED" = "$VERSION" ] && break
  sleep 6
done
[ "$PUBLISHED" = "$VERSION" ] || die "registry reports ${PUBLISHED:-nothing}, expected ${VERSION} (run: ${RUN_URL})" 5

printf '\nReleased %s %s at %s (workflow %s)\n' "$PACKAGE" "$PUBLISHED" "$HEAD_SHA" "$RUN_URL"
printf 'Next: A7 installs (PC first; the server stays extension-only, no machine switch).\n'
