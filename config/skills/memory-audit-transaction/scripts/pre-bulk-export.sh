#!/usr/bin/env bash
# Pre-script for the memory-processor specialist.
#
# Phase 3 of the memory-audit-transaction skill: bulk-export every bd memory
# to a single JSON artifact so the model can slice chunks without per-key
# round-trips at runtime.
#
# `bd memories --json` returns one JSON object {key: content, ...} from a
# single dolt query (~ms), independent of N. This is the bulk surface that
# makes the Transactional File-Backed Audit Ledger pattern viable at any
# scale.
#
# Output:
#   .tmp/memory-audit/memories.json   — full {key: content} object
#   .tmp/memory-audit/keys.txt        — one key per line
#   .tmp/memory-audit/decisions.jsonl — initialized empty (model appends)
#
# stdout: one-line summary that the runner injects as $pre_script_output.

set -euo pipefail

ART_DIR=".tmp/memory-audit"
mkdir -p "${ART_DIR}"

# Refuse to clobber an in-flight ledger (resumable runs land here).
if [ -s "${ART_DIR}/decisions.jsonl" ] && [ -s "${ART_DIR}/memories.json" ]; then
  KEYS_PREV=$(jq -r 'keys[]' "${ART_DIR}/memories.json" 2>/dev/null | wc -l || echo 0)
  ROWS_PREV=$(wc -l < "${ART_DIR}/decisions.jsonl" 2>/dev/null || echo 0)
  echo "RESUMABLE: ${ROWS_PREV}/${KEYS_PREV} decisions already in ${ART_DIR}/decisions.jsonl"
  echo "          Bulk export skipped (artifact still present)."
  exit 0
fi

# Bulk export — single dolt query, no per-key recall.
bd memories --json > "${ART_DIR}/memories.json"

# Key list (one per line) for chunking.
jq -r 'keys[]' "${ART_DIR}/memories.json" > "${ART_DIR}/keys.txt"

# Initialize the ledger (empty; model appends per-chunk).
: > "${ART_DIR}/decisions.jsonl"

KEYS=$(wc -l < "${ART_DIR}/keys.txt" | tr -d ' ')
BYTES=$(wc -c < "${ART_DIR}/memories.json" | tr -d ' ')

cat <<EOF
Bulk export complete:
  artifact:  ${ART_DIR}/memories.json
  keys:      ${ART_DIR}/keys.txt (${KEYS} keys)
  size:      ${BYTES} bytes
  ledger:    ${ART_DIR}/decisions.jsonl (initialized empty)

Read each chunk's content from memories.json with jq, e.g.:
  jq -r --arg k "<key>" '.[\$k]' ${ART_DIR}/memories.json

Append per-entry decisions to ${ART_DIR}/decisions.jsonl with bash heredocs.
Do NOT echo memories.json into chat history.
EOF
