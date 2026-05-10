# Project Memory — specialists
_Updated: 2026-05-08 | 502 memories in raw store | last session: 2026-05-08_

## Do Not Repeat
- ❌ `sp epic merge` refusing after persisted `failed` state → ✅ Only `merged`/`abandoned` block merge; persisted `failed` is soft/recoverable
- ❌ `sp finalize` closing only named job → ✅ Cascade-closes all waiting keep-alive members via `supervisor.listChainJobIds()`
- ❌ Reviewer PASS not triggering auto-finalize → ✅ Verdict regex now matches `**PASS**` (markdown-bold); auto-finalize fires on streaming PASS
- ❌ `sp run` pre-validator rejecting shell builtins like `if` → ✅ SHELL_BUILTINS allowlist before PATH check
- ❌ `sp merge` on chains after `sp stop` cleaned status.json → ✅ Use `sp epic merge <epic>` for wave-bound chains; DB-first merge canonical
- ❌ Specialist runtime tool starvation with `--tools` flag → ✅ Extension tools in permission-tier allowlists
- ❌ `sync-docs` v2.x unbounded runtime → ✅ v3.1 hard timeout 600s + single-doc invariant + enumerated tool ban
- ❌ `specialists init` inside pi sessions → ✅ USER-ONLY bootstrap; agents ask user to run it
- ❌ Stale `.specialists/user/` overlays shadowing defaults → ✅ `sp doctor` detects and warns on overlay drift
- ❌ Reviewer flagging "verify blast radius" on new-file-only diffs → ✅ Escape-hatch clause in `gitnexus-required` rule
- ❌ Executor worktree jobs leaving changes uncommitted → ✅ `bd worktree create` NOT `git worktree add` — beads integration required
- ❌ Node coordinator on Anthropic models → ✅ Use gpt-5.4/codex; Anthropic produces 0-token empty responses in keep-alive
- ❌ Parallel executors on same file → ✅ Sequential `--job` chain or consolidate into one bead; parallel = merge conflict cascade
- ❌ `sp result` returning empty on waiting specialists → ✅ Initial-turn path calls `upsertResult` + inline bead-notes append
- ❌ `sp clean --dry-run` crashing on deleted job dirs → ✅ DB-first migration; `--processes` flag with PID-liveness gate
- ❌ Reading `.beads/issues.jsonl` directly → ✅ Use `bd show`/`bd show --json`; beads migrated to Dolt DB
- ❌ Running vitest/bun test in executor → ✅ Executor runs lint+tsc only; test-runner in chained pipeline
- ❌ `--job` flag without `--bead` or `--prompt` → ✅ Both required; auto-bead-resolution not implemented
- ❌ Editing `.xtrm/skills/` directly → ✅ Edit `config/skills/<name>/SKILL.md` only; `.xtrm` paths overwritten on init/sync

## How This Project Works
- **MCP surface**: single `use_specialist` tool; all orchestration via CLI (`sp run/feed/result/stop/finalize/merge/ps/list`)
- **Bead-first orchestration**: every run gets `--bead <id>`; reviewer uses `--job` to auto-resolve bead context
- **SpecialistLoader precedence**: `.specialists/user/` > `.specialists/default/` > `config/specialists/` — stale overlay silently shadows defaults
- **Worktree isolation**: edit-capable specialists run in isolated worktrees; reviewer must cd into same worktree; orchestrator merges in dependency order
- **DB-first runtime**: `observability.db` is canonical; `.specialists/jobs/` is legacy mirror; `sp ps/list/result/feed/merge` read from SQLite
- **Epic state is DERIVED**: Not persisted — computed live from chain readiness. Only `merged`/`abandoned` are terminal. Persisted `failed` is soft/recoverable.
- **Chain lifecycle**: job (atomic) → chain (worktree lineage) → epic (merge container). `sp epic merge` is canonical publication path.
- **Per-chain merge**: `sp merge <bead>` works for ANY PASS chain, regardless of sibling-epic state. No inverted-gate guard.
- **Auto-finalize**: Supervisor auto-finalizes keep-alive executor on reviewer PASS (streaming path). Manual fallback: `sp finalize <any-chain-job-id>` cascades all waiting members.
- **Job lifecycle**: running → waiting (keep-alive idle) → done/cancelled/error. `findActiveJob` includes `waiting` — prevents duplicate dispatch.
- **sp serve features**: `/readyz` 6-reason taxonomy; `/healthz` unchanged; trust flags default-reject; operational JSON logs per request
- **sync-docs v3.1 invariant**: one bead = one doc in SCOPE; empty/multi/non-doc BLOCKED; 600s hard timeout
- **CHANGELOG flow**: `/releasing` skill v2.0.0 drives bump → build → commit → tag → push → npm publish; `changelog-keeper` v3.0.0 fills `[Unreleased]` gaps only
- **test-runner v2.0.0**: Polyglot manifest detection (package.json/pyproject.toml/Cargo.toml/go.mod); executor/debugger prompts project-language-aware
- **expected_output_keys**: Schema field for required-key validation independent of `response_format`; text-format specs can enforce JSON contracts

## Active Context
- **Chain-lifecycle + epic-simplification redesign shipped** (2026-05-08) — Epic state now derived live from chain readiness. `sp epic resolve` removed. `sp merge` works per-chain. `sp finalize` cascades chain closure. Persisted `failed` is recoverable.
- **v3.14.0/v3.14.1 released** — sp serve operational logging, script-runner hardening, changelog-keeper v3.0.0, `/releasing` skill v2.0.0
- **Race-spawn dispatch fix** (`unitAI-55cb3`) — `findActiveJob` includes `waiting`; early CLI pre-flight in `src/cli/run.ts`
- **Open P1**: `unitAI-6i986` — parallel `sp run` dispatch reliability; likely closed by `55cb3` but needs smoke test
- **Open P2**: `unitAI-f5pxt` — `sp clean` does not purge observability sqlite; manual truncate needed this session
- **Open P1**: `unitAI-i6khn` — defensive template-field misuse check
- **Open P1**: `unitAI-huwov` — reference Python client for specialists-service
- **Open P0 cluster**: Release/distribution hardening (`unitAI-ye5s9` epic + children) — CI smokes, npm-pack validation, fresh-install paths
- **Models in rotation**: gpt-5.4-mini, gpt-5.3-codex, gpt-5.5 (overthinker), glm-5; Anthropic deprecated for keep-alive
- **Last commit**: `5f103032` (session report 2026-05-08, merged)
