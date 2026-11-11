#!/usr/bin/env bash
# Release 4.2.0 of @jaggerxtrm/specialists (SPECIALISTS-4422 A6).
#
# The operator runs this. The agent does not.
#
# It publishes to npm, so every check runs before anything leaves the machine, and every
# step stops the script on failure. There is no rollback in here: if the publish fails,
# nothing was published; if the tag push fails, the tag exists only locally and can be
# deleted with `git tag -d v4.2.0`. If publish succeeds and a later step fails, the release
# exists and the fix is forward.
#
# Preconditions (checked, not assumed):
#   * HEAD is the approved release commit, and that commit is on origin/master
#   * the working tree is clean, including untracked files
#   * package.json is 4.2.0 and the two plugin manifests already agree with it
#   * the committed dist rebuilds to itself (the publish workflow's own requirement)
#   * npm has a login, and 4.2.0 is not already published
#   * tag v4.2.0 does not exist, locally or on the remote
#
# The published artifact is the attested tarball, by path: a bare `npm publish` would
# repack from the directory and could ship bytes that were never attested.
#
# Usage:
#   scripts/release-4.2.0.sh <release-commit-sha>
#   RELEASE_COMMIT=<sha> scripts/release-4.2.0.sh
#
# Exit codes: 1 precondition failed, 2 tag or version already taken, 3 build/pack failed,
#             4 publish failed, 5 published version is not 4.2.0.

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

step "4/8 dist rebuilds to the committed dist"
NODE_ENV=test bun run build >/dev/null || die "build failed" 3
git diff --exit-code -- dist/ || die "committed dist differs from a fresh build; commit the rebuild in a PR" 3
[ -z "$(git status --porcelain --untracked-files=all -- dist/)" ] || die "build left untracked files under dist/" 3

step "5/8 pack and attest"
TARBALL="$(npm pack --silent | tail -n 1)"
[ -f "$TARBALL" ] || die "npm pack produced no tarball" 3
ATTEST="$(mktemp -t release-attestation-XXXXXX.json)"
# The tarball survives a failed publish so step 8 can be re-run by hand against the same
# attested bytes; it is removed only when the release actually completed.
KEEP_TARBALL=0
cleanup() {
  rm -f "$ATTEST"
  if [ "$KEEP_TARBALL" = 1 ]; then
    printf 'kept the attested tarball for a manual retry: %s\n' "$TARBALL"
  else
    rm -f "$TARBALL"
  fi
}
trap cleanup EXIT
npm run --silent release:attest -- "$TARBALL" "$ATTEST" || die "attestation generation failed" 3
EXPECTED_SOURCE_COMMIT="$HEAD_SHA" npm run --silent release:attest -- --validate "$TARBALL" "$ATTEST" \
  || die "attestation validation failed" 3
TARBALL_SHA256="$(sha256sum "$TARBALL" | cut -d' ' -f1)"
printf '   tarball: %s\n   sha256:  %s\n   attest:  %s\n' "$TARBALL" "$TARBALL_SHA256" "$ATTEST"

step "6/8 npm auth, and ${VERSION} not already published"
WHOAMI="$(npm whoami)" || die "npm has no login; run npm login before tagging" 2
[ -n "$WHOAMI" ] || die "npm whoami returned nothing; not logged in" 2
printf '   npm user: %s\n' "$WHOAMI"
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

step "8/8 publish the attested tarball and verify"
printf '   publishing %s (sha256 %s) as %s\n' "$TARBALL" "$TARBALL_SHA256" "$WHOAMI"
# By path, so the published bytes are the attested ones. If npm asks for an OTP, enter it.
if ! npm publish "$TARBALL" --access public; then
  KEEP_TARBALL=1
  die "npm publish failed (a wrong or cancelled OTP lands here). Tag ${TAG} is already on origin, and nothing was published.
  Retry the upload by hand with the attested tarball: npm publish \"$TARBALL\" --access public
  Or remove the tag first and rerun the script: git push origin :refs/tags/${TAG} && git tag -d ${TAG}" 4
fi
PUBLISHED="$(npm view "${PACKAGE}" version)"
[ "$PUBLISHED" = "$VERSION" ] || die "published version is ${PUBLISHED}, expected ${VERSION}" 5

printf '\nReleased %s %s at %s\n' "$PACKAGE" "$PUBLISHED" "$HEAD_SHA"
printf 'Next: A7 installs (PC first; the server stays extension-only, no machine switch).\n'
