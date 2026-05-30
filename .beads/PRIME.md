# Beads Workflow Context

> **Context Recovery**: Run `bd prime` after compaction, clear, or new session
> Hooks auto-call this in Claude Code when a beads workspace is resolved

# 🚨 SESSION CLOSE PROTOCOL 🚨

**CRITICAL**: Before saying "done" or "complete", you MUST run this checklist:

```
[ ] 1. git status              (check what changed)
[ ] 2. git add <files>         (stage code changes)
[ ] 3. git commit -m "..."     (commit code)
[ ] 4. git push                (push to remote)
```

**NEVER skip this.** Work is not done until pushed.

## Core Rules
- **Primary tracker**: Use beads for ALL durable, cross-session task tracking (`bd create`, `bd ready`, `bd close`). This is the canonical state — survives compaction, sessions, agents.
- **In-session tasks**: TaskCreate / TaskUpdate are allowed and encouraged for ephemeral, in-session task lists (multi-step work where you want a visible checklist in the harness). Keep them **in sync with beads** — when an in-session task corresponds to durable work, file a bead too. Tasks are the harness's local view; beads are the source of truth.
- **Prohibited**: markdown files for task tracking (MEMORY.md, TODO.md and similar). They fragment across accounts and silently desync. Use beads + (optionally) in-session tasks instead.
- **Workflow**: Create beads issue BEFORE writing code, mark in_progress when starting
- **Memory**: Use `bd remember "insight"` for persistent knowledge across sessions. Do NOT use MEMORY.md files — they fragment across accounts. Search with `bd memories <keyword>`.
- Persistence you don't need beats lost context
- Git workflow: beads auto-commit to Dolt, run `git push` at session end
- Session management: check `bd ready` for available work

## Essential Commands

### Finding Work
- `bd ready` - Show issues ready to work (no blockers)
- `bd list --status=open` - All open issues
- `bd list --status=in_progress` - Your active work
- `bd show <id>` - Detailed issue view with dependencies

### Creating & Updating
- `bd create --title="Summary of this issue" --description="Why this issue exists and what needs to be done" --type=task|bug|feature --priority=2` - New issue
  - Priority: 0-4 or P0-P4 (0=critical, 2=medium, 4=backlog). NOT "high"/"medium"/"low"
- `bd update <id> --claim` - Claim work
- `bd update <id> --assignee=username` - Assign to someone
- `bd update <id> --title/--description/--notes/--design` - Update fields inline
- `bd close <id>` - Mark complete
- `bd close <id1> <id2> ...` - Close multiple issues at once (more efficient)
- `bd close <id> --reason="explanation"` - Close with reason
- **Tip**: When creating multiple issues/tasks/epics, use parallel subagents for efficiency
- **WARNING**: Do NOT use `bd edit` - it opens $EDITOR (vim/nano) which blocks agents

### Dependencies & Blocking
- `bd dep add <issue> <depends-on>` - Add dependency (issue depends on depends-on)
- `bd blocked` - Show all blocked issues
- `bd show <id>` - See what's blocking/blocked by this issue

### Sync & Collaboration
- `bd dolt push` - Push beads to Dolt remote
- `bd dolt pull` - Pull beads from Dolt remote
- `bd search <query>` - Search issues by keyword

### Project Health
- `bd stats` - Project statistics (open/closed/blocked counts)
- `bd doctor` - Check for issues (sync problems, missing hooks)
- `bd doctor --check=conventions` - Check for convention drift (lint, stale, orphans)

### Quality Tools
- `bd create --validate` - Check description has required sections
- `bd create --acceptance="criteria"` - Set acceptance criteria (checked by --validate)
- `bd create --design="decisions"` - Record design decisions
- `bd create --notes="context"` - Add supplementary notes
- `bd config set validation.on-create warn` - Auto-validate on every create
- `bd lint` - Check existing issues for missing sections

### Lifecycle & Hygiene
- `bd defer <id> --until="date"` - Defer work to a future date
- `bd supersede <id> --with=<new-id>` - Mark issue as superseded
- `bd close <id> --suggest-next` - Show newly unblocked issues after closing
- `bd stale` - Find issues with no recent activity
- `bd orphans` - Find issues with broken dependencies
- `bd preflight` - Pre-PR checks (lint, stale, orphans)
- `bd human <id>` - Flag for human decision (list/respond/dismiss)

### Structured Workflows
- `bd formula list` - See available workflow templates
- `bd mol pour <name>` - Start structured workflow from formula

## Common Workflows

**Starting work:**
```bash
bd ready           # Find available work
bd show <id>       # Review issue details
bd update <id> --claim  # Claim it
```

**Completing work:**
```bash
bd close <id1> <id2> ...    # Close all completed issues at once
git add . && git commit -m "..."  # Commit code changes
git push                    # Push to remote
```

**Creating dependent work:**
```bash
# Run bd create commands in parallel (use subagents for many items)
bd create --title="Implement feature X" --description="Why this issue exists and what needs to be done" --type=feature
bd create --title="Write tests for X" --description="Why this issue exists and what needs to be done" --type=task
bd dep add beads-yyy beads-xxx  # Tests depend on Feature (Feature blocks tests)
```

## Persistent Memories (606)

Stored via `bd remember`. Update in place with `bd remember --key <key> "new content"`. Search with `bd memories <keyword>`. Remove with `bd forget <key>`.

### 032n4-sp-feed-f-global-exit-on-keepalive-waiting
032n4-sp-feed-f-global-exit-on-keepalive-waiting: GH#76 fix. src/cli/feed.ts followMerged() now treats keep-alive 'waiting' jobs as terminal-equivalent in GLOBAL follow mode (options.jobId not set). Per-job mode (options.jobId set) unchanged — keep-alive jobs still tracked across resume turns. --forever still overrides. 27/27 feed.test.ts pass. tests use Bun-compatible mock cleanup (vi.doUnmock removed in fix loop after reviewer caught Vitest API).

### 13-chain-templates-concretized-in-docs-design-chain
13 chain templates concretized in docs/design/chain-templates/ (verified bd formula schema: file=.formula.json, top-level field is 'formula' not 'name', version is INT, extends is array, vars is map, needs becomes blocks-on edge). Each template carries 5-section contracts in step descriptions (change-contract for root, step-contract MANDATE/INPUTS/OUTPUTS/SCOPE/NON_GOALS for steps). Labels carry role:X + edge:<type>-><target> for post-pour wiring helper (option B). bd mol pour creates a 'molecule' issue (issue_type=molecule, NOT epic) as auto-parent with steps as children via parent-child edges + blocks-on between siblings — chain≡bd molecule (refines prior chain≡bd epic model). 13 templates: code-quick (2 steps), code-standard (5), code-with-advisors (8 — parallel explorer+researcher+overthinker before executor), debug (5, debugger non-skippable), security-deep (7 — security-auditor twice: advisor+gate), release-prep (3, changelog-drafter+keeper), triage (3, explorer+overthinker), research-only (2 with {{specialist}} var), restitch (4), planning (2, planner alone), premortem (2, overthinker alone, decision type), doc-sync (2, sync-docs alone), memory-hygiene (2, memory-processor alone). All verified parsing + cooking correctly. applies_when matcher NOT supported as formula field — selection logic lives in Claude hook + sp chain plan dispatcher externally.

### 1j9om-bf7qw-ci-package-payload-smoke-new-github
1j9om-bf7qw-ci-package-payload-smoke: new .github/workflows/package-payload.yml has payload-contract job (npm pack --dry-run + scripts/assert-package-payload.sh against required asset list including dist entrypoints, config/specialists/{executor,reviewer}.specialist.json, config/mandatory-rules/{executor-delivery,index}, config/skills/using-specialists-v3/SKILL.md, config/catalog/{index,native,gitnexus,serena}.json) AND packed-smoke job (build + npm pack + global install to /tmp/sp-smoke-prefix + sp --version/doctor/prune-stale-defaults/clean/list). dorny/paths-filter gates on package.json/src/config/dist/script/workflow changes. Local assert script smoked clean against current dry-run.

### 2026-05-19-triage-45-44-open-key
2026-05-19 triage: 45→44 open. Key wiring: k5kap discovered-from c4g0m (LSP epic↔problem); dp3lg↔3ip52 relates-to (dolt resource siblings); specialists-83y child of z2vpq (script-class docs). Closed pi9ww (throwaway smoke). ylphl registry entry similarities are naming-convention artifacts, not dupes.

### 2026-05-20-full-triage-46-44-open
2026-05-20 full triage: 46→44 open. Closed: pickup bead 1gkeu (superseded by c4g0m), live-proof epic 7t93q (100% done). New edges: uniab↔x7dlo (doc siblings); a5ys3↔rlq48↔ib5xc (toolchain wave); rvawq↔0vb3 (startup context design↔prototype); h2o7u↔3ofi6 (sp UX); ncd1w tracks c4g0m (devcontainer urgency depends on LSP pooling result); xr45u↔c4g0m (global overrides needs lsp field when c4g0m ships option B).

### 3m27y-payload-tightening-license
3m27y-payload-tightening-license: LICENSE file added (MIT 2026 Dawid/Jaggerxtrm). package.json files allowlist now explicit: config/specialists/, /mandatory-rules/, /skills/, /catalog/, /nodes/, /hooks/, /presets.json + LICENSE. Top-level types field added: dist/types/lib.d.ts. .npmignore additionally excludes config/benchmarks/ and config/skills/**/evals/. CI payload-contract gate asserts LICENSE. npm pack payload shrank from 258 to 256 files; benchmarks/evals excluded.

### 3r268-help-text-refresh
3r268-help-text-refresh: src/index.ts help blocks updated: sp init notes Bun prereq + xtrm install order; sp clean --reap-orphans describes dead-toolchain reason; sp merge usage includes --target-branch + ignored noise paths; sp finalize notes SQLite-first read + cascade; sp doctor --check-drift notes Category A scope.

### 5voar-doctor-flat-active-layout
5voar-doctor-flat-active-layout: src/cli/doctor.ts Category A check no longer loops over scoped active/claude + active/pi sub-dirs. Validates flat .xtrm/skills/active/<skill> + root symlinks (.claude/skills, .pi/skills → .xtrm/skills/active). Aligns doctor with sp init layout from src/cli/init.ts:533-560. Fresh sp init + sp doctor no longer reports false-positive Category A failures.

### 6fsxp-reviewer-blast-radius-gate-relaxed
6fsxp-reviewer-blast-radius-gate-relaxed: config/specialists/reviewer.specialist.json prompt.system step 5 + task_template now accept gitnexus_impact OR $gitnexus_summary OR gitnexus_detect_changes OR LOW impact_report as blast-radius evidence. Only flags gap when NONE present AND diff is MEDIUM+. Eliminates ~75% false-PARTIAL rebuttal pattern observed in 2026-05-13 sessions.

### 7ezse-list-rules-user-tier
7ezse: list-rules now shows .specialists/user/mandatory-rules at top of RULE_TIERS. docs/surface-ownership.md + config/mandatory-rules/README.md updated. 5/5 tests pass.

### 8tm35-stale-reaper-design-sp-clean-reap-orphans
8tm35-stale-reaper-design: sp clean --reap-orphans now detects dead-pid + orphaned-keep-alive stale specialist jobs with 30-min min-age threshold. New collectStaleSpecialistJobs in src/specialist/process-health.ts queries local observability DB (process.cwd()/.specialists). Apply mode SIGTERMs alive stale processes + marks DB row cancelled. CAVEAT: detection is per-repo (single .specialists/db lookup). Cross-project stale jobs (e.g. xtrm-tools, mercury) visible in sp ps via /proc scanning are NOT reaped from a different repo's cwd. Each project owns its cleanup. wq0mw (zombie stuck-running case) needs similar logic but covers the alive-PID-still-no-tool-events case.

### a6e60-sp-merge-target-branch-flag
a6e60-sp-merge-target-branch-flag: sp merge + sp epic merge accept --target-branch <name> with git ref validation. resolveDefaultBranchName in src/cli/merge.ts:101 takes optional override; threaded through isBranchAlreadyPublished, previewBranchMergeDelta, rebaseBranchOntoMaster, assertBranchMergeWorthiness, runMergePlan. Backward compat preserved (origin/HEAD default when flag absent). Retires xtrm-nr05 cherry-pick playbook. 22 merge.test.ts tests pass.

### added-specialistschema-mandatory-rules-with-shared-mandatory
Added SpecialistSchema.mandatory_rules with shared MandatoryRuleSchema defaults and kebab-case template_sets validation.

### after-changing-specialist-yaml-configs-model-extensions-etc
After changing specialist YAML configs (model, extensions, etc), MUST run npm run build to rebuild dist/index.js. The dist bundles session.ts which reads extension paths and model config at compile time. Stale dist causes RPC timeouts that look like pi-core issues but are actually the wrong model/provider being spawned.

### after-workflow-docs-migrations-generated-surfaces-drift-too
After workflow/docs migrations, generated surfaces drift too: specialists status and doctor were still pointing users to specialists install. Sweep active CLI guidance, not just markdown docs, when changing bootstrap semantics.

### agent-browser-integration-unitai-544sf-2-research-adopt
agent-browser integration (unitAI-544sf.2 research): adopt as a researcher TOOL, NOT a new specialist. It's a native Rust CLI + daemon + CDP — NOT an MCP server (no MCP surface in repo). Best transport: 'agent-browser batch --json' so one call does open→snapshot→click→get-text. SECURITY (researcher is MEDIUM + agent-browser can run page JS via eval): use safe-default flags --content-boundaries, --max-output, --allowed-domains, --action-policy; deny eval on hostile domains; HAR/network logs can capture tokens (redact); always 'close --all'. Only justify a separate web-scraper specialist for long-running crawls / heavy extraction / strict per-target isolation. Sources: vercel-labs/agent-browser README + skill-data/core + docs/security (accessed 2026-05-29).

### agentcore-evals-split-scoring-and-diagnostics-evaluators-are
AgentCore evals split scoring and diagnostics: evaluators are scoring functions (built-in LLM-as-judge or custom Lambda/code) while the AgentCore Evaluation Diagnostic Skill is a separate log-query triage workflow for empty/failing evaluations.

### agentic-observability-research-unitai-544sf-6-recommendation
Agentic observability research (unitAI-544sf.6): RECOMMENDATION 'Grafana first'. Our stack has SQLite canonical stream (.specialists/db/observability.db) + sp log/sp feed + channels/wakes/memory tables, but NO Prometheus exporter / /metrics endpoint and NO alert-rule UI, no anomaly engine, no traces. Datadog = biggest managed surface (monitors+anomaly+APM+log mgmt) but SaaS lock-in; Grafana = dashboards/alerting over many sources (but core SQL sources are PG/MySQL/MSSQL not SQLite → needs adapter/ETL/plugin); Snowflake = cold cross-repo warehouse analytics only (per-second billing, 60s min), not hot alert loop. PLAN: keep raw in observability.db, export a curated view; add Grafana for dashboards+alerting (needs SQLite→Grafana adapter); add a 'monitor' specialist for anomaly detection (no native engine today); traces later only. Sources: docs.datadoghq.com, grafana.com/docs, docs.snowflake.com (accessed 2026-05-29).

### allowskillsroots-for-script-specialists-now-uses-path-relati
allowSkillsRoots for script specialists now uses path.relative containment rather than string startsWith, and applies to both skills.paths and prompt.skill_inherit to reject sibling-prefix and traversal escapes.

### always-create-a-beads-issue-before-writing-any
ALWAYS create a beads issue before writing any code or making fixes, even during investigation tasks. The moment a real bug or change is confirmed, stop and run bd create before touching any file. 'Investigation that leads to a fix' is tracked work. No exceptions — momentum is not an excuse.

### always-validate-specialist-executor-output-with-a-live
Always validate specialist executor output with a live test run — executors frequently implement functions but forget to wire them into the render path. The sp ps bead title bug (fetched but never displayed) was only caught by running a real explorer and checking the output.

### amzec-sp-finalize-sqlite-fallback-supervisor-readresult-now
amzec-sp-finalize-sqlite-fallback: supervisor.readResult now tries SQLite (client.readResult) first, falls back to file-based read. Root cause: SPECIALISTS_JOB_FILE_OUTPUT defaults to 'off' (job-file-output.ts:12), so result.txt never gets written; supervisor.upsertResult persisted to SQLite only; finalize.ts's PASS regex never matched. Fix flips finalize lookup to SQLite-first. After this fix, sp finalize <exec-job> after reviewer PASS should succeed without operator override (caveat: PASS regex /## Compliance Verdict[\s\S]*?- Verdict:\s*\**\s*PASS\s*\**/i still needed).

### anthropic-rpc-bug-745i-primary-cause-was-sendcommand
Anthropic RPC bug (745i): primary cause was sendCommand timeout 10s too short for OAuth startup. Fixed in 0dd86317 (bumped to 30s). Adaptive thinking (--thinking medium) silence period between message_start and first thinking event is secondary risk for stall_timeout_ms=120s on complex tasks. Executor switched to qwen as workaround but Anthropic itself works fine in RPC mode with stdin open.

### applied-designer-rev-9-reconciliation-deltas-to-docs
Applied designer rev-9 reconciliation deltas to docs/design/specialists-friction-audit.md (1312 lines). Key changes: (1) §1.1.1 mental model rewritten from chain≡bd-epic to chain≡bd-molecule (epic is organizational parent above chains, molecule is chain identity per §13.3); (2) sp chain verb rename plan/dispatch/insert → review/approve/insert to match substrate sb chain 1:1 (D16); (3) sp chain accepts root molecule id only (D17); (4) §11.2 closed D21 — workspace identity internal to substrate, Opportunity 10 implements early; (5) §11.3 closed D22 — opened_by must be marked synthetic-pre-substrate for legacy chains; (6) §11.4 new — recommended_template on planner (D23), enum=13 formula names + on-the-run, validated against bd formula list; (7) Opp 9 reconciliation note replaced — applies_when external selection config, NOT formula sections (verified silently dropped by bd binary); (8) D2 promoted to principle in §2.D + Opp 8 — verification authority belongs to independent gate; (9) R5 deduped to §5.3 hard-refuse, noted Opp 10 dissolves R1/R2/R5; (10) §5.5 sp merge dirty-index → LAND per D18 runway recalibration; (11) §6 bootstrap split clarified — h9hqg covers B-A1/A2/A3, B-A4/A5/A6 stay friction-audit; (12) §13.1 catalog marks 6 archetypes (A) vs 7 deliberative/maintenance (D) per substrate §6.9.10 floor framing. Added decisions D16-D23 to §11.0 ledger; §11.1 questions all closed with cross-refs.

### architecture-md-synced-to-b7fb256a-added-job-root
ARCHITECTURE.md synced to b7fb256a — added job-root.ts (git-common-root anchoring), worktree.ts (worktree isolation), supervisor.ts (GitNexus tracking, FIFO steering, keep-alive sessions, SQLite integration), timeline-events.ts (token_usage, finish_reason, turn_summary, compaction, retry events)

### attach-list-integration-fixtures-need-specialists-job-file
attach/list integration fixtures need SPECIALISTS_JOB_FILE_OUTPUT=on for file-backed status paths; otherwise CLI intentionally stays DB-only and list --live returns empty.

### auto-append-universal-all-bead-linked-specialist-runs
auto-append-universal: All bead-linked specialist runs now auto-append full output to input bead notes on every run_complete (not just terminal). No READ_ONLY gate, no self-management skip. Append-only via bd update --append-notes. Status-aware headers: [WAITING — more output may follow] vs [DONE]. updateBeadNotes in beads.ts returns {ok, error} instead of void. Commit 428cd7f7.

### auto-commit-checkpoint-on-waiting-filters-xtrm-paths
auto_commit checkpoint_on_waiting filters .xtrm/ paths — when a specialist edits hooks/skills/docs there, the worktree branch carries unstaged changes that block sp epic merge's rebase step. Workaround: cd to worktree, git add + commit the .xtrm files manually before retrying merge.

### auto-commit-checkpoint-supervisor-auto-commits-worktree-chan
auto-commit-checkpoint: Supervisor auto-commits worktree changes on run_complete for specialists with auto_commit=checkpoint_on_waiting. Executor and debugger default to checkpoint_on_waiting. Commit message: checkpoint(<specialist>): <bead_id> turn <N>. Noise paths filtered: .xtrm/, .wolf/, .specialists/jobs/, .beads/. Failure is non-fatal warning. Timeline events: auto_commit_success/skipped/failed. Status fields: last_auto_commit_sha, last_auto_commit_at_ms, auto_commit_count. Commit 11e9b016.

### aws-bedrock-agentcore-research-unitai-544sf-5-two
AWS Bedrock AgentCore research (unitAI-544sf.5): two patterns worth extracting (no AWS-runtime lock-in needed). (1) AgentCore Evaluation = split between EVALUATORS (built-in immutable LLM judges + custom LLM/Lambda evaluators; online/on-demand/batch) and a separate DIAGNOSTIC SKILL (log/trace triage for empty/failing evals, NOT a scorer). Maps onto our reviewer/code-sanity/security-auditor gates; the evaluator-vs-diagnostic split should inform roadmap Phase 7 R-checks: score-check (evaluator path) vs diagnose-check (plumbing/trace path). (2) AWS DevOps Agent learned-skills = same shape as xtrm skills (SKILL.md + refs/assets, auto-load by description, agent-type targeting incl 'Evaluation', auto-refresh every 30 investigations / on capability change, non-executable docs only). Difference: AWS learns from Agent Space telemetry; xtrm can learn from board/reports/docs. Recommendation both: extract pattern. Courses P0: 'AgentCore Evaluation on Amazon Bedrock', 'AWS Observability', 'Security Best Practices: Monitoring and Alerting', 'Production-Ready AI Agents with AgentCore'. Primary sources: docs.aws.amazon.com/bedrock-agentcore + /devopsagent + skillbuilder.aws (accessed 2026-05-29).

### bare-mode-authoring-pipeline-validated-2026-05-23
bare-mode-authoring-pipeline-validated-2026-05-23: End-to-end live test confirms specialists-creator (v1.4.0) correctly produces bare-mode specs after the unitAI-rz0cp + unitAI-w8t6y updates. Dispatched against bead unitAI-igrzj to author a research specialist — output had execution.bare=true, system_prompt_mode=replace, extensions.serena/gitnexus=false, READ_ONLY, fallback_model from different provider, and a substantive 1655-char prompt.system that explicitly names the tool allowlist + deny list and termination condition. validate-specialist OK, specialists list shows it correctly. Pipeline: bare.specialist.json template + updated SKILL.md sections + docs/bare-specialists.md + spec.prompt.system additions all flow through correctly to agent output.

### bd-auto-export-pain-fix-set-export-git
bd auto-export pain fix: set 'export.git-add: false' to disable per-write auto-staging (kills all the checkout abort + lock race pain mid-work). Patch .beads/hooks/pre-commit to add 'git add -f .beads/issues.jsonl' OUTSIDE the BEGIN BEADS INTEGRATION markers (so bd upgrades don't clobber). Net result: mid-work bd ops are silent (file still updates via auto-export but no staging), and commits naturally include the fresh JSONL snapshot via the pre-commit shim. No more 'chore(beads): export state' commits. Verified 2026-05-25.

### bd-config-writes-flat-format-yaml-export-git
bd config writes flat-format YAML (export.git-add: false) not nested. Both formats are valid YAML and bd reads either. For repos where bd config set fails (broken dolt server, missing config init), append in nested format manually: 'export:\n  git-add: false'. Detection grep must check BOTH: 'grep -E ^export.git-add:' for flat AND awk for nested under 'export:' block.

### bd-hooks-install-silently-no-ops-in-two
bd hooks install silently no-ops in two cases: (1) repo has core.hooksPath set — bd writes nowhere visible to git; reports success regardless; (2) repo has non-bd pre-commit hook at the target path — bd may skip or clobber depending on version, but my sweep showed reports success either way. Mercury repos commonly use core.hooksPath=.githooks (chain-githooks wrapper pattern) or core.hooksPath=.beads/hooks (misconfigured — points at bd's source dir, not a git hooks target). Before assuming bd hooks install worked, verify the actual hook file at $(git config --get core.hooksPath || echo .git/hooks)/pre-commit exists AND grep for BEADS INTEGRATION markers. Repos with security-pipeline pre-commit wrappers (.githooks/pre-commit starting with 'security-pipeline-managed-wrapper') need chained-hook integration, not file replacement.

### bd-prime-context-overhead-bd-prime-injects-3k
bd-prime-context-overhead: bd prime injects ~3k tokens of all project memories at every specialist spawn regardless of task relevance. This wastes context on irrelevant memories. Fix tracked in unitAI-tz4r: filter by relevance to current bead title/description, and supplement with gitnexus codebase structure injection instead of navigation via grep/read cycles.

### bd-writes-can-be-silenced-with-sandbox-it
bd writes can be silenced with --sandbox; it disables auto-sync and prevents Dolt auto-push permission-denied noise when remote auth is unavailable.

### bead-id-verbatim-rule-added-to-prevent-bd
bead-id-verbatim rule added to prevent bd command ids from being regenerated without dots; use verbatim bead_id from injected context or bd create output, not memory.

### beads-edit-gate-requires-bd-update-id-claim
beads-edit-gate requires bd update <id> --claim before writing files — setting --status=in_progress is NOT enough. The gate checks for an active claim separately.

### benchmark-runner-should-use-append-only-attempts-jsonl
benchmark runner should use append-only attempts.jsonl with rerun-failed selecting only latest non-success sample state

### board-wide-safe-triage-pass-outside-smjsq-surfaces
Board-wide safe triage pass outside smjsq surfaces: close placeholder beads with no description/notes/deps (unitAI-klz1); park date-gated or low-priority design/backlog work; keep open epics/bugs with explicit recent reconciliation notes or open descendants.

### bug-fix-in-porcelain-parser-ts-commit-2709a09c
Bug fix in porcelain-parser.ts (commit 2709a09c+816e2860): supervisor's git-status path parsing dropped first character of modified-file paths because .map(line.trim()) ran before .slice(3). Extracted to src/specialist/porcelain-parser.ts:parsePorcelainStatus() — pure helper, tested in tests/unit/specialist/porcelain-parser.test.ts. listSubstantiveWorktreeFiles still applies noise-path filter after parsing. Side-effect: explains months of silent auto-commit failures for executor/debugger checkpoint_on_waiting.

### bug-v3xb3-root-cause-sp-stop-sigterm-on
Bug v3xb3 root cause: sp stop SIGTERM on waiting READ_ONLY keepAlive jobs bypassed appendResultToInputBead. Fix: SIGTERM handler in supervisor.ts now flushes accumulated output with status='cancelled' before terminal transition; append returns boolean so skip-dedupe flag only sets on success (retry on transient beads failure). Tests in supervisor-sigterm-append.test.ts cover both paths.

### bun-build-target-bun-still-emits-usr-bin
bun build --target=bun still emits #!/usr/bin/env node shebang. Must post-process with sed to replace with #!/usr/bin/env bun. Build script: bun build --target=bun --outfile=dist/index.js && sed -i '1s|#!/usr/bin/env node|#!/usr/bin/env bun|' dist/index.js. Without this, bun:sqlite (and all bun: imports) fail silently in production because the binary runs under Node.

### bun-bundle-path-resolution-dist-index-js-is
bun-bundle-path-resolution: dist/index.js is the bun bundle entry point. dirname(import.meta.url) inside the bundle resolves to dist/, not the original source file location. Consequence: paths to package root need only ONE .. from dist/ (e.g. ../package.json, ../bin/install.js, ../specialists/). Using two .. navigates above the package root into the parent scope. This caused the specialists install path bug in 2.1.14 and was also the correct fix for version.ts package.json import.

### bun-esm-zod-import-in-bun-vitest-test
bun-esm-zod-import: In Bun/Vitest test context, zod must be imported as 'import * as z from zod' not 'import { z } from zod' — named export fails with 'z is undefined'. Discovered from run_parallel.tool.ts pattern.

### bun-runtime-throws-uncaught-ebadf-when-closing-named
bun runtime throws uncaught EBADF when closing named pipe fds that were already closed by explicit closeSync(). This is a bun quirk, not a code bug. Fix: process-level uncaughtException handler in src/index.ts that suppresses err.code=EBADF && err.syscall=close.

### bun-sqlite-database-transaction-callback-returns-a-transacti
Bun sqlite Database.transaction(callback) returns a transaction function; call it with () in runtime wrappers. Returning the wrapper from claimJobStart made Supervisor see !ok with undefined fields and killed MEDIUM/HIGH --bead startup before run_start.

### bun-test-no-runif-bun-s-test-runner
bun-test-no-runif: Bun's test runner does not support it.runIf() — that is Vitest-only API. Use ternary pattern instead: (condition ? it : it.skip)('name', fn). Executors using Vitest docs will generate it.runIf() which silently errors in Bun.

### bun-vitest-esm-spyon-node-fs-vi-mock
bun-vitest-esm-spyon-node-fs: vi.mock('node:fs') is also required for vi.spyOn(fs, 'readFileSync') to work — node:fs exports are ESM bindings like node:child_process. Pattern applies to ALL node: built-ins. Any test file that vi.spyOn's a node: module needs vi.mock at top. Files fixed: run.test.ts (node:fs + node:crypto + node:child_process + tmux-utils), tmux-utils.test.ts (node:child_process).

### bun-vitest-esm-spyon-vi-spyon-on-esm
bun-vitest-esm-spyon: vi.spyOn on ESM named exports fails with 'Cannot replace module namespace binding' in Bun/vitest. Fix: add vi.mock('node:module-name', async (importOriginal) => { const actual = await importOriginal(); return { ...actual }; }) at module scope — this makes the spread copy mutable. Then capture the real function BEFORE calling vi.spyOn (const real = module.fn) to avoid infinite recursion in the mock body.

### cannot-chain-bd-close-and-git-commit-in
Cannot chain bd close and git commit in a single && command — the beads commit gate hook fires before bd close completes, blocking the commit. Always close the bead in a separate command FIRST, then run git commit separately.

### canonical-pipeline-not-overlay-chain-templates-md-treats
canonical-pipeline-not-overlay: chain-templates.md treats Iron + QA as CANONICAL pipeline steps (not opt-in 'overlays'). Iron already in production via using-specialists-v3 SKILL; QA imminent-canonical via sfwe1. Severity (low|medium|high|critical) modulates depth (which canonical steps fire), NOT whether the pipeline exists. The 'overlay' framing was leaky historical residue from when Iron/QA were introduced as 'hardening additions' — in a canonical doc that framing implies opt-in/modularity that doesn't exist. The ONLY pending pipeline addition is DevOps gates (chain-templates.md §4). Engineering composition mechanism (how dispatcher resolves chain shape) is in §5 — that's where 'compose' vocabulary lives, not in the user-facing pipeline description.

### catalog-default-overrides-commit-b463f94d-5d3bd4ed-specialis
Catalog default_overrides (commit b463f94d+5d3bd4ed): .specialists/catalog/index.json grew default_overrides field. Resolver merge order: catalog default ⊕ specialist override (override takes precedence). Layer attribution shows 'catalog_default' distinct from 'specialist_override' in resolution-diagnostics. Default deny: grep,find,ls,read for all four tiers (matches Serena runtime enforcement). Auto-restore on extension unhealthy still works via the catalog_default attribution layer. WART: sp config show via global npm dist is stale; use bunx tsx src/index.ts config show <name> --resolved for worktree-source verification.

### catalog-default-overrides-now-carry-runtime-native-deny
Catalog default_overrides now carry runtime-native deny baseline; specialist permissions replace catalog default for tier, so explicit overrides must repeat any native denies they still want.

### caveman-micro-85-token-terse-output-directive-injected
caveman-micro: 85-token terse output directive injected at all specialist spawns via runner.ts. March 2026 study shows brevity improves agent accuracy +26pp and cuts tokens ~65%. All specialist output is agent-to-agent so no human readability tradeoff. Sources: github.com/JuliusBrussee/caveman, github.com/kuba-guzik/caveman-micro

### cch-tagetik-is-wolters-kluwer-cpm-platform-aws
CCH Tagetik is Wolters Kluwer CPM platform; AWS relevance is real: AWS Marketplace private offer, AWS global technology partner, and public AWS Summit 2024 speaker post about cloud journey with AWS.

### cch-tagetik-scoping-unitai-544sf-7-wolters-kluwer
CCH Tagetik scoping (unitAI-544sf.7): = Wolters Kluwer Corporate Performance Management (CPM) suite — financial close, consolidation, planning, reporting, analytics, ESG/regulatory reporting; 'single unified platform' with embedded AI, deployed on AWS. AWS relevance is REAL: AWS Global Technology Partner + AWS Marketplace listing + AWS Summit 2024 'cloud journey with AWS' speaker post (no official summit agenda page found naming it — inferred). Relevance to xtrm: only if xtrm cares about enterprise finance/reporting/consolidation/FinOps (likely a mercury/finance-stack tie, not specialists-core). Recommend deeper bead ONLY if that direction matters. Sources: wolterskluwer.com/en/solutions/cch-tagetik (+/partners), aws marketplace prodview-mdvoxqy2qj6zy (accessed 2026-05-29).

### chained-bead-pipeline-is-the-standard-orchestration-pattern
Chained bead pipeline is the standard orchestration pattern: every specialist run gets its own child bead chained via deps. --context-depth 2 passes upstream output downstream automatically. Reviewer uses --job to auto-resolve bead context from executor job. Fix loop creates new child bead with dep on impl bead, runs in same worktree via --job.

### changelog-keeper-now-gets-bounded-xt-report-bundles
changelog-keeper now gets bounded xt report bundles from pre-script injection, so release drafts can be WHY-grounded without reading source or git log.-

### changelog-keeper-output-quality-is-dominated-by-the
changelog-keeper output quality is dominated by the prompt's fidelity rule, not the model. Default keeper prompts that say 'prefer merged bullets' or 'prefer user-facing language' produce thematic 12-bullet summaries of 70+ commits. Adding an explicit 'every substantive commit must appear as its own bullet; substantive = not matching ^(merge|checkpoint|prep state|session report|bookkeeping)' rule, plus inlining the JSON output schema literally in the prompt, lifted bullet count from 12 to 74 on the same input range with the same model.

### changelog-keeper-rewritten-to-medium-specialist-v2-0
changelog-keeper rewritten to MEDIUM specialist (v2.0.0) doing end-to-end release: read xt reports, draft CHANGELOG, bump package.json, build, commit, tag, push. Enforced by changelog-keeper-scope mandatory rule (edit whitelist: CHANGELOG.md, package.json, dist/). Operator gate is git diff --stat HEAD~1 HEAD via the releasing skill. Replaces sp release prepare/publish CLI (deleted). Synthesis input is xt reports under .xtrm/reports/, not git log + bd query.

### changelog-keeper-specialist-should-keep-pre-script-evidence
changelog-keeper specialist should keep pre-script evidence deterministic and map conventional commits to Keep-a-Changelog sections with markdown output plus JSON post-processing schema.

### changelog-md-gap-v3-9-0-v3-10
CHANGELOG.md gap (v3.9.0/v3.10.0) backfilled manually using git log <prev>..<next> commit lists + xt reports for context. Specialist v2 changelog-keeper is designed for go-forward releases only (bumps version + tags + pushes); historical backfill is a one-time job better done by hand than by retrofitting backfill mode into the spec.

### changelog-md-seeded-at-v3-8-0-keep
CHANGELOG.md seeded at v3.8.0 (Keep-a-Changelog v1.1.0). [Unreleased] empty; ## [3.8.0] - 2026-04-26 covers specialists-service v1 ship + hardening from .xtrm/reports/2026-04-26-{523fc559,2cd6af43}.md. Compare links anchored to github.com/Jaggerxtrm/specialists. fln4q-epic intentionally excluded. Future changelog-keeper specialist appends to [Unreleased].

### changelog-release-drafting-needs-separate-read-only-speciali
changelog release drafting needs separate READ_ONLY specialist; interactive changelog-keeper stays publish-only, changelog-drafter is script-safe for sp script.

### claude-code-hooks-were-duplicated-between-claude-settings
Claude Code hooks were duplicated between ~/.claude/settings.json and project .claude/settings.json — both registered the same hook events pointing at parallel copies of the same scripts (~/.xtrm/hooks/* vs ./.xtrm/hooks/*). Result: every PreToolUse/PostToolUse/Stop fired twice and Stop hook feedback messages printed both paths. Resolution 2026-05-09: stripped 'hooks' block + 'statusLine' from ~/.claude/settings.json (kept permissions/plugins/marketplaces); deleted ~/.xtrm/hooks/ directory entirely. Backups: ~/.claude/settings.json.bak-2026-05-09 + /tmp/global-xtrm-hooks-backup-2026-05-09. Project hooks fire once each. New projects without their own .xtrm/hooks/ + .claude/settings.json hooks block will have NO hooks (was: inherited from global). Trade-off accepted: per-project hook registration is the desired model.

### claude-md-xtrm-start-xtrm-end-blocks-are
CLAUDE.md xtrm:start..xtrm:end blocks are already byte-identical across ~/dev, ~/dev/specialists, ~/dev/xtrm-tools — same Edit string applies to all three. Confirmed pre-edit via diff. Makes multi-repo CLAUDE.md sync trivial when changes stay inside the existing sentinel region. AGENTS.md mirrors drift independently (specialists/AGENTS.md says 'extensions enforce these' instead of 'hooks'; xtrm-tools/AGENTS.md has OpenWolf preamble that CLAUDE.md lacks).

### cli-help-tests-in-specialists-are-more-reliable
CLI help tests in specialists are more reliable when they execute dist/index.js via execFileSync instead of re-importing src/index.ts under Bun/Vitest; this avoids module-cache and argv mocking fragility for top-level help assertions.

### cli-native-coordinator-e2e-gap-static-members-in
CLI-native coordinator E2E gap: static members in node config bypass spawn-member entirely — coordinator never exercises sp node spawn-member or wait-phase because members are pre-seeded by on_start triggers. To fully validate the CLI command surface, need a node config with NO static members so coordinator MUST call spawn-member. Also: sp node complete succeeds even while members are still running (overthinker was still active when coordinator completed) — may need a pre-completion check that all members are terminal.

### cli-reference-sync-april-2026-updated-docs-cli
cli-reference-sync-april-2026: Updated docs/cli-reference.md v1.7.0 with sp edit dot-path syntax, --preset/--list-presets, --append/--remove/--file/--get flags, sp config deprecation notice, and JSON format references. Synced at 9648ffae.

### cli-stop-sibling-skip-now-persists-supervisor-meta
CLI stop sibling-skip now persists supervisor meta event before stdout skip message; supervisor.emitMetaEvent added for reusable persistence path.

### code-sanity-338980-found-json-output-contract-diff
code-sanity 338980 found JSON output contract diff OK: response_format=json injection is narrow; deeper schema enforcement remains existing required-key validation and can be revisited separately if full JSON Schema validation becomes needed.

### code-sanity-specialist-promoted-to-mandatory-seconder-gate
code-sanity specialist promoted to mandatory seconder gate (Iron-style). Description and prompt reflect: reviewer treats OK verdict as pre-condition for PASS on production diffs; skip only allowed for test-only or new-file-only diffs. Output schema unchanged (OK|FINDINGS|BLOCKED). 'seconder' added to tags. config/specialists/code-sanity.specialist.json updated 2026-05-25.

### collectstalespecialistjobs-now-has-dead-toolchain-path-keyed
collectStaleSpecialistJobs now has dead-toolchain path keyed off MAX(tool,think) activity; optional source method keeps simple stubs compatible.

### console-error-in-node-doesn-t-route-through
console.error() in Node doesn't route through vi.spyOn(process.stderr,'write') — stderr tests that assert on console.error output must spy on console.error directly. Pre-existing tests in run.test.ts worked because code wrote via process.stderr.write directly (completion footer). New guard code used console.error, breaking the test pattern. Fix: use vi.spyOn(console,'error') + extract via consoleError.mock.calls.map(args => args.join(' ')).

### context-depth-default-3-231x-changed-context-depth
context-depth-default-3-231x: Changed --context-depth default from 1 to 3 across CLI (run.ts:80), runner fallback (runner.ts:818), help text (index.ts, help.ts). Override with --context-depth 0. Existing explicit --context-depth 2 in skill docs still works (explicit wins).

### conversations-design-docs-design-conversations-md-sequenced
Conversations design (docs/design/conversations.md) sequenced v0→v3. Hard invariant for v2: inside a node workstream, mailbox messages enqueue intent into a supervisor inbox; node-supervisor is the sole scheduler. Pair-talk workstreams keep direct runner wakeups. Critique on bead unitAI-jzhim.

### conversations-md-design-invariants-read-ack-separation-reads
conversations.md design invariants: read/ack separation (readSince is observation-only, markSeen is effectful with cursor-through-N), authority lane per participant (one MailboxClient per job), body-text authority always rejected (downgraded to kind=note), system.epoch_bump triggers role re-read before next mutation. These came from Statecraft/Envoy pattern analysis.

### conversations-md-judge-design-judge-timeout-n-default
conversations.md judge design: judge_timeout:N (default 3 ticks) auto-emits system.continue when silent, making the judge eventually-consistent not a blocking gate. Rationale comes from Jonas Templestein (Iterate) observing that before-hooks in Claude/OpenCode caused real perf regressions and cost spikes via broken context caching. Bounded-latency eventual consistency is the deliberate alternative.

### conversations-md-mailbox-waiting-loop-reducer-must-be
conversations.md mailbox waiting loop: reducer must be pure (no side effects, no LLM calls) — all side effects go in the after-hook gated on idempotency keys. If violated, a job crash between 'enqueue resume' and markSeen causes a duplicate LLM call on replay. This constraint is invisible from code structure alone and easy to miss when writing the v0 waiting loop.

### ctl0o-fixed-by-1phu7-detached-pi-group-sigkill
ctl0o-fixed-by-1phu7-detached-pi-group-sigkill: gitnexus-mcp leak fixed by unitAI-1phu7 (commit b12dd0fc 'fix(pi/session): plug gitnexus-mcp leak via group-SIGKILL backstop'). src/pi/session.ts:671 spawns pi with detached:true, line 1186 escalates to process.kill(-proc.pid, 'SIGKILL') group kill on 8s timeout. ctl0o verified covered.

### cww2s-asset-contract-generator
cww2s: scripts/generate-asset-contract.mjs produces deterministic dist/asset-contract.json with schema_version, package_version, sha256-hashed shipped_skills/specialists/mandatory_rules/catalogs/nodes/hooks. No wall-clock timestamps. CI assert lists asset-contract.json. xtrm-tools can validate vendor mirror against this manifest.

### dead-pid-recovery-for-node-tagged-jobs-must
Dead PID recovery for node-tagged jobs must be terminal error; waiting/recovery_pending causes wait-phase deadlock.

### debugger-specialist-auto-creates-its-own-child-beads
Debugger specialist auto-creates its own child beads (e.g. cq10, g8vn, iciu) during runs — these are duplicates of the orchestrator's beads. Close them as duplicates after debugger completes to avoid stale in_progress clutter.

### dependabot-docker-github-actions-smoke-failures-in-specialis
Dependabot Docker/GitHub Actions smoke failures in specialists can be Dockerfile builder-context drift: bun run build needs config/ and scripts/generate-asset-contract.mjs because generate:contract writes dist/asset-contract.json.

### dependabot-npm-prs-in-specialists-need-bun-lock
Dependabot npm PRs in specialists need bun.lock/dist fixups because Dependabot updates package.json only. Safe examples: #85 yaml/@types-bun and #87 @types-node pass after bun install + build. Zod 4 and TypeScript 6 are migrations, not safe auto-merges.

### design-canon-promotion-pattern-cross-cutting-design-docs
design-canon-promotion-pattern: Cross-cutting design docs that span both pre-substrate roadmap and substrate-canonical future belong at docs/design/ TOP-LEVEL (not inside roadmap/ or substrate/). Pair with MD + HTML companion (substrate.html visual style, NOT pandoc-rendered, NOT byte-mirror — two views with different roles: MD = referential source-of-truth with mermaid, HTML = editorial narrative with custom .flow/.overlay-stack visuals). Both reference each other; neither is a render of the other. Pattern established by docs/design/chain-templates.{md,html} 2026-05-30 absorbing iron-review-hardening.html + iron-review-hardening-qa-chain-substrate.md. Roadmap and substrate primitive docs both reference the canonical as authority for catalog/overlay semantics; the canonical itself describes the philosophy both sides agree on. Living document — revision history at end tracks substantive folds.

### diagnose-loop-mandatory-rule-absorbs-debugger-discipline-fas
diagnose-loop mandatory rule absorbs debugger discipline (fast feedback loop, 3-5 falsifiable hypotheses, [DEBUG-<id>] tagged instrumentation removed before completion, convert minimized repro to regression test only when a correct seam exists; otherwise route to overthinker/planner). debugger-trace-first rule was deleted in this round — diagnose-loop is its successor. Source: tytob (unitAI-tytob) overthinker analysis based on Matt Pocock's diagnose discipline. Orchestration counterpart: 'Bug Diagnosis Chain' section in config/skills/using-specialists-v3/SKILL.md tells orchestrator NOT to dispatch executor while bug cause is unknown — chain is test-runner→debugger→code-sanity/security-auditor→reviewer, with overthinker/planner for architecture/testability fallout.

### diagnostic-exploration-beads-should-be-closed-once-their
Diagnostic exploration beads should be closed once their findings are captured in notes and the underlying implementation bug is already closed; keeping them open creates stale tracking noise.

### dnqas-release-gate-workflow
dnqas: .github/workflows/release-gate.yml — paths-filter on cross-repo asset paths, asset-contract byte-equality check via bun run generate:contract, repository_dispatch to Jaggerxtrm/xtrm-tools with XTRM_TOOLS_DISPATCH_PAT secret. Requires operator to configure PAT in repo secrets. YAML validated via python yaml.safe_load.

### do-not-keep-stale-sync-docs-worktrees-or
Do not keep stale sync-docs worktrees or path shims around. If sync-docs worktrees point at old xtrm-tools paths, remove/prune the stale worktrees and relaunch from current repo state rather than preserving compatibility symlinks.

### doc-guidance-integration-tests-should-assert-both-markdown
Doc-guidance integration tests should assert both markdown ownership contracts and real CLI help/validate output to catch drift across docs and runtime semantics.

### dockerfile-bakes-healthcheck-using-node-e-fetch-on
Dockerfile bakes HEALTHCHECK using node -e fetch on /healthz port 8000 (no curl/wget — bun:slim image has neither). Format: HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "-e", "fetch('http://127.0.0.1:8000/healthz').then(...)"]. Verified live with docker run: container reports 'healthy' within 12s. Operators dropping the image into compose now inherit health reporting; explicit compose-level healthcheck only needed when overriding the listen port. Pre-fix darth-feedor compose hit a wget-based healthcheck trap (silent permanent-unhealthy). Avoid CMD-SHELL form — image is minimal.

### docs-drift-reconciliation-2026-05-15-after-v3
Docs drift reconciliation 2026-05-15: after v3.14-v3.15 releases, README and high-traffic docs needed updates for package-canonical defaults, xtrm-tools prerequisite/install order, current specialist roster/models, sync-docs single-doc invariant, DB-first runtime/feed/ps behavior, and retired docs links. drift_detector scan count should be 0 after stamping reviewed docs.

### docs-specialists-service-install-now-reflects-current-subpro
docs/specialists-service-install now reflects current subprocess runner path: pi CLI child, pinned @mariozechner/pi-coding-agent@0.64.0, SDK-backed execution only future work.

### dolt-auto-push-warning-b0bc6-3-bd-v0
Dolt auto-push warning (b0bc6.3): bd v0.59.0 ignores dolt.auto_push=false config; warning is wired into bd code path. Real fix is upstream. Workarounds: (1) configure DoltHub creds, (2) remove remote in .beads/dolt, (3) shell-alias filter via grep -v. Documented in bead notes.

### dpf3a-sp-merge-tsc-gate-tsconfig-check
dpf3a-sp-merge-tsc-gate-tsconfig-check: GH#71 fix. src/cli/merge.ts runTypecheckGate now checks for tsconfig.json before running bunx tsc --noEmit. Without tsconfig, logs 'TypeScript gate: skipped (no tsconfig)' and returns clean. Unblocks markdown/notes/non-TS repos. 23/23 merge.test.ts pass.

### drs41-1-kpi-auto-aggregate-insight-supervisorstatus-uses
drs41.1 KPI auto-aggregate insight: SupervisorStatus uses last_event_at_ms (not updated_at_ms) — easy to miss when authoring tests. Synthetic-timeline tests should NOT assert active+waiting=elapsed strictly because elapsed includes startup time (started_at_ms → first run_start) that's neither active nor waiting; use <= instead. supervisor.test.ts has bun+vitest mock incompatibility on master (importOriginal undefined) — file is excluded from default vitest run; per-test bun runs work. Schema migrateToV11 added active_runtime_ms + waiting_ms columns; aggregateJobMetricsBestEffort wired into supervisor.ts terminal path AND src/cli/stop.ts.

### dynamic-self-organizing-agent-workflows-research-unitai-544s
Dynamic/self-organizing agent workflows research (unitAI-544sf.1): three references — Claude dynamic workflows (code.claude.com/docs/en/workflows: JS script, background runtime, ≤1000 subagents, script-var intermediates, resumable, no mid-run user input), Anthropic multi-agent research system (lead agent spawns subagents, plan in memory, subagents write external artifacts + pass lightweight refs, ~15× token cost vs chat), AutoScientists/Harvard (arxiv 2605.28655 + mims-harvard/AutoScientists repo: shared experimental state via posts/comments/workspaces as message bus, self-organize into hypothesis teams, stateless between sessions, stagnation/timeout salvage). RECOMMENDATION for xtrm/substrate: keep policy-driven step-insert (substrate §4.3) as DEFAULT; add a 'research/dynamic' chain class only as OPT-IN catalog entry for open-ended research loops (runtime branching, fresh subteams, shared external memory, explicit stagnation stop). Good fit for mercury-style breadth-first source-dive pipelines; bad fit when same-context tight coupling dominates. Risk: token blowup + weak long-chain context (substrate §4.3 no cross-session journal).

### earendil-works-pi-tui-not-mariozechner-pi-tui
@earendil-works/pi-tui (NOT @mariozechner/pi-tui — that namespace only has clipboard) is the TUI primitive package. Add as DIRECT dep of @jaggerxtrm/specialists when building sp chat; pi-coding-agent doesn't re-export TUI/Input/Editor/matchesKey. Pin major/minor to installed pi-coding-agent (currently 0.75.4) to avoid component drift. Key primitives: TUI+ProcessTerminal+Container, Input/Editor (Editor has history+multiline), addInputListener for Ctrl+C intercept, wrapTextWithAnsi for ANSI preservation, requestRender for status redraw. TUI.stop()+ProcessTerminal.stop() handle teardown but caller must wire SIGTERM/SIGHUP/uncaughtException/unhandledRejection (copy pi's interactive guard pattern).

### edit-capable-specialists-must-run-with-worktree-flag
edit-capable specialists MUST run with --worktree flag. 9 debuggers ran on main without worktrees, 3 of 9 fixes were lost because last-writer-wins on shared files. HIGH permission = always --worktree. This is not optional.

### edit-gate-hook-requires-session-scoped-kv-claim
Edit gate hook requires session-scoped KV claim: bd kv set session-claim:<session-id> <bead-id>. Just bd update --claim is not enough — the hook checks bd kv for the session ID. Without this KV, all Edit/Write tools are blocked even with an in_progress bead.

### env-gated-file-fallback-broke-file-backed-tests
Env-gated file fallback broke file-backed tests: set SPECIALISTS_JOB_FILE_OUTPUT=on for file fixture expectations, add off-mode assertions for unknown/empty behavior.

### epic-iron-review-hardening-unitai-kglvm-complete-2026
Epic iron-review-hardening (unitAI-kglvm) complete 2026-05-25. Adopted Iron concepts in pipeline: SCRUTINY tiers in reviewer + skill, ddiff re-review mode, code-sanity promoted to mandatory seconder, NEW obligations-scanner specialist, executor+debugger taught obligations discipline (structured TODO(bead-id) format), reviewer outputs Release Checklist. Removed sp merge/sp epic merge/sp finalize from skill (rule #9 inverted) — manual git workflow + Cherry-Pick Playbook are canonical. Rule #14 added: Git State Precondition before any dependent chain dispatch. Rule #13 exception clause added for epics restructuring specialists themselves. All commits: adb3c51a + 09a321d0 + 079e8c62 on master. Design doc: docs/design/iron-review-hardening.html.

### execution-expected-output-keys-string-added-to-script
execution.expected_output_keys (string[]) added to script-class spec schema and validated by runScriptSpecialist. When set, runtime parses assistant text as JSON (after stripMarkdownFences) and checks every listed key is present, regardless of response_format. On miss returns error_type:'invalid_json' with the missing key name. Unions with prompt.output_schema.required when response_format is 'json'. Catches the saved-but-corrupt failure mode where text-format specs with inline JSON contract accept hallucinated key sets. Helper: collectRequiredOutputKeys(spec). Example spec: docs/examples/smoke-echo-text-expected-keys.specialist.json. Documented in docs/authoring.md.

### executor-and-debugger-specialists-now-have-obligations-disci
executor and debugger specialists now have Obligations discipline section: do NOT introduce in-code TODO/FIXME/HACK/etc markers in production by default. File follow-up bead via 'bd create --deps discovered-from:<current>' instead. Exception: structured '// TODO(<bead-id>): reason' format where bead exists AND is in current bead's NON_GOALS. Test/fixture paths exempt (test/, tests/, __tests__/, *.spec.*, *.test.*, *.fixture.*, fixtures/, mocks/, e2e/, docs/). Prevents PARTIAL fix-loop from obligations-scanner gate.

### executor-bead-notes-exclude-supervisor-test-when-dispatching
executor-bead-notes-exclude-supervisor-test: When dispatching any executor that touches src/specialist/ or runs the full test suite, explicitly add to bead notes: 'Exclude tests/unit/specialist/supervisor.test.ts from vitest runs — pre-existing FIFO readline hang kills the process.' Without this, executors include it, vitest hangs 120s, bash timeout kills the session, and the job crashes after completing all implementation work.

### executor-benchmark-protocol-doc-must-use-non-anthropic
Executor benchmark protocol doc must use non-Anthropic cheaper challengers; include frozen snapshot corpus and quality-floor-first decision rule.

### executor-gpt-codex-copy-paste-bugs-are-common
executor (gpt-codex) copy-paste bugs are common in YAML→JSON migrations — always verify fallback paths reference the correct extension. The loader bug (za41) was .specialist.json used for both JSON and YAML paths.

### executor-keep-alive-insight-executors-should-default-to
executor-keep-alive-insight: Executors should default to keep-alive (interactive: true). When executor bails early (e.g. GitNexus CRITICAL risk warning), orchestrator can resume instead of re-dispatching entirely. Orchestrator must explicitly stop when done. Filed as unitAI-1k8w.

### executor-keep-alive-s-success-terminal-state-is
Executor --keep-alive's success terminal state IS 'waiting', by design (resumable for PARTIAL fix loops). No code path consumes 'reviewer verdict=PASS' to terminate the keep-alive executor. The two state machines (executor lifecycle, chain readiness) are decoupled and there is no finalizer between them. This is the structural cause of the deadlock — not a bug in any single file, an absence between files. Any redesign must add the missing finalizer (auto on PASS, or sp finalize command, or both).

### executor-specialist-crashes-at-13min-on-large-tasks
executor specialist crashes at ~13min on large tasks (context limit). Pattern seen twice on 08zd. Mitigation: break large epics into explicit Phase sub-beads before dispatching. Each executor run should target a single well-scoped phase, not an entire epic.

### executor-specialist-gpt-5-3-codex-high-permission
executor specialist: gpt-5.3-codex, HIGH permission, 120s stall timeout. Works autonomously via --bead <issue-id>. Needs directive prompts (DO NOT ASK FOR CONFIRMATION) to avoid Proceed?/Yes/No blocks. Successfully fixed 3 bugs autonomously (jzg6, 08la.3, 1ajm). The specialist-creator also works on gpt-5.3-codex but --background mode stalls (use foreground only).

### executor-specialist-json-must-not-instruct-broad-staging
executor.specialist.json must not instruct broad staging; runtime auto_commit checkpoint already filters noisy paths, so manual staging guidance must stay explicit-path only.

### executor-specialist-must-not-run-npm-test-vitest
Executor specialist must NOT run npm test/vitest/bun test — tests hang on supervisor.test.ts FIFO cleanup (EBADF). Tests belong to reviewer/test-runner in the chained pipeline. Executor runs lint+tsc only. Fixed in executor.specialist.yaml workflow section.

### executor-staging-hardening-dmu9q-executor-specialist-json-sy
executor-staging-hardening-dmu9q: executor.specialist.json system_prompt no longer instructs git add -A; Workflow Step 5 now prefers runtime auto_commit checkpoint_on_waiting + explicit-path manual staging. Testing Awareness adds staging-discipline + self-verify (git diff --cached --name-only vs bead SCOPE). Bans manual staging of .beads/, .xtrm/, .wolf/, .specialists/jobs/, .pi/. Merge commit 0c863a58. Companion: xtrm-tools .beads provisioning + bd .beads-credential-key tracking still open.

### executor-worktree-jobs-may-complete-edits-but-not
Executor worktree jobs may complete edits but not commit — the executor closes the bead and enters waiting but leaves changes unstaged. Orchestrator must check git status in the worktree and commit manually before merging. Observed in all 4 waves of unitAI-om8x audit (2026-04-09).

### explorer-hard-deny-rollout-belongs-in-specialist-permissions
Explorer hard-deny rollout belongs in specialist permissions only: deny grep/find/ls in READ_ONLY hard mode, keep read soft, and revert by removing explorer permissions block without touching generic deny engine.

### extractreleasedraft-must-1-handle-both-section-shapes-schema
extractReleaseDraft must (1) handle BOTH section shapes — schema's {added:[],...} and array-of-{name,bullets} — and (2) fall through to parseMarkdownDraft when JSON parses but normalization yields nothing. gpt-5.4-mini ignores output_schema and emits the array shape; defensive parser tolerates model-fidelity drift across model swaps.

### feed-follow-loop-using-readevents-each-tick-breaks
Feed follow loop using readEvents() each tick breaks incremental-read contract; reviewer must flag steady-state full-history rereads.

### final-sp-ps-clean-semantics-are-documented-in
Final sp ps/clean semantics are documented in both CLI help and config/skills/using-specialists-v3; keep them in sync whenever dashboard visibility behavior changes.

### final-sp-ps-dashboard-semantics-default-shows-active
Final sp ps dashboard semantics: default shows active jobs plus unresolved error/cancelled terminal jobs; sp clean --ps soft-hides terminal rows via ps_hidden_at metadata without deleting DB history; --include-cleaned/--all show hidden history.

### fln4q-a-complete-4-commits-on-feature-unitai
fln4q-A complete: 4 commits on feature/unitAI-fln4q-executor (70027858 DB-first crashRecovery + readers; 9cf29c0e wym03 test gates; 5521cc22 c9he9+n17dw env-gates and attach UX; 8ce14c16 n878q DB-first events). All tsc/build/tests green. Reviewer effectively PASS — soft caveats are infra (gitnexus traceability, missing sp result artifact). Branch ready for merge once main repo clean.

### fln4q-split-into-a-unitai-fln4q-crashrecovery-13
fln4q split into A (unitAI-fln4q): crashRecovery + 13 easy readers + 24 tests + runtime-mode surface; B (unitAI-1ypy2): detached watchdog DB parity + cleanupProcesses + clean.ts GC + timeline-query + worktree-gc. ppkdg blocks on both. A and B can run in parallel (disjoint scopes). Watchdog is highest-risk: detached subprocess needs SQLite or IPC channel.

### for-bead-happy-path-validation-a-live-smoke
For --bead happy-path validation, a live smoke test should confirm the footer references the input bead and bd show on that bead has no new specialist dependent; this verifies single-bead orchestration without runner-created tracking beads.

### for-long-specialist-chains-when-executor-context-exceeds
For long specialist chains, when executor context exceeds practical limits, launch a fresh executor in the same worktree via --job for commit-only handoff after reviewer PASS; preserves diff integrity and avoids context-rot mistakes.

### for-pi-session-stall-watchdogs-arm-the-timer
For Pi session stall watchdogs, arm the timer at prompt/resume time (not process start) and reset on each parsed RPC event to avoid false positives during idle pre-prompt periods.

### fresh-specialists-repo-clones-need-xtrm-registry-json
Fresh specialists repo clones need .xtrm/registry.json committed; without it xt doctor/update cannot sync xtrm-managed skills/hooks after pull.

### ftu5-keep-specialist-jobs-json-first-promote-only
ftu5: keep specialist_jobs JSON-first; promote only operational filter/join fields (status, bead_id, node_id, updated_at_ms, plus existing specialist/worktree cache), leave model/backend/metrics/gitnexus rollups in status_json until measured query pressure

### git-state-precondition-for-chain-dispatch-orchestrator-must
Git-state precondition for chain dispatch: orchestrator MUST verify (1) git status clean, (2) HEAD contains prior chain commits, (3) no orphaned worktrees, (4) on integration branch HEAD is in sync, BEFORE dispatching any chain that depends on prior chain work. Specialist worktrees fork from current HEAD at dispatch; stale base = guaranteed debugger-restitch later. Applies strict to sequential-dependency chains and to chains-after-orchestrator-direct-edits.

### gitnexus-adoption-query-specialists-use-gitnexus-via-both
gitnexus-adoption-query: specialists use gitnexus via BOTH MCP tools (gitnexus_query, gitnexus_impact) AND bash CLI (gitnexus query, gitnexus impact). DB monitoring must check both: MCP via specialist_events WHERE tool LIKE '%gitnexus%', CLI via tool='bash' AND result_summary LIKE '%gitnexus%'. All-time adoption with both methods: explorer 29.2%, executor 21.6% (mostly CLI), debugger 20.0%, sync-docs 20.0%. Reviewer 0%, overthinker 0%, code-review 0%. Executor prefers CLI over MCP tools.

### gitnexus-cheatsheet-injected-at-specialist-spawn-when-gitnex
GitNexus cheatsheet injected at specialist spawn when .gitnexus/meta.json exists — reminds specialists to run impact analysis before editing

### gitnexus-detect-changes-command-may-be-unavailable-in
GitNexus detect_changes command may be unavailable in some specialist envs; reviewer should treat as tooling limitation if impact/context plus diff evidence exists.

### gitnexus-exploring-skill-was-broken-xtrm-skills-default
gitnexus-exploring-skill-was-broken: .xtrm/skills/default/gitnexus-exploring was missing — symlink from active/pi/ was dangling. Explorer and overthinker ran without their primary gitnexus skill. Fixed 2026-04-15 by syncing from .claude/skills/gitnexus/. Also synced gitnexus-guide and gitnexus-cli which were missing from default/. Root cause: sp init --sync-skills doesn't sync .claude/skills/gitnexus/* to .xtrm/skills/default/ — only config/skills/ sources get synced.

### gitnexus-rpc-extraction-impl-full-pipeline-landed-in
gitnexus-rpc-extraction-impl: Full pipeline landed in commit c601a032 (merged 23e4d875). onToolEnd 5th param resultRaw flows session→runner→supervisor. gitnexusAccumulator in supervisor.ts collects files_touched/symbols_analyzed/highest_risk across a run. gitnexus_summary emitted in run_complete only when tool_invocations>0. edit/write tool resultRaw.path auto-captured as files_touched. All additive/backward-compatible.

### gitnexus-rpc-extraction-pi-rpc-tool-execution-end
gitnexus-rpc-extraction: Pi RPC tool_execution_end contains FULL event.result for all tools including gitnexus MCP. findToolResultContent() in session.ts discards structure, keeps only 500-char text. Files/symbols/risk are available but not captured. Fix: extend onToolEnd signature, add gitnexus accumulator in supervisor.ts, add result_raw to TimelineEventTool. No protocol changes needed — extraction layer only. Tracked in unitAI-g5np.

### global-specialist-overrides-design-unitai-o328h-package-cano
Global specialist overrides design (unitAI-o328h): package canonical ships with model=null — no model values in config/specialists/*.specialist.json. Models are user-env-specific (each user has own pi OAuth/API). User config lives in single ~/.config/specialists/user.json generated by sp init --global, listing all specialists + modifiable fields. Loader hard-fails if model still null after merge. Repo .specialists/user/ still wins as top layer.

### globally-installed-binary-shadows-dist-changes-when-speciali
globally-installed-binary-shadows-dist-changes: When specialists is installed globally (npm install -g .), executors call the installed binary at ~/.nvm/.../bin/specialists, NOT dist/index.js. Source changes have zero effect until npm install -g . is re-run. All guard fixes were bypassed for an entire session because of this. Always reinstall after guard/init changes: bun run build && npm install -g .

### graphify-taskprep-design-session-do-not-query-graphify
Graphify/TaskPrep design session: Do not query Graphify/GitNexus/FTS5 with whole bead descriptions; broad bead text distorts retrieval toward generic god nodes. Use scripted anchors plus fast ~27B prep model as strict-JSON query planner for graph_queries and memory_queries, then verify scope with Graphify/GitNexus/Serena and inject compressed traceable memory_pack. Graphify AST-only over src/pi+src/specialist+src/cli+docs/design produced 1,152 nodes/2,661 edges/30 communities/0 model tokens; exact symbol-rich queries worked, broad natural-language queries were noisy. TaskPrep is spawn-time substrate; Shepherd is mid-run sidecar.

### gzrx-design-insight-capability-taxonomy-and-source-tier
gzrx design insight: capability taxonomy and source-tier policy are independent axes. Tools grouped semantically (Meta/Memory/Symbol-nav/Writes) must still be split by mutation effect — admin.serena, memory must each have .read and .write capabilities. Otherwise capability-driven tier policy diverges from source byte-for-byte default. Snapshot tests per tier are the safety net for migrating hardcoded arrays in src/pi/session.ts:225-243.

### gzrx-impl-per-tier-byte-snapshots-are-insufficient
gzrx impl: per-tier byte snapshots are insufficient — need matrix tests across (tier × extension health × specialist override × YAML exclusion). Soft deny is preference/debug only and does NOT fix the explorer-uses-grep problem; hard deny is required but must be gated on replacement capability being healthy AND catalog-compatible. Precedence order to define before resolver: catalog metadata → default tier → project manifest → specialist manifest → specialist YAML availability → runtime health downgrade (most restrictive wins, except health degradation restores native fallback). Health model must be per-capability (Serena partial outage; GitNexus stale-but-callable), not extension-wide on/off.

### gzrx-manifest-impl-safest-phased-board-is-serialized
gzrx manifest impl safest phased board is serialized: foundation -> resolver/tests -> resolved-debug+health -> runtime thread -> soft deny -> hard-deny engine -> explorer rollout -> post-release cleanup.

### gzrx-orchestration-shape-8-phase-children-4-test
gzrx orchestration shape: 8 phase children + 4 test issues under epic unitAI-8vb65. Phases serialized — each gated by reviewer PASS. Phase 1 = precedence comments + catalog files (additive). Phase 2 = resolver lib + matrix tests (additive). Phase 3 = sp config show --resolved + health/drift (additive). Phase 4 = runtime threading behind feature flag. Phase 5+ = soft/hard deny. Phase 8 = legacy array removal, requires one-release parity window. Test issues 8vb65.9-12 pair with phases 1-2/3/4-5/6-8. First dispatch: unitAI-8vb65.1.

### gzrx-phase-1-pr-shape-6-new-files
gzrx phase 1 PR shape: 6 new files (.specialists/catalog/{native,gitnexus,serena,index}.json + src/specialist/tool-catalog.ts + tests). Conflict-resolution semantics §3.0 must be encoded in implementation artifact (header doc comment) and asserted by test, not just precedence order. Per-file catalog parity tests vs src/pi/session.ts arrays deferred to Phase 2.

### gzrx-phase-2-pr-shape-pure-resolver-library
gzrx phase 2 PR shape: pure resolver library (src/specialist/manifest-resolver.ts) + matrix tests. 12 tests pass. Phase 3 must widen ExtensionHealth type to include loaded_degraded and version_mismatch per doc §3.3 — current logic handles them correctly but type is narrow.

### gzrx-reality-check-2026-05-03-pi-serena
gzrx reality check (2026-05-03): pi-serena-tools and pi-gitnexus extensions were silently broken across previous specialist runs — missing transitive deps (cross-spawn, @modelcontextprotocol/sdk) crashed the loader, so tools were advertised in --tools allowlist but never served. Specialists used native grep/read/find by necessity, never Serena/GitNexus. Fixed by npm install in /home/dawid/.nvm/versions/node/v25.2.1/lib/node_modules/{pi-gitnexus,pi-mcp-adapter}/. Implications: (1) Phase 1/2 byte-equivalence is still valid (allowlist string is unchanged regardless of extension health), (2) §1.6 'native read blocked, use Serena' evidence applied only to the one pi harness session where extensions had loaded — most prior specialists ran without Serena, (3) Phase 3 health probes are the first time the system can distinguish 'tool listed in --tools' from 'tool actually serves'. Always check global node_modules for missing transitive deps when extensions appear silent.

### gzrx-tool-resolver-pisessionoptions-now-carries-specialistna
gzrx tool resolver: PiSessionOptions now carries specialistName + specialistPermissions. resolvePermissionTools is the only path; mapPermissionToTools and hardcoded GITNEXUS_*_TOOLS / SERENA_*_TOOLS arrays in src/pi/session.ts are deleted. Resolver default-on, no env-flag opt-in. Per-specialist override flows from runner.ts and use_specialist.tool.ts into PiAgentSession.start. Only config/specialists/explorer.specialist.json declares a permissions[READ_ONLY] block; all other specialists use tier defaults. Verified end-to-end with 8/8 manifest-resolver and 59/59 pi/session vitest passes (qujxo.2).

### handoff-final-block-fix-unitai-mis38-follow-on
Handoff FINAL-block fix (unitAI-mis38, follow-on to 10y07): the canonical [FINAL · DONE] block must be emitted in finalizeWaitingJob (supervisor.ts ~819) on the sp-stop/auto-close path — the natural-termination path (2168/2181) already emitted it but keep-alive jobs ended via sp stop did NOT, so the canonical block never materialized for the dominant keep-alive+stop workflow. Also: keep-alive turn_summary path must SKIP the non-final {final:false} done write (gate on !keepAliveSession) to avoid per-turn [turn N · WORKING]+[turn N · WAITING] double-write. Net for keep-alive: one [turn N · WAITING] per turn + one [FINAL · DONE] at stop. Still open (out of scope here): model-string provider-prefix inconsistency between blocks.

### handoff-final-on-stop-true-root-cause-unitai
Handoff FINAL-on-stop — TRUE root cause (unitAI-mis38, took 5 layers + live re-smoke to find): the canonical [FINAL · DONE] block was never emitted on 'sp stop' because src/specialist/control.ts constructs the Supervisor WITHOUT a beadsClient (line ~50 createFinalizeSupervisor, ~64 stopJob: 'new Supervisor({runner,runOptions,jobsDir})' — no beadsClient), and finalizeWaitingJob guards the emit on 'if(bead_id && this.opts.beadsClient)' → silently skipped. FIX: pass 'beadsClient: new BeadsClient()' to BOTH Supervisor constructions in control.ts. Supporting fixes also needed: stopJob must CALL finalizeWaitingJob when status==='waiting' (sp stop ≠ sp finalize — only finalizeJob called it before); finalizeWaitingJob must source from the result file w/ readResult empty-fallback (SQLite specialist_results is populated via upsertResult but the guard was the real blocker); keep-alive turn_summary must skip the non-final done write to avoid [turn N · WORKING]+[WAITING] duplication. LESSON: unit tests + reviewer PASS are NOT sufficient for this — they passed 3x while live failed; the LIVE keep-alive→resume→sp stop re-smoke (bd show shows [FINAL · DONE]) is the only real acceptance gate. Verified: demo job c9dd35 FINAL=1/WORKING=0/WAITING=2.

### handoff-note-format-is-markdown-native-unitai-yiazs
Handoff note format is markdown-native (unitAI-yiazs): formatHandoffBlock emits NO rule/divider line; trail turns = H3 '### <spec> · <model> · [turn N · WAITING]', FINAL = H2 '## <spec> · <model> · [FINAL · DONE]'; specialist result.output inserted VERBATIM (its markdown/JSON untouched); footer = ONE italic line '_<turn N|final> · <ms> · <in> to <out> tok · <YYYY-MM-DD HH:MM> · git <sha8>_' with empty/zero/unknown fields OMITTED (via footerParts.filter(Boolean)). Model normalized via normalizeHandoffModel(m)=m.split('/').at(-1) (strips provider prefix) consistently across all blocks. getCurrentGitSha cached once. Rationale: the 14-line key=value footer collapsed into a run-on paragraph in GFM/CommonMark and the underscore rule became an <hr> — ugly in markdown viewers. Full telemetry still lives in observability DB + sp result. Tests: supervisor-bead-notes.test.ts asserts no-rule/H2-final/italic-footer/model-normalize/empty-omission.

### handoff-persistence-3-state-model-unitai-10y07-builds
Handoff persistence 3-state model (unitAI-10y07, builds on sx5qk): supervisor.ts formatHandoffBlock(result,{final}) renders light '____' rule + '### 🔬 <spec> · <model> · [turn N · WORKING/WAITING]' for non-final, heavy '════' rule + '### ✅ … [FINAL · DONE]' for final (greppable canonical block). shouldPersistHandoffBlock({output,notesMode,final}) skips empty output + suppresses intermediate turns when notes_mode='final-only'. Per-specialist notes_mode enum in schema.ts: 'full-trail' (default, append every substantive turn) | 'final-only' (only canonical block — for chained-reading pipelines where downstream reads the previous bead note). output_file is SINGLE-WRITER: supervisor owns it in supervised runs (sets runOptions.suppressRunnerFileOutput=true; writes via writeJobFileOutput append/overwrite at supervisor.ts ~1472), runner writes raw final ONLY in script/serve (no supervisor). ONE content source: lastTurnSummaryTextContent (turn_summary.text_content) feeds notes + output_file + sp result. Tests: supervisor-bead-notes.test.ts (formatHandoffBlock + shouldPersistHandoffBlock) + job-file-output.test.ts; NEVER supervisor.test.ts (excluded, FIFO hang).

### handoff-specialists-runtime-cleanup-bead
Handoff bead for specialists-runtime cleanup + substrate-alignment work: unitAI-wxi9e. Points at canonical docs (docs/design/substrate/specialists-roadmap-revised.md, substrate.md rev10, channels.md, chain-templates/) and archived superseded docs (docs/archive/). Three-phase plan: (1) fresh-session validation pass, (2) planning + decomposition via test-planner with recommended_template Pass-2, (3) specialists-auto execution with explicit smoke-test checkpoints after each of 5 phases (rebuild + CLI smoke of new surfaces). Closed decisions D1-D27 in roadmap §0 — do not reopen. 11 opportunities, ~15.5 days for Phases 1-5.

### hard-deny-resolver-now-falls-back-to-native
Hard-deny resolver now falls back to native when extension health is loaded_unhealthy, unknown, disabled, or catalog-incompatible; diagnostics surface downgradeReasons for restore cases.

### hard-rule-never-use-no-worktree-for-any
HARD RULE: Never use --no-worktree for any specialist run. Worktrees are mandatory and non-negotiable for ALL edit-capable specialists. If an executor keeps crashing in a worktree, fix the root cause (reduce context-depth, switch model, diagnose the crash) — do NOT bypass isolation. The --no-worktree flag caused lost work in the 3f7b epic session when parallel merges overwrote uncommitted changes. Worktree isolation protects against this. No exceptions.

### hexstrike-ai-research-unitai-544sf-4-mcp-backed
HexStrike AI research (unitAI-544sf.4): MCP-backed security suite, ~100-150 tools (README 150+ vs MCP header 100+ — marketing, not contract; repo 0x4m4/hexstrike-ai). RECOMMENDATION: adopt ONLY as a gated security-auditor ADJUNCT, NOT baseline security-pipeline (which stays semgrep+osv+gitleaks+dependabot). Integration shape: default-OFF; only inside security-auditor; only on SCRUTINY=critical/high-risk surfaces; split tools into capability tiers (analysis: gdb/ghidra/radare2/binwalk; authorized recon: nmap/nuclei/httpx/trivy/prowler; opt-in offense: hydra/sqlmap/msfvenom/pacu); per-repo opt-in + per-run audit log; needs new pi adapter/catalog (current resolver only knows native+gitnexus+serena). RISK: no built-in auth/sandbox (plain HTTP, alwaysAllow empty by default), offensive tools dangerous on live targets — run isolated VM, require approval token, redact secrets. Start with safe recon+analysis subset only.

### hgpu-worktree-isolation-mvp-merged-to-master-but
hgpu worktree isolation MVP merged to master but test beads (hgpu.6/7) need regeneration — test files were lost during merge cleanup. Blocked by supervisor.test.ts FIFO hang (9n93, quarantined in vitest.config.ts). Also pending: resolveCommonRoot dedup between job-root.ts and worktree.ts.

### highest-leverage-anti-orchestrator-laziness-patch-claude-cod
Highest-leverage anti-orchestrator-laziness patch: Claude Code PostToolUse hook on 'bd create' (~/.claude/hooks/bd-create-hint.sh wired in settings.json). Fires at bead creation when type/scope decision is freshest — BEFORE any specialist is dispatched. Computes: (1) scrutiny inference from keyword scan vs iron SCRUTINY surface table, (2) type-shape mismatch detection (type=bug + description verbs 'implement/add' → suggest type=task), (3) workflow proposal using the 6 default workflows from substrate-review §25.3 hard-coded, (4) specialist resolution via cached 'specialists list --full --json', (5) compatibility cross-check that proposed names exist in registry — closes B4 (invented specialist names blocked at hint time). Hint output: structured 8-line block with chain shape + recommended dispatch command + registry version. Closes B1/B2/B3/B4 directly + D4 bridge. ~1 day implementation, standalone (no daemon/sp/observability.db dependency). Complementary to sp-runtime hints (Layer 3b): 3a fires before specialist picked, 3b fires at/after sp run. Both orthogonal, both needed.

### implemented-specialists-clean-processes-to-stop-running-star
Implemented specialists clean --processes to stop running/starting jobs and mark status.json as error; added supervisor binary_version persistence and session-start stale-binary warning.

### init-migration-changes-must-verify-fs-imports-and
init migration changes must verify fs imports and rebuilt dist before publish; unlinkSync omission caused runtime crash

### initschema-seq-index-migration-ordering-when-adding-new
initSchema seq-index migration ordering: when adding new columns via ALTER TABLE in a later migration (e.g. migrateToV6 adds seq), do NOT reference those columns in CREATE INDEX statements in earlier migrations or in the core initSchema block. CREATE TABLE IF NOT EXISTS skips existing tables, so the new column won't exist until the ALTER TABLE migration runs. Defer seq-dependent indexes to the migration that adds the column. This caused silent SQLite failures for months — createObservabilitySqliteClient caught the error and returned null.

### integration-cli-ownership-tests-use-real-temp-repos
Integration CLI ownership tests: use real temp repos and CLI entrypoint; doctor mirror checks need local config/* sources seeded to assert mismatch categories.

### integration-tests-for-specialists-init-require-specialists-i
Integration tests for specialists init require SPECIALISTS_INIT_FORCE=1 in env because spawnSync runs in non-TTY context and the TTY guard blocks init. Also, test temp dirs must set up the full .xtrm symlink structure (active/claude, active/pi, .claude/skills symlink, .pi/skills symlink) before calling init, since installProjectSkills validates these exist.

### integration-tests-for-worktree-cli-flows-require-isolated
Integration tests for worktree CLI flows require isolated temp git repos with .beads/ dirs, and must strip ANSI codes from CLI output for assertions. Tests for --worktree provisioning require valid bd beads or will fail at bead lookup phase (which happens before worktree provisioning in run.ts).

### iron-qa-extension-design-docs-design-iron-review
Iron QA extension design: docs/design/iron-review-hardening-qa-chain.md defines devops-oriented planner/test-planning -> test-engineer -> test-runner -> Iron gates pipeline; test-engineer writes tests/smoke/telemetry assertions while test-runner stays LOW execution/classification only

### jj7hy-catalog-canonical-move-tool-catalog-gitnexus-index
jj7hy-catalog-canonical-move: tool catalog (gitnexus/index/native/serena.json) git mv'd from .specialists/catalog/ → config/catalog/ to make package-live. loadSharedToolCatalogIndex in src/pi/session.ts now tries cwd .specialists/catalog/index.json (user override) first, then falls back to resolveCanonicalAssetDir('catalog')/index.json (package canonical). Smoked from /tmp non-repo cwd — sp list resolves catalog after npm-install path. Drift-detector references already aligned (packageLabel was already 'package config/catalog'). docs/installation.md Category A now mentions config/catalog/. Merge commit see jj7hy section.

### job-storage-sqlite-not-dolt-specialists-job-run
job-storage-sqlite-not-dolt: specialists job/run storage uses bun:sqlite (unitAI-08zd), NOT Dolt. Dolt is beads-only. Do not propose Dolt for any specialists persistence work.

### keep-alive-status-persistence-on-keep-alive-agent
Keep-alive status persistence: on keep-alive agent_end events, Supervisor must write waiting state immediately to avoid status.json reverting to running after resume turns.

### lifecycle-boundary-keep-piagentsession-as-protocol-liveness
Lifecycle boundary: keep PiAgentSession as protocol+liveness adapter and Supervisor as sole durable lifecycle source (status.json/events.jsonl/result.txt/run_complete); do not let CLI infer completion from mixed signals like agent_end/done.

### linux-page-cache-always-coherent-on-linux-usecache
linux-page-cache-always-coherent: On Linux, useCache:false / openSync+closeSync does NOT bypass the OS page cache — the page cache is always coherent with writes. App-level fd caching (e.g. in feed.ts makeJobMetaReader) is the only layer being bypassed. Renaming to useAppCache is clearer. No need to use O_DIRECT or similar tricks for feed polling correctness.

### list-rules-cli-wv3l9-new-sp-list-rules
list-rules-cli-wv3l9: New 'sp list-rules' command for rule×specialist introspection. Walks tier order .specialists/mandatory-rules/ → .specialists/default/mandatory-rules/ → config/mandatory-rules/ for rule sets, mirrors runner's resolution. Renders matrix (R=required, D=default, x=role-specific, .=not applied), --rule filter, --specialist filter, --json. Detected explorer-readonly as orphan rule (declared but never wired to any spec).

### listsubstantiveworktreefiles-must-not-trim-leading-porcelain
listSubstantiveWorktreeFiles must not trim leading porcelain space; parse path from byte 3 and preserve quoted rename targets

### lqsha-noise-filter-reviewer-injected-diff
lqsha-noise-filter-reviewer-injected-diff: src/cli/run.ts buildInjectedReviewerDiffVariables now filters every source's files[] against AUTO_COMMIT_NOISE_PREFIXES (exported from supervisor.ts) before the empty-source fall-through at line ~526. Noise-only unstaged files (.xtrm/, .wolf/, .specialists/jobs/, .beads/) no longer shadow real branch-vs-base diff. Eliminates the xtrm-axwq reviewer-injected-diff bug rebuttal pattern. Test: tests/unit/cli/run.test.ts new regression with noise-only unstaged + real commit.

### mandatory-rules-feature-landed-schema-field-specialist-manda
mandatory_rules feature landed: schema field specialist.mandatory_rules.template_sets, config/mandatory-rules templates + index.json, runner prompt injection, supervisor meta parsing, and default specialist template_sets wiring all present

### mandatory-rules-live-in-yaml-frontmatter-rules-array
mandatory rules live in YAML frontmatter rules: array; reuse one buildMandatoryRulesBlock result for both task injection and meta event to avoid duplicate file reads

### mandatory-rules-meta-payload-must-flow-from-runner
mandatory rules meta payload must flow from runner -> supervisor timeline; emit only when injection appended using same payload object

### mandatory-rules-parser-only-read-frontmatter-rules-array
mandatory-rules parser only read frontmatter rules array; fallback to markdown body text needed or injection silently empty

### mandatory-rules-templates-live-under-config-mandatory-rules
mandatory-rules templates live under config/mandatory-rules with short YAML-frontmatter md files and index.json template-set lists

### memory-audit-prune-pass-bounded-heuristics-from-current
memory-audit prune pass: bounded heuristics from current session reports + explicit obsolescence/closed-bead/deprecated-identifer criteria produced 81 safe prunes; pre-bulk-export script restored worktree artifact generation for .tmp/memory-audit.

### memory-gate-infinite-loop-the-fast-path-cleanup
memory-gate infinite loop: the fast path cleanup in beads-memory-gate.mjs must NOT clear the memory-gate-done sentinel key. Clearing it allows claimed:<sessionId> or inferIssueIdFromBranch() to re-discover the issue and re-trigger the gate. The sentinel must persist for the session lifetime.

### memory-gate-is-stop-time-only-bd-close
Memory gate is Stop-time only; bd close never blocks. Hook still fail-opens when bd show is unavailable, so docs must say session-stop ack semantics, not close-time blocking.

### merge-resolution-must-prefer-sqlite-epic-chain-membership
Merge resolution must prefer sqlite epic_chain_membership chain_root_bead_id/chain_id, and listEpicChains must not filter root chains; artifact epics with no chain membership are not merge gates.

### merge-uses-sqlite-liststatuses-for-runtime-job-selection
merge uses SQLite listStatuses for runtime job selection; doctor legacy file scans stay explicit repair-only.

### model-behavior-qwen3-5-flailing-and-default-skip
model-behavior-qwen3.5-flailing-and-default-skip: nano-gpt/qwen/qwen3.5-397b-a17b-thinking exhibits two pathological patterns under multi-phase/multi-tool workflows: (1) every model turn emits ~5 parallel rejected tool calls (edit blocked by Serena + 4 gitnexus_query/context/detect_changes/cypher with the bead description as query argument) — wastes 3-5k tok per turn on rejection echoes; (2) defaults heavily to 'conservative' fallback (e.g. status=Current with evidence:[]) instead of doing per-entry analysis when the task asks for classification. Observed on memory-processor 508-memory audit 2026-05-12: qwen wrote 508 ledger rows BUT 481/508 (95%) had evidence:[] and only 3 marked Stale. Same task on executor (openai-codex/gpt-5.3-codex) completed with 91 evidence-backed prunes (18% rate), no flailing, /usr/bin/zsh.019 cost. AVOID qwen3.5-thinking via nano-gpt for any specialist that needs evidence-grounded multi-step tool execution. Prefer gpt-5.3-codex (executor model) or anthropic/claude-sonnet-4-6 for similar tool-heavy roles.

### model-incompat-deepseek-v4-dsml-via-nano-gpt
model-incompat-deepseek-v4-dsml-via-nano-gpt: nano-gpt/deepseek/deepseek-v4-*:thinking models (pro-cheaper, flash confirmed by inference) emit tool calls in DeepSeek's native DSML chat-template format (<｜｜DSML｜｜tool_calls>...<｜｜DSML｜｜invoke name=...>). nano-gpt proxy does NOT translate DSML <-> OpenAI tool_calls. Pi reads OpenAI tool_calls field empty -> 0 tools executed despite N invocation attempts logged in content. Symptom on job 9d58b3 (memory-processor MEDIUM): elapsed=1m13s, turns=3, tools=40 logged, tokens=54654 out=936, but actual file ops zero. AVOID deepseek-v4-*:thinking for any specialist that needs tool execution via nano-gpt. Safe alternatives confirmed: nano-gpt/qwen/qwen3.5-397b-a17b-thinking (Qwen ChatML template translates OK), anthropic/claude-sonnet-4-6 (native tool API), openai-codex/gpt-5.x (native tool API). Re-evaluate when nano-gpt adds DSML translation OR when an SGLang/vLLM proxy with --tool-call-parser=deepseek is used.

### modelcontextprotocol-sdk-1-29-0-ships-with-vulnerable
@modelcontextprotocol/sdk@1.29.0 ships with vulnerable transitive deps (fast-uri, ip-address, hono) at a time when the SDK is already at latest. Fix via package.json npm overrides forcing fast-uri ^3.1.2 / ip-address ^10.2.0 / hono ^4.12.18. When MCP SDK ships a new minor bump that includes these fixes upstream, the overrides become redundant and should be removed — leaving them in place silently masks regressions in dep hygiene.

### never-use-manual-git-merge-for-specialist-chain
Never use manual git merge for specialist chain work. Always use sp merge <chain-root-bead> or sp epic merge <epic-id>. If sp merge fails (e.g. merge-base error with main vs master), diagnose the root cause or flag to user — don't silently fall back to git merge.

### new-specialist-obligations-scanner-read-only-cheap-openai
NEW specialist: obligations-scanner. READ_ONLY, cheap (openai-codex/gpt-5.4-mini, bare, thinking:low, <30s), scans diff for newly-introduced TODO/FIXME/HACK/XXX/TEMP/WIP/NOTE(release) markers. Distinguishes production vs test (test/, tests/, __tests__/, *.spec.*, *.test.*, *.fixture.*, fixtures/, mocks/, e2e/, docs/). Recognizes structured TODO(<bead-id>): format vs unstructured. Verdict CLEAN|OBLIGATIONS_FOUND|BLOCKED + JSON output_schema. Not a gate itself — reviewer consumes its output and enforces. Lives at config/specialists/obligations-scanner.specialist.json.

### no-explicit-parent-job-id-in-supervisorstatus-job
No explicit parent_job_id in SupervisorStatus — --job reuse doesn't record which job it reused from. worktree_path matching is unreliable for chain reconstruction. Must add reused_from_job_id + worktree_owner_job_id before building tree views.

### node-cli-discovery-now-reports-source-order-and
node CLI discovery now reports source order and labels repo config/nodes first, then .specialists/default/nodes, then package fallback; explicit path remains escape hatch

### node-coordination-redesign-overthinker-consensus-locked-in-u
Node coordination redesign overthinker consensus (locked in unitAI-3f7b notes): coordinator stays READ_ONLY emitting typed actions; NodeSupervisor is the effect executor; orchestrator owns FIFO merge. Identity model: memberId=logical slot, generation=replacement incarnation, beadId=task lineage, workspaceId=worktree owner. Action schema additions: create_bead, spawn_member (with worktree|worktree_from), complete_node (strategies: pr|manual, NOT merge_to_master). Hybrid worktree: static members[].worktree for declared, worktree_from:memberId for dynamic fix loops. Context-depth precedence: action override → node default → fallback 2; reuse existing getCompletedBlockers, don't invent new context model. Replacement: same memberId + generation++, new bead child of failed bead, context_depth 2, plus synthetic prev_member_output in bootstrap. Coordinator empty-output: ONE bounded restart, then terminal error. Wave order locked: 1) bootstrap parity (P0), 2A) schema, 2B) execute actions, 3) worktrees+replacement, 4A) CLI, 4B) skill+docs. NEVER add: cross-node coordination, OpenWolf integration, runner retry, custom merge strategies, auto-conflict-resolution, coordinator write access.

### node-coordinator-operator-owns-lifecycle-coordinator-has-no
node-coordinator-operator-owns-lifecycle: coordinator has NO completion command. After synthesis it enters waiting. Operator closes via sp node stop (or sp node complete as force-close). Rationale: (1) consistent with single jobs — orchestrator owns lifecycle; (2) keeps coordinator context alive so operator can steer/resume for more work without starting a new node. node-contract.ts renderers, SKILL.md, and coordinator prompt all reflect this — do not reintroduce sp node complete on coordinator command surface.

### node-coordinator-uses-native-tools-on-first-turn
node-coordinator-uses-native-tools-on-first-turn: On its first turn, the node-coordinator used read/ls/find tools to answer the research task directly (bypassing members entirely). Members were all running but coordinator completed the task itself via file reads. Root cause: coordinator has read/grep/find/ls capabilities + no explicit prohibition on direct file access. Fix paths: (a) remove read/ls/find from coordinator required_tools, or (b) add explicit 'Do NOT read files directly — read member results via sp node result' to system prompt.

### node-coordinator-v1-1-0-skills-paths-wires
node-coordinator v1.1.0: skills.paths wires using-specialists SKILL.md, pre-script injects specialists list, system prompt has worktree lifecycle section. Model: anthropic/claude-sonnet-4-6. All specialist system prompts get universal 'never cd' rule via runner.ts Specialist Run Context block.

### node-coordinators-now-need-an-explicit-phase-boundary
Node coordinators now need an explicit phase-boundary synthesis loop: after wait-phase, read member outputs with sp node result --full before deciding next phase or completion.

### node-id-fix-validated-jobcontrol-startjob-must-set
Node ID fix validated: JobControl.startJob() must set SPECIALISTS_NODE_ID alongside node_id. Runner env forwarding must fall back to node_id. Without both, coordinator bash env lacks the env var and model hardcodes stale IDs from context.

### node-member-prompt-injection-gap-members-receive-only
Node member prompt injection gap: members receive only their config.role as first-turn prompt with no node context. bead_context in runner.ts (~line 715) is set to options.prompt (duplicate) not the actual bead title/description/notes, so the research goal never reaches the coordinator on first turn. Members have no idle-wait pattern and run their role blindly (explorer rampages). The coordinator's first-turn prompt is a generic initialPrompt from node config, with member registry only appearing in later resume payloads via buildResumePayload. Pre-script 'specialists list' is noise for node-coordinator. Fixes need P0: bead content injection, member idle-wait pattern, coordinator first-turn context enrichment.

### node-supervisor-member-registry-nodesupervisor-owns-the-memb
node-supervisor-member-registry: NodeSupervisor owns the member_id→job_id translation layer. Coordinator never sees raw job IDs — it uses logical member_id (e.g. 'explorer-1'). After spawning members, NodeSupervisor resumes coordinator with a Member Registry Update table. On member output, NodeSupervisor resumes coordinator with the output attributed to member_id. This pattern prevents coordinator from needing to track internal job IDs and makes the coordinator reusable across different NodeSupervisor implementations.

### nodesupervisor-audit-2026-04-09-18-findings-across
NodeSupervisor audit 2026-04-09: 18 findings across structural integrity, observability, and resilience. All fixed in 4 commits. Key changes: recovery distinguishes queued vs in-flight actions, coordinator terminal states handled, degraded->done allowed, stable output hashing, generation-scoped pending actions, no-progress watchdog (120s), per-member dep chains, stderr for sqlite failures, decision events (coordinator_resume_skipped, action_dropped, member_disabled), taxonomy cleanup.

### nodesupervisor-gpt-5-3-codex-executor-can-silently
NodeSupervisor gpt-5.3-codex executor can silently produce zero-output on first turn — model returns empty response with 0 tokens. Workaround: resume with explicit instructions or fall back to claude-sonnet-4-6. Happened during unitAI-kdl4 observability wave (2026-04-09).

### nodesupervisor-now-rehydrates-dispatch-action-lifecycle-coor
NodeSupervisor now rehydrates dispatch/action lifecycle, coordinator output hash, and resume_pending from node events; Supervisor crashRecovery keeps node-bound jobs recoverable by moving orphaned statuses to waiting/recovery_pending.

### nodesupervisor-planning-69rw-epic-usy9-created-with-5
NodeSupervisor planning (69rw): Epic usy9 created with 5 children. dv08 (JobControl, unblocked) → x77p (NodeSupervisor class) → [36s6 CLI, ef7b state tests, yldo orchestration tests]. Key design: composition over inheritance, 8-state machine with 17 transitions, FIFO dispatch, auto-resume via lastSeenOutputHash dedup. Files: job-control.ts, node-supervisor.ts, src/cli/node.ts.

### npm-audit-triage-2026-05-05-safe-non
npm audit triage 2026-05-05: safe non-force remediation was @modelcontextprotocol/sdk ^1.29.0 + yaml 2.8.4, plus remove accidental self-dependency @jaggerxtrm/specialists. This reduced audit from 18 vulns (6 high) to 6 moderate; remaining Vitest 2.x chain requires semver-major Vitest 4 migration in follow-up unitAI-zxz9f.

### npm-link-is-the-right-way-to-make
npm link is the right way to make local sp dev changes available globally during soak — NOT manual .specialists/default/ mirror copies. Per CLAUDE.md the default/ tier is managed by update-specialists, never hand-edited. Workflow: cd ~/dev/specialists && bun run build && npm link. Verify with 'ls -la $(which sp)' showing symlink to the local repo. After this, sp list from ANY repo shows the dev version with [package] tier resolution from ~/dev/specialists/config/specialists/.

### npm-package-extensions-pi-gitnexus-pi-serena-tools
npm package extensions (pi-gitnexus, pi-serena-tools) must be resolved from global node_modules (~/.nvm/versions/node/<version>/lib/node_modules/), not from ~/.pi/agent/extensions/ directory

### observability-db-setup-is-now-human-only-via
Observability DB setup is now human-only via 'specialists db setup'; path resolves from git root so worktrees share .specialists/db/observability.db, with chmod 644 and sqlite sidecar ignore patterns.

### observability-prune-now-extracts-job-metrics-into-specialist
observability prune now extracts job metrics into specialist_job_metrics before deleting raw events; aggregation uses readEvents + specialist_jobs and CLI stats reads aggregated table.

### observability-sqlite-hot-path-read-apis-should-expose
Observability SQLite hot-path read APIs should expose seq-cursor incremental queries like readEventsAfter(jobId, afterSeq, limit) and narrow direct lookup aliases so downstream runtime consumers can migrate off job files without inventing new access patterns; gitnexus detect_changes may be unavailable in some CLI environments and should be treated as a tooling limitation, not a code blocker.

### observability-sqlite-hot-path-reads-should-expose-seq
observability sqlite hot-path reads should expose seq-cursor incremental event queries; readEvents can delegate to readEventsAfter(jobId) so downstream runtime consumers get O(new events) reads without new file access patterns.

### osv-action-v2-3-8-resolves-unpinned-python
OSV action v2.3.8 resolves unpinned Python requirements to old vulnerable versions; for specialists security pipeline, pin safe lower bounds in requirements.txt and verify with ghcr.io/google/osv-scanner-action:v2.3.8, not only the older local osv-scanner CLI.

### osv-remediation-in-specialists-google-osv-scanner-action
OSV remediation in specialists: google/osv-scanner-action has no floating v2 tag; pin workflows/templates to google/osv-scanner-action/osv-scanner-action@v2.3.8. Syncing bun.lock to package.json Vitest 4 clears OSV but exposes full-suite Vitest migration failures tracked by unitAI-rlq48.

### osv-scanner-can-report-transitive-python-advisories-from
OSV scanner can report transitive Python advisories from requirements.txt resolution; for GHSA-65pc-fj4g-8rjx, add explicit idna>=3.15 alongside requests to force the fixed version.

### output-file-decoupled-from-specialists-job-file-output
output_file decoupled from SPECIALISTS_JOB_FILE_OUTPUT (unitAI-f58ma, fixed 2026-05-30, merge c40765f0). A specialist spec that sets top-level output_file (specialist.output_file) now ALWAYS writes the full result whenever a run produces handoff output — foreground AND --background tmux — independent of the env flag. Three gate removals: src/specialist/job-file-output.ts writeJobFileOutput (dropped internal isJobFileOutputEnabled self-gate; caller now owns the decision), src/specialist/runner.ts ~1457 (script/serve path), src/specialist/supervisor.ts ~1487 (supervised path: if(outputFile) — env check removed). Content is UNCHANGED and at full parity with bead notes + sp result: supervisor writes the rendered formatHandoffBlock (markdown-native ### turn / ## FINAL headings + verbatim body + italic footer); runner path still writes raw output. The DEBUG file-mirror infra (events.jsonl/status.json/result.txt) STAYS env-gated — only output_file is decoupled. single-writer invariant preserved (suppressRunnerFileOutput=true still skips runner write; supervisor owns output_file in supervised runs). .gitignore gained .specialists/*-result.md so executor/sync-docs/xt-merge result files (now always written) never get auto-committed. SUPERSEDES the gotcha in memory smoke-testing-specialist-handoff-output-from-unitai-438ve which said output_file is gated + foreground-only. Live-verified: background sp run with output_file set + env UNSET wrote the file with the FINAL handoff block. Chain: executor 8ea379 -> code-sanity OK bde32d -> obligations CLEAN de57f9 -> reviewer PASS 94 dce36f.

### output-file-is-not-needed-on-specialists-that
output_file is not needed on specialists that should always run with --bead. Bead linkage handles traceability — READ_ONLY specialists auto-append output to bead notes. Only use output_file for specialists that run without bead tracking.

### output-type-surfaced-e90j-output-type-from-specialist
output-type-surfaced-e90j: output_type from specialist execution config now surfaces in (1) RunResult.outputType (runner.ts:64), (2) SupervisorStatus.output_type (supervisor.ts:71), (3) TimelineRunMetrics.output_type (timeline-events.ts), (4) run_complete event metrics. Plumbed through finalResult.outputType in the DONE branch only — error/cancelled paths inherit existing metrics shape.

### overthinker-can-hallucinate-out-of-tree-files-when
overthinker-can-hallucinate-out-of-tree-files: When an overthinker bead points to absolute paths outside the specialist's cwd repo (e.g. /home/dawid/dev/xtrm-tools/...), the read tool sandbox refuses, but the model does NOT fail loudly — it can fabricate file contents in its analysis. Detected 2026-05-09 when changelog-drafter overthinker (job 653e17) reported template_sets:['workflow','safety','specialists-runtime','git-workflow'] with line citations, while the actual file has ['changelog-keeper-scope','changelog-conventions']. Mitigation: stage cross-repo files into a tmp dir inside the overthinker's repo before dispatch, OR inline the file contents in the bead description.

### ownership-model-docs-loader-precedence-user-default-package
Ownership model docs: loader precedence user>default>package; sync-defaults now covers specialists+mandatory-rules+nodes; use sp edit --fork-from for user-layer promotion; mandatory_rules template_sets docs must mention template mirror + prompt-end injection.

### p0-script-runner-hardening-for-unitai-z2vpq-validated
P0 script-runner hardening for unitAI-z2vpq validated across isolated branches before merge: stdin transport, projectDir cwd, prompt_too_large preflight, and JSON output contract each have targeted tests plus lint/build evidence.

### package-payload-smoke-should-install-exact-tmp-sp
package-payload smoke should install exact /tmp/sp-test.tgz tarball path in isolated prefix, so CI mirrors release install path

### parallel-bd-create-on-dolt-can-serialize-fail
Parallel bd create on Dolt can serialize-fail and scramble child suffix order; create planning boards sequentially when stable numbering matters.

### per-specialist-extension-opt-out-unblocks-vision-workflows
Per-specialist extension opt-out unblocks vision workflows: execution.extensions.{serena,gitnexus}=false maps to PiSessionOptions.excludeExtensions and skips -e injection while preserving default behavior.

### per-turn-handoff-schema-added-as-mandatory-rule
per-turn-handoff-schema added as mandatory rule; executor/debugger/reviewer/code-sanity/security-auditor/sync-docs/test-runner/changelog-keeper/planner/overthinker/researcher/explorer configs now include it.

### phase-1-of-p0-lsp-overhead-unitai-c4g0m
Phase 1 of P0 LSP overhead (unitAI-c4g0m): set execution.extensions.serena=false on code-sanity, explorer, overthinker, changelog-drafter. Infrastructure already existed (session.ts:644 omits -e flag when excluded). Saves ~80-150 MB per invocation of these specialists. serena-cheatsheet also removed from mandatory_rules where present.

### phase-2-executor-4726a6-wrote-all-targets-before
Phase 2 executor (4726a6) wrote all targets before crashing on supervisor.test.ts FIFO hang during vitest. Pattern: executor completes implementation then runs tests including the hung test — kills the process. Fix: explicitly exclude supervisor.test.ts from executor's test run instructions in bead notes.

### phase-3-integration-coverage-is-valuable-at-the
Phase 3 integration coverage is valuable at the real CLI boundary: spawn bun run src/index.ts in temp project dirs to verify .mcp.json merge behavior, argument validation, and early --bead lookup failures without relying only on mocked unit tests.

### phase-3-regression-coverage-should-be-split-across
Phase 3 regression coverage should be split across shell/core/tool layers: init tests assert project .mcp.json registration/idempotence, run tests assert --bead argument behavior, and tool/business tests assert bead context formatting plus use_specialist bead_id forwarding.

### phase-4-runtime-threading-uses-usesharedtoolresolver-interna
Phase 4 runtime threading uses useSharedToolResolver internal option in PiAgentSession; legacy mapPermissionToTools stays fallback, and shared resolver loads .specialists/catalog/index.json lazily with safe fallback to legacy path.

### pi-compat-ci-strategy-smoke-checks-a-every
pi compat CI strategy: smoke checks (a) every required spawn flag appears in pi --help (regex match per flag) and (b) real pi accepts our positional-prompt args without 'Unknown option' rejection (using fake/fake model so we get auth/provider error, not args parse error). Cheap, no quota, no secrets, no LLM. Workflow at .github/workflows/pi-compat.yml. Triggers: weekly cron + PR on Dockerfile/src/specialist/script-runner.ts/src/pi/session.ts.

### pi-event-stream-cap-should-be-on-retained
Pi event-stream cap should be on RETAINED state (assistant text + stderr + single line size), never raw pipe throughput. Raw-byte caps reject runs based on the volume of data we explicitly discard during streaming parse. The wrong knob causes legitimate large-range LLM runs to fail and tempts band-aid cap raises that risk downstream context overflow. Pattern: cap what you keep, not what you receive.

### pi-install-l-only-adds-a-package-to
pi install -l only adds a package to .pi/settings.json — it does NOT fetch/install from npm. To actually install, run pi install npm:<pkg> without -l (global). Listing in settings.json is declarative; the global install is what makes the extension available at runtime.

### pi-model-selection-use-pi-list-models-to
pi-model-selection: use 'pi --list-models' to discover models, pick highest version in family (glm-5 not glm-4.7, claude-sonnet-4-6 not 4-5, gemini-3.1-pro-preview not gemini-2.5-pro). Verify with: pi --model <provider>/<id> --print ping — must return 'pong'. Format: provider/model-id (e.g. anthropic/claude-sonnet-4-6, zai/glm-5)

### pi-process-extension-compatibility-artale-pi-procs-installs
pi process extension compatibility: @artale/pi-procs installs but is incompatible with current Pi extension API because it uses @anthropic-ai/claude-code plus addTool/addCommand; @aliou/pi-processes is compatible with current Pi via @mariozechner/pi-coding-agent and registerTool/registerCommand, exposing a single process tool.

### pi-rpc-mode-rpc-hangs-exits-immediately-when
Pi RPC --mode rpc hangs/exits immediately when zombie vitest/tinypool processes are running or after model changes. Three fixes to try in order: (1) kill all zombie vitest/tinypool/bun processes (ps aux | grep vitest/tinypool), (2) npm run build to rebuild dist with correct model config, (3) ask user to run xt pi reload. The root cause is not pi-core symlinks — it's stale processes or stale dist.

### pi-runtime-already-provides-all-primitives-substrate-5
Pi runtime already provides all primitives substrate §5.8/§6.9 assumed: turn_start/turn_end events, agent_end as quiescence barrier, steer command (queues message after current turn before next LLM call - the natural channel-after-hook injection point), follow_up for resume-from-waiting, auto_compaction_start/end events, auto_retry_start/end for transient classification. supervisor.ts already wires every callback substrate needs (lines 1671 turn_start, 1658 agent_end, 1882 auto_compactions, runner.ts:1361 session.steer). Substrate's container 'tick' is NOT a clock - it is event-driven on member turn_end + pulse arrival + sb command. Substrate becomes a second reader of observability.db alongside sp log; no new instrumentation needed.

### pi-session-resolver-default-on-use-specialist-currently
Pi session resolver default-on; use_specialist currently only forwards specialistName from input name, while permissions still come from runner/spec. sp config show --resolved parity is enough evidence for byte-equivalence gate.

### pi-skill-name-resolves-via-pi-settings-json
pi --skill <name> resolves via .pi/settings.json skills array search order. Adding ~/.xtrm/skills/default as the second entry makes canonical xt-managed skills resolvable in projects whose .xtrm/skills/active/ only contains a subset. Verified via 'pi --skill clean-code --print recite-description' returning the actual clean-code description after fallback was added. validateBeforeRun in src/specialist/runner.ts:255 does a literal-path existsSync check that does NOT honor pi search paths — its warnings are not a reliable signal of actual skill resolution.

### pi-tui-package-is-earendil-works-pi-tui
Pi TUI package is @earendil-works/pi-tui, not @mariozechner/pi-tui; pi-coding-agent does not re-export TUI/ProcessTerminal/Input/Editor/matchesKey, so specialists sp chat should add direct @earendil-works/pi-tui dependency if importing TUI primitives.

### pi-tui-tui-integration-gotchas-learned-from-chat
pi-tui TUI integration gotchas (learned from chat.ts P0 fix unitAI-h1yst): (1) Input components don't render their cursor or accept keys until tui.setFocus(input) is called — without it, the box appears empty and inert. (2) addInputListener is a TUI METHOD (tui.addInputListener(cb)), NOT a top-level export from @earendil-works/pi-tui. (3) When piping runner output into a TUI feed, launchSpecialist must NOT use outputMode:'human' (writes to stdio directly, bypasses callbacks). Use callback-based output and wire onToken/onToolStart/etc into feed.append*. (4) tui.start() must run concurrently with the runner, not after — await on the runner will block TUI render forever.

### piagentsession-package-class-rpc-launches-should-include-off
PiAgentSession package-class RPC launches should include --offline, --no-context-files, --no-prompt-templates, and --no-themes while retaining --append-system-prompt (not --system-prompt); script-runner already had analogous isolation flags.

### ppkdg-split-into-3-beads-after-overthinker-fhmuo
ppkdg split into 3 beads after overthinker fhmuo: fln4q (pre-mig: crashRecovery DB parity + reader migration + ~30 test migration + runtime-mode detectability) -> ppkdg (gate file writes behind SPECIALISTS_JOB_FILE_OUTPUT=on|off, hard-fail on DB write failure, default off, keep steer.pipe) -> jjp7w (docs + obsolete fallback cleanup). Critical: DB-native crashRecovery is the most important missing precondition.

### ppkdg-supervisor-write-sites-writestatusfile-writestatusfile
ppkdg supervisor write sites: writeStatusFile, writeStatusFileOnly, appendTimelineEvent, appendTimelineEventFileOnly in src/specialist/supervisor.ts. All have DB parity via SqliteClient (upsertStatus, appendEvent, upsertResult). crashRecovery() still file-based — readStatus has DB fallback, so crash recovery transition needs explicit work. ~30 tests assert on file presence. Recommended opt-in: SPECIALISTS_FILE_OUTPUT=0|1 env.

### pqe96-merge-dirty-ignore-beads-xtrm-active
pqe96-merge-dirty-ignore-beads-xtrm-active: MERGE_DIRTY_IGNORE_PREFIXES in src/cli/merge.ts:537 extended with '.beads/' and '.xtrm/skills/active/'. sp merge no longer refuses when only bd auto-export (.beads/issues.jsonl) or gitnexus stat refresh (.xtrm/skills/active/**) noise dirties the tree. Retires the manual pre-merge stash ritual for those two paths. .xtrm/reports/, .wolf/, .specialists/jobs/, dist/ unchanged.

### pr-99-osv-failed-on-qs-6-15
PR #99 OSV failed on qs@6.15.1 in bun.lock; fixing requires a package override for qs 6.15.2, not only adding a direct dependency. Codex stop/resume feedback was telemetry coupling: control-plane actions must succeed after FIFO/signal delivery even if observability SQLite writes fail.

### project-vision-gitboard-as-mercury-console-agentic-devops
PROJECT VISION — gitboard as Mercury console + agentic devops/monitoring stack (operator, 2026-05-29; GROUNDED in code). ~/dev/gitboard = 'Omniforge' monorepo (pkg name 'xtrm'), primary app apps/gitboard, Bun + Tailscale + WebSocket + @omniforge/ui design system. It is ALREADY a multi-source specialists/substrate/beads CONSOLE (api/routes: specialists, substrate, beads, graph, observability, sources, terminal, internal-dolt-health/logs/parity/verify; dashboard/pages/console: Specialists.tsx, Graph.tsx, chain cards, bead drawers; hooks: useChains, useSpecialistHistory). It HAS a self-observability engine: core/observability (typed event bus per CONTRACT.md — materializer.run/parity.diff/ws.publish/api.request/scanner/app, severity info|warn|error; thresholds.ts = static p95 budgets materializer2000/parity500/api200/ws50ms; verifier, spans) + server/observability (metrics-dao, live watcher, parity, multi-db attach-pool) + UnifiedScanner over multiple sources (source_key=kind:path, materialization_state) so observing Mercury repos is in-model. GAP (= the AWS DevOps Agent's job): NO anomaly detection (only static p95), NO incident lifecycle, NO detect→triage→RCA→mitigation loop, NO learned-skills-from-telemetry. PLAN: build the agentic devops/monitoring layer INSIDE gitboard (extend the thin /summary observability route) + a devops/monitor specialist family modeled on AWS DevOps Agent agent-types (Incident Triage/RCA/Mitigation/Evaluation). This REFRAMES the .6 observability research: gitboard IS the viz/console, so 'Grafana-first' (bead unitAI-rgu4q) is likely the WRONG path — build in-gitboard instead. Absorbs 544sf .5(AgentCore eval+learned-skills)/.6(observability)/.4(security-tester) into ONE console initiative. Operator providing AWS DevOps Agent docs+transcripts + Obsidian requirements next.

### pure-resolver-parity-holds-if-gitnexus-write-extras
Pure resolver parity holds if gitnexus write extras are appended after serena tools, not merged in catalog precedence order.

### quality-check-cjs-failures-must-write-blocking-diagnostics
quality-check.cjs failures must write blocking diagnostics to stderr; stdout-only blocking output triggers spurious 'blocking error / no stderr' wrapper noise.

### quality-check-cjs-hook-b0bc6-4-when-blocking
quality-check.cjs hook (b0bc6.4): when blocking-exit (code 2) on real lint/typecheck failures, hook now also writes concise reason to stderr so Claude Code harness reports something instead of 'no stderr output'. Full details remain on stdout.

### rczcp-serena-adoption-observability-meta-event-mandatory-rul
rczcp Serena adoption: observability meta event mandatory_rules_injection.sets_loaded surfaces global default sets only — does NOT include spec template_sets like serena-cheatsheet or explorer-readonly. Discovered while attempting Serena adoption soak. Filed as follow-up. Until fixed, soak measurements based on this event are unreliable; verify rule injection by reading specialist input transcripts directly, not the meta event.

### re-review-fln4q-a-poll-feed-specialist-still
Re-review fln4q-A: poll/feed_specialist still file-first when SPECIALISTS_JOB_FILE_OUTPUT=on; violates DB-first fallback contract.

### re-review-gates-env-fallback-needs-explicit-off
Re-review gates: env fallback needs explicit off-mode DB-only tests; targeted vitest catches silent regressions fast.

### re-review-needs-auditable-raw-gitnexus-impact-evidence
Re-review needs auditable raw gitnexus impact evidence in notes, not summary claims.

### re-review-pass-flips-when-raw-impact-command
Re-review PASS flips when raw impact command evidence anchored in bead notes plus smoke pass proof.

### readme-lacked-any-mention-of-using-specialists-v3
README lacked any mention of using-specialists-v3, using-specialists-auto, update-specialists skills. Added Operator skills table before Core tracked workflow, guided-update note in drift repair section, and 3 explicit docs map entries. docs/skills.md already had them — the gap was only in README.

### readme-onboarding-should-keep-a-vision-section-plus
README onboarding should keep a Vision section plus direct specialists.scheme.md link and an inline Mermaid scheme showing orchestrator -> bead contract -> specialists -> handoff -> decision loop.

### rebuttal-pattern-serena-pool-spawn-ordering-when-tests
rebuttal-pattern-serena-pool-spawn-ordering: When tests/unit/pi/session.test.ts fails 5 specific tests (resolver default-on, resolver LOW path, resolver READ_ONLY path, mapPermissionToTools HIGH) with 'expected -1 to be greater than -1' or 'expected undefined to be defined' from mockSpawn.mock.calls[0][1], this is PRE-EXISTING test fragility against serena-pool/index.ts (npm package @jaggerxtrm/pi-extensions). serena-pool execFileSyncs 'git rev-parse --show-toplevel' to hash a per-repo-root port. If no serena daemon is alive on that port (typical for fresh worktrees with their own git root), serena-pool spawns one BEFORE pi's spawn — making mockSpawn.mock.calls[0] the serena spawn, not pi. Reproduces on master source checked out into a worktree cwd. Rebuttal evidence: (a) cwd=/home/dawid/dev/specialists passes 61/61; (b) any worktree cwd fails the same 5 tests regardless of branch content; (c) failing tests use mockSpawn.mock.calls[0][1] and were not touched in the diff. Stabilization follow-up: select pi spawn by arg predicate (.find(...includes('--mode'))) not call index.

### reference-python-client-lives-at-clients-python-stdlib
Reference Python client lives at clients/python/ (stdlib-only, ~170 LOC, pyproject.toml, smoke tests). Mirrors closed error_type taxonomy 1:1 plus caller-side 'transport' for HTTP/socket failures. Smoke tests gated by SPECIALISTS_SERVICE_URL env; pass --extra='SPECIALISTS_SMOKE_SPECIALIST=name' for the round-trip test. Replaces docs/examples/specialists_client.py (deleted). docs/specialists-service.md and docs/design/darth-feedor-migration.md cross-reference the new path. Tested live against darth-feedor's running specialists-service container at 172.18.0.27:8000 — healthz + specialist_not_found assertions pass.

### release-fixes-that-affect-cli-behavior-must-rebuild
release fixes that affect CLI behavior must rebuild bundled dist before publish; source-only changes do not ship

### research-node-with-fixed-members-research-node-json
Research node with fixed members (research.node.json) works e2e. Dynamic spawn (research-multi.node.json with empty members array) fails — spawned member jobs die in 'starting' state. Use fixed-member configs until dynamic spawn is investigated.

### researcher-specialist-v1-3-0-gained-a-general
researcher specialist (v1.3.0) gained a general-web pipeline: ddgs (web search, NO api key — 'uv tool install ddgs', 'ddgs text -q "..." -m 8') discovers URLs, then agent-browser ('npm i -g agent-browser' + 'agent-browser install' → Chrome 149, ~452MB) reads ANY url incl JS-rendered ('agent-browser batch --bail "open <url>" "wait --load networkidle" "get text body" "close"'). CRITICAL: do NOT declare these in capabilities.external_commands — that field is a HARD pre-run gate (runner.ts validateBeforeRun throws if missing on PATH), would break the shipped package-tier researcher in projects without them. They're documented as Mode 4 in prompt.system + research-tool-routing.md instead. agent-browser CANNOT search (Google/DDG CAPTCHA headless Chrome) — ddgs does search, agent-browser does read. Closes web-gap for epic unitAI-544sf children 1/5/7.

### researcher-specialist-yaml-v1-1-two-modes-targeted
researcher.specialist.yaml v1.1: two modes (targeted: ctx7+deepwiki, discovery: ghgrep→deepwiki), LOW perm, haiku, keep-alive. Skills: find-docs + deepwiki + github-search at .xtrm/skills/active/pi/. Documented in config/skills/using-specialists/SKILL.md specialist table.

### review-4vuvd-prune-stale-defaults-no-repo-marker
Review 4vuvd: prune-stale-defaults no repo marker writes; warning only when diverged defaults exist; keep-diverged preserves old behavior.

### review-audit-injected-diff-enough-for-compliance-missing
review audit: injected diff enough for compliance; missing specialist result artifact should note limitation not auto-fail

### review-audit-job-waiting-state-can-block-sp
review audit: job waiting state can block sp result; use git diff + targeted bunx vitest as fallback evidence

### review-gate-injected-diff-can-be-stale-verify
review gate: injected diff can be stale; verify with reviewed job worktree diff

### review-gate-injected-diff-can-contradict-target-job
Review gate: injected diff can contradict target job scope; trust authoritative context first, then flag contradiction.

### review-gate-must-verify-actual-queue-semaphore-and
Review gate must verify actual queue semaphore and child-process SIGTERM forwarding; counter checks alone pass tests but violate serve spec.

### review-gate-require-explicit-gitnexus-impact-tool-evidence
Review gate: require explicit gitnexus impact tool evidence in specialist feed/result when highest_risk HIGH.

### review-run-must-verify-dist-based-help-tests
Review run must verify dist-based help tests against rendered output, not only source-string edits.

### review-run-stale-job-reaper-compliance-validated-via
Review run: stale-job reaper compliance validated via cumulative diff + targeted tests + tsc.

### review-z9cku-1-package-live-fallback-wired-across
review z9cku.1: package-live fallback wired across loader/mandatory-rules/node with read-only semantics; missing explicit blast-radius evidence can block strict compliance

### reviewer-audit-doctor-ts-db-first-can-miss
Reviewer audit: doctor.ts DB-first can miss file-output mode fallback if sqlite DB exists; require explicit SPECIALISTS_JOB_FILE_OUTPUT gate in cleanupProcesses.

### reviewer-audit-for-amzec-sqlite-fallback-verify-readresult
Reviewer audit: for amzec SQLite fallback, verify readResult SQLite-first then file fallback and targeted readResult test via bun test -t readResult.

### reviewer-audit-injected-diff-context-authoritative-local-loo
Reviewer audit: injected diff context authoritative; local lookup optional; missing gitnexus proof should be gap not auto-fail.

### reviewer-audit-injected-diff-context-contradicted-actual-rev
Reviewer audit: injected diff context contradicted actual reviewed worktree diff; used worktree evidence for compliance.

### reviewer-audit-injected-diff-context-enough-for-compliance
Reviewer audit: injected diff context enough for compliance review when sp result missing; missing unstaged+bounded-review coverage => PARTIAL.

### reviewer-audit-injected-diff-showed-cap-comment-test
Reviewer audit: injected diff showed cap/comment/test updates; parser semantic parity must be evidenced with explicit event-order test, not only code inspection.

### reviewer-audit-injected-noise-diff-context-unreliable-use
reviewer audit: injected noise diff context unreliable; use git diff master...HEAD as source of truth

### reviewer-audits-must-trust-injected-diff-context-over
Reviewer audits must trust injected diff context over local branch state when lineage provided

### reviewer-blind-spot-list-live-db-native-migration
Reviewer blind spot: list --live DB-native migration still lacks direct runtime-status test; parseArgs-only list test can mask regression.

### reviewer-blind-spot-reviewer-validates-executor-claims-again
Reviewer blind spot: reviewer validates executor claims against current codebase but does NOT diff branch vs master to verify changes were actually made. If executor writes a convincing result.txt without editing files, reviewer will confirm pre-existing patterns as 'evidence' of the claimed changes. Mitigation: before dispatching reviewer, verify the worktree branch actually has a diff (git diff master -- <files>).

### reviewer-cannot-rely-on-sp-result-when-job
Reviewer cannot rely on sp result when job stays waiting; use master..HEAD diff plus full-file reads and mark traceability gap.

### reviewer-cannot-rely-on-specialists-jobs-in-worktree
Reviewer cannot rely on .specialists/jobs in worktree; use sp ps + git diff in worktree for evidence when sp result unavailable due waiting state.

### reviewer-check-master-head-scope-drift-can-hide
Reviewer check: master..HEAD scope drift can hide targeted bead success; enforce branch reset or isolate bead branch before review.

### reviewer-check-meta-callback-path-must-pass-metapayload
Reviewer check: meta callback path must pass metaPayload into mapCallbackEventToTimelineEvent; otherwise CLI feed cannot render source-specific meta lines.

### reviewer-check-require-explicit-gitnexus-impact-tool-call
Reviewer check: require explicit gitnexus impact tool-call evidence in specialist feed/result; summary-only impact_report block not sufficient.

### reviewer-compliance-can-pass-with-injected-diff-lineage
Reviewer compliance can PASS with injected diff+lineage even when local job artifacts missing; record limitation, avoid false FAIL.

### reviewer-diff-source-must-drop-auto-commit-noise
Reviewer diff source must drop auto-commit noise prefixes before source priority fall-through, or noise-only unstaged files can shadow branch-vs-base diff.

### reviewer-evidence-hierarchy-injected-context-may-be-sparse
Reviewer evidence hierarchy: injected context may be sparse; use worktree diff plus bd show requirements, and mark missing injected reviewed_output explicitly without auto-failing.

### reviewer-fallback-if-sp-result-unavailable-waiting-use
Reviewer fallback: if sp result unavailable (waiting), use sp ps + git diff evidence; do not fail solely for missing local job artifacts when worktree diff proves scope.

### reviewer-fallback-patch-must-include-real-injected-diff
reviewer fallback patch must include real injected diff source or wording must not claim it; staged-only test currently fails due reviewer metadata mismatch

### reviewer-finding-enforce-scope-gate-before-merge-master
Reviewer finding: enforce scope gate before merge; master..HEAD for bead-specific branches can include unrelated config/docs/schema edits even when target files pass.

### reviewer-finding-fln4q-a-readers-still-use-ungated
Reviewer finding: fln4q-A readers still use ungated file fallback in poll/attach/feed/status and no fallback path in specialist_status; contract says fallback only when SPECIALISTS_JOB_FILE_OUTPUT=on.

### reviewer-flow-if-sp-result-missing-fallback-artifacts
Reviewer flow: if sp result missing, fallback artifacts may also be missing in worktree; treat lineage confidence as reduced and downgrade verdict unless independent evidence complete.

### reviewer-for-unitai-rzrq1-should-use-unstaged-scoped
Reviewer for unitAI-rzrq1 should use unstaged scoped diff when master..HEAD includes unrelated history in reused worktree

### reviewer-gate-if-reviewed-job-id-injected-as
Reviewer gate: if reviewed_job_id injected as unresolved placeholder, stop and FAIL for missing required injected fields; do not guess target run.

### reviewer-injected-diff-bug-rebuttal-template-when-reviewer
reviewer-injected-diff-bug-rebuttal-template: When reviewer FAILs citing 'authoritative patch shows only .xtrm/.../SKILL.md' or similar one-line noise, the injected reviewer_diff context fell into the xtrm-axwq bug. Rebuttal pattern that flips FAIL→PASS reliably: paste the actual 'git diff master...HEAD --stat' output, note 'matches bead SCOPE', point at the IGNORE-injected-diff instruction in the bead. Verified 2026-05-13 sgw9g.review job 1de887 FAIL→PASS in one turn.

### reviewer-injecteddiff-can-be-stale-verify-master-head
Reviewer: injecteddiff can be stale; verify master...HEAD in assigned worktree for compliance evidence.

### reviewer-job-lineage-now-rendered-in-reviewer-task
reviewer --job lineage now rendered in reviewer task template via ; prevents manual reviewed_job_id resume blocker in normal flows

### reviewer-job-startup-needs-real-injected-reviewer-diff
reviewer --job startup needs real injected reviewer_diff_* context plus size-capped hunks; otherwise fallback claims are fake or pi hits E2BIG on large injected diffs

### reviewer-master-head-may-include-files-from-master
Reviewer: master..HEAD may include files from master when branch behind; verify with git diff HEAD..master before marking scope drift.

### reviewer-misses-executor-gitnexus-evidence-via-sp-result
reviewer-misses-executor-gitnexus-evidence-via-sp-result-only: reviewer.specialist.json system_prompt step 'Job linkage and evidence collection' (lines 57-84) instructs evidence retrieval via injected context → sp ps → sp result → events.jsonl file fallback. NEVER instructs sp feed <reviewed_job_id> or specialist_events query. Consequence: executor's gitnexus_query/context/impact tool invocations are persisted in specialist_events.type='tool' rows in observability.db but are INVISIBLE via sp result (which surfaces only final assistant text). Reviewer therefore consistently flags 'missing gitnexus blast-radius evidence' even when executor performed all required gitnexus calls (verified live: 7 recent executors made 46 gitnexus_* tool calls between them, all in DB, but no reviewer can see them via current evidence path). Compounding: 0/5 reviewer runs in the 7-day DB window had reviewed_job_id populated at all — operator-side they're being dispatched without --job <exec-job-id> lineage. Two-part fix needed: (1) reviewer prompt adds a step 'sp feed <reviewed_job_id> | grep gitnexus_' to surface tool events; (2) runner pre-injects gitnexus_summary block (already extracted by supervisor accumulator per memory gitnexus-rpc-extraction-impl) when reviewed_job_id is set. Until shipped, every PARTIAL/FAIL verdict citing 'missing gitnexus evidence' is likely a false negative — verify by running sp feed on the reviewed job and grepping for gitnexus_ tool events before treating reviewer verdict as authoritative.

### reviewer-must-compare-run-baseline-counts-master-34
Reviewer must compare run baseline counts (master 34/10 vs worktree 40/7) to avoid false regressions when pre-existing sqlite flake persists.

### reviewer-must-trust-injected-diff-lineage-over-missing
Reviewer must trust injected diff/lineage over missing local artifacts in worktree review runs.

### reviewer-must-verify-branch-diff-scope-unitai-u7zsw
Reviewer must verify branch diff scope; unitAI-u7zsw fixture slice included unrelated docs changes and failing targeted vitest due bun:sqlite loader.

### reviewer-must-verify-code-sanity-fixes-against-final
Reviewer must verify code-sanity fixes against final diff and not trust summary-only claims.

### reviewer-must-verify-executor-changed-branch-has-real
Reviewer must verify executor changed branch has real diff vs base, not only claimed output.

### reviewer-must-verify-executor-claims-against-actual-diff
Reviewer must verify executor claims against actual diff+runtime output; summary-only evidence can hide scope drift.

### reviewer-must-verify-feature-branch-diff-vs-master
Reviewer must verify feature branch diff vs master and not trust waiting job summary; unresolved --fork-from parsing can silently break AC.

### reviewer-must-verify-using-kpi-persistence-via-active
Reviewer must verify using-kpi persistence via active symlink target in .xtrm/skills/default when auditing skill additions.

### reviewer-new-file-only-skill-drafts-satisfy-gitnexus
Reviewer new-file-only skill drafts satisfy gitnexus blast-radius gate via explicit new-file-scope statement plus diff evidence.

### reviewer-re-check-removing-file-fallback-must-include
Reviewer re-check: removing file fallback must include ps.ts status and event fallback paths; list/attach-only fixes still leave runtime not fully DB-native.

### reviewer-rerun-must-trust-current-branch-diff-over
Reviewer rerun must trust current branch diff over stale sp result when orchestrator amended commit.

### reviewer-rerun-must-use-injected-or-fresh-diff
Reviewer rerun must use injected or fresh diff plus bunx vitest evidence for help.test.ts fixes.

### reviewer-run-needs-concrete-reviewed-job-id-injected
Reviewer run needs concrete reviewed_job_id injected; placeholder/empty value blocks lineage resolution and forces FAIL for missing required injected fields.

### reviewer-s-sp-result-on-a-target-job
Reviewer's sp result on a target job only shows the LAST turn — earlier turns (esp. tool-event evidence like gitnexus_impact) live only in bd show <bead-id> via auto-append. When reviewer flags missing audit trail, point it at bd show notes, not sp result. Saved 1 review cycle on unitAI-p0kfz.

### reviewer-should-require-direct-tool-event-evidence-for
Reviewer should require direct tool-event evidence for gitnexus_impact, not self-reported summary.

### reviewer-skips-phase-2-adversarial-code-quality-in
reviewer skips phase 2 (adversarial code quality) in practice: the system prompt defines a two-phase audit but task_template opener 'Audit the completed specialist run for requirement compliance' anchors the model to compliance-only. All 5 sampled runs (8df73e, f3736a, e6e7c3, 34d5bd, 00dba8) show no Phase 2 section, no adversarial code quality framing in output. Fix: add an explicit '## Code Quality Audit' section to the required output format in task_template, or rewrite the task_template opener to mention both phases.

### reviewer-specialist-crash-pattern-2026-05-23-reviewer
reviewer-specialist-crash-pattern-2026-05-23: reviewer specialist (openai-codex/gpt-5.3-codex) crashed three times in a row at ~15-21s with ~18k input tokens consumed at turn 2 in this session. Pattern: job appears running in sp ps but DB shows dead, sp feed returns 'not found in observability.db', sp result returns 'still running' indefinitely. Workaround: manually verify per-criterion against worktree files, document operator-level review attestation in bead close reason. System health showed serena-lsp=18 at time of failure — may be resource/MCP related. If recurrent, investigate reviewer model timeout or pi RPC initialization in resource-pressured sessions.

### reviewer-specialist-now-iron-inspired-scrutiny-tier-behavior
Reviewer specialist now Iron-inspired: SCRUTINY tier behavior (low/medium/high/critical) drives review depth; auto-escalation table raises floor on sensitive surfaces (auth, config/specialists, lockfiles, migrations, permissions/hooks); ddiff mode on PARTIAL re-review carries prior approvals forward; obligations scan blocks unstructured TODO/FIXME/HACK in production code; mandatory Release Checklist block in every verdict for future machine-side enforcement. config/specialists/reviewer.specialist.json updated 2026-05-25.

### reviewer-specialist-requires-prompt-or-bead-job-alone
reviewer specialist requires --prompt or --bead — --job alone is not sufficient and exits with an error. When dispatching reviewer via --job <exec-job-id>, always add --prompt describing what to review.

### reviewer-specialist-sandbox-cannot-run-sp-bd-git
Reviewer specialist sandbox cannot run sp/bd/git diff/gitnexus CLIs from its own shell — this causes PARTIAL verdicts citing 'traceability gaps' even when code is correct. When reviewer reports PARTIAL due to missing sp ps/git diff/lint evidence (not substantive code gaps), verify directly from main env (git diff --stat, npx tsc --noEmit in worktree) before treating as failure. Real code issues look like named bugs, missing guardrails, broken invariants — not 'could not execute sp ps'.

### reviewer-startup-contract-needs-explicit-patch-source-label
Reviewer startup contract needs explicit patch source label plus hard fail when all patch sources empty; tests should assert staged fallback and empty-source rejection.

### reviewer-startup-currently-blocks-on-empty-worktree-diff
reviewer startup currently blocks on empty worktree diff before any CLI evidence collection, so bd show/sp ps/sp result cannot run on staged-only or branch-only patches

### reviewer-startup-fallback-needs-branch-vs-base-coverage
Reviewer startup fallback needs branch-vs-base coverage in tests: clean worktree on feature branch can still require git diff <merge-base>..HEAD, while main-branch clean repo stays empty and should fail fast.

### reviewer-startup-must-probe-staged-diff-and-branch
reviewer startup must probe staged diff and branch-vs-base diff before failing empty-patch; auto-commit/reset workflows often have staged-only patches

### reviewer-startup-needs-branch-vs-base-fallback-after
Reviewer startup needs branch-vs-base fallback after injected, unstaged, and staged diff sources; feature-branch test caught empty main-branch false positive.

### reviewer-startup-prompt-must-not-embed-full-git
Reviewer startup prompt must not embed full git diff; keep patch retrieval instruction short to avoid ARG_MAX/E2BIG on large worktrees.

### reviewer-traceability-fixes-2026-04-27-ctkk9-split
reviewer-traceability-fixes-2026-04-27: ctkk9 split into two surgical fixes. (1) gitnexus-required mandatory rule expanded from 1-line to 14-line spec with explicit MCP tool names and CLI fallbacks (npx gitnexus impact/context/query/cypher) — no machinery added to verify executor's prior gitnexus runs. (2) buildInjectedReviewerDiffVariables in src/cli/run.ts:454 now mirrors runner.ts getPatchSources fallback chain (unstaged → staged → branch-vs-base) so reviewer always gets injected diff context labeled by source, even when executor committed. Removes the false-PARTIAL on authoritative_diff_present:no when fallback found a clean diff.

### reviewer-trust-injected-diff-lineage-first-local-db
Reviewer trust injected diff/lineage first; local DB miss in sp feed not failure if injected context consistent.

### reviewer-trust-injected-diff-worktree-diff-over-summaries
Reviewer: trust injected diff+worktree diff over summaries; verify code-sanity/security claims against actual hunks.

### rl9uh-q30r7-naming-and-prereq-policy
rl9uh-q30r7-naming-and-prereq-policy: Specialists publishes as @jaggerxtrm/specialists (scoped). xtrm-tools is a separate unscoped published package with the xt CLI. Specialists does NOT declare xtrm-tools as dep/peerDep/devDep — only an underscore-prefixed _runtime_prerequisites field in package.json (npm ignores it) plus runtime enforcement via assertXtrmPrerequisites in sp init. Rationale: avoid transitive bin ambiguity + decouple release cadences. Documented in docs/installation.md Naming and prerequisite policy section.

### root-specialists-repo-compose-yml-is-local-dev
Root specialists repo compose.yml is local dev only: container_name should be sp-service-dev; darth-feedor/consumer compose owns specialists-service; old specialists-specialists-1 is Compose auto-name until recreated.

### runner-ts-already-injects-a-universal-specialist-run
runner.ts already injects a universal Specialist Run Context block; worktree-awareness should likely be injected nearby using worktree_path/branch from status.json or explicit run options, and tests should assert injection for READ_ONLY runs too.

### runner-ts-now-appends-mandatory-rules-to-task
runner.ts now appends MANDATORY_RULES to task prompt after template render, with missing mandatory-rules index.json skipped non-fatally and token budget capped at ~400.

### script-class-specialists-should-pass-rendered-task-prompts
script-class specialists should pass rendered task prompts to pi via stdin, not argv: avoids process-list prompt leakage and prevents prompts beginning with -- or @ from being parsed as CLI args/files; keep --system-prompt separate and keep prompt-size hardening as follow-up.

### script-runner-false-positive-fix-validate-template-against
script-runner false-positive fix: validate template against variable keys before renderTemplate; rendered output may legally contain literal  tokens from data values.

### script-runner-overflow-test-needs-explicit-wait-for
script-runner overflow test needs explicit wait-for-spawn before emitting stdout chunks; otherwise mock child can fire before listeners attach and vitest hangs.

### script-service-specialists-fail-closed-for-local-scripts
script/service specialists fail closed for local scripts: skills.scripts are always rejected and sp serve --allow-local-scripts is unsupported until a sandboxed local-script lifecycle is designed; --allow-skills remains separate for prompt skill sources.

### script-specialist-prompt-preflight-uses-execution-prompt-lim
script-specialist prompt preflight uses execution.prompt_limit_bytes first, then SPECIALISTS_SCRIPT_PROMPT_LIMIT_BYTES, then 4MiB default; over-limit requests return error_type prompt_too_large before spawning Pi so service clients can retry/drop deterministically.

### security-pipeline-bootstrap-in-specialists-do-not-run
Security pipeline bootstrap in specialists: do not run pre-commit pre-push with --all-files here; trailing-whitespace/end-of-file hooks mutate hundreds of tracked generated files. The committed .githooks pre-push baseline runs semgrep-diff directly and OSV informational instead.

### serena-extension-intercepts-native-filesystem-tools-read-gre
Serena extension intercepts native filesystem tools (read/grep/find/ls) at runtime and refuses them with 'Tool X is disabled. Use Serena tools instead.', regardless of whether they are present in pi --tools. Verified by probes 83u8q (explorer) and xqzg6 (executor): explorer's --tools includes 'read' (no override on read) yet runtime call was denied; executor with no permissions override block also got denials. Implication: catalog --tools currently overstates what's actually usable at runtime. The permissions[TIER] override block's role is not to functionally block (Serena does that) but to make policy explicit, save tokens by not exposing the tool to the model, and drive auto-restore behavior when extensions degrade.

### serena-http-mode-streamable-http-already-exists-one
Serena HTTP mode (streamable-http) already exists — one server per repo root shared across all worktrees. Key blocker: #1496 --project-from-cwd goes stale; must pass --project <repo-root> explicitly. Source: src/serena/mcp.py. This is the 90% RAM win for P0 unitAI-c4g0m with no upstream code changes needed.

### serena-pool-e2e-test-bun-extensions-serena-pool
serena-pool e2e test: bun extensions/serena-pool/test/e2e.ts from packages/pi-extensions. DEBUG=serena-pool enables decision trace. Validates: cold start, warm reuse, dead recovery, synthetic orphan cleanup (fake bash group), concurrent 5x spawn. Requires uvx on PATH.

### serena-pool-extension-path-in-pi-extensions-packages
serena-pool extension path in pi-extensions: packages/pi-extensions/extensions/serena-pool/index.ts. Loaded by specialists via join(npmGlobalDir, '@jaggerxtrm', 'pi-extensions', 'extensions', 'serena-pool') in session.ts BEFORE pi-serena-tools. Sets SERENA_MCP_PORT to hashToPort(gitRoot), range 40000-44999. Serena persists as daemon — no session_shutdown handler.

### serena-pool-orphan-cleanup-spawn-serena-detached-pgid
serena-pool orphan cleanup: spawn Serena detached (pgid==pid), persist {pid,pgid,startTime,instanceId} to /tmp/serena-pool/pool-<port>.json. On session_start, if port not listening, acquire per-port file lock, verify recorded Serena dead via pid+startTime, then kill its process group (SIGTERM, wait 2s, SIGKILL). Process-group filter — never path-matching. Editor LSPs / tests / hooks untouched.

### serena-project-server-is-already-a-multi-project
Serena project-server is already a multi-project HTTP cache: it loads queried projects on demand, caches them by root, and instantiates language-server managers lazily; good starting point for daemon/pool design.

### session-2026-05-24-26-closed-with-handoff
Session 2026-05-24→26 closed with handoff bead unitAI-bb346. Iron-review-hardening epic + bd auto-stage fix landed. v3.17.0 deliberately deferred for soak. Next-session pickup priorities: soak, xtrm-h9hqg, v3.17.0 cut, broken-bd-state triage.

### session-continuation-from-ad93j-fln4q-a-complete-and
Session continuation from ad93j: fln4q-A complete and pushed (8ce14c16); fln4q-B (1ypy2) partial → split into B1 (t8o6o, complete b41c746e) and B2 (fktxa, watchdog work staged on feature/unitAI-fktxa-executor pending commit). Open: ppkdg, jjp7w (post-cleanup), c6he0 (gitnexus CLI fallback), and re-review beads. Main repo dirty with prior-session WIP — merge deferred.

### session-factory-mock-pattern-any-test-that-mocks
session-factory-mock-pattern: Any test that mocks SessionFactory (vi.fn().mockResolvedValue(mockSession)) must include close and getState in the mock object alongside start/prompt/waitForDone/getLastOutput/kill/meta. Missing these causes 'close is not a function' runtime errors in runner.ts Phase 2+. Files: runner.test.ts, runner-scripts.test.ts.

### session-report-template-saved-at-xtrm-report-templates
session report template saved at .xtrm/report-templates/session-report-reference.md — use as inspiration for automated xtrm session report feature. Key sections: Summary, Changes (per-file), Bugs Fixed (table), Issues Filed, Beads Closed, Next Steps. Design principle: structure not constraint, detailed where it matters.

### session-ts-loads-serena-pool-synchronously-before-pi
session.ts loads serena-pool synchronously before pi spawn (dynamic import of global @jaggerxtrm/pi-extensions/.../serena-pool/index.ts via Bun). Sets SERENA_MCP_PORT in baseEnv so pi-serena-tools picks it up at construction. The Pi extension's session_start handler was too late — pi-serena-tools caches the env in createSerenaServerManager constructor.

### session-ts-pi-spawn-now-uses-detached-true
session.ts pi spawn now uses detached:true. close()/kill() do graceful SIGTERM first, then group-SIGKILL backstop after 8s via process.kill(-pid, SIGKILL). Replaces old 2s redundant SIGTERM that aborted pi's in-flight MCP dispose (rpc-mode.js:533 process.exit guard). Fixes gitnexus-mcp leak under --keep-alive teardown. The 2s window was too short for MCP transport.close() worst case (~4s/server: stdin.end 2s -> SIGTERM 2s -> SIGKILL). 8s gives pi-mcp-adapter time to call manager.closeAll() cleanly via session_shutdown event handler in pi-mcp-adapter/index.ts:137.

### sessionrunmetrics-src-pi-session-ts-and-timelinerunmetrics-s
SessionRunMetrics (src/pi/session.ts) and TimelineRunMetrics (src/specialist/timeline-events.ts) are intentionally separate types — SessionRunMetrics is runtime state persisted in status.json, TimelineRunMetrics is the persistence schema for run_complete events. Do not unify them; the separation is correct design.

### sgw9g-agents-md-sentinels-agents-md-specialists-block
sgw9g-agents-md-sentinels: AGENTS.md Specialists block now wrapped in <!-- specialists:start --> / <!-- specialists:end -->. ensureAgentsMd has 4 branches: (1) no file → write block (2) sentinels present → idempotent replace (3) legacy AGENTS_MARKER only → migrate by parsing next H2 / EOF and replacing full legacy span (4) neither → append. README.md no longer falsely claims sp init injects CLAUDE.md (only AGENTS.md). Code-sanity caught initial brittle legacy-marker splice; executor fixed via H2-boundary parse. 3o3gf audit covered by this impl.

### shared-observability-test-fixtures-live-in-tests-utils
Shared observability test fixtures live in tests/utils/observabilityFixtures.ts and seed SQLite-native status, events, result, and full-job records for CLI runtime tests.

### sigterm-waiting-flush-fix-good-but-skip-final
SIGTERM waiting flush fix good, but skip-final flag should set only after successful append to avoid losing retry chance when bead append fails.

### skill-source-of-truth-is-config-skills-name
Skill source-of-truth is config/skills/<name>/SKILL.md — NOT .xtrm/skills/default or .xtrm/skills/active. Install flow: config/skills → .xtrm/skills/default (copied via 'sp init --sync-skills') → .xtrm/skills/active/{claude,pi}/<name> (symlinks to default). Editing .xtrm/skills/default gets overwritten on next init. Editing .xtrm/skills/active/* goes through symlinks to default — also lost. ALWAYS edit config/skills/. This applies to sync-docs targets, skill improvements, and any programmatic skill updates.

### skillopt-research-unitai-544sf-3-microsoft-skillopt-trains
SkillOpt research (unitAI-544sf.3, microsoft/SkillOpt): trains skills like NN WITHOUT weight updates — 6-stage loop rollout(scored trajectories)→reflect(patch dicts)→aggregate→select→update(candidate_skill.md)→evaluate_gate (accept only if candidate beats current score; new best if beats best). Emits SKILL.md with YAML frontmatter+body — SAME shape as our skills (main mismatch is metadata schema + validation harness, not doc format). Cost knobs: batch_size 40 traj/step, workers 8, analyst_workers 16, optimizer/target default gpt-5.5. RECOMMENDATION: do NOT make live self-editing now; PILOT post-Phase-6 / after v4 freeze (roadmap §714-728 wants clean post-ship revamp not drip patches), quarterly cadence, pilot 1 skill first with held-out task set + frozen registry snapshot; accept only if primary metric improves + no regressions. Risk: overfit to transient runtime traces, needs real A/B harness.

### skillopt-style-update-loop-fits-our-skill-md
SkillOpt-style update loop fits our SKILL.md artifacts structurally because both are markdown frontmatter + body; best use is post-ship batch refresh with held-out eval, not per-commit self-edit.

### smoke-testing-specialist-handoff-output-from-unitai-438ve
Smoke-testing specialist handoff output (from unitAI-438ve): supervisor handoff blocks render WITHOUT emoji — canonical block is greppable via heavy '═'×70 rule + '### <spec> · <model> · [FINAL · DONE]'; trail blocks use light '_'×70 + '[turn N · WORKING|WAITING]'. To smoke-test: 'sp run <spec> --bead <b>' (full-trail → trail + FINAL blocks land in bd notes); a spec with notes_mode='final-only' → exactly one canonical block. GOTCHA: output_file is gated by SPECIALISTS_JOB_FILE_OUTPUT and only works FOREGROUND — --background jobs run in a tmux session that does NOT inherit CLI env, so output_file is silently skipped in background (tracked: unitAI-f58ma). To verify output_file: run foreground 'env SPECIALISTS_JOB_FILE_OUTPUT=on sp run <spec> --bead <b>'.

### smoke-verification-for-unitai-bnsk7-tests-unit-specialist
Smoke verification for unitAI-bnsk7: tests/unit/specialist/worktree.test.ts and tests/unit/specialist/node-supervisor-worktree.test.ts passed, confirming provisionWorktree v2 .beads symlink behavior.

### soft-deny-phase-needs-resolver-output-resolved-config
Soft-deny phase needs resolver output + resolved-config report to surface preferenceSignals and deny mode, while config show must feed specialist.permissions into resolver input; otherwise soft preference stays invisible even when tools list unchanged.

### sp-chat-attach-safe-control-semantics-ctrl-c
sp chat attach-safe control semantics: Ctrl+C and /quit must detach/restore/exit the TUI without calling stopJob; /stop is the explicit kill path. Install any stdin fallback only after tui.start() so raw-mode acquisition is not broken.

### sp-chat-docs-must-distinguish-current-launch-only
sp chat docs must distinguish current launch-only TUI from legacy tmux sp attach: chat combines feed/result/status/input and maps freeform input to steer or resume; existing-job TUI attach is planned separately under unitAI-hx4ln.

### sp-chat-feed-parity-needs-three-pieces-from
sp chat feed parity needs three pieces from sp feed/result: event-key dedupe so repeated THINK/TEXT stream events render once per phase/turn, startup/payload context side-lines, and run_complete.output appended so final result surfaces in the TUI.

### sp-chat-feed-rendering-should-not-consume-specialistrunner
sp chat feed rendering should not consume SpecialistRunner onProgress raw deltas directly; use the same events.jsonl tailing path as sp run/feed and format via formatEventInlineDebounced so thinking/text/tool phases are debounced and final output is rendered once.

### sp-chat-feed-should-mirror-sp-feed-exactly
sp chat feed should mirror sp feed exactly: tail SQLite/events timeline and render with formatEventLine, suppress chat:/stderr startup preamble while TUI owns terminal, and pin ChatStatus to the current chat job id to avoid stale global active-job rows.

### sp-chat-input-must-perform-real-control-actions
sp chat input must perform real control actions, not just render queued text: plain input writes {type:steer,message} for running jobs or {type:resume,task} for waiting jobs to status.fifo_path; /stop and /finalize call specialist control helpers; /notes calls appendBeadNote.

### sp-chat-pi-tui-rendering-fix-tui-ignores
sp chat pi-tui rendering fix: TUI ignores tui.root and Container constructor options; mount components with tui.addChild(root), call tui.start(), then force/request one render and yield before starting launchSpecialist so the initial feed/status/input frame is visible. Smoke tests must assert visible feed/input cursor, not only CSI takeover escapes.

### sp-chat-v1-delivered-wave-1-u4fdd-1
sp chat V1 delivered: Wave 1 (u4fdd.1-5 impls + u4fdd.8/9 tests) + Wave 2 (u4fdd.6 entrypoint) + Wave 3 (u4fdd.7 smoke) all merged to master. @earendil-works/pi-tui@^0.75.4 added as direct dep. Smoke test runs ~20s, 2/2 pass. Component is interface in pi-tui (not class) — chat feed implements Component (render+invalidate). Out-of-band: dep was installed by orchestrator before Wave 2 to unblock Wave 1 imports.

### sp-clean-keep-now-protects-epic-chain-root
sp clean --keep now protects epic chain-root jobs by default via epic_chain_membership lookup; --aggressive-prune bypasses protection; ps include-terminal renders terminal epics with orphaned chain rows.

### sp-clean-reap-orphans-now-includes-deleted-cwd
sp clean --reap-orphans now includes deleted-cwd Dolt sql-server and deleted-cwd tool processes surfaced by sp ps --health.

### sp-config-show-resolved-from-source-can-be
sp config show --resolved --from-source can be implemented by dist wrapper spawning bunx tsx src/index.ts, while source runtime short-circuits locally; worktree warning can key off git common-dir vs top-level plus runtime package version mismatch.

### sp-config-show-resolved-now-routes-through-shared
sp config show --resolved now routes through shared phase-2 resolver via src/specialist/resolution-diagnostics.ts; config CLI tests needed mocking of edit alias to avoid real edit path.

### sp-doctor-now-resolves-canonical-package-assets-via
sp doctor now resolves canonical package assets via resolveCanonicalAssetDir fallback, so drift checks work in packed installs and source checkouts.

### sp-epic-cli-new-command-surface-for-epic
sp epic CLI: new command surface for epic lifecycle management. 'sp epic list' enumerates epics with status and readiness, 'sp epic status <id>' shows chains/blockers/readiness, 'sp epic resolve <id>' transitions open->resolving. All commands support --json output. Reads from observability SQLite (epic_runs, epic_chain_membership tables).

### sp-list-full-now-surfaces-worktree-badge-chain
sp list --full now surfaces worktree badge, chain-position badge, median runtime, and filtered mandatory rule sets; list --json and non-full output unchanged.

### sp-log-color-style-keep-human-output-restrained
sp log color style: keep human output restrained/professional — metadata dim, identifiers mostly plain/bold, green only success, yellow warnings/cancel/control, red failures; avoid rainbow job/status colors.

### sp-log-duplicate-handling-unitai-f5k0p-real-mercury
sp log duplicate handling unitAI-f5k0p: real mercury logs had duplicate RETRY rows with adjacent seq/timestamps; human mode now collapses near-identical display rows within 2s, while --json preserves full event fidelity. status=<state> is color-coded again with restrained semantic colors.

### sp-log-global-mode-unitai-v5xfu-from-a
sp log global mode unitAI-v5xfu: from a repo root reads that repo DB; from a parent with no local DB scans immediate child repos with .specialists/db/observability.db, aggregates logs, and supports --repo <name> filtering.

### sp-log-lean-default-unitai-vfqgq-excludes-agent
sp log lean default unitAI-vfqgq: excludes agent internal feed events unless all events flag is used; human rows use compact worktree field and colorized event labels.

### sp-log-unitai-gqpvw-is-the-full-specialist
sp log (unitAI-gqpvw) is the full specialist runtime/control/error stream: use it instead of compact sp feed for reviewer/code-sanity crashes, cancelled jobs, stop/resume/steer provenance, and terminal error tracing. Rows include timestamp, job, specialist, bead, repo/path, branch, status, pid, model, chain, seq, event; JSON mode preserves full event payload.

### sp-merge-can-report-merge-conflict-while-merging
sp merge can report 'Merge conflict while merging <branch>' without conflict files when dirty tracked .beads/issues.jsonl would be overwritten. Safe recovery: bd export -o .beads/issues.jsonl after conflicts, then git stash push -m pre-sp-merge-beads -- .beads/issues.jsonl before retrying sp merge; avoid git stash -a because it can hide ignored .specialists job metadata.

### sp-merge-conflict-fallback-pattern-when-sp-merge
sp merge conflict fallback pattern: when sp merge fails with 'Merge conflict', root causes are (1) stale .git/index.lock from a crashed merge attempt — fix: rm .git/index.lock, and (2) noise files staged from prior squash attempts. Manual path: rm .git/index.lock if present, git merge --squash <feature-branch>, git reset HEAD <noise-files>, git add <release-scope-only>, git commit. Use git branch -D (not -d) to delete squash-merged branches since --squash doesn't create a merge commit in the DAG.

### sp-merge-worktree-branch-divergence-when-parallel-executors
sp merge worktree branch divergence: when parallel executors run in separate worktrees, each worktree branches from master at dispatch time. If Wave A merges first, Wave B's worktree is now stale — its diff against master shows reversions of Wave A's changes. Must rebase (git rebase master) in the worktree before merging, or the merge will revert prior wave's work.

### sp-node-steer-node-id-message-steers-the
sp node steer <node-id> <message> steers the COORDINATOR (writes to coordinator FIFO), not a member. The name implies member targeting but it doesn't. Any future member-targeted steering needs a new command (e.g. sp node steer --member <key>) or a redesigned surface. Do NOT teach coordinators to call sp node steer on themselves.

### sp-prune-stale-defaults-help-was-destructive-executed
sp prune-stale-defaults --help was destructive (executed prune instead of printing help) until ca6bl. Pattern: any new sp subcommand MUST recognize --help/-h before running its main function. Test the help flag explicitly.

### sp-ps-current-tool-staleness-sp-ps-reads
sp ps current_tool staleness: sp ps reads status_json snapshot where current_tool is set on tool start but never cleared. sp feed reads event stream which has correct tool lifecycle. Fix: derive current_tool from specialist_events at read time (unitAI-66xn) AND clear it in supervisor onToolEndCallback (unitAI-yke7). This caused a false-positive hung job kill during the always-worktree design session.

### sp-ps-default-aggregate-health-detailed-process-tables
sp ps default aggregate health; detailed process tables are opt-in via sp ps --health.

### sp-ps-default-is-active-jobs-only-terminal
sp ps default is active jobs only; terminal historical DB rows should require --include-terminal or --all, otherwise sp clean appears ineffective despite no running/waiting jobs.

### sp-ps-design-model-job-trees-via-explicit
sp ps design: model job trees via explicit reused_from_job_id/worktree_owner_job_id plus denormalized context snapshot in status; render one unified tree that groups worktree chains and node members with urgency-first ordering.

### sp-ps-f-follow-rendering-hardening-use-process
sp ps -f follow rendering hardening: use process.stdout.isTTY guard; TTY should enter alternate screen/hide cursor and render via stdout.write with cleanup on SIGINT/SIGTERM/exit/EPIPE; non-TTY should strip ANSI and append snapshots.

### sp-ps-follow-rendering-should-dedupe-statuses-by
sp ps follow rendering should dedupe statuses by id and track rendered job IDs to keep row/footer counts stable across epic/node/worktree sections.

### sp-ps-health-now-uses-shared-process-health
sp ps health now uses shared process-health helper for orphan detection, Dolt/Serena/RSS reporting, and ps clean reuse.

### sp-ps-needs-pid-liveness-check-to-filter
sp ps needs PID liveness check to filter dead jobs — stale status.json files from killed processes show as active. The PID watchdog (supervisor.ts) only runs during active jobs; sp ps renderer should also check process.kill(pid, 0) before displaying.

### sp-ps-process-health-severity-must-include-non
sp ps process-health severity must include non-memory alerts: Dolt sql-server count >1 and orphan process count >0 should make the headline WARN even when RSS is below threshold; unitAI-uof0t manual validation caught this.

### sp-ps-process-health-specialist-count-should-be
sp ps process-health specialist count should be narrow: count direct specialists/sp run processes and pi-coding-agent only; do not count Serena/GitNexus MCP, tsserver, shell wrappers, or generic tooling. Unknown ps flags like --ps should error with a sp clean --ps hint.

### sp-release-prepare-now-supports-explicit-from-to
sp release prepare now supports explicit --from/--to backfill mode with optional --insert-after; package.json version bump skipped in backfill mode.

### sp-run-background-tmux-wrapper-must-use-bin
sp run --background tmux wrapper must use /bin/bash -c not -lc: login shell (-lc) rebuilds PATH from /etc/profile only, stripping NVM/bun entries in ~/.bashrc, causing pi spawn ENOENT. Fixed in baz0t. If --background ever breaks again with ENOENT, check the tmuxCmd shell flag in src/cli/run.ts first.

### sp-script-cli-now-uses-shared-runscriptspecialist-path
sp script CLI now uses shared runScriptSpecialist path; flock wrapper via env SP_SCRIPT_NO_LOCK=1 gives cron-safe single-instance exit 75 without new deps.

### sp-script-runner-stdout-cap-now-resolves-spec
sp script-runner stdout cap now resolves spec stdout_limit_bytes first, then env SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES, then 32MB default; classifyAttempt error_type output_too_large stays bounded.

### sp-script-serve-db-path-now-means-an
sp script/serve --db-path now means an exact observability SQLite file path; omit it for the project default .specialists/db/observability.db.

### sp-serve-must-pass-projectdir-through-to-runscriptspecialist
sp serve must pass projectDir through to runScriptSpecialist and Pi child spawn cwd must use options.projectDir; otherwise service-class specialists run from orchestrator cwd even when --user-dir/--project-dir points at a production pipeline project.

### sp-serve-needs-inline-per-request-ops-logs
sp serve needs inline per-request ops logs in serve.ts; observability.db alone is audit, not operator visibility

### sp-serve-now-emits-structured-json-operational-logs
sp serve now emits structured JSON operational logs per /v1/generate request with trace_id, specialist, resolved_specialist, model, status, duration_ms, prompt_bytes, and short error text; --log-level off suppresses output.

### sp-serve-readiness-canary-is-optional-off-by
sp serve readiness canary is optional: off by default, warn returns ready with warning, require blocks /readyz with pi_binary_missing/pi_flag_missing/pi_smoke_failed.

### sp-serve-readiness-pattern-keep-the-readiness-evaluator
sp serve readiness pattern: keep the readiness evaluator (evaluateReadiness) as a pure async function exported from serve.ts so it's unit-testable without spinning up an HTTP server. State (shuttingDown flag, audit-failure timestamp window, dbWriteFailuresTotal counter) lives in a plain ReadinessState object — caller passes it in, we mutate. The 60s sliding-window pruning happens both on increment and on each readyz call. Audit failures wire from script-runner via an onAuditFailure callback in ScriptRunnerOptions; writeTraceRow wraps upsertStatus/upsertResult in try/catch and invokes the callback. Failure precedence: draining > degraded:audit > pi_config_unreadable > db_not_writable > user-dir checks.

### sp-serve-relies-on-createobservabilitysqliteclient-and-resol
sp serve relies on createObservabilitySqliteClient and resolveObservabilityDbLocation; integration tests in vitest may need file-level DB assertions because bun:sqlite client is unavailable in node-loader context

### sp-serve-trust-flags-pattern-default-reject-for
sp serve trust flags pattern: default-reject for skills.paths, prompt.skill_inherit, skills.scripts. Three CLI flags gate them: --allow-skills (paths + skill_inherit), --allow-skills-roots <p1>:<p2> (path-prefix allowlist, only effective with --allow-skills), --allow-local-scripts (scripts). compatGuard takes optional TrustOptions; ScriptRunnerOptions.trust threads from serve.ts. When --allow-skills enabled, computeSkillSources(spec) reads each resolved path and embeds {path, sha256} into status.skill_sources for audit (lands in specialist_jobs.status_json via JSON.stringify). Unreadable files get sha256='unreadable' rather than throwing.

### sp-stop-and-supervisor-terminal-close-now-gate
sp stop and supervisor terminal close now gate bead auto-close on sibling live jobs via single listLiveJobsForBead sqlite query; filter self, skip close when other starting/running/waiting jobs remain.

### sp-stop-fix-landed-in-stop-specialist-tool
sp stop fix landed in stop_specialist tool: write terminal status before SIGTERM; run_complete evidence maps to done, otherwise cancelled.

### sp-stop-marks-status-terminal-before-sigterm-waiting
sp stop marks status terminal before SIGTERM; waiting keepAlive job may miss post-keepAlive bead append unless SIGTERM path flushes latestOutput to input bead

### sp-stop-should-persist-terminal-status-before-sigterm
sp stop should persist terminal status before SIGTERM; wrapping supervisor.updateJobStatus in a dedicated helper keeps write-before-kill order obvious and avoids future regressions.

### sp-stop-sigterm-terminal-status-fix-already-in
sp stop SIGTERM terminal status fix already in codebase (commit 260e7246). resolveTerminalStatus checks hasRunCompleteEvent, writes done/cancelled to status.json before SIGTERM. Task was a duplicate/retest benchmark seed.

### sp-stop-terminal-status-fix-already-committed-in
sp-stop-terminal-status: Fix already committed in 260e7246. stop.ts writes terminal status (done/cancelled) via hasRunCompleteEvent BEFORE sending SIGTERM. No changes needed.

### sp-validate-now-supports-target-script-with-script
sp validate now supports --target=script with script-runner compatGuard and preserves schema-only default path validation

### sp-view-edit-list-is-the-specialist-config
sp view/edit/list is the specialist config UX triad: view=read (pretty-print), edit=write (dot-path mutation), list=discover. Users should never need to open raw JSON files directly.

### spawnsync-stdin-block-spawnsync-without-explicit-stdio-confi
spawnSync-stdin-block: spawnSync() without explicit stdio config inherits parent stdin. When called from a script run as a background process or non-TTY, stdin is an open pipe that blocks child processes waiting for input. Fix: always pass stdio: ['ignore', 'pipe', 'pipe'] to spawnSync in utility scripts that don't need stdin. Symptom is silent hang with no output — diagnosed via PID check, not error messages.

### spec-driven-frameworks-that-work-well-with-beads
Spec-driven frameworks that work well with beads/specialists keep artifacts small and reviewable: proposal/spec/plan/tasks, explicit validation gates, and archive/sync or resume semantics. Borrow traceability and checkpoints; avoid rigid waterfall phase ordering when local work needs iteration.

### spec-framework-design-for-specialists-implement-a-thin
Spec framework design for specialists: implement a thin sp spec CLI, not direct slash-command bead creation. Use docs/specs/<slug>/spec.yaml as intent artifact; validate 7-section mappability, SCRUTINY, testability, scope, dependency sanity; sp spec apply creates planner bead and routes through planner/test-planning as compiler backend. /create-spec remains draft-only alias.

### specialist-chain-epic-lifecycle-redesign-delivered-2026-05
Specialist chain/epic lifecycle redesign delivered 2026-05-05. Findings: .wolf/scratch/chain-lifecycle-findings.md (deadlock loops A/B/C with file:line). Redesign: .wolf/scratch/chain-lifecycle-redesign.md. Core rule: reviewer PASS auto-finalizes waiting --keep-alive executor via finalizeChain() in supervisor.ts; new sp finalize <chain> command as retry; sp merge allowed for publishable PASS chain inside unresolved epic; FAILED persisted state heals on recompute via sp epic sync --apply. Files to change: supervisor.ts, jobRegistry.ts, epic-readiness.ts, epic-reconciler.ts, merge.ts, epic.ts, NEW src/cli/finalize.ts. Meta-confirmation: closing this overthinker required sp stop --force because resume End does not terminate waiting state — exactly the deadlock the redesign fixes.

### specialist-creator-workflow-is-now-scaffold-specialist-ts
specialist-creator workflow is now: scaffold-specialist.ts (pre-script, fills missing fields) → sp edit for mutations → sp view to verify. Dead config fields: communication.next_specialists, preferred_profile, approval_mode, normalize_template, heartbeat — exist in schema but never consumed by runtime.

### specialist-executors-must-not-spawn-nested-sp-run
Specialist executors must NOT spawn nested 'sp run <specialist>' synchronously — supervisor blocks and the parent stalls with StallTimeoutError (~120s). Witnessed on qujxo.2 job 3203cf when bead VALIDATION asked for live tier verification. Workaround: use 'sp config show --resolved <name>' for parity proof (filesystem-only) or dispatch nested specialists with --background and only poll once. Bead contracts that ask for live spawn evidence should redirect to the static resolver path.

### specialist-job-metrics-now-auto-aggregates-on-terminal
specialist_job_metrics now auto-aggregates on terminal status writes, with additive active_runtime_ms/waiting_ms migration and stats table seconds columns derived from ms values.

### specialist-json-output-e-g-changelog-keeper-must
Specialist JSON output (e.g. changelog-keeper) must be defensively normalized in callers — LLMs can omit schema-required fields. extractReleaseDraft now coerces missing sections to []. Pattern applies to any 'JSON.parse(modelOutput) as TypedShape' site.

### specialist-mandatory-rule-payload-breakdown-must-measure-eac
specialist mandatory_rule payload_breakdown must measure each rendered section, not reused combined block; keep sections in buildMandatoryRulesInjection for accurate per-set payload accounting.

### specialist-metadata-descriptions-now-use-list-friendly-routi
specialist metadata descriptions now use list-friendly routing format: first clause names task shape, then choose-when/do-not-choose-when/distinctive capability/permission note. specialists-creator v1.2 teaches this for future .specialist.json authoring.

### specialist-monitoring-should-prefer-raw-tokns-totals-over
Specialist monitoring should prefer raw TOKNS totals over context percentage: around 50k tokens, steer toward conclusion/handoff unless deep run is intentional; 75k+ usually means stop-and-summarize or fresh narrower bead to avoid context rot.

### specialist-per-turn-handoff-notes-appendbeadnote-src-special
Specialist per-turn handoff notes: appendBeadNote (src/specialist/bead-notes.ts) used to call 'bd update --notes' which REPLACES the whole notes field — so each turn's auto-note clobbered the previous (explains why historical multi-turn bead notes show only the last/empty turn). FIXED (unitAI-sx5qk) to 'bd update --append-notes' so turns accumulate. Also formatBeadNotes (now EXPORTED in supervisor.ts) emits a 70-underscore divider between turns + header '### 🔬 <specialist> · <model> · [<status>]' + token-usage metadata (input/output/cache) wired from runMetrics.token_usage / finalResult.metrics. Tests: bead-notes.test.ts + NEW supervisor-bead-notes.test.ts (supervisor.test.ts is excluded from default vitest — FIFO hang in worktrees; DO NOT add tests there, use sibling files). Recovery tip if notes ever empty again: specialist_events.text_content (type=turn_summary) in .specialists/db/observability.db holds the full final text.

### specialist-prompt-audit-2026-05-06-test-runner
Specialist prompt audit (2026-05-06): test-runner hardcodes bun+vitest in 4 places (BLOCKER for non-JS projects). executor+debugger hardcode tsc/npm lint (WARN). changelog-keeper hardcodes 'npm run build' (project-pinned vs portable decision pending). security-auditor is multi-language. User specialists clean. Follow-ups: unitAI-0er69 (P1 fix test-runner), unitAI-dults (P2 soften executor/debugger), unitAI-61qaa (P3 changelog-keeper portability decision), unitAI-f28ad (P2 explorer harness fix).

### specialist-prompts-hard-instruct-mcp-only-gitnexus-calls
specialist prompts hard-instruct MCP-only GitNexus calls (gitnexus_query/_context/_impact) — when MCP tools aren't loaded in harness, specialists fall through to grep/Read and reviewer flags missing GitNexus evidence (c6he0). Fix: prompts now show MCP and 'npx gitnexus' CLI equivalents inline; reviewer accepts either form. Mandatory-rule gitnexus-required.md already had both — but rule guidance is overridden by spec system+task_template content if those only show MCP. Lesson: when adding tool-fallback to a mandatory rule, audit specialist system+task_template for hard-instructed MCP-only call patterns and update those too.

### specialist-report-v1-now-uses-semantic-output-type
Specialist Report v1 now uses semantic output_type enums and runner-enforced structured output contracts with warn-only schema validation for json/markdown machine blocks.

### specialist-runner-injects-xtrm-memory-md-bd-prime
specialist runner injects .xtrm/memory.md + bd prime at spawn — ~3800 tokens total, prevents rediscovering known gotchas

### specialist-runner-now-injects-output-contract-instructions-f
Specialist runner now injects output contract instructions from response_format/output_type/output_schema and performs warn-only post-run schema validation (including mandatory markdown machine-readable JSON block).

### specialist-runner-sets-bead-claim-kv-before-spawn
specialist runner sets bead-claim KV before spawn — edit gate checks this as fallback to session claim, enabling worktree specialists to edit without blocking

### specialist-skills-paths-are-project-local-skills-paths
specialist-skills-paths-are-project-local: skills.paths in specialist YAMLs must use .agents/skills/<name>/ (project-relative), NOT ~/.agents/skills/ — that path does not exist on this machine. Executors consistently default to the ~ prefix when inferring paths. Always verify with ls .agents/skills/ before wiring.

### specialist-staleness-stale-flag-can-t-be-cleared
Specialist staleness STALE flag can't be cleared by a same-day metadata.updated bump (loader.ts:46-51). computeStaleness does updatedMs=new Date(metadata.updated).getTime() which parses a 'YYYY-MM-DD' string as MIDNIGHT UTC, then flags STALE when watched-file mtimeMs > updatedMs. A files_to_watch target touched later the SAME calendar day (e.g. 03:4x) has mtime > midnight, so it stays STALE until metadata.updated is a LATER date (or an ISO timestamp >= the file mtime). The mechanism is day-granular in intent (stale_threshold_days is in days) but the comparison is ms-granular — a real minor bug. Proper fix: compare date-granular (truncate mtimeMs to its date vs updated date). Workaround if you must clear it today: set updated to a full ISO timestamp after the file mtime (breaks the YYYY-MM-DD convention) or next day's date (inaccurate). Surfaced bumping specialists-creator.specialist.json to 1.4.1/2026-05-30 after the SKILL.md refresh (unitAI-tkl69).

### specialist-sub-bead-root-cause-specialists-creating-unnecess
specialist-sub-bead-root-cause: Specialists creating unnecessary sub-beads is NOT caused by hooks/extensions (--no-extensions already wired in session.ts). Root cause is pi loading the project's CLAUDE.md which contains edit-gate instructions telling agents to bd create before editing. Fix: runner.ts injects 'Specialist Run Context' system prompt override when inputBeadId is present, overriding CLAUDE.md behavior. A future --no-claude-md pi flag would be cleaner but doesn't exist yet.

### specialist-tier-resolution-specialistloader-prefers-speciali
specialist tier resolution: SpecialistLoader prefers .specialists/user/<name> over .specialists/default/<name> over config/specialists/<name>. A stale user overlay can silently shadow recent default fixes (system prompt, mandatory_rules template_sets, skill paths). Symptoms: meta event mandatory_rules_injection.sets_loaded reports fewer sets than expected; reviewer flags missing evidence the default would have prevented. Discovered via zleim investigation 2026-04-28; explorer.specialist.json user overlay shadowed serena-cheatsheet AND c6he0 CLI-fallback fix. Detection workflow filed as follow-up.

### specialistloader-precedence-now-scans-specialists-user-first
SpecialistLoader precedence now scans .specialists/user first, then .specialists/default, then config/specialists fallback; edit flow excludes package fallback from mutable targets.

### specialistrunner-now-injects-hard-cwd-worktree-boundary-miss
SpecialistRunner now injects hard cwd/worktree boundary + missing-evidence stop rule into bead-driven Specialist Run Context for input-bead runs.

### specialists-authoring-docs-must-include-execution-extensions
Specialists authoring docs must include execution.extensions.serena/gitnexus opt-out; creators should set false for vision workflows needing native Read.

### specialists-complete-hook-can-derive-completion-banners-from
specialists-complete hook can derive completion banners from sp poll JSON and keep marker cleanup unchanged when status.json absent

### specialists-creator-9ilgw-audit-findings-1-3-4
specialists-creator-9ilgw: Audit findings 1,3,4,5,6 already fixed in earlier sessions. Finding 2 (missing fallback_model) addressed by adding google-gemini-cli/gemini-3.1-pro-preview to config/specialists/specialists-creator.specialist.json. Audit script reports 26 specs · 0 parse errors · 0 unknown keys.

### specialists-destructive-ops-prohibited-specialists-must-neve
specialists-destructive-ops-prohibited: Specialists must never perform destructive or irreversible operations — no rm -rf, no force push, no database drops, no mass deletes, no credential rotation, no history rewrites. If a task requires destructive action, the specialist must stop and surface it to the user. This is Hard Rule 7 in using-specialists v3.7 and should be enforced in specialist YAML permissions and coordinator instructions.

### specialists-feed-tail-semantics-for-a-real-tail
specialists feed tail semantics: for a real tail -f experience, initial backlog should replay oldest-to-newest so the freshest historical lines land at the bottom; newest-first startup ordering looks wrong even if live updates append correctly.

### specialists-feed-vs-result-specialists-feed-follow-gets
specialists-feed-vs-result: 'specialists feed --follow' gets captured as a background Claude Code task — use 'specialists result <job-id>' instead. The real specialists job ID is printed inside the .output file (look for 'Job started: <id>'), not the Claude Code task ID returned by the Bash tool.

### specialists-frequently-leave-work-staged-but-uncommitted-eve
Specialists frequently leave work staged-but-uncommitted, even after producing successful test/build runs. Recurring across multiple chains in this session (B doctor.ts, B2 watchdog, A's c9he9+n17dw bundle). Always verify 'git log master..HEAD' AND 'git status --short' in the worktree after an executor reports success — don't trust 'success' status alone. Common fix: re-dispatch executor with explicit commit-only steer, or commit directly after closing your top-level claim.

### specialists-friction-audit-consolidation-rev-3-final-for
Specialists friction-audit consolidation rev-3 (final for planning handoff): chain ≡ bd epic mental model corrected — 3-level nesting (top epic → chain epic → step beads), bd permits nested up to depth 2-3 verified. Major reconciliation discovery: bd already exposes the primitives we were going to invent — bd merge-slot = worktree lease (Opportunity 1+2), bd mol pour = chain shape persistence (Opportunity 3), bd formula = template definition + composition nudge language (Opportunity 4+9), bd swarm = wave/epic with DAG. New Opportunity 10: --chain <chain-epic-id> redesign deprecating --worktree + --job, refusing write-capable without --chain (closes safety hole). sp epic decoration strategy (§12): DROP merge/abandon/sync/guard/epic_runs/lifecycle SM/readiness/reconciler (~500 lines removed), KEEP list/status as thin readers + --epic flag + specialist_jobs.epic_id column. Master rollout: 6 phases, ~14 days for Phases 1-4 (core). 15 decisions taken (D1-D15) recorded in §11.0 for planner reference. Doc grew 832→1168 lines (14 top-level § / 50 ### / 12 #### sections).

### specialists-friction-audit-docs-design-specialists-friction
Specialists friction audit (docs/design/specialists-friction-audit.md): 4 categories observed across mercury+gitboard+specialists reports — (A) bootstrap/dirty-state breakage (bd auto-export racing git ops, dominant cost — gitboard sp merge failed 5x in one session same root cause), (B) orchestrator laziness (skipped reviewer on '1-char fix', invented --skip-review flag, --force-stale-base used as default escape valve, hand-edits .specialists/default/ despite SKILL saying never), (C) wrong-cwd dispatches (CRITICAL: cd into worktree persisted, git reset --hard wiped executor commits — recoverable only via reflog), (D) visibility gaps (silent swallow masked .58+.61 for hours, executor tests_pass self-report unreliable, sp merge 'Merge conflict' with no diagnostic). Roadmap: Layer 1 runtime patches to sp (dirty-index diag, --accept-stale-base --reason, errors-never-swallowed audit, move tests_pass to code-sanity), Layer 2 per-repo bootstrap config-skill (orphan-wt cleanup, vitest excludes), Layer 3 NEW success/hint messages (post-dispatch hint with model/scrutiny/next-step, result-aware next-step, pre-dispatch warning hooks for bead-incomplete/missing --job/type-mismatch/cwd-mismatch, new sp chain <bead> CLI). Reuse audit: no new daemon/IPC/entity proposed. Substrate-future bridge map distinguishes throwaway bridges (sp merge diag, doctor pre-dispatch) from keepers (--accept-stale-base naming, errors-never-swallowed, hint messages survive even after dashboard).

### specialists-init-must-accept-only-flattened-xtrm-skills
specialists init must accept only flattened .xtrm/skills/active root; legacy active/claude and active/pi are stale assumptions

### specialists-init-owns-project-scoped-mcp-registration-by
specialists init owns project-scoped MCP registration by writing .mcp.json with mcpServers.specialists={command:'specialists',args:[]}; reruns should be idempotent.

### specialists-init-should-auto-rewire-legacy-root-symlinks
specialists init should auto-rewire legacy root symlinks from active/claude or active/pi to flattened active root during migration

### specialists-init-writes-claude-settings-json-hooks-as
specialists init writes .claude/settings.json hooks as top-level event keys (flat format) while xtrm install writes under the hooks{} object (structured format). Both work in Claude Code but create two parallel registries in the same file. Any future settings.json merge logic must handle both locations.

### specialists-job-file-output-gating-should-reuse-detectjobout
SPECIALISTS_JOB_FILE_OUTPUT gating should reuse detectJobOutputMode exported from src/cli/status.ts; tests that assert file fallback need env on.

### specialists-list-now-shows-full-specialist-descriptions-by
specialists list now shows full specialist descriptions by default; --compact preserves truncated summaries, and --full/--no-truncate are accepted aliases for explicit full-description mode.

### specialists-list-truncates-metadata-descriptions-so-speciali
specialists list truncates metadata descriptions, so specialist descriptions must be truncation-first: role name + task shape in the first visible words, then optional detail. Package-owned configs require a package release/update for other repos to receive changes.

### specialists-machinery-keep-alive-default-reviewer-mandatory
Specialists machinery (keep-alive default, reviewer mandatory, epic grouping, single merge command, memory-ack gate) is NOT over-engineered ceremony — each piece is a guardrail because LLMs drift, skip steps, and do stupid things unless forced. The deadlocks aren't a sign of bloat; they're a sign the system was built assuming a careful human driver and is now incomplete for keep-alive-default LLM operation. The fix is the missing automatic bridge from reviewer PASS to executor terminate (auto-finalize + sp finalize), NOT trimming guardrails. When tempted to suggest 'maybe simpler', stop and check what each piece prevents — usually it's catching past LLM drift. Reviewer exists BECAUSE clankers drift. Memory-ack exists BECAUSE clankers skip. Don't propose deleting them.

### specialists-observability-stale-active-repair-if-sp-ps
specialists observability stale-active repair: if sp ps --all shows running/waiting but sp ps --active shows none, inspect .specialists/db/observability.db specialist_jobs; rows with status running/waiting/starting and dead pid can be direct-SQL updated to cancelled with ps_hidden_at/ps_hidden_reason after sqlite backup.

### specialists-ownership-model-package-config-upstream-source-s
specialists ownership model: package config/ upstream source, .specialists/default managed repo mirror, .specialists/user repo customization; runtime precedence should follow user > default > package fallback; mandatory-rules need same layered model.

### specialists-quickstart-install-docs-must-mention-bun-prereq
Specialists quickstart/install docs must mention Bun prereq alongside package.json bun engine and runtime guard.

### specialists-readonly-output-gap-read-only-specialists-explor
specialists-readonly-output-gap: READ_ONLY specialists (explorer, overthinker) cannot update beads with their output. Coordinator must pipe results back manually via bd update <id> --notes. This is a real workflow gap — needs an allowlist mechanism where the runner auto-appends READ_ONLY specialist output to the input bead.

### specialists-result-should-prefer-result-txt-when-status
specialists result should prefer result.txt when status is running/starting because keep-alive follow-ups can temporarily flip status back to running after an initial completed turn

### specialists-run-job-flag-works-but-still-requires
specialists run --job flag works but still requires --bead or --prompt for input. Auto-bead-resolution from job status.json for READ_ONLY specialists not yet implemented. Current working pattern: sp run reviewer --bead X --job EXECJOBID. Future enhancement: sp run reviewer --job EXECJOBID should auto-resolve bead.

### specialists-run-use-specialist-can-treat-a-bead
specialists run/use_specialist can treat a bead as the task spec: read it via bd show --json, pass formatted bead content as prompt/, expose , and link the auto-created tracking bead back to the input bead with bd dep add.

### specialists-runtime-has-6-architectural-asymmetries-docs-des
Specialists runtime has 6 architectural asymmetries (docs/design/specialists-runtime-critique.md) all rooted in one shape error: jobs are first-class, chains are derived projections. Confirmed in chain-identity.ts:38-39 (chainId defaults to worktree_owner_job_id defaults to job's own id — no chain entity). The 6 asymmetries: (1) executor as privileged chain bootstrapper (--worktree and --job mutually exclusive forces first-dispatched role to own chain), (2) worktree owned by job not chain (orphan-on-death pattern, stale-base false positives), (3) chain has no entity row (workflow/scrutiny/budget/evidence-index have nowhere to live), (4) keep-alive paradox (pi session held alive because workspace handle bound to job_id), (5) --bead conflates work-contract with chain-key (R4 tracking-bead-vs-target confusion is structural), (6) reviewer-as-parasite cannot exist without executor --job (locks chain shape to executor-first). Substrate containers invert each: container opens BEFORE specialists, worktree lifetime = container lifetime, container row carries chain-level state, pi keep-alive becomes purely LLM-state convenience. Stage A/B/C/D rollout plan: containers table additive → worktree ownership migration → explicit container open → issue membership edges replace chain_root_bead_id. Friction-audit §3.4 sp chain <bead> is at risk of entrenching asymmetry 5; better surface = sb container ps <container-id>.

### specialists-service-deploy-alongside-recipe-documented-at-do
specialists-service deploy-alongside recipe documented at docs/deploying-alongside.md. Three required compose tweaks: (1) user: '${UID:-1000}:${GID:-1000}' or container crashes EPERM/EROFS on observability.db; (2) HOME=/pi-home or pi looks at /root/.pi and silently has zero models; (3) rw bind mount of .specialists/ (the directory, not just the .db file, so SQLite can create -wal/-shm siblings). Reference recipe distilled from darth-feedor's ingestion/infra/docker-compose.yml. Includes troubleshooting matrix (symptom -> cause -> fix) and rootless podman/SELinux notes.

### specialists-skill-source-of-truth-for-xtrm-tools
specialists skill source of truth for xtrm-tools vendoring is config/skills, not .xtrm/skills/default; when changing using-specialists-v3 for xtrm release, update config/skills and regenerate dist/asset-contract.json or xtrm-tools prepublish will vendor stale content.

### specialists-src-specialist-worktree-ts-provisionworktree-now
specialists src/specialist/worktree.ts:provisionWorktree replaces the bd worktree create stub .beads/ with a SYMLINK to <commonRoot>/.beads. v1 (rm -rf only) was insufficient: bd's post-checkout/pre-commit/post-merge git hooks (registered via parent's core.hooksPath = .beads/hooks/) fire on any git operation inside the worktree (notably supervisor's auto-commit checkpoint), invoke bd from inside the worktree, and re-scaffold a per-worktree .beads/ + dolt server. Caught by 20-min monitor: xtrm-lait worktree had .git at 03:19:51, .beads recreated at 03:21:56 (2 min later, matching first auto-commit). v2 fix: rm + symlinkSync(<commonRoot>/.beads, <worktreePath>/.beads, 'dir'). bd from worktree then operates on parent's data — single dolt server, shared writes (verified by smoke: bd kv set from worktree visible from parent). xt claude / xt pi (xtrm-tools/cli/src/utils/worktree-session.ts) gets the same v2 fix.

### specialists-usage-skill-purpose-is-behavioral-evals-must
specialists-usage skill purpose is behavioral: evals must test whether agents actually invoke a specialist (grep transcript for 'specialists run' or 'use_specialist'), not whether they can answer CLI questions. Give agents a delegatable task; without the skill they do it themselves, with the skill they delegate. Q&A evals measure knowledge, not the behavioral change the skill exists to produce.

### specialists-wave-orchestration-sync-docs-stalls-on-dense
specialists-wave-orchestration: sync-docs stalls on dense reference/schema docs (hit 60s stall timeout twice on MCP tool reference). Explorer (haiku) is the better specialist for reference-heavy output. When a specialist stalls, stop and switch specialist type rather than retrying the same one.

### sqlite-feed-poll-runtime-migration-feed-follow-must
SQLite feed/poll runtime migration: feed follow must maintain per-job seq cursors and use readEventsAfter() in steady state, while poll cursors must represent last seen event seq rather than event count; DB-first tests must mutate SQLite state directly instead of file-era artifacts.

### sqlite-observability-metadata-readiness-tmux-session-fifo-pa
SQLite observability metadata readiness: tmux_session, fifo_path, session_file, status, events, results, and epic/node metadata already persist in SQLite; remaining file-only blockers are .specialists/jobs/latest and .specialists/ready/<jobId>, plus direct file-native readers in attach/list/ps.

### sqlite-only-migration-epics-scope-cleanest-when-contract
SQLite-only migration epics scope cleanest when contract-definition, metadata-write readiness, CLI read migration, test harness migration, legacy tooling, and write-path removal are separate tracks; late catch-all test/tooling issues create hidden coupling and sequencing churn.

### sqlite-runtime-contract-use-two-selectors-not-one
SQLite runtime contract: use two selectors, not one — exact launch_request_id -> job_id for correctness, and latest_started_job -> job_id only as a convenience pointer; all runtime consumers must resolve to job_id and then read status/events/result from DB, while .specialists/jobs artifacts remain legacy/debug mirrors.

### sqlite-worktree-concurrency-all-worktrees-must-share-one
sqlite-worktree-concurrency: All worktrees must share ONE DB via git rev-parse --git-common-dir (not --show-toplevel which returns worktree root). Concurrent writes: WAL + busy_timeout=5000 + bounded app retry (3-5 attempts, exp backoff+jitter). NEVER silently swallow SQLITE_BUSY — current best-effort try/catch is unacceptable once SQLite is primary source of truth. Must use persistent bun:sqlite connection, not execFileSync('sqlite3') shell-out per statement. Scope: fqxo (Phase 3C).

### startup-context-for-specialist-runs-should-be-surfaced
Startup context for specialist runs should be surfaced directly in run_start/status and user-facing feed/result views; relying on trace/status/events reconstruction makes smoke verification brittle.

### startup-context-visibility-changes-require-docs-updates-in
Startup context visibility changes require docs updates in CLI reference, features, and architecture docs; drift detector clean after sync-docs scoped run.

### startup-payload-metrics-must-capture-components-before-model
Startup payload metrics must capture components before model invocation and persist as job-local JSON for later KPI queries.

### stash-pop-after-worktree-merge-can-silently-revert
Stash pop after worktree merge can silently revert config files — happened during t4ss when git stash pop conflicted on node-coordinator.specialist.json and --theirs resolved to the stale stashed version instead of the merged Wave 2 changes. Also: skill files at .xtrm/skills/default/ and .xtrm/skills/active/ don't auto-sync from config/skills/ — must manually cp after editing source. sp init --sync-skills handles this but wasn't run during the epic.

### status-result-runtime-now-db-first-cli-tests
status/result runtime now DB-first; CLI tests need SQLite client mocks when runtime db not bootstrapped in vitest

### substrate-autonomy-gradient-one-pattern-for-three-open
Substrate autonomy gradient — one pattern for three open questions (container nesting, node nesting, dispatch_mode). Pattern: 'allowed within policy → escalates at boundary → hard-blocked beyond which only operator can go' (same shape as §5.10 graded escalation + §5.8 emitter capability). Decisions: (a) container nesting soft-warn at depth 2, hard-cap at 4 (depth=live membership only, seeds don't count); (b) node nesting depth 1 via parent escalation + operator approval, depth 2 manual-only (sub-node coordinator cannot escalate for grandchild), depth 3+ hard-blocked unconditionally; (c) dispatch_mode = flat default string + optional matcher rules reusing seed invite_when / workflow applies_when syntax. All three are config + reuse of existing primitives — no new daemon machinery, no new SDK verbs.

### substrate-chain-template-coordinator-covers-bounded-adaptati
Substrate chain_template + coordinator covers bounded adaptation via insert-step policy, but not open-ended self-organizing research loops that need external memory/artifact handoffs and runtime team formation.

### substrate-close-model-elegantly-removes-3-bd-shim
Substrate close model elegantly removes 3 bd shim hooks (memory-ack, commit-gate, Stop) by making close a derivation not an imperative: issue closes when evidence satisfies acceptance AND container state permits AND close_reason recorded. Normal path: nobody runs sb issue close — container merge transactionally closes all members. memory-ack disappears because substrate auto-distills memory on failed-semantic close (curator pulled relevant memories at seed start, no end-of-issue lesson to ack). commit-gate disappears because issue cannot reach close_ready until diff evidence dual-written. Stop hook disappears because claims belong to participants (jobs) not sessions — pi keep-alive holds participant in waiting, no claim is left dangling. Eligibility table maps issue class × container kind × container state to allowed close_reason enum; refusal returns structured envelope matching channels.md §10.2 shape. close_reason deterministically drives done vs archived split. New work_state value 'close_ready' = eligible but awaiting container merge.

### substrate-knowledge-scope-principle-unifies-rule-conflict-co
Substrate knowledge-scope principle (unifies rule conflict / cold-start context / memory pruning + promotion): 'facts with metadata; queries reconstruct the slice. Rules, curation, pruning are queries with different filters — not different stores or new entities.' Extends §10 'levels are queries not fields' to all 3. Decisions: (a) rule conflict impossible because owning-issue rules govern MY behavior, target-issue contract is MY rubric, referenced-issue evidence is MY input — three different surfaces, not one collapsed authority; (b) no session-level memory curator — orchestrator-as-participant gets context same as any participant, cold-start = explicit CLI Query (one store, two entry points); (c) pruning runs on stored metadata fields (in_container, in_project) not on tier-queries — preserve-and-demote, never delete on retirement (matches §5.10 closed:failed pattern); (d) promotion = automatic counter (≥3 distinct workgroups in 90d) + manual override; (e) identity scope = per-role-per-project (not per-role-global) to prevent cross-project surface leakage.

### substrate-md-vs-channels-md-cross-doc-consistency
substrate.md vs channels.md cross-doc consistency: (a) substrate's 'cross-container channels' for peer coordinator collaboration directly contradicts channels.md §11 'Cross-channel messaging deferred indefinitely' — resolve in favor of pulse-based, channels stays container-scoped; (b) substrate's Discord/Gmail north-star (§14.1) conflicts with channels.md 'Channels are internal' — resolve by making external connectors emitters+API-consumers, never channel members; (c) channels.md has 'pair:<uuid>' channels with no container — not every channel needs a container, channels package has primitives substrate does not. All three documented in docs/design/substrate-review.md §13.

### substrate-rev-9-6-9-2-step-issues
Substrate rev-9 §6.9.2 (step-issues with dual contracts), §6.9.5 (3-moment composition with sb chain approve gate), §6.9.6 (worktree LEASE acquired by writer-steps released on agent_end, read-only steps don't touch), §6.9.7 (two-axis git model: container kind × chain shape; worktree names derive from membership not from creator role) — all four sections directly resolve my 6 specialists-runtime asymmetries from the critique. Mapping verified in docs/design/specialists-substrate-alignment.md. Key insight: 9 alignment opportunities can be implemented in sp TODAY (~10 days total) producing data already shaped for substrate migration — when containers table arrives the migration is mechanical rename not double-write. Highest-leverage single patch: Opportunity #2 (READ_ONLY specialists bind to worktree by path not by --job liveness) decouples reviewer/code-sanity from executor's keep-alive — closes the most expensive part of asymmetries 4+6, lets operator forget sp finalize without resource leak.

### substrate-review-2026-05-27-workflow-steps-should
Substrate review 2026-05-27: workflow steps should be issue-backed durable contracts (root/step/gate/advisor/followup/decision classes) spawned as participants into container channels; blocking is edge-driven, and pulses insert/wake steps idempotently. Captured in docs/design/substrate-review.md.

### substrate-workflow-definition-language-substrate-review-md-2
Substrate workflow definition language (substrate-review.md §25): YAML schema composes existing primitives (matcher syntax from §5.2 invite_when; bookends + Layer 2 gates from §6.9.3; workflow_role from review §16). Linear inheritance only (extends), with steps_before/after/replace/skip. Six concrete default workflows extracted from real .xtrm/reports/ chains: (1) code-quick (LOW blast, observed mercury 98vy one-line fix), (2) code-standard (Iron pipeline default, specialists 2026-05-26 entire iron epic), (3) code-with-advisors (HIGH/CRITICAL blast, mercury 7egg tick-grid), (4) debug (non_skippable debugger as bookend opener, fixes 'orchestrator forgets debugger' laziness), (5) quant-validation (mercury custom pack, methodology before code, scope_matches analytics/**), (6) security-deep (sensitive surfaces, security-auditor twice: advisor pre + gate post — same role two workflow_role positions). Layer 2 gates (code-sanity/obligations-scanner/security-auditor) are config-shipped overlay never declared in workflow files — workflow author cannot opt out.

### supervisor-handleresumeturn-auto-finalizes-keep-alive-on-pas
supervisor.handleResumeTurn auto-finalizes keep-alive on PASS-shaped output (unitAI-y6crh): mirrors the initial-turn auto-finalize at supervisor.ts:1937. Predicate: shouldAutoFinalizeKeepAlive(output) = PASS_COMPLIANCE_VERDICT_REGEX.test(output). Closes the gap that made sp finalize <id> necessary after every resume-driven PASS verdict (e.g. reviewer initially returns PARTIAL/needs-evidence, operator resumes with evidence, reviewer emits PASS — now auto-closes without explicit operator action). Test for this lives in supervisor.test.ts but that file is excluded from the suite (hang-prone, Track A flagged); validation relies on the parallel initial-turn auto-close test pattern + manual inspection. The change is 3 lines: introduce passFinalize/readOnlyClose locals, isWaitingTurn = !readOnlyClose && !passFinalize.

### supervisor-readresult-now-checks-sqlite-first-matching-sp
supervisor.readResult now checks SQLite first, matching sp result semantics for finalize PASS detection when result.txt is absent.

### supervisor-test-ts-keep-alive-test-has-a
supervisor.test.ts keep-alive test has a pre-existing hang in Bun vitest — FIFO readline race: createReadStream with flags:'r+' on a named pipe doesn't open the fd synchronously, so the test's writeFileSync (O_WRONLY) can block before the reader is ready. Confirmed against original HEAD — not a regression from 08zd changes. Skip this test when running supervisor suite in batch; run individually with -t filter to isolate.

### supervisor-timeline-events-have-two-write-paths-appendtimeli
Supervisor timeline events have TWO write paths: appendTimelineEvent (dual-write to events.jsonl + SQLite specialist_events table; throws on SQLite failure) and appendTimelineEventFileOnly (file-only; silently no-op when SPECIALISTS_JOB_FILE_OUTPUT is gated off post-ppkdg). After ppkdg landed yesterday, anything using FileOnly is invisible to sp feed/result unless file output is on. Use appendTimelineEvent + createMetaEvent(...) for any META event that should be operator-visible. Pre-ppkdg gitnexus_analyze_started (commit cf79f149, Apr 5) used FileOnly and silently broke; today's hrsvj fix switches it to dual-write. run_start is exempt because claimJobStart's transaction calls writeEventRow separately.

### supervisor-ts-fifo-hang-fix-the-named-pipe
supervisor.ts FIFO hang fix: the named pipe fd must be closed SYNCHRONOUSLY in the finally block (closeSync before stream.destroy). Set autoClose:false on createReadStream so only our explicit closeSync touches the fd. Hoist fifoFd to outer scope. Order: readline.close() → closeSync(fifoFd) → stream.destroy(). This prevents event loop hangs in batch test suites.

### sync-docs-architecture-md-bead-lifecycle-section-updated
sync-docs: ARCHITECTURE.md bead lifecycle section updated — supervisor now auto-closes input beads on terminal status via closeBeadIfInProgress (unitAI-9truh). Also added output_type to run_complete event fields (unitAI-e90j).

### sync-docs-concurrency-guard-job-force-job-liveness
sync-docs: concurrency guard (--job --force-job), liveness checks (--show-dead), test-aware stall timeout, pending-ops tracker for async dispose are all architectural additions from 2026-04-09 vitest wave. Key files: docs/cli-reference.md (flags), docs/features.md (sections 5-8 new), docs/ARCHITECTURE.md (liveness+async dispose sections), config/skills/using-specialists/SKILL.md (--job semantics update)

### sync-docs-runs-may-report-synced-at-invalid
Sync-docs runs may report synced_at invalid even when docs are updated because drift_detector extract_synced_at currently expects string but update-sync can emit unquoted integer hash; docs content may still be correct.

### sync-docs-scope-discipline-mandatory-rule-sync-docs
sync-docs scope discipline: mandatory rule sync-docs-scope-discipline (.specialists/default/mandatory-rules/) forbids Read on src/tests/pi/packages; per-commit git show/diff is the only direct source-code probe. Bead SCOPE is read+write boundary. Pre-script injects xt report + git log + xtrm docs cross-check + drift scan; gatherer JSON re-run only if mode needs different window. Wired into config/.specialists/default sync-docs.specialist.json v3.0.0 + slim SKILL.md. Use ls -1 + sort -r for picking latest .xtrm/reports/*.md (mtime sort is wrong for date-named files).

### sync-docs-specialist-single-doc-invariant-enforced-via
sync-docs specialist: single-doc invariant enforced via drift_detector scan --json + filter. Pre-script context + git show <hash> -- <paths> bounded at 3 commits. No source reads except git show. Edit one doc, stamp via drift_detector update-sync, verify clean drift.

### syncthing-vps-setup-can-proceed-without-sudo-by
Syncthing VPS setup can proceed without sudo by copying the local binary to ~/.local/bin and using user cron @reboot when loginctl enable-linger is denied, but persistent systemd user services still require admin help.

### system-prompt-mode-no-universal-default-adding-system
system_prompt_mode-no-universal-default: Adding system_prompt_mode append|replace to the specialist prompt schema cannot use a single Zod default. script-runner legacy behavior is replace (--system-prompt), session.ts legacy behavior is append (--append-system-prompt). A default('append') would silently break existing script-class service specialists; a default('replace') would break all existing package-class specialists. Field must be z.enum(['append','replace']).optional() with no default — each runner falls back to its own legacy when the field is absent. Bead: unitAI-qngis.

### template-field-misuse-error-type-added-to-script
template_field_misuse error_type added to script-runner.ts: when input.template equals an exact spec.prompt key name (matching /^[a-zA-Z_][a-zA-Z0-9_]*$/, length<=30, key exists on spec.prompt), runScriptSpecialist returns success:false error_type:'template_field_misuse' before rendering. Catches the darth-feedor production bug where consumers passed 'task_template' or 'normalize_template' as the literal template field. Helper: detectTemplateFieldMisuse(template, specPrompt). Test coverage in tests/unit/specialist/script-runner.test.ts.

### template-hygiene-default-bead-id-to-empty-in
Template hygiene: default bead_id to empty in runner prevents unresolved placeholder leakage in non-bead prompts; enforce with targeted runner + config hygiene tests.

### tests-unit-cli-help-test-ts-must-spawn
tests/unit/cli/help.test.ts must spawn bun for dist/index.js help output because vitest workers run under node and bun-built dist/index.js uses __require shim.

### tests-unit-cli-run-test-ts-has-9
tests/unit/cli/run.test.ts has 9 pre-existing failures on master HEAD (verified 2026-05-04 via pristine clone). exit:0 expected, got exit:1 — likely from a recent merge (hjyh3 / 7ftju area). Not regression from individual specialist work. When executor reports 'tests fail' on this file, FIRST verify whether master itself fails before treating it as that bead's responsibility.

### tests-utils-observabilityfixtures-ts-must-stay-lazy-for
tests/utils/observabilityFixtures.ts must stay lazy for bun:sqlite; node/vitest consumers should catch unsupported runtime and skip sqlite-backed assertions

### the-beads-edit-gate-hook-uses-claimed-session
The beads-edit-gate hook uses 'claimed:<session_id>' as the kv key (not 'active-claim:'). When the gate blocks despite an active claim, run: bd kv set "claimed:$SESSION_ID" "<issue-id>" to manually register the session claim. The session_id comes from the Claude Code hook input (input.session_id).

### three-explorer-overthinker-chain-works-well-for-boundary
Three-explorer + overthinker chain works well for boundary-defining design tasks: dispatch parallel READ_ONLY explorers with disjoint scopes (runtime, consumers, dependencies), then synthesize via overthinker with --keep-alive for revisions. Two gotchas observed: (1) explorer beads must explicitly forbid grep patterns starting with -- because ripgrep rejects them; tell the agent to use Bash for --help and Read on package source instead. (2) Overthinker on first pass may over-strip features the user actually wants (e.g. observability); resume it with the user's intent stated clearly and ask it to defend or yield, do not silently overrule.

### tmux-pty-bypasses-tty-check-tmux-provides-a
tmux-pty-bypasses-tty-check: tmux provides a pseudo-TTY so process.stdin.isTTY===true inside tmux-backed specialist sessions. TTY check alone is not sufficient to detect agent contexts. Must combine with env var checks: SPECIALISTS_TMUX_SESSION, SPECIALISTS_JOB_ID, PI_SESSION_ID, PI_RPC_SOCKET. Any one of these being set means agent/pi context regardless of isTTY.

### to-commit-while-a-specialist-is-actively-running
To commit while a specialist is actively running on a claimed bead, set the bead to open first: bd update <id> --status=open. The commit gate checks in_progress claims by git user email and blocks regardless of whether you or a specialist is the active worker.

### token-counts-in-sp-ps-e-g-tokens
Token counts in 'sp ps' (e.g. tokens=90k) are RAW totals, not context-window percentages. Models like gpt-5.3-codex have ~200k windows. The using-specialists-v2 65-80% steer threshold is a percentage, not a token count. Don't steer specialists to conclude based on raw token totals — watch for stalls, repeated edit failures, or scope drift instead. The 'context' column in sp ps is the real percentage signal (often '--' / unavailable).

### token-usage-was-never-populated-because-findtokenusage-in
token_usage was never populated because findTokenUsage() in session.ts only parsed OpenAI-style fields (prompt_tokens/completion_tokens) but pi RPC emits input/output/cacheRead/cacheWrite with nested cost.total. Fixed in commit 4ba911d0.

### tool-catalog-foundation-now-encoded-in-specialists-catalog
Tool-catalog foundation now encoded in .specialists/catalog/* with explicit precedence_order [native, gitnexus, serena] and per-tier source_tiers metadata; later resolver phases should consume these artifacts instead of re-deriving policy from session.ts.

### tool-catalog-now-ships-from-config-catalog-with
tool catalog now ships from config/catalog with .specialists/catalog override fallback

### top-level-cli-help-works-better-when-it
Top-level CLI help works better when it is flatter and operator-oriented: usage, common flows, rules, core commands, examples, and pointers to deeper help. Keep quickstart as the full guide, and make help the practical day-one command map.

### top-level-sp-help-and-readme-should-mention
Top-level sp help and README should mention sp chat as the interactive launch TUI: feed-style timeline, status row, final result, and state-aware input that steers running jobs or resumes waiting jobs; current sp attach remains legacy tmux-only until unitAI-hx4ln.

### tq1f-closure-can-rely-on-committed-code-audit
tq1f closure can rely on committed-code audit after merge when reviewer patch-context startup cannot run: verify executor result plus merged symbols in main repo (session api_error plumbing, timeline error event, feed/result rendering)

### traceability-re-review-prior-partial-cleared-when-bead
Traceability re-review: prior PARTIAL cleared when bead notes explicitly record exact dotted id unitAI-tsnwh.5 even if executor report typo exists.

### transcriber-specialist-is-now-package-shipped-at-config
transcriber specialist is now package-shipped at config/specialists/transcriber.specialist.json v1.6.0; copied from second-mind and requires dense documentation-grade technical reports.

### trusted-script-skill-audit-now-records-source-kind
Trusted script skill audit now records source kind for each entry: skills.paths or prompt.skill_inherit, so observability can distinguish inherited skill prompts from explicit skill paths.

### tsserver-typescript-language-server-does-not-support-multi
tsserver (typescript-language-server) does NOT support multi-root workspaceFolders — open issue since 2018 (#66). Means per-repo tsserver pooling is blocked; each worktree still needs its own tsserver instance even after Serena HTTP-mode pooling. pyright IS multi-root capable natively. This gap means HTTP pooling saves Serena+pyright but not tsserver.

### tty-gate-for-user-only-commands-process-stdin
tty-gate-for-user-only-commands: process.stdin.isTTY === false in all agent/subprocess/pipe/tmux contexts. Use it as a structural agent-proof gate on any command that is user-only bootstrap (init, setup, scaffold). Check at the very top of run() before any file I/O. Tests must stub it: Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true }). No heuristic detection needed — the OS tells you everything.

### tui-processes-own-stderr-stdout-once-tui-start
TUI processes own stderr/stdout once tui.start() runs — console.log/error are invisible. For any TUI debugging, use file-based tracing. Pattern in src/cli/chat.ts: SP_CHAT_DEBUG=1 env var → appendFileSync to /tmp/sp-chat-debug.log with timestamped lifecycle markers. Operator tails the log in a second shell to see exactly where the process stalls. Adopt this pattern for any future pi-tui integration work.

### u0nbr-6kofw-audits-covered
u0nbr-6kofw-audits-covered: Both release-drift audits (2026-05-07 overthinker output) closed as covered by 2026-05-13a/b/c chains. u0nbr concerns: doctor↔init layout (fixed by 5voar), payload contract (fixed by 1j9om CI gate + 3m27y LICENSE + allowlist), xtrm-tools cross-repo seam (fixed by usj9y + rl9uh+q30r7 policy doc). 6kofw concerns: catalog runtime path (fixed by jj7hy package-canonical resolver), Category A vs B boundary (clarified in usj9y + docs/installation.md Naming policy). Both audits were planning passes; their recommended children are filed/closed.

### ug51-fix-enhanced-crashrecovery-to-reconcile-zombie-waiting
ug51 fix: enhanced crashRecovery() to reconcile zombie waiting jobs — dead PID + run_complete evidence → done, dead PID + no evidence + non-node → error. Added hasRunCompleteEvent() to observability-sqlite.ts with file fallback. Added waiting_timeout_ms (6h default) in stall detection config — dead waiting jobs past timeout → error. Node members preserved for NodeSupervisor recovery.

### uncommitted-xtrm-hook-refreshes-can-regress-repo-local
Uncommitted xtrm hook refreshes can regress repo-local safety fixes: watch for beads-memory-gate clearing memory-gate-done sentinel and specialists-complete losing DB-first sp ps metadata lookup; revert those unless an explicit xtrm hook upgrade bead proves parity.

### unitai-0k4mf-auto-commit-checkpoint-noise-prefixes-include
unitAI-0k4mf: auto-commit checkpoint noise prefixes include .pi/ so provisioned .pi/npm cache symlinks are filtered from specialist checkpoint commits without editing consumer .gitignore.

### unitai-28idx-cleanupprocesses-env-gate-currently-present-as
unitAI-28idx: cleanupProcesses env gate currently present as uncommitted change in doctor.ts; git log still shows e14cec47 as last doctor commit.

### unitai-2b3m-research-node-epic-closure-core-researcher
unitAI-2b3m Research Node epic closure: core researcher + NodeSupervisor architecture is shipped and validated; old note blockers unitAI-22tq/unitAI-brbb/unitAI-e90j are closed; only unitAI-mesk remains deferred as future conversation/handoff work, not a blocker.

### unitai-3kt0b-specialists-release-gate-requires-xtrm-tools
unitAI-3kt0b: specialists release-gate requires XTRM_TOOLS_DISPATCH_PAT with Contents: write on Jaggerxtrm/xtrm-tools, and xtrm-tools receiver expects client_payload keys specialists_sha, specialists_tag, specialists_package_version (not sha/tag).

### unitai-6l4aj3-duplicate-specialist-dispatch-guard-needs-writ
unitAI-6l4aj3: duplicate specialist dispatch guard needs writeStatusFile first, then atomic claimJobStart with unique partial index on (bead_id, specialist) for starting/running jobs; READ_ONLY skips claim.

### unitai-6x6p6-reviewer-crash-root-cause-heavy-bash
unitAI-6x6p6 reviewer crash root cause: heavy bash validation bursts can kill reviewer before run_complete; Supervisor.readStatus computes is_dead but does not terminalize stale running rows, crashRecovery only runs at new Supervisor.run startup. Fix should add read-time dead-PID reconciliation + terminal run_complete/error event.

### unitai-8zui-coordinator-active-orchestration-research-node-j
unitAI-8zui coordinator-active-orchestration: research.node.json members=[] coordinator spawns dynamically. System prompt v2.0 adds sp steer/resume, phase management, synthesis mandate. Skill updated with multi-phase examples, steering patterns, sp steer/resume in command table. node-contract.ts renderForSystemPrompt/renderForDocs updated with steer/resume commands. All 3 config layers synced (config/, .specialists/default/, .xtrm/skills/). Pre-existing test failures in node-contract.consistency.test.ts (5/6) — action_vocabulary missing, output_schema missing from specialist config, validator snippets missing from supervisor.

### unitai-ad0ol-sp-feed-human-output-renders-auto
unitAI-ad0ol: sp feed human output renders auto_commit_success/skipped/failed as AUTO+/AUTO-/AUTO! with commit SHA, file count/path preview, reason, and GitNexus analyze meta as gitnexus=analyze_started source=<checkpoint|terminal>; JSON feed remains raw events.

### unitai-ashu1-canonical-config-skills-using-specialists-v3
unitAI-ashu1: canonical config/skills/using-specialists-v3 now documents that specialist worktrees are clean git checkouts; missing validation tools in fresh worktrees should be resolved with the repo standard bootstrap, not by tracking node_modules/.venv.

### unitai-asnmw-init-agents-md-bootstrap-now-uses
unitAI-asnmw: init AGENTS.md bootstrap now uses HTML sentinels plus legacy-marker migration; README now only claims AGENTS.md injection.

### unitai-f28ad-explorer-read-only-tool-starvation-bug
unitAI-f28ad explorer READ_ONLY tool-starvation bug is stale: original job 1956ca lacked native/Serena tools, but later explorer jobs d9ea71/362e08/abc8f6 used Serena read_file/find_file/list_dir/search_for_pattern and GitNexus tools successfully from observability.db.

### unitai-f5pxt-sp-clean-now-has-explicit-observability
unitAI-f5pxt: sp clean now has explicit observability pruning via 'sp clean --observability --before <iso|duration> [--include-epics] [--dry-run]', delegating to pruneObservabilityData; default clean and --all remain filesystem-only and do not touch observability.db.

### unitai-fn2wd-sp-edit-now-distinguishes-package-tier
unitAI-fn2wd: sp edit now distinguishes package-tier specialists from missing names and tells operators to run 'specialists edit <name> --fork-from <name>' before editing.

### unitai-lqryx-re-review-feed-follow-now-uses
unitAI-lqryx re-review: feed follow now uses SQLite readEventsAfter + per-job seq cursor; poll cursor returns last seq not event count, fixing incremental contract drift.

### unitai-n2q4o-specialist-output-file-and-remaining-supervisor
unitAI-n2q4o: specialist.output_file and remaining supervisor result.txt writes are gated by SPECIALISTS_JOB_FILE_OUTPUT; default DB-first runs no longer write .specialists/<role>-result.md or result.txt mirrors, while legacy file-output mode still writes them.

### unitai-pqe961-merge-dirty-ignore-list-now-includes
unitAI-pqe961: merge dirty ignore list now includes .beads/ and .xtrm/skills/active/; regression test covers ignored dirty paths and non-ignored src/cli/run.ts shelving.

### unitai-rzrq1-merge-conflict-test-needs-git-rev
unitAI-rzrq1: merge conflict test needs git rev-parse --git-common-dir, --show-toplevel, --abbrev-ref, merge-base, and diff mocks to exercise DB-native merge path; doctor boundary test should assert zombie-job status.json stays repair-only.

### unitai-usj9y-impl-sp-init-now-splits-missing
unitAI-usj9y.impl: sp init now splits missing xt CLI vs missing .xtrm/ with ordered recovery steps; docs now state xtrm-tools as runtime prerequisite and install order.

### unitai-yse03-review-dnmcg-script-alias-passed-after
unitAI-yse03 review: dnmcg script alias passed after non-stub smoke and scope cleanup; public script command remains changelog-keeper, internal resolved specialist is changelog-drafter.

### update-specialists-must-cover-both-distribution-tracks-categ
update-specialists must cover both distribution tracks: Category A specialists runtime/npm-live uses sp doctor --check-drift and sp prune-stale-defaults; Category B filesystem skills/hooks uses xt doctor/update.

### update-specialists-should-compare-repo-install-against-insta
update-specialists should compare repo install against installed package defaults, not just local shape drift

### update-specialists-v2-must-use-xt-doctor-cwd
update-specialists v2 must use xt doctor --cwd <root> --json and xt update --apply --root/--repo; fallback cleanly when xt missing

### user-s-syncthing-sync-target-is-second-mind
User's Syncthing sync target is ~/second-mind/1-projects/Mercury/ (capital M). Lowercase mercury/ causes case-collision with local Windows/macOS-style folder. Always use capitalized Mercury/ when dropping files for sync.

### using-kpi-canonical-skill-lives-under-xtrm-skills
using-kpi canonical skill lives under .xtrm/skills/default via symlinked xtrm-tools repo; active mirror stays in specialists repo

### using-script-specialists-doc-now-reflects-current-subprocess
using-script-specialists doc now reflects current subprocess runner: stdin-fed prompt, exact db-path file, offline JSON pi spawn, optional thinking/system-prompt forwarding.

### using-specialists-orchestration-gap-if-bead-is-the
using-specialists orchestration gap: if --bead is the only prompt, bead creation must include a mandatory task contract (problem, success criteria, scope/files, constraints/non-goals, validation, output/handoff). Current docs say bead=prompt but examples create title-only beads, encouraging specialist drift.

### using-specialists-skill-md-claude-skills-is-a
using-specialists SKILL.md: .claude/skills is a symlink to .xtrm/skills/active/claude — updates to .claude/skills path propagate through symlink automatically. config/skills/using-specialists/SKILL.md is a separate copy that also had the stale unitAI-4abv block but was out of task scope.

### using-specialists-v2-refactor-was-superseded-by-creating
using-specialists-v2 refactor was superseded by creating a clean using-specialists-v3; preserve core orchestration guidance in main skill, use specialists list --full for live role registry, and use sp help for command surface instead of large embedded catalogs.

### using-specialists-v2-skill-v1-2-now-reflects
using-specialists-v2 skill v1.2 now reflects latest xt report lessons: avoid nested synchronous sp run in specialists, use --from-source for resolver/catalog worktree evidence, fall back on gitnexus_impact stalls, check sibling jobs before stop/close, verify master before chasing noisy tests, and use sp epic abandon for failed epic cleanup.

### using-specialists-v2-v1-3-full-xt-report
using-specialists-v2 v1.3 full xt report pass added canonical-live Cat A guidance, Cat B xtrm-tools boundary, drift/prune workflow, mandatory-rule fallback semantics, help side-effect safety, release xt-reports annotated-tag checks, orphan starting-row triage, .xtrm auto-checkpoint caveat, and runner.test noisy-suite triage.

### using-specialists-v2-v1-4-is-canonical-final
using-specialists-v2 v1.4 is canonical final-state guidance only: no report changelog, gotchas, or obsolete workaround framing; it documents current asset ownership, resolution precedence, drift commands, source verification, epic publication, and release context contract.

### using-specialists-v3-activation-in-specialists-repo-is
using-specialists-v3 activation in specialists repo is an active symlink at .xtrm/skills/active/using-specialists-v3 pointing to ../default/using-specialists-v3; for local Claude Code evals, copy config/skills/using-specialists-v3 into the xtrm default skill mirror first.

### using-specialists-v3-now-points-at-adjacent-xt
using-specialists-v3 now points at adjacent xt commands with short cross-refs; source anchored to latest xt report plus xt --help.

### using-specialists-v3-now-teaches-bead-contracts-dependency
using-specialists-v3 now teaches bead contracts, dependency linking, under-promoted specialists, and explicit out-of-scope memory-processor/xt-merge boundaries.

### using-specialists-v3-should-not-be-an-87
using-specialists-v3 should not be an 87-line skeleton: keep it clean and live-registry based, but preserve core orchestration behaviors from v2 such as bead contracts, autonomous review/fix loops, monitoring, sp merge/sp epic merge publication, epic flow, and failure recovery.

### using-specialists-v3-should-stay-canonical-and-self
using-specialists-v3 should stay canonical and self-contained: use specialists list --full for live role registry, sp help/subcommand help for command surface, and role-selection evals should test delegation behavior, not CLI trivia.

### using-specialists-v3-skill-md-gained-paranoid-mode
using-specialists-v3 SKILL.md gained Paranoid Mode, Project-Specific Specialists, Security+Code-Sanity Mandatory, Sleep Timers Mandatory (with per-role duration table), and Worktree Cleanup sections. Sleep-timer table: sync-docs/changelog 60-180s, code-sanity/security 60-180s, reviewer 90-240s, explorer/debugger/planner 120-300s, executor 180-600s+. Initial sleep 10 + sp ps after every dispatch is mandatory.

### using-specialists-v3-skill-v3-5-updates-1
using-specialists-v3 skill v3.5+ updates: (1) SCRUTINY field universal in bead contracts with low/medium/high/critical tiers and auto-escalation table for sensitive surfaces (auth, config/specialists, lockfiles, migrations, permissions/hooks); (2) NEW Git State Precondition section — verify git clean + HEAD has prior chain commits + no orphan worktrees before dependent dispatch; (3) Advisory Passes section restructured as Seconder Gate (code-sanity, mandatory) + Obligations Gate (obligations-scanner, mandatory) + Security Gate; (4) Rule #9 INVERTED — manual git workflow is canonical, sp merge / sp epic merge / sp finalize PROHIBITED (known broken, awaiting separate rework); Cherry-Pick Playbook is canonical multi-chain path; (5) Rule #13 has explicit exception for epics that restructure the specialists themselves (operator-authorized manual-orchestrator-direct work); (6) Rule #14 added — Git State Precondition reference; (7) CLAUDE.md gotchas rewritten to match. parallel-review marked deprecated. obligations-scanner added to Choosing The Specialist table. Failure Recovery table replaced sp-merge rows with git-workflow recovery patterns (stale .git/index.lock, info/exclude vs tracked beads file, FF-via-update-ref when checkout blocked).

### using-specialists-v3-v3-4-maps-full-bd
using-specialists-v3 v3.4 maps full bd relationship vocabulary and weaves typed edges into existing specialist workflow examples; unitAI-ylphl reframed workflow catalog into executable sp workflows CLI/router epic.

### usj9y-xtrm-prereq-declared-sp-init-now-branches
usj9y-xtrm-prereq-declared: sp init now branches messages for missing-xt-cli vs missing-.xtrm-dir cases with ordered recovery commands (npm install -g xtrm-tools → xt install → xt init → verify xt --version). package.json adds _runtime_prerequisites field (no npm dep added; field name underscore-prefixed so npm ignores). README/quickstart.ts/installation.md/bootstrap.md all document install order: Bun → xtrm-tools → xt install → xt init → @jaggerxtrm/specialists → sp init. Category-A note: sp list, sp doctor --check-drift, sp prune-stale-defaults do NOT require xt. go847 audit covered by this impl.

### v3-12-0-release-used-xt-reports-as
v3.12.0 release used xt reports as synthesis source; marquee note is specialists list --full live registry surface plus using-specialists-v3 skill.

### v3-15-1-patch-unitai-n4h16-three-part
v3.15.1 patch (unitAI-n4h16): three-part epic landed — pruneStaleDefaults now removes diverged defaults by default (--keep-diverged escape hatch), --sync-defaults deprecated with loud warning, list-rules walks package-canonical tier. All three child beads merged to master manually via git merge --squash after sp merge failed due to index.lock contention and noise file staging.

### v3-skill-doctrine-merge-2026-05-13
v3-skill-doctrine-merge: using-specialists-v3 SKILL.md bumped to 3.3. Doctrine merge from docs/proposals/using-specialists-v3-improvements-2026-05-09.md. Added: Escalation Matrix table (A4), Pre-Dispatch Conflict Cluster (A5), Pre-Epic Test-Failure-Map (A5b), Specialist Rebuttal As Routine (A6, overthinker + reviewer templates), dual-mechanism Monitoring with cron pattern (A7), Bead Lifecycle And Parallel Commit Ordering (A8), At Session End handoff (A9 — references /session-close-report not duplicates), Integration Phase Cherry-Pick Playbook (A1 reduced for non-sp-merge cases), Debugger-Restitch Pattern (A2), E2E Smoke Phase procedure (A3). Strengthened: Advisory Passes Are Part Of Every Chain (A0). Hard rule 13 added. Failure Recovery extended with sp run silent-drop diagnosis, sp feed truncation check, bd/Dolt recovery. Description updated to mention integration phase + debugger-restitch keywords. 8 of 10 Part C workarounds obsoleted by code fixes earlier this session (lqsha/pqe96/a6e60/wq0mw/xbofm/6fsxp/889dv); 2 bd-Dolt items kept as recovery patterns.

### validate-edit-doctor-now-key-off-managed-mirror
validate/edit/doctor now key off managed mirror model: validate reports source/path from loader, edit forks user overrides for non-user specialists, doctor adds managed mirror drift checks.

### vitest-4-upgrade-reduced-test-suite-flakiness-not
Vitest 4 upgrade reduced test-suite flakiness, not increased it. Baseline on vitest 2.1.8: 135 failures / 1104 tests, 10 unhandled errors, 74s wall. On vitest 4.1.6: 87 failures, 2 unhandled errors, 44s wall. Bun + 'bun --bun vitest run' command path still works on v4. Our config (server.deps.external, coverage thresholds, include/exclude) is forward-compatible — no migration edits required. npm audit Vitest chain (vitest/vite/esbuild/@vitest/* moderate) fully resolved by the bump; total audit count dropped 20 → 4 (remaining 4 are fast-uri / ip-address / yaml-transitive — unrelated to Vitest).

### vitest-runner-choice-affects-visible-test-failures-and
Vitest runner choice affects visible test failures and may cause executor crashes. On this project (2026-04-09): 'bun --bun vitest run' = 599 pass / 50 fail / 244s; 'node vitest' = 584 pass / 65 fail / 91s (3x faster, 15 MORE failures). Node is faster but surfaces SQLite teardown races as failures; bun's slower path lets supervisor's 5-retry readStatus loop mask them. The 'Failed after 5 attempts (readStatus): Cannot use a closed database' stderr spam is bun-specific. Critically: every executor that attempted vitest this session DIED (2/2 — jobs 491177 and 3287ea, both during bun --bun vitest run), while executors that avoided vitest survived. Likely root cause: bun vitest's tinypool workers + better-sqlite3 bindings in supervisor tests + worktree context nesting (codex → bash → bun → vitest → worker) → process cleanup race escalates to parent kill. Recommended: add test:node script for executors; fix the SQLite teardown races in supervisor.ts (the 5-retry loop is masking a real bug); consider moving more tests to bun test native runner where vi.mock isn't needed.

### vozx-fix-added-syncepiconjobcomplete-helper-in-supervisor-ts
vozx fix: added syncEpicOnJobComplete helper in supervisor.ts — calls upsertEpicChainMembership + loadEpicReadinessSummary + syncEpicStateFromReadiness on both success and error completion paths. Epic chain membership now auto-syncs on job terminal state.

### vwrnq-bun-runtime-declared-package-json-engines-now
vwrnq-bun-runtime-declared: package.json engines now requires bun >=1.0.0 (node entry removed). src/index.ts guards with globalThis.Bun check at top + bun.sh install URL. README, docs/installation.md, src/cli/quickstart.ts all declare Bun as prerequisite. Caveat: bun-targeted bundle uses __require so 'node dist/index.js' crashes before the guard runs; the engines field + shebang remain the primary gate. Merge commits 9830662c (src) + ca73141d (dist rebuild).

### w7ksg-covered-by-1j9om-ci-gate
w7ksg-covered-by-1j9om-ci-gate: npm payload audit closed as covered by 1j9om CI gate. .github/workflows/package-payload.yml + scripts/assert-package-payload.sh assert 14 required assets (dist entrypoints, bin/install.js, package.json, config/specialists/{executor,reviewer}, config/mandatory-rules/{executor-delivery,index}, config/skills/using-specialists-v3, config/catalog/{index,native,gitnexus,serena}). packed-smoke job also runs full install + sp diagnostics. Other config/specialists/* ship via package.json files allowlist; deeper per-specialist assertion left as future enhancement if regressions emerge.

### wave-2a-ssot-drift-fix-export-action-types
Wave 2A SSoT drift fix: export ACTION_TYPES and PHASE_KINDS from node-contract and consume constants in node-supervisor runtime validation paths; keep literal assertions in consistency tests intact.

### wave-2b-adds-nodesupervisor-autonomy-handlers-for-create
Wave 2B adds NodeSupervisor autonomy handlers for create_bead/spawn_member/complete_node with additive observability fields and events.

### wave-chain-job-formal-model-locked-2026-04
Wave/chain/job formal model LOCKED 2026-04-10 via 2 parallel overthinkers in unitAI-5osz. TAXONOMY: Job (atomic) | Chain (worktree lineage, seeded only by edit-capable specialist) | Wave (STAGE/BATCH label, speech only, zero code meaning) | Epic (top merge-gated identity with state machine). MULTI-AXIS not strict nesting: epic contains stages, chain contains jobs, jobs carry both associations. 'Wave' is reserved for human shorthand ('Wave 1', 'Wave 2b') — never persisted, never a code identity. The top merge container is 'epic' (reuses bead epic id). Epic lifecycle: open → resolving → merge_ready → merged/failed/abandoned. INVARIANT: an epic is not 'done' when its jobs finish; it is only complete when it reaches merge_ready and is closed through sp epic merge, even if that merge is a no-op. CLI split: sp merge <chain> (one-shot, refuses if chain ∈ unresolved epic), sp epic merge <epic> (the only legal publication path for wave-bound chains), sp end (must be epic-aware, refuses bypass). Chain owns worktree, provisioned at chain seed. Full locked design in unitAI-lzys notes.

### when-a-specialist-returns-empty-output-in-5s
When a specialist returns empty output in <5s with 0 tool calls, check model availability first (pi --list-models, or watch for 403 in feed) before diagnosing a code bug. Pi silently eats 403/auth errors — the specialist gets an empty assistant turn with no error surfaced.

### when-a-specialist-worktree-has-a-local-beads
When a specialist worktree has a local .beads/dolt server without the unitAI database, pointing planning commands at the main repo's .beads database (or creating the missing DB) is necessary before bd issue-board work; hgpu planning now lives under parent feature unitAI-hgpu with file-disjoint children unitAI-hgpu.1-.7.

### when-creating-or-fixing-a-specialist-yaml-always
When creating or fixing a specialist YAML, always use /specialists-creator skill first — it knows the schema, correct field names (e.g. interactive not keep_alive), and model prefix conventions. Do not guess.

### when-dispatching-chain-executors-that-should-belong-to
When dispatching chain executors that should belong to an epic, use --epic <epic-id> flag explicitly — bd dep relate alone does NOT link the chain to the epic in the specialists observability DB (because link is tracked via bead.parent or --epic). Result: sp epic status shows '(none tracked)' for chains and sp epic merge cannot publish them. Workaround: use sp merge <chain-root-bead> standalone per chain. Fix: always pass --epic on run or make impl bead a direct child (parent) of the epic bead.

### when-reviewer-patch-context-startup-cannot-run-after
When reviewer patch-context startup cannot run after merge, re-review can still close from committed-code audit if executor result plus current code directly answer original findings (e.g. mandatory_rules meta propagation and single-build append discipline).

### when-running-parallel-executor-worktrees-that-modify-the
When running parallel executor worktrees that modify the same file (e.g. init.ts), merging creates conflicts because each worktree branches from the same base. Sequence them as separate waves instead, or accept manual conflict resolution. The cp command from worktree to main repo can silently fail if cwd drifted into a worktree directory — always verify cwd is the main repo before file operations.

### when-running-parallel-executors-that-all-modify-the
When running parallel executors that all modify the same file (e.g. ps.ts), merge conflicts cascade badly. Better approach: run one executor for the main file, then sequential executors for additions, OR consolidate all changes into one executor bead with clear instructions.

### when-sp-epic-merge-fails-on-dirty-tree
When sp epic merge fails on dirty-tree refusal, the epic transitions to terminal 'failed' state with no CLI recovery path. Manual git merge --no-ff per chain is the documented fallback, but skips tsc/conflict gates — verify reviewers PASS first and run bunx tsc --noEmit + targeted tests after.

### when-using-bd-create-update-descriptions-in-bash
When using bd create/update descriptions in bash, avoid backticks in quoted text or they trigger command substitution; use plain text or escaped backticks to prevent accidental command execution in issue descriptions.

### worktree-bd-smoke-shared-parent-db-works-from
worktree bd smoke: shared parent DB works from specialist worktree

### worktree-beads-compatibility-use-bd-worktree-create-not
worktree-beads-compatibility: use 'bd worktree create' NOT 'git worktree add' or 'xt claude' when creating worktrees for executor agents. Standard git worktrees don't integrate with beads — bd worktree create wires the beads context so claims, memory gate, and edit-gate hooks work correctly inside the worktree session.

### worktree-concurrency-guard-must-not-reuse-active-statuses
Worktree concurrency guard must NOT reuse ACTIVE_STATUSES from worktree-gc.ts — GC treats 'waiting' as active (don't delete), but the --job concurrency guard must treat 'waiting' as SAFE (reviewer enters idle executor). Different semantics require a separate BLOCKED_JOB_REUSE_STATUSES = Set(['starting', 'running']). Also: --job auto-bead resolution requires TWO changes — relaxing parseArgs() validation (currently rejects --job without --bead/--prompt before run() executes) AND adding post-resolution inference.

### worktree-per-edit-agent-any-specialist-with-edit
worktree-per-edit-agent: Any specialist with edit permission runs in its own worktree branch. Subsequent agents (reviewer, test-runner, etc.) must cd into that same worktree to see the files. Orchestrator merges branches in dependency order after each wave. Parallel executors only allowed if file sets are provably disjoint.

### worktree-pi-rpc-startup-fix-provisionworktree-now-symlinks
Worktree pi RPC startup fix: provisionWorktree() now symlinks <worktree>/.pi/npm -> <commonRoot>/.pi/npm. Prevents 30-60s npm install on first specialist run in new worktrees. symlinkPiNpmCache() is non-fatal: if symlink fails, pi still installs from scratch. The stdout corruption claim in notes was incorrect — takeOverStdout() is called before resourceLoader.reload() so npm output goes to stderr, not stdout. Real issue was slow startup (10s→30s timeout was band-aid, symlink is fix).

### worktree-rpc-timeout-root-cause-pi-runs-npm
Worktree RPC timeout root cause: pi runs npm install in fresh worktrees, stdout output corrupts RPC JSON channel. Fix: symlink worktree .pi/npm/node_modules → main repo .pi/npm/node_modules. provisionWorktree() should do this automatically. Also: always run commands from main repo cwd, not worktree — cd into worktree loses beads DB connection.

### wq0mw-dead-toolchain-reaper
wq0mw-dead-toolchain-reaper: collectStaleSpecialistJobs in src/specialist/process-health.ts:384 now has third reason 'dead-toolchain': status running/waiting + PID alive + ppid!=1 + age >= 30min + no tool/think events in specialist_events in last 30min. New ObservabilitySqliteClient.getLastActivityTimestampMs(jobId) returns MAX(t) WHERE type IN ('tool','think'). Detects market-data zombie pattern (jobs 525851/89ab98) where supervisor stall_timeout_ms missed. sp clean --reap-orphans surfaces the new reason.

### xbofm-background-stderr-surfacing
xbofm-background-stderr-surfacing: src/cli/run.ts detached background dispatch now pipes child stderr (stdio:['ignore','ignore','pipe']) and forwards to process.stderr. On child early-exit before jobId appears, parent exits non-zero with surfaced stderr. tmux path unchanged. Retires xtrm-5sz2 friction.

### xt-reports-helper-getcommitdate-must-use-git-log
xt-reports helper getCommitDate must use 'git log -1 --format=%cs' (auto-peels annotated tags) NOT 'git show -s' (returns tag header for annotated refs). All sp release tags are annotated, so this regression silently emitted empty bundles for every real release.

### xtrm-tools-pre-push-osv-vs-gitignored-lockfile
xtrm-tools-pre-push-osv-vs-gitignored-lockfile-2026-05-23: xtrm-tools's pre-push osv-scanner reads cli/.pi/npm/package-lock.json from disk regardless of .gitignore status. When pushing to xtrm-tools origin/main, this lockfile may flag GHSA advisories for transitive deps (e.g. qs<6.15.2 GHSA-q8mj-m7cp-5q26 from body-parser/express) that have nothing to do with the commit. Fix: cd ~/dev/xtrm-tools/cli/.pi/npm && npm update <pkg> to bump the lockfile in place. No git commit needed since the file is gitignored; the osv-scanner picks up the disk state, hook passes, push proceeds. Verify by checking grep '"version":' on the lockfile after npm update before retrying the push.

### xtrm-tools-skill-propagation-requires-npm-link-2026
xtrm-tools-skill-propagation-requires-npm-link-2026-05-23: To propagate skill changes from ~/dev/specialists/config/skills/* to consumer repos via xt update, xtrm-tools must be installed as an npm symlink (not a real-dir copy). Default xtrm-tools install via npm publish creates a real directory at /home/dawid/.nvm/.../lib/node_modules/xtrm-tools, breaking the symlink pattern that pi-extensions and specialists use. Symptom: xt update --apply reports 'refreshed' but the SKILL.md content doesn't change in consumer repos because xt reads the npm-installed xtrm-tools registry which has stale hashes baked in at install time. Fix: cd ~/dev/xtrm-tools && npm link (restores the global symlink), then re-run vendor-specialists-skills.mjs + gen-registry.mjs, then xt update --apply again. The first xt update WILL revert your vendor changes (because pre-link, it treats them as drift); only the second one after link+revendor propagates them. Verify with diff -q ~/projects/<repo>/.xtrm/skills/default/<skill>/SKILL.md ~/dev/specialists/config/skills/<skill>/SKILL.md returning identical.

### xtrm-worktrees-should-be-ignored-with-a-single
xtrm worktrees should be ignored with a single .xtrm/worktrees/ rule; if individual worktree paths were accidentally committed as gitlinks, remove them from the index and keep the generic ignore instead of adding per-worktree .gitignore entries

### yaml-json-migration-has-3-config-layers-that
YAML→JSON migration has 3 config layers that must stay in sync: config/specialists/*.json (source), .specialists/default/*.json (deployed copy), config/skills/*/SKILL.md (docs). After changing config/, always cp to .specialists/default/ and check skill docs for stale YAML refs.

### z0mq-pipeline-epic-17-tasks-implementing-agent-native
z0mq pipeline epic: 17 tasks implementing agent-native output pipeline. Key patterns: (1) agent teams with Sonnet model, 2 agents at a time, shut down after each wave for context freshness (2) executor specialist on gpt-5.3-codex works well for autonomous bug fixes via --bead workflow (3) E2E validation with real specialist runs catches bugs unit tests miss (parallel tool_call_id, EPIPE, dead config wiring) (4) stall_timeout_ms is the correct timeout mechanism, timeout_ms should be 0 (5) .specialists/ must NOT be in .gitignore — it was causing specialists to disappear on rebuild (6) start_specialist MCP uses in-memory JobRegistry not Supervisor — jobs invisible to feed/status (7) --background is broken and should be removed (8) pi/rpc/ is the canonical protocol reference for all session.ts work

### z5ml-design-synthesis-keep-node-events-event-json
z5ml design synthesis: keep node_events/event_json JSON-first, drop separate action_dispatch_log unless a measured query bottleneck appears, keep node_memory provenance in JSON, and promote only hot state columns like node_runs.status and node_members.status/enabled to real columns.

### zero-token-specialist-runs-need-api-error-event
Zero-token specialist runs need api_error event surfaced from RPC assistantMessageEvent.error or stderr at agent_end; feed/result can recover explicit rate-limit/auth/quota text without manual pi --print.

### znkgi-9-shipped-src-cli-version-check-ts
znkgi.9 shipped: src/cli/version-check.ts (130 LOC) + sp doctor integration (always-show comparison, even when network skipped) + sp status footer nudge (TTY-gated, per-tag dedupe via .specialists/version-check.json cache, 6h staleness, 2s timeout, silent failure). 17 tests pass. Cache fields: checked_at_ms, latest_tag, notified_for_tag. Reviewer PASS @ 98.

### znkgi-epic-publication-flow-shipped-changelog-md-seed
znkgi epic publication flow shipped: CHANGELOG.md seed → changelog-keeper specialist + changelog-conventions rule → sp release prepare/publish CLI → using-specialists-v2 + update-specialists skills updated for version-awareness. Implementation of sp doctor version-check deferred to follow-up bead. Operator does sp release prepare → review staged → commit 'release: vX.Y.Z' → sp release publish.

### zod-schema-silently-drops-unrecognized-fields-in-specialist
Zod schema silently drops unrecognized fields in specialist YAMLs — fields like 'publishes', 'output_to', 'keep_alive', 'diagnostic_scripts' produce no error during validation but are ignored at runtime. When debugging unexpected specialist behavior (e.g. researcher not staying in keep-alive), check for invalid field names first — they fail silently.

### zod-specialistschema-strips-unknown-keys-on-parse-verified
Zod SpecialistSchema strips unknown keys on parse — verified bug. `config/specialists/explorer.specialist.json` has `communication.publishes` that disappears after `parseSpecialist()`. Breaks `sp edit` round-trip today. Fix: `.passthrough()` on every nested object in src/specialist/schema.ts. Required precondition for any class discriminator or new optional field that must round-trip. Test: parse a spec with extra keys and assert they survive.

