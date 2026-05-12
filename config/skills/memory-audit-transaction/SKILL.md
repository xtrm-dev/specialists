---
name: memory-audit-transaction
kind: skill
---

# Memory Audit Transaction

Pattern for auditing the project's persistent bd memories at any scale (N=500, N=2000+) without exhausting the agent's context window.

The naive workflow — `bd memories` → per-key `bd recall` → per-entry classification text in chat → per-key `bd forget` — collapses past ~150-200 memories because every classification row cumulates in conversation history. This skill replaces it with a **transactional file-backed audit ledger**: per-entry decisions persist to a JSONL artifact on disk, chunked work bounds the per-turn token cost, and pruning happens through one hash-guarded batch step rather than N inline `bd forget` calls.

## When This Activates

- The memory-processor specialist's input bead targets `.xtrm/memory.md` consolidation
- Project has more than ~50 bd memories (`bd memories | wc -l`)
- A previous memory-processor run hit context CRITICAL or produced "all current" without per-entry evidence

## Workflow

### Phase 1 — Read existing synthesized memory

Read `.xtrm/memory.md` if present. Single Read call. Tells you what was synthesized last time and prevents regressions.

### Phase 2 — Read last 3 session reports (targeted sections)

For each of the latest 3 `.xtrm/reports/*.md`, extract only:
- `## Summary`
- `## Problems Encountered`
- `## Memories Saved`
- `## Suggested Next Priority`

Ignore everything else. These are the highest-signal sections.

### Phase 3 — Bulk-export memories (already done by pre-script)

The specialist's pre-script (`config/skills/memory-audit-transaction/scripts/pre-bulk-export.sh`, registered in `skills.scripts` phase=pre) has **already executed before your first turn** and produced three artifacts:

- `.tmp/memory-audit/memories.json` — full `{key: content}` JSON object from one `bd memories --json` call (single dolt query, no per-key round-trips)
- `.tmp/memory-audit/keys.txt` — one key per line, for chunking
- `.tmp/memory-audit/decisions.jsonl` — initialized empty, you append to it

Verify the pre-script summary in `$pre_script_output` (injected at the top of the task). Confirm `keys.txt` count matches expectation. Do NOT re-export — running `bd recall` 500+ times in your bash window WILL time out (~150-300ms per call × 500 = 75-150s vs 120s bash stall window). The pre-script bypasses that entirely.

Read a chunk's content by slicing the JSON object:

```bash
# extract the next 20-30 keys for this chunk
sed -n '1,30p' .tmp/memory-audit/keys.txt > .tmp/memory-audit/chunk-1-keys.txt
# fetch their content from the bulk JSON
jq --slurpfile keys <(jq -R . .tmp/memory-audit/chunk-1-keys.txt | jq -s .) \
   'with_entries(select(.key as $k | $keys[0] | index($k)))' \
   .tmp/memory-audit/memories.json > .tmp/memory-audit/chunk-1.json
```

Simpler if jq feels heavy — just read keys.txt for the chunk's slice and look up each key with `jq -r --arg k "<key>" '.[$k]' memories.json` one at a time in a bash heredoc. Either way, the dump is on disk; do NOT echo memories.json into chat.

### Phase 4 — Fill gaps from project state (single pass)

One Bash call combining several quick reads:

```bash
git log --oneline -30
cat CLAUDE.md 2>/dev/null | head -100
cat README.md 2>/dev/null | head -50
```

Use this as the cross-reference baseline for Phase 5 classification.

### Phase 5 — Chunked classification with on-disk ledger

Read `.tmp/memory-audit/keys.txt` to know how many memories there are. Process them in **chunks of 20-30 keys**. For each chunk:

1. Read only the slice of `memories.txt` for the chunk's keys (use `awk`/`sed` to extract `=== key ===` … blocks for the N keys in this chunk).
2. For each memory in the chunk, decide its classification using the cross-reference baseline from Phase 4 plus targeted file spot-checks where needed.
3. **Append decisions to `.tmp/memory-audit/decisions.jsonl`** — one JSON line per memory:

   ```json
   {"key":"<memory-key>","content_hash":"sha256:<hex>","status":"Current|Stale|Contradicted|Redundant|Skipped","confidence":"high|medium|low","evidence":["file:line or memory-key or report-ref"],"reason":"one sentence","duplicate_of":"optional-key"}
   ```

4. **Do NOT print the decisions to chat**. Use a single Bash heredoc to append the chunk's rows to the JSONL file. The chat-side summary for each chunk is just one line: `chunk N: X classified (Current=a, Stale=b, Contradicted=c, Redundant=d, Skipped=e)`.

5. After each chunk, optionally write a checkpoint marker file `.tmp/memory-audit/chunk-N.done` so a re-dispatch can resume.

Compute `content_hash` with `sha256sum` against the exact `bd recall` output captured in Phase 3. The hash will be re-verified at Phase 7 apply time.

### Phase 6 — Ledger completeness validation (HARD GATE)

Before writing `.xtrm/memory.md`:

```bash
KEYS=$(wc -l < .tmp/memory-audit/keys.txt)
ROWS=$(wc -l < .tmp/memory-audit/decisions.jsonl)
echo "keys=${KEYS} rows=${ROWS}"
test "${KEYS}" = "${ROWS}" || { echo "INCOMPLETE — missing $((KEYS - ROWS)) decisions"; exit 1; }
```

If the count does not match, the audit is incomplete. **Do not proceed to Phase 7 or Phase 8**. Report the gap and stop. Never default missing rows to `Current` to "make it work" — that is the c791ef failure mode (`bead unitAI-aofbp` empirical evidence).

### Phase 7 — Atomic prune with hash guard

When bd CLI gains `bd forget --batch --apply --if-hash-matches --transaction --backup` (tracked in Phase B of the parent epic, `unitAI-pwojn.2`), use it directly. Until then, the Phase A fallback is a single bash loop that re-verifies the hash before each delete and writes a backup:

```bash
mkdir -p .tmp/memory-audit/backup
PRUNED=0; SKIPPED_HASH=0
jq -c 'select(.status=="Stale" or .status=="Contradicted" or .status=="Redundant")' \
  .tmp/memory-audit/decisions.jsonl > .tmp/memory-audit/prune-set.jsonl

while read -r row; do
  key=$(echo "${row}" | jq -r .key)
  want_hash=$(echo "${row}" | jq -r .content_hash | sed 's/^sha256://')
  have_hash=$(bd recall "${key}" 2>/dev/null | sha256sum | awk '{print $1}')
  if [ "${want_hash}" = "${have_hash}" ]; then
    bd recall "${key}" > ".tmp/memory-audit/backup/${key}.txt"
    bd forget "${key}" && PRUNED=$((PRUNED + 1))
  else
    SKIPPED_HASH=$((SKIPPED_HASH + 1))
    echo "${key}: hash mismatch — skipping" >> .tmp/memory-audit/apply-log.txt
  fi
done < .tmp/memory-audit/prune-set.jsonl

echo "pruned=${PRUNED} skipped_hash=${SKIPPED_HASH}"
```

The chat output stays the count line only. The list of pruned keys lives in the apply-log file on disk; the report links to it.

### Phase 8 — Write .xtrm/memory.md from Current rows

Use `jq` to filter `decisions.jsonl` to only `Current` entries, then synthesize the 3-section `.xtrm/memory.md`:

```markdown
# Project Memory — <project-name>
_Updated: <YYYY-MM-DD> | <N-current> memories synthesized, <N-pruned> pruned, <N-skipped> skipped | last session: <YYYY-MM-DD>_

## Do Not Repeat
- ❌ <wrong action> → ✅ <correct action>

## How This Project Works
- <directive bullet>

## Active Context
- <situational brief from last 2-3 session reports>
```

Target 100-200 lines. Imperative voice. No descriptive prose. Each bullet ends in "do Y" or "never Z".

### Phase 9 — Final report (counts only, NOT per-entry text)

```
## Memory Processor Report

### Synthesized → .xtrm/memory.md
<N> memories synthesized into 3 sections (~<line count> lines)

### Pruned (<N> applied, <M> hash-mismatch-skipped)
See `.tmp/memory-audit/apply-log.txt` for the full list and `.tmp/memory-audit/backup/` for restore data.

### Kept in bd (<N> entries)
Raw detail store intact. Use `bd recall <key>` to dig deeper.

### Ledger artifact
`.tmp/memory-audit/decisions.jsonl` (one row per memory, every status decision evidence-backed).
```

## Conservative-Pruning Rule (Inviolable)

When in doubt, **status=Skipped** — never default to Current. A false negative (slightly stale memory survives) is less harmful than a false positive (delete still-relevant entry). The completeness validator (Phase 6) ensures missing rows do not slip through as "all current."

## Decision-Row Evidence Requirements

Every row in `decisions.jsonl` must have non-empty `evidence`. Acceptable evidence forms:

- `"src/foo.ts:42"` — file:line reference verified against current repo
- `"memory:other-key"` — duplicate-of reference to another existing memory
- `"reports/2026-05-10:Summary"` — section reference in a recent session report
- `"commit:abc1234"` — git commit hash that fixed/changed the memorialized behavior
- `"unverifiable: <reason>"` — explicit acknowledgment when nothing concrete supports the classification → forces `status=Skipped`

A row with status not in {Current, Skipped} and evidence `["unverifiable: …"]` is a contract violation and is treated as Skipped during Phase 7.

## Failure-Mode Mapping

| Past failure | Symptom | Guarded by |
|---|---|---|
| c791ef (deepseek pre-DSML-fix) | 82% context, false "all 507 current" without per-entry evidence | Phase 6 completeness validator + evidence requirement; missing/uncertain → Skipped |
| fad36f (qwen with bulk-export) | 105% context, STALE for 80s, then flailing into gitnexus_* + destructive git | Phase 5 chunked decisions written to disk not chat; Phase 7 single batch not N inline forget; prompt forbids git sync commands |

## Anti-Patterns (Do Not)

- **Do not** echo `bd recall` output into chat. Read from `.tmp/memory-audit/memories.txt` slice instead.
- **Do not** classify multiple chunks worth of memories in one turn. Cap N at 20-30 per chunk.
- **Do not** emit per-entry decision text to chat. Append to the JSONL ledger; chat gets the count summary.
- **Do not** run `bd forget` inline per decision. Always go through Phase 7 batch path.
- **Do not** run `git pull --rebase`, `git push`, `git reset --hard`, or any destructive git command. The memory audit is a project-local read+forget+single-file-write operation. No remote sync, no history rewrite.
- **Do not** proceed to Phase 8 if Phase 6 completeness check fails. Stop and report the gap.
