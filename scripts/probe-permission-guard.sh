#!/usr/bin/env bash
# Phase-1 permission-guard probes (SPECIALISTS-4285 VALIDATION).
# Executes the guard's REAL wrapped commands (built by the shipped .mjs via
# node) directly under bash: no model, no pi session. Proves the bwrap
# boundary itself; pi wiring (tool_call mutation, nested codemode path) is
# covered by tests/unit/pi/permission-guard.test.ts.
# Skips with reason when bwrap is absent (contract SCOPE).
set -u

if ! command -v bwrap >/dev/null 2>&1; then
  echo "SKIP: bwrap not on PATH"
  exit 0
fi
if ! command -v node >/dev/null 2>&1; then
  echo "SKIP: node not on PATH"
  exit 0
fi

GUARD_MJS="config/pi-extensions/permission-guard/index.mjs"
PASS=0
FAIL=0
BWRAP_BIN="$(command -v bwrap)"

# Build the wrapped shell script for CMD in CWD; prints it to stdout.
# Uses the absolute bwrap path, exactly as the guard does at call time.
build_wrapped() {
  local cmd="$1" cwd="$2" mask="$3"
  WRAP_CMD="$cmd" WRAP_CWD="$cwd" WRAP_MASK="$mask" WRAP_BIN="$BWRAP_BIN" node --input-type=module -e "
import { buildWrappedCommand } from './$GUARD_MJS';
const maskArgs = JSON.parse(process.env.WRAP_MASK);
process.stdout.write(buildWrappedCommand({ command: process.env.WRAP_CMD, cwd: process.env.WRAP_CWD, maskArgs, bwrapBin: process.env.WRAP_BIN, env: process.env }));
"
}

# Run CMD sandboxed in CWD, passing through exit code and output.
run_wrapped() {
  local cmd="$1" cwd="$2"
  local script
  script="$(build_wrapped "$cmd" "$cwd" "$MASK_JSON")"
  bash -c "$script"
}

check() { # $1=name $2=want-exit; rest: run_wrapped args
  local name="$1" want="$2"; shift 2
  if "$@" >/dev/null 2>&1; then local got=0; else local got=$?; fi
  if [ "$got" = "$want" ]; then PASS=$((PASS+1)); echo "PASS: $name";
  else FAIL=$((FAIL+1)); echo "FAIL: $name (want exit $want, got $got)"; fi
}

check_out() { # $1=name $2=needle; rest: run_wrapped args
  local name="$1" needle="$2"; shift 2
  local out
  out=$("$@" 2>&1)
  if printf '%s' "$out" | grep -qF "$needle"; then PASS=$((PASS+1)); echo "PASS: $name";
  else FAIL=$((FAIL+1)); echo "FAIL: $name (missing '$needle'; got: $(printf '%s' "$out" | head -c 300))"; fi
}

# TMPDIR-independent: work outside /tmp so the probe does not depend on the
# very directory the sandbox remounts. /var/tmp (NOT $XDG_RUNTIME_DIR: that is
# /run/user/$UID, which the sandbox masks with --tmpfs /run).
BASE="/var/tmp/perm-guard-probe-$$"
mkdir -p "$BASE"
WORK="$BASE/work"; HOME_FAKE="$BASE/home"
mkdir -p "$WORK" "$HOME_FAKE"
trap 'rm -rf "$BASE"' EXIT

mkdir -p "$HOME_FAKE/.ssh" "$HOME_FAKE/.aws" "$HOME_FAKE/.pi/agent"
echo secret > "$HOME_FAKE/.ssh/id_rsa"
echo token > "$HOME_FAKE/.netrc"
echo tok > "$HOME_FAKE/.pi/agent/auth-token.json"
export HOME="$HOME_FAKE"

MASK_JSON="$(WRAP_HOME="$HOME_FAKE" node --input-type=module -e "
import { buildCredentialMaskArgs } from './$GUARD_MJS';
buildCredentialMaskArgs(process.env.WRAP_HOME).then((a) => process.stdout.write(JSON.stringify(a)));
")"

echo "--- probe: writes fail (worktree, HOME, host tmp) ---"
check "worktree write fails" 1 run_wrapped "touch $WORK/nope" "$WORK"
check "HOME write fails" 1 run_wrapped 'touch "$HOME/nope"' "$WORK"
check "host root write fails" 1 run_wrapped "touch /probe-should-not-exist" "$WORK"
echo "--- probe: private /tmp succeeds ---"
check "private tmp write succeeds" 0 run_wrapped "echo ok > /tmp/ok.txt && cat /tmp/ok.txt" "$WORK"
echo "--- probe: network fails ---"
check "tcp connect fails" 1 run_wrapped "bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'" "$WORK"
echo "--- probe: sandbox escape surface closed (/run bus, docker socket) ---"
check "user bus unreachable" 1 run_wrapped "test -S /run/user/$(id -u)/bus" "$WORK"
check "docker socket unreachable" 1 run_wrapped "test -S /var/run/docker.sock" "$WORK"
echo "--- probe: clearenv allowlist (named secrets absent, allowlist kept) ---"
# The guard builds --clearenv from the live process env; export the secrets
# here so the builder sees them, mirroring production.
export DATABASE_URL="postgres://secret" AWS_ACCESS_KEY_ID="AKIASECRET" TWITTER_CT0="ct0secret"
export GH_TOKEN="ghp_secret" PI_MODEL="test-model" OTHER_KEEP="no"
SECRET_OUT="$(bash -c "$(build_wrapped 'env' "$WORK" "$MASK_JSON")")"
for leaked in "postgres://secret" "AKIASECRET" "ct0secret" "ghp_secret"; do
  if printf '%s' "$SECRET_OUT" | grep -qF "$leaked"; then FAIL=$((FAIL+1)); echo "FAIL: secret leaked ($leaked)";
  else PASS=$((PASS+1)); echo "PASS: secret absent ($leaked)"; fi
done
unset DATABASE_URL AWS_ACCESS_KEY_ID TWITTER_CT0 GH_TOKEN PI_MODEL OTHER_KEEP
if printf '%s' "$SECRET_OUT" | grep -q "^PATH="; then PASS=$((PASS+1)); echo "PASS: PATH allowlisted";
else FAIL=$((FAIL+1)); echo "FAIL: PATH missing"; fi
echo "--- probe: credential reads fail ---"
check "read ~/.ssh fails" 1 run_wrapped 'cat "$HOME/.ssh/id_rsa"' "$WORK"
check "read ~/.netrc fails" 1 run_wrapped 'cat "$HOME/.netrc"' "$WORK"
check "read auth token fails" 1 run_wrapped 'cat "$HOME/.pi/agent/auth-token.json"' "$WORK"
echo "--- probe: read-only commands succeed ---"
git -C "$WORK" init -q . && git -C "$WORK" config user.email t@t && git -C "$WORK" config user.name t
echo a > "$WORK/f" && git -C "$WORK" add f && git -C "$WORK" commit -qm init && echo b > "$WORK/f"
check_out "git diff works" "diff --git" run_wrapped "git diff" "$WORK"
check_out "git log works" "init" run_wrapped "git log --oneline" "$WORK"
check "whoami succeeds" 0 run_wrapped "whoami" "$WORK"
echo "--- probe: mutation controls (weaken one flag, the matching probe must fail-open) ---"
# Control 1: --ro-bind / / -> --bind / / (writable root). The worktree write
# must now SUCCEED, proving --ro-bind is the load-bearing read-only flag.
MUT_WRITABLE="$(build_wrapped "touch $WORK/mutated-ok" "$WORK" "$MASK_JSON" | sed "s/'--ro-bind' '\/' '\/'/'--bind' '\/' '\/'/")"
if bash -c "$MUT_WRITABLE" >/dev/null 2>&1 && [ -f "$WORK/mutated-ok" ]; then PASS=$((PASS+1)); echo "PASS: mutation control ro-bind (writable root lets the write through)";
else FAIL=$((FAIL+1)); echo "FAIL: mutation control ro-bind"; fi
rm -f "$WORK/mutated-ok"
# Control 2: drop --unshare-net (keep the rest). TCP must now SUCCEED
# (direct TCP to 1.1.1.1:443 works on this host), proving the namespace flag
# is what blocks network.
MUT_NET="$(build_wrapped "bash -c 'exec 3<>/dev/tcp/1.1.1.1/443'" "$WORK" "$MASK_JSON" | sed "s/'--unshare-net' //")"
if bash -c "$MUT_NET" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS: mutation control unshare-net (shared net lets TCP through)";
else FAIL=$((FAIL+1)); echo "FAIL: mutation control unshare-net"; fi
# Control 3: drop --tmpfs /run (keep the rest). The user bus socket must now
# be VISIBLE, proving the /run mask is what hides it.
MUT_RUN="$(build_wrapped "test -S /run/user/$(id -u)/bus" "$WORK" "$MASK_JSON" | sed "s/'--tmpfs' '\/run' //")"
if bash -c "$MUT_RUN" >/dev/null 2>&1; then PASS=$((PASS+1)); echo "PASS: mutation control run-mask (unmasked /run exposes the bus)";
else FAIL=$((FAIL+1)); echo "FAIL: mutation control run-mask"; fi
# Control 4: drop --clearenv (keep the rest). The secrets must now LEAK,
# proving the allowlist is what scrubs them.
export DATABASE_URL="postgres://secret"
MUT_ENV="$(build_wrapped 'env' "$WORK" "$MASK_JSON" | sed "s/'--clearenv' //")"
if bash -c "$MUT_ENV" 2>/dev/null | grep -qF "postgres://secret"; then PASS=$((PASS+1)); echo "PASS: mutation control clearenv (no allowlist leaks secrets)";
else FAIL=$((FAIL+1)); echo "FAIL: mutation control clearenv"; fi
unset DATABASE_URL

echo "=== $PASS passed, $FAIL failed ==="
[ "$FAIL" = 0 ]
