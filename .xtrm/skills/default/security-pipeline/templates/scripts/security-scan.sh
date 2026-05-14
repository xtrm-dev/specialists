#!/usr/bin/env bash
# Local security AUDIT — informational, never fails.
# Surfaces all findings (including pre-existing debt) so you can triage.
# The blocking gate is the pre-push hook (diff-only); CI is the SoT.
#
# Usage:  ./scripts/security-scan.sh [--quick]
#   --quick  skip semgrep + osv (only gitleaks)

set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

QUICK=0
[[ "${1:-}" == "--quick" ]] && QUICK=1

FINDINGS=0

echo "── gitleaks (working tree, no-git) ──"
if command -v gitleaks >/dev/null; then
    if ! gitleaks detect --source . --config .gitleaks.toml --no-banner --no-git; then
        FINDINGS=$((FINDINGS + 1))
    fi
else
    echo "  gitleaks not installed — see SECURITY-PIPELINE.md for install"
fi

if [ "$QUICK" = "0" ]; then
    echo
    echo "── semgrep (full repo) ──"
    if command -v semgrep >/dev/null; then
        if ! semgrep --config=p/default --config=p/security-audit --config=p/secrets \
                     --config=p/python --config=p/dockerfile --config=p/github-actions \
                     --error --skip-unknown-extensions --quiet 2>&1; then
            FINDINGS=$((FINDINGS + 1))
        fi
    else
        echo "  semgrep not installed"
    fi

    echo
    echo "── osv-scanner ──"
    if command -v osv-scanner >/dev/null; then
        if ! osv-scanner --recursive --skip-git ./ ; then
            FINDINGS=$((FINDINGS + 1))
        fi
    else
        echo "  osv-scanner not installed"
    fi
fi

echo
if [ "$FINDINGS" -eq 0 ]; then
    echo "✅ Clean — no findings."
else
    echo "⚠️  $FINDINGS scanner(s) reported findings — triage above."
    echo "   Pre-push gate only blocks NEW findings vs origin/main; pre-existing debt is tracked separately."
fi
exit 0
