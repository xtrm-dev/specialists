#!/usr/bin/env bash
set -euo pipefail

# OPERATOR / CI-RUN ONLY — do NOT execute inside an executor specialist session
# (an executor running `sp run` nests synchronous dispatch and stalls the supervisor).
# The orchestrator or a human operator may run this directly.
#
# For each fixture under .specialists/evals/seconder/{wrong-scope,bad-quality,clean}:
#   1) build prompt = contract.md + diff.patch
#   2) dispatch the real seconder
#   3) compare the returned overall_verdict against expected-verdict.json
# Exit nonzero on any overall_verdict mismatch.
#
# Verified live 2026-05-31: wrong-scope→FAIL, bad-quality→FAIL, clean→PASS (3/3 gate-correct).

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fail=0

for c in wrong-scope bad-quality clean; do
  dir="$HERE/$c"
  expected="$(python3 -c "import json; print(json.load(open('$dir/expected-verdict.json'))['overall_verdict'])")"
  prompt="$(cat "$dir/contract.md"; printf '\n\n--- WRITER DIFF (the diff to evaluate) ---\n\n'; cat "$dir/diff.patch")"

  job="$(sp run seconder --prompt "$prompt" --background 2>/dev/null | tail -1)"
  # poll sp result until the dual-verdict JSON appears (READ_ONLY seconder is fast; up to ~80s)
  actual=""
  for _ in $(seq 1 40); do
    sleep 2
    out="$(sp result "$job" 2>/dev/null || true)"
    v="$(printf '%s' "$out" | grep -oE '"overall_verdict"[ ]*:[ ]*"[A-Z]+"' | grep -oE '(PASS|PARTIAL|FAIL)' | head -1 || true)"
    if [ -n "$v" ]; then actual="$v"; break; fi
  done
  if [ "$actual" = "$expected" ]; then
    echo "PASS  $c  overall_verdict=$actual"
  else
    echo "FAIL  $c  expected=$expected actual=${actual:-<none>}  (job $job)"
    fail=1
  fi
done

exit "$fail"
