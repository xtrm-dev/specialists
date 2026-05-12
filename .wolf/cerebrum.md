# Cerebrum

> OpenWolf's learning memory. Updated automatically as the AI learns from interactions.
> Do not edit manually unless correcting an error.
> Last updated: 2026-03-31

## User Preferences

<!-- How the user likes things done. Code style, tools, patterns, communication. -->

- [2026-05-06] For darth-feedor/service-specialist hardening, prioritize current Pi subprocess/RPC architecture redeployment fixes first; SDK migration remains a later measured phase. In full-auto mode, set wake-up timers and run paranoid validation/review passes.

## Key Learnings

- [2026-05-06] script-class specialists must keep pi prompt context isolated: use --system-prompt plus --no-context-files --no-skills --no-prompt-templates --no-themes; package-class runner may still use project context.
- **Project:** @jaggerxtrm/specialists
- **Description:** OmniSpecialist — 7-tool MCP orchestration layer powered by the Specialist System. Discover and execute .specialist.yaml files across project/user/system scopes via pi.

## Do-Not-Repeat

- [2026-04-22] When changing CLI behavior, rebuild and publish updated dist/index.js before claiming fix shipped. Source-only fix is insufficient because npm package executes bundled dist.
- [2026-04-24] In this project, executor specialists do not use Bun/Vitest for verification. Do not ask executors to run vitest or bun test commands; keep executor verification to lint/tsc and handle tests via reviewer/test-runner or manual follow-up outside the executor path.
- [2026-05-06] Do not preserve stale specialist/sync-docs worktrees with compatibility path symlinks. If a worktree points at an obsolete xtrm-tools path, remove/prune the stale worktree and relaunch from current repo state instead of keeping path shims.

<!-- Mistakes made and corrected. Each entry prevents the same mistake recurring. -->
<!-- Format: [YYYY-MM-DD] Description of what went wrong and what to do instead. -->

## Decision Log

<!-- Significant technical decisions with rationale. Why X was chosen over Y. -->

## User Corrections — 2026-05-12
- `sp ps` default must stay compact: show aggregate System health only. Detailed per-process specialist/Dolt/Serena/orphan rows belong behind explicit `sp ps --health`.
