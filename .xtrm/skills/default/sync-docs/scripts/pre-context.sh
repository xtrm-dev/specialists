#!/usr/bin/env bash
# sync-docs pre-script: byte-capped context dump.
# Output is injected into the specialist prompt at run-time.

echo '=== Latest xt report (excerpt, 5KB cap) ==='
R=$(ls -1 .xtrm/reports/*.md 2>/dev/null | sort -r | head -1)
if [ -n "$R" ]; then
  echo "FILE: $R"
  head -c 5000 "$R"
  echo
else
  echo '(no reports found)'
fi
echo
echo '=== Recent master commits (20, 2KB cap) ==='
git log master --oneline -20 2>/dev/null | head -c 2000 || echo '(git unavailable)'
echo
