#!/usr/bin/env bash
set -euo pipefail

# OPERATOR-RUN ONLY — do not execute inside executor session (nested sp run crashes supervisor).
#
# For each fixture under .specialists/evals/seconder/{wrong-scope,bad-quality,clean}:
# 1) read contract.md + diff.patch
# 2) dispatch real seconder via `sp run seconder --prompt ...`
# 3) compare returned dual-verdict JSON against expected-verdict.json
#
# Suggested operator command shape:
#   sp run seconder --prompt "$(cat contract.md; printf '\n'; cat diff.patch)"
#
# Exit nonzero on any mismatch.

echo "Operator-only harness stub. See README.md for exact steps."
