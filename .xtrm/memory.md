# Project Memory — specialists
_Updated: 2026-04-30 | 165 memories analyzed, 15 pruned | last session: 2026-04-30_

## Do Not Repeat
- ❌ `sp merge` on chains after `sp stop` cleaned status.json → ✅ Use `sp epic merge <epic>` for wave-bound chains; manual `git merge --no-ff` for orphan branches; DB-first merge now canonical (ofjvj migrated)
- ❌ Specialist runtime tool starvation with `--tools` flag → ✅ Extension tools (Serena/GitNexus) added to permission-tier allowlists; `unitAI-gzrx` tracks full manifest-based policy
- ❌ `sync-docs` v2.x unbounded runtime (9d3a pattern) → ✅ v3.1 hard timeout 600s + single-doc invariant + enumerated tool ban + git show exception capped at 3 commits
- ❌ `specialists init` inside pi sessions → ✅ USER-ONLY bootstrap; agents ask user to run it
- ❌ Stale `.specialists/user/` overlays shadowing default specs → ✅ `sp doctor` now detects and warns on overlay drift
- ❌ Reviewer flagging "verify blast radius" on new-file-only diffs → ✅ Added escape-hatch clause to `gitnexus-required` rule; orchestrator pre-empts with "new-file scope" note
- ❌ Executor worktree jobs leaving changes uncommitted → ✅ `bd worktree create` NOT `git worktree add` — beads integration required for merge flow
- ❌ Node coordinator on Anthropic models → ✅ Use gpt-5.4/codex; Anthropic produces 0-token empty responses in keep-alive sessions
- ❌ Parallel executors on same file (ps.ts, init.ts) → ✅ Sequential `--job` chain or consolidate into one bead; parallel = merge conflict cascade
- ❌ `sp result` returning empty on waiting specialists → ✅ Initial-turn path now calls `upsertResult` + inline bead-notes append; `run_complete` event fallback in result.ts
- ❌ `sp clean --dry-run` crashing on deleted job dirs → ✅ DB-first migration complete; `--processes` flag with PID-liveness primary gate
- ❌ Executor `gpt-5.3-codex` returning 0 tokens on turn 1 → ✅ Kill and redispatch; parallel dispatch may increase failure rate
- ❌ Reading `.beads/issues.jsonl` directly → ✅ Use `bd show`/`bd show --json`; beads migrated to Dolt DB
- ❌ Running vitest/bun test in executor → ✅ Executor runs lint+tsc only; test-runner in chained pipeline; supervisor.test.ts FIFO hang in bun
- ❌ `--job` flag without `--bead` or `--prompt` → ✅ Both required; auto-bead-resolution not implemented
- ❌ Editing `.xtrm/skills/` directly → ✅ Edit `config/skills/<name>/SKILL.md` only; `.xtrm` paths overwritten on init/sync
- ❌ Assuming `--background` removed → ✅ Still exists; supports tmux background mode

## How This Project Works
- **MCP surface**: single `use_specialist` tool; all orchestration via CLI (`sp run/feed/result/stop/merge/ps/list`)
- **Bead-first orchestration**: every run gets `--bead <id>`; reviewer uses `--job` to auto-resolve bead context
- **SpecialistLoader precedence**: `.specialists/user/` > `.specialists/default/` > `config/specialists/` — stale overlay silently shadows defaults
- **Worktree isolation**: edit-capable specialists run in isolated worktrees; reviewer must cd into same worktree; orchestrator merges in dependency order
- **DB-first runtime**: `observability.db` is canonical; `.specialists/jobs/` is legacy mirror; `sp ps/list/result/feed/merge` read from SQLite
- **Wave/Chain/Job taxonomy**: job (atomic) < chain (worktree lineage) < epic (merge container); `sp epic merge` is canonical publication path
- **Job lifecycle**: running → waiting (keep-alive idle) → done/cancelled/error; `run_complete` single completion event per turn
- **sp serve features**: `/readyz` 6-reason taxonomy with audit-failure sliding window; `/healthz` unchanged; trust flags default-reject; hot-reload via `fs.watch` or `--reload-poll-ms`
- **sync-docs v3.1 invariant**: one bead = one doc in SCOPE; empty/multi/non-doc BLOCKED; 600s hard timeout; tool ban enumerates all source-read primitives
- **CHANGELOG flow**: `sp release prepare --minor` → review → commit → `sp release publish`; operator gates between prepare and publish
- **KPI payload**: `specialist_job_metrics` table exists but needs manual `sp db extract --all-missing` to populate; startup_payload_json coming
- **Version check**: `sp doctor` shows version comparison; `sp status` shows update nudge gated by TTY+offline+job context; 6h cache

## Active Context
- **ChangeLog pipeline shipped** — znkgi epic complete: CHANGELOG seed, changelog-keeper specialist, sp release prepare/publish, in-CLI version check. Backfill needed for v3.9.0/v3.10.0 (`unitAI-ani1n`, `unitAI-1evl2`).
- **KPI/Payload epic filed** (`unitAI-drs41`) — 4 children: auto-aggregate on terminal, startup payload measurement, surface in feed/ps/result, `using-kpi` skill. Skill shipped in `config/skills/using-kpi/SKILL.md`. CLI `sp db extract/stats` unhidden.
- **sp merge DB-first** (`unitAI-ltwme`) — `sp clean --processes` migrated; `--stale-after <hours>` fallback; PID-liveness primary gate.
- **sp release hotfix** — pre-scripts now run in release CLI (not script-runner); markdown fallback for models declining JSON; `allowLocalScripts: true` default for operator-driven runs.
- **sync-docs v3.1 canary soak** — A/B/D PASS; C timed out correctly at 600s. Convergence tuning in `unitAI-n03vt`.
- **Open P1**: `unitAI-gzrx` permission/tool manifest design — replace hardcoded allowlists with data-driven catalogs.
- **Open P0**: `unitAI-ofjvj` `sp merge` DB migration — was DB-first for status but still needed chain metadata from files; now fully migrated.
- **Open P2**: `unitAI-ani1n` CHANGELOG backfill — v3.9.0 and v3.10.0 missing from CHANGELOG.
- **Open P3**: `unitAI-8elrc` changelog-keeper output quality — tighten JSON tail, disallow self-referential bullets.
- **Models in rotation**: gpt-5.4-mini, gpt-5.3-codex, glm-5; Anthropic deprecated for keep-alive; haiku/sonnet for sync-docs tuning candidate.
- **Last commit**: `3f061391` (release backfill ranges validation)