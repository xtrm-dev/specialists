# XTRM-93 — Stack Overlay and Cut Line (GitNexus)

**Lane:** I (architecture maps and cut-line overlay)
**Source of truth:** git `master` `472b1aef` + one local commit (`unitAI-rx1bu`); worktree HEAD `6553ef05`.
**Audited tree:** `/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh` (branch `xt/akkh`).
**Index used:** the **fresh worktree index** `repo="/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh"`.
`gitnexus status`: `Indexed commit 6553ef0 == Current commit 6553ef0`; 742 files / 22 207 symbols / 54 636 edges; CLI 1.6.11.
The "stale" marker is caused only by the ten `docs/migrations/xtrm-93/*.md` files added after indexing. The repo-wide
`ce33c31` index was **not** used.

## 0. Reachability definition (read this before using the columns)

A module is **legacy-reachable** when it is reachable in the live graph from the legacy execution roots
`src/cli/run.ts`, `src/cli/chat.ts`, `src/cli/node.ts`; it is **native-reachable** when reachable from
`src/activation/native-host.ts`, `src/tools/specialist/activation.tool.ts`, `src/mcp/v2-server.ts`, `src/server.ts`,
`config/pi-extensions/specialist-subagents/index.mjs`.

The live graph is `IMPORTS` edges that are **not** `import (type-only)` and **not** `markdown-link`, **plus** `CALLS`
edges with `confidence >= 0.80`. Type-only imports are excluded deliberately: a type import cannot execute.
The measured boundary crossing is asymmetric and small (query E.7): the **native** stack imports **13 legacy
modules live and 2 type-only**, while the **legacy** stack imports only **3 native modules live and 1 type-only**
(`cli/doctor -> workitem-store`; `beads`/`bead-gate -> contract-sections`; `native-activation-observability -> pi-sdk`
type-only). Exclusion is not free: `src/specialist/supervisor.ts:23` imports `SpecialistRunner` **type-only** and
calls `runner.run()` at runtime (`:2219`), so the type-only filter introduces a known false-negative there. Every
such gap is compensated by an explicit `INFERRED` edge in the corresponding map rather than being silently dropped.
The package bin `src/index.ts` is **not** a seed: it reaches both stacks through deferred `import()` dispatch, which
would collapse the two closures into one and hide the cut line.
`src/lib.ts` is the library entry the Pi extension loads; it is in the native closure only.

## 1. Overlay table

| module | layer | legacy-reachable? | native-reachable? | label | evidence | notes |
|---|---|---|---|---|---|---|
| `src/activation/ask-tool.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/async-events.ts` | native core | no | yes | native-only | native closure only; importers: src/lib.ts, src/mcp/resume-tool.ts, src/mcp/v2-server.ts |  |
| `src/activation/authority-store.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts, src/activation/workitem-store.ts, src/mcp/v2-server.ts |  |
| `src/activation/build-identity.ts` | native core | no | yes | native-only | native closure only; importers: src/lib.ts, src/mcp/resume-tool.ts, src/tools/specialist/activation.tool.ts |  |
| `src/activation/contract-sections.ts` | native core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/activation/workitem-store.ts, src/lib.ts |  |
| `src/activation/forensic-sink.ts` | native core | no | yes | native-only | native closure only; importers: src/lib.ts, src/mcp/v2-server.ts, src/server.ts |  |
| `src/activation/guarded-tools.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/interaction.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/ask-tool.ts, src/activation/async-events.ts, src/activation/native-host.ts |  |
| `src/activation/model-gate.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/native-host.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/forensic-sink.ts, src/lib.ts, src/mcp/channel.ts |  |
| `src/activation/peer-bridge.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/pi-sdk.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/ask-tool.ts, src/activation/guarded-tools.ts, src/activation/model-gate.ts |  |
| `src/activation/registry.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/rejection.ts` | native core | no | yes | native-only | native closure only; importers: src/lib.ts, src/mcp/resume-tool.ts, src/tools/specialist/activation.tool.ts |  |
| `src/activation/settlement-lease.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/settlement-publication.ts |  |
| `src/activation/settlement-publication.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts |  |
| `src/activation/settlement-store.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts, src/activation/settlement-publication.ts |  |
| `src/activation/step-contract.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts, src/activation/registry.ts, src/activation/types.ts |  |
| `src/activation/transport/peer-adapter.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/async-events.ts, src/activation/native-host.ts, src/activation/peer-bridge.ts |  |
| `src/activation/transport/peer-registration.ts` | native core | no | no | UNKNOWN | not in either closure |  |
| `src/activation/transport/peer-transport.ts` | native core | no | yes | native-only | native closure only; importers: scripts/measure-roster.ts, src/activation/transport/peer-adapter.ts, src/activation/transport/peer-registration.ts |  |
| `src/activation/transport/pending-store.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/peer-bridge.ts, src/activation/transport/peer-adapter.ts, src/activation/transport/polling.ts |  |
| `src/activation/transport/polling.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/transport/peer-adapter.ts, src/tools/specialist/specialist_status.tool.ts |  |
| `src/activation/transport/roster.ts` | native core | no | yes | native-only | native closure only; importers: scripts/measure-roster.ts, src/activation/transport/peer-adapter.ts, src/activation/transport/peer-registration.ts |  |
| `src/activation/types.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/ask-tool.ts, src/activation/async-events.ts, src/activation/authority-store.ts |  |
| `src/activation/workitem-store.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/native-host.ts, src/activation/registry.ts, src/activation/settlement-publication.ts |  |
| `src/activation/workspace-lease.ts` | native core | no | yes | native-only | native closure only; importers: src/activation/guarded-tools.ts, src/activation/native-host.ts, src/activation/settlement-lease.ts |  |
| `src/activation/workspace-reconcile.ts` | native core | no | yes | native-only | native closure only; importers: src/lib.ts, src/tools/specialist/specialist_status.tool.ts |  |
| `src/cli/attach-tui.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/attach.ts |  |
| `src/cli/attach.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/attach-tui.ts, src/index.ts |  |
| `src/cli/chat.ts` | CLI frontend | yes | no | legacy-only | legacy closure only; importers: src/cli/attach-tui.ts, src/index.ts |  |
| `src/cli/chat/control.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/attach-tui.ts, src/cli/attach.ts, src/cli/chat.ts |  |
| `src/cli/chat/feed.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/attach-tui.ts, src/cli/chat.ts |  |
| `src/cli/chat/status.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/attach-tui.ts, src/cli/chat.ts |  |
| `src/cli/clean.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/config.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/console.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/console/components.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console.ts |  |
| `src/cli/console/config-source.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/components.ts, src/cli/console/runtime.ts, src/cli/console/types.ts |  |
| `src/cli/console/forensic.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/runtime.ts |  |
| `src/cli/console/git.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/runtime.ts |  |
| `src/cli/console/help.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/console/log.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/components.ts, src/cli/console/config-source.ts, src/cli/console/repo-config.ts |  |
| `src/cli/console/repo-config.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/repo-discovery.ts, src/cli/console/runtime.ts |  |
| `src/cli/console/repo-discovery.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/runtime.ts |  |
| `src/cli/console/runtime.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console.ts, src/cli/console/components.ts |  |
| `src/cli/console/subscribe-prototype.ts` | CLI frontend | no | no | frontend | not in either closure |  |
| `src/cli/console/theme.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/components.ts, src/cli/console/forensic.ts, src/cli/ps.ts |  |
| `src/cli/console/types.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/components.ts, src/cli/console/forensic.ts, src/cli/console/runtime.ts |  |
| `src/cli/console/view-model.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/console/components.ts |  |
| `src/cli/db.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/doctor.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/edit.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/config.ts, src/index.ts |  |
| `src/cli/end.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/epic.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/end.ts, src/index.ts |  |
| `src/cli/feed.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/finalize.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/follow-up.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/forensic.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/format-helpers.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/chat.ts, src/cli/console/runtime.ts, src/cli/feed.ts |  |
| `src/cli/help.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/init.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/install.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/integration.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/launch-outcome.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/list-rules.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/list.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/log.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/merge.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/end.ts, src/cli/epic.ts, src/cli/run.ts |  |
| `src/cli/metrics.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/models.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/node.ts` | CLI frontend | yes | no | legacy-only | legacy closure only; importers: src/index.ts |  |
| `src/cli/pi-json-output.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/feed.ts, src/cli/run.ts |  |
| `src/cli/prune-stale-defaults.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/ps.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/quickstart.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/render-bead.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/render-skill-prefix.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/render-task.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/render-bead.ts, src/cli/render-skill-prefix.ts, src/index.ts |  |
| `src/cli/result.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/resume.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/follow-up.ts, src/index.ts |  |
| `src/cli/retry.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/run.ts` | CLI frontend | yes | no | legacy-only | legacy closure only; importers: src/index.ts, src/specialist/launch.ts |  |
| `src/cli/script.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/serve-hot-reload.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/serve.ts |  |
| `src/cli/serve.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/setup.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/status.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts, src/tools/specialist/feed_specialist.tool.ts |  |
| `src/cli/steer.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/stop.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/tmux-utils.ts` | CLI frontend | yes | no | frontend | legacy closure only; importers: src/cli/run.ts, src/specialist/control.ts, src/specialist/supervisor.ts |  |
| `src/cli/validate.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/version-check.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/cli/doctor.ts, src/cli/list.ts, src/cli/status.ts |  |
| `src/cli/version.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/cli/view.ts` | CLI frontend | no | no | frontend | not in either closure; importers: src/index.ts |  |
| `src/constants.ts` | misc | no | yes | native-only | native closure only; importers: src/mcp/v2-server.ts, src/server.ts, src/utils/logger.ts |  |
| `src/index.ts` | CLI/MCP entry | no | no | frontend | not in either closure |  |
| `src/lib.ts` | library entry | no | yes | native-only | native closure only; importers: src/tools/specialist/specialist_list.tool.ts |  |
| `src/mcp/channel.ts` | MCP frontend | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/mcp/request-meta.ts` | MCP frontend | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/mcp/resume-tool.ts` | MCP frontend | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/mcp/v2-server.ts` | MCP frontend | no | yes | frontend | native closure only; importers: src/index.ts |  |
| `src/pi/backendMap.ts` | shared agent runtime | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/pi/session.ts |  |
| `src/pi/extension-tool-policy-extension.ts` | shared agent runtime | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/pi/session.ts |  |
| `src/pi/python-kernel-extension.ts` | shared agent runtime | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/pi/session.ts |  |
| `src/pi/read-line-numbers-extension.ts` | shared agent runtime | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/pi/session.ts, src/specialist/script-runner.ts |  |
| `src/pi/session.ts` | shared agent runtime | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/activation/pi-sdk.ts |  |
| `src/server.ts` | MCP entry | no | yes | native-only | native closure only |  |
| `src/specialist/bead-gate.ts` | shared/legacy core | no | yes | native-only | native closure only; importers: src/lib.ts |  |
| `src/specialist/bead-notes.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/chat.ts, src/cli/node.ts |  |
| `src/specialist/beads.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/node.ts, src/cli/render-task.ts, src/cli/run.ts |  |
| `src/specialist/benchmarks.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/setup.ts |  |
| `src/specialist/branch-integration-events.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/integration.ts, src/cli/merge.ts, src/specialist/observability-sqlite.ts | no frontend importer; native path: settlement publication/provenance |
| `src/specialist/canonical-asset-resolver.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/config.ts, src/cli/console/config-source.ts, src/cli/doctor.ts |  |
| `src/specialist/chain-identity.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/db.ts, src/specialist/observability-sqlite.ts, src/specialist/supervisor.ts | no frontend importer; native path: settlement attempt/lineage identity |
| `src/specialist/channel-doctor.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/doctor.ts |  |
| `src/specialist/citation-evidence.ts` | shared/legacy core | no | yes | native-only | native closure only; importers: src/lib.ts |  |
| `src/specialist/control.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/chat.ts, src/cli/console/runtime.ts, src/cli/finalize.ts |  |
| `src/specialist/dead-job-audit.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/doctor.ts |  |
| `src/specialist/drift-detector.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/doctor.ts, src/cli/prune-stale-defaults.ts |  |
| `src/specialist/epic-lifecycle.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/end.ts, src/cli/epic.ts, src/cli/merge.ts | no frontend importer; native path: Fleet + Substrate epic ancestry |
| `src/specialist/epic-readiness.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/merge.ts, src/cli/ps.ts, src/specialist/epic-reconciler.ts | no frontend importer; native path: workitem-store dispatch gate |
| `src/specialist/epic-reconciler.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/epic.ts, src/cli/merge.ts | no frontend importer; native path: Substrate readiness/reconciliation |
| `src/specialist/forensic-events.ts` | shared/legacy core | yes | yes | ownership-move | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/console/forensic.ts, src/cli/epic.ts, src/cli/log.ts | native mcp/request-meta.ts + server.ts build forensic events with the legacy factory |
| `src/specialist/forensic-renderer.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/console/forensic.ts, src/cli/log.ts |  |
| `src/specialist/git-diff-evidence.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/specialist/supervisor.ts |  |
| `src/specialist/global-config.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/console/config-source.ts, src/cli/console/runtime.ts |  |
| `src/specialist/hooks.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/node.ts, src/cli/run.ts, src/specialist/launch.ts |  |
| `src/specialist/job-control.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/specialist/node-supervisor.ts | no frontend importer; native path: NativeActivationHost.start/stop/answer |
| `src/specialist/job-file-output.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/status.ts, src/specialist/runner.ts, src/specialist/status-load.ts |  |
| `src/specialist/job-root.ts` | shared/legacy core | yes | yes | ownership-move | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/workspace-reconcile.ts, src/cli/clean.ts, src/cli/console/repo-discovery.ts | activation/workitem-store.ts + workspace-reconcile.ts consume resolveJobsDir/resolveCommonGitRoot |
| `src/specialist/jobRegistry.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/runner.ts, src/tools/specialist/resume_specialist.tool.ts, src/tools/specialist/steer_specialist.tool.ts |  |
| `src/specialist/json-output.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/runner.ts |  |
| `src/specialist/launch-outcome.ts` | shared/legacy core | no | yes | native-only | native closure only; importers: src/cli/launch-outcome.ts, src/lib.ts |  |
| `src/specialist/launch.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/chat.ts, src/cli/run.ts |  |
| `src/specialist/live-aggregates.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/console/runtime.ts |  |
| `src/specialist/loader.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/cli/chat.ts, src/cli/console/config-source.ts |  |
| `src/specialist/mandatory-rules.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/list-rules.ts, src/specialist/required-platform-rules.ts, src/specialist/runner.ts |  |
| `src/specialist/manifest-resolver.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/pi/session.ts, src/specialist/resolution-diagnostics.ts, src/specialist/resolved-tool-contract.ts |  |
| `src/specialist/memory-retrieval.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/mandatory-rules.ts, src/specialist/system-prompt.ts |  |
| `src/specialist/model-chain.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/lib.ts, src/specialist/runner.ts |  |
| `src/specialist/model-display.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/chat.ts, src/cli/feed.ts, src/tools/specialist/feed_specialist.tool.ts |  |
| `src/specialist/model-probes.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/setup.ts |  |
| `src/specialist/native-activation-observability.ts` | shared/legacy core | no | yes | native-only | native closure only; importers: src/activation/forensic-sink.ts, src/activation/native-host.ts |  |
| `src/specialist/native-activation-summary.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/feed.ts, src/cli/ps.ts |  |
| `src/specialist/node-contract.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/specialist/node-supervisor.ts | no frontend importer; native path: contract-sections/step-contract |
| `src/specialist/node-resolve.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/feed.ts, src/cli/node.ts, src/cli/ps.ts | no frontend importer; native path: Substrate issue resolution in workitem-store |
| `src/specialist/node-supervisor.ts` | shared/legacy core | yes | no | candidate-delete | legacy closure only; importers: src/cli/node.ts | no frontend importer; native path: FleetRegistry + workitem-store dispatch gate |
| `src/specialist/observability-db.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/console/repo-discovery.ts, src/cli/console/runtime.ts, src/cli/db.ts |  |
| `src/specialist/observability-sqlite.ts` | shared/legacy core | yes | yes | ownership-move | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/forensic-sink.ts, src/cli/chat.ts, src/cli/clean.ts | native forensic-sink.ts writes specialist_jobs/specialist_events via upsertStatus/upsertStatusWithEvents (forensic-sink.ts:164) |
| `src/specialist/payload-measure.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/runner.ts, src/specialist/system-prompt.ts, src/specialist/task-prompt.ts |  |
| `src/specialist/pipeline.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure |  |
| `src/specialist/porcelain-parser.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/specialist/supervisor.ts |  |
| `src/specialist/pr-drift-refresh.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/doctor.ts |  |
| `src/specialist/preset-resolver.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/edit.ts, src/specialist/loader.ts |  |
| `src/specialist/process-health.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/clean.ts, src/cli/console/runtime.ts, src/cli/console/types.ts |  |
| `src/specialist/process-liveness.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/specialist/control.ts, src/specialist/epic-readiness.ts |  |
| `src/specialist/project-pack-skill-resolver.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/loader.ts |  |
| `src/specialist/prometheus-projection.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/metrics.ts, src/cli/serve.ts |  |
| `src/specialist/required-platform-rules.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/script-runner.ts, src/specialist/system-prompt.ts |  |
| `src/specialist/resolution-diagnostics.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/config.ts |  |
| `src/specialist/resolved-tool-contract.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/pi/session.ts, src/specialist/resolution-diagnostics.ts |  |
| `src/specialist/runner.ts` | shared/legacy core | yes | yes | ownership-move | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/cli/node.ts | native-host imports validateBeforeRun/runScript/resolveOutputContractSchema/formatRequiredPreScriptFailure/formatScriptOutput/createReviewerDiffAppendHook/classifyFallbackError (native-host.ts:41-50) |
| `src/specialist/runtime-origin-reconstruct.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure |  |
| `src/specialist/runtime-origin.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/run.ts, src/specialist/launch.ts, src/specialist/runner.ts |  |
| `src/specialist/schema.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/edit.ts, src/cli/render-bead.ts |  |
| `src/specialist/script-runner.ts` | shared/legacy core | no | yes | native-only | native closure only; importers: src/cli/script.ts, src/cli/serve.ts |  |
| `src/specialist/snapshot-diff.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/console/components.ts |  |
| `src/specialist/source-queue.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/console/components.ts |  |
| `src/specialist/status-load.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/attach-tui.ts, src/cli/attach.ts, src/cli/chat.ts |  |
| `src/specialist/supervisor.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/activation/forensic-sink.ts, src/cli/chat/control.ts, src/cli/chat/status.ts |  |
| `src/specialist/system-prompt.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/specialist/runner.ts |  |
| `src/specialist/task-prompt.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/native-host.ts, src/cli/render-skill-prefix.ts, src/cli/render-task.ts |  |
| `src/specialist/templateEngine.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/specialist/script-runner.ts, src/specialist/system-prompt.ts, src/specialist/task-prompt.ts |  |
| `src/specialist/timeline-events.ts` | shared/legacy core | yes | yes | ownership-move | in both closures (live IMPORTS + CALLS >=0.80); importers: src/activation/forensic-sink.ts, src/cli/chat.ts | native-activation-observability.ts + script-runner.ts build native events with the legacy event factories |
| `src/specialist/timeline-query.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/feed.ts, src/tools/specialist/feed_specialist.tool.ts |  |
| `src/specialist/tool-catalog.ts` | shared/legacy core | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/doctor.ts, src/pi/session.ts, src/specialist/resolution-diagnostics.ts |  |
| `src/specialist/worktree-gc.ts` | shared/legacy core | no | no | UNKNOWN | not in either closure; importers: src/cli/clean.ts |  |
| `src/specialist/worktree.ts` | shared/legacy core | yes | no | legacy-only | legacy closure only; importers: src/cli/run.ts, src/specialist/node-supervisor.ts |  |
| `src/substrate/services.ts` | native substrate | no | yes | native-only | native closure only; importers: src/mcp/v2-server.ts, src/tools/substrate/issue.tool.ts, src/tools/substrate/journal.tool.ts |  |
| `src/tools/specialist/activation.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/lib.ts, src/mcp/resume-tool.ts, src/mcp/v2-server.ts |  |
| `src/tools/specialist/feed_specialist.tool.ts` | tool adapter | no | no | frontend | not in either closure |  |
| `src/tools/specialist/list_specialists.tool.ts` | tool adapter | no | no | frontend | not in either closure |  |
| `src/tools/specialist/resume_specialist.tool.ts` | tool adapter | no | no | frontend | not in either closure |  |
| `src/tools/specialist/specialist_list.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts, src/server.ts |  |
| `src/tools/specialist/specialist_status.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts, src/server.ts |  |
| `src/tools/specialist/steer_specialist.tool.ts` | tool adapter | no | no | frontend | not in either closure |  |
| `src/tools/specialist/stop_specialist.tool.ts` | tool adapter | no | no | frontend | not in either closure |  |
| `src/tools/substrate/issue.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/tools/substrate/journal.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/tools/substrate/provenance.tool.ts` | tool adapter | no | yes | frontend | native closure only; importers: src/mcp/v2-server.ts |  |
| `src/utils/circuitBreaker.ts` | shared util | yes | yes | shared | in both closures (live IMPORTS + CALLS >=0.80); importers: src/cli/node.ts, src/cli/run.ts, src/mcp/v2-server.ts |  |
| `src/utils/logger.ts` | shared util | no | yes | native-only | native closure only; importers: src/index.ts, src/mcp/channel.ts, src/mcp/v2-server.ts |  |
| `plugins/specialists/scripts/mcp-server.mjs` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | Claude plugin launcher -> dist/index.js |
| `plugins/specialists/scripts/wake-watch.mjs` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | asyncRewake fallback watcher; read-only |
| `plugins/specialists/scripts/lease-warn.mjs` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | read-only lease warning hook |
| `plugins/specialists/scripts/session-start.mjs` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | read-only Substrate state injection |
| `plugins/specialists/hooks/hooks.json` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | Claude hook wiring |
| `config/pi-extensions/specialist-subagents/index.mjs` | plugin frontend | n/a | n/a | frontend | file:line cited in native/legacy maps | Pi coordinator extension; INFERRED constructs NativeActivationHost from dist/lib.js |
| `clients/python/specialists_client.py` | client SDK | n/a | n/a | frontend | file:line cited in native/legacy maps | out-of-band Python client |

## A. The cut line

### A.1 What changes owner or disappears

**Legacy-only modules (15) — the legacy execution core. These do not execute on the native path.**

`src/cli/run.ts`, `src/cli/chat.ts`, `src/cli/node.ts`, `src/specialist/launch.ts`, `src/specialist/supervisor.ts`,
`src/specialist/control.ts`, `src/specialist/worktree.ts`, `src/specialist/hooks.ts`, `src/specialist/status-load.ts`,
`src/specialist/runtime-origin.ts`, `src/specialist/git-diff-evidence.ts`, `src/specialist/porcelain-parser.ts`,
`src/specialist/process-liveness.ts`, `src/specialist/model-display.ts`, `src/specialist/bead-notes.ts`.

**Candidate-delete (9) — legacy-only internals with no frontend importer and a named native replacement.**
These are the safest deletions *after* the legacy launch path is retired.

| module | replacement on the native path |
|---|---|
| `src/specialist/node-supervisor.ts` | `FleetRegistry` + `workitem-store` dispatch gate |
| `src/specialist/node-resolve.ts` | Substrate issue resolution in `workitem-store` |
| `src/specialist/node-contract.ts` | `contract-sections.ts` + `step-contract.ts` |
| `src/specialist/job-control.ts` | `NativeActivationHost.start/stop/answer` + `registry` |
| `src/specialist/epic-lifecycle.ts` | Fleet + Substrate epic ancestry (`workitem-store.epicAncestors`) |
| `src/specialist/epic-readiness.ts` | `workitem-store.check` dispatch gate |
| `src/specialist/epic-reconciler.ts` | Substrate readiness/reconciliation |
| `src/specialist/chain-identity.ts` | settlement attempt/lineage identity |
| `src/specialist/branch-integration-events.ts` | settlement publication + provenance |

**Caveat — not yet deletable, despite being legacy-only:** `supervisor.ts`, `control.ts`, `worktree.ts`,
`status-load.ts`, `runtime-origin.ts`, `git-diff-evidence.ts` are still consumed by the **operator CLI surfaces**
(`ps`, `status`, `result`, `feed`, `log`, `stop`, `resume`, `retry`, `steer`, `finalize`, `end`, `merge`, `epic`,
`console`). Removing the legacy launch path does not retire them; re-pointing those CLI surfaces at the Fleet does.

### A.2 Ownership moves (5 modules)

| module | moved symbols now called by the native stack | native caller (evidence) |
|---|---|---|
| `src/specialist/runner.ts` | `validateBeforeRun`, `runScript`, `resolveOutputContractSchema`, `findRequiredPreScriptFailure`, `formatRequiredPreScriptFailure`, `formatScriptOutput`, `createReviewerDiffAppendHook`, `classifyFallbackError`, `resolvePromptWithBeadContext` | `native-host.ts:41-50` (live import), `:505,1731` (calls) |
| `src/specialist/observability-sqlite.ts` | `upsertStatus`, `upsertStatusWithEvents` (and the whole `ObservabilitySqliteClient` write surface) | `forensic-sink.ts:164` |
| `src/specialist/timeline-events.ts` | `createRunStartEvent`, `createRunCompleteEvent`, `createTokenUsageEvent`, `createTurnSummaryEvent`, `createFinishReasonEvent`, `createStatusChangeEvent`, `createControlSignalEvent`, `createMetaEvent`, `mapCallbackEventToTimelineEvent` | `native-activation-observability.ts`, `script-runner.ts` |
| `src/specialist/forensic-events.ts` | `createForensicEvent`, `deploymentEnvironment`, `deriveParticipantId`, `forensicEventFromTimelineEvent` | `mcp/request-meta.ts`, `server.ts`, `observability-sqlite.ts` |
| `src/specialist/job-root.ts` | `resolveJobsDir`, `resolveCommonGitRoot` | `observability-sqlite.ts`, `activation/workspace-reconcile.ts` |

`runner.ts` is the sharpest ownership move: the native host imports the legacy runner **live** and executes its
helpers directly, so "the runner belongs to the CLI" is already false before any cutover.

### A.3 Shared and highest regression risk (34 modules)

**Shared (29):** `src/specialist/beads.ts`, `loader.ts`, `schema.ts`, `global-config.ts`, `canonical-asset-resolver.ts`,
`preset-resolver.ts`, `project-pack-skill-resolver.ts`, `manifest-resolver.ts`, `resolved-tool-contract.ts`, `model-chain.ts`,
`mandatory-rules.ts`, `required-platform-rules.ts`, `memory-retrieval.ts`, `system-prompt.ts`, `task-prompt.ts`,
`templateEngine.ts`, `tool-catalog.ts`, `payload-measure.ts`, `json-output.ts`, `job-file-output.ts`, `jobRegistry.ts`,
`observability-db.ts`, `src/pi/session.ts`, `src/pi/backendMap.ts`, `src/pi/read-line-numbers-extension.ts`,
`src/pi/python-kernel-extension.ts`, `src/pi/extension-tool-policy-extension.ts`, `src/activation/contract-sections.ts`,
`src/utils/circuitBreaker.ts`.

**Plus the 5 ownership-move modules listed in A.2.** Ranked by GitNexus impact on the shared symbols:

| shared symbol | GitNexus impact | risk | why a cutover can break silently |
|---|---|---|---|
| `observability-sqlite.createObservabilitySqliteClient` | 127 impacted (75 direct) | **CRITICAL** | legacy jobs and the native forensic sink write the **same** `specialist_jobs`/`specialist_events` tables |
| `loader.SpecialistLoader` | 138 impacted | **CRITICAL** | both stacks resolve the same definitions; a change to layer/override resolution changes what both run |
| `pi/session.resolveRuntimeToolContract` | 15 impacted | **CRITICAL** | the `--tools` surface for both `pi --mode rpc` and the in-process session |
| `beads.buildBeadContext` | 13 impacted | **CRITICAL** | legacy prompt path and native task-prompt share the same context renderer |
| `system-prompt.buildSystemPrompt` | 4 impacted | LOW | native and legacy compile the same system prompt from the same source |

## B. Shared symbols both stacks call

### B.1 Hard evidence — called from a **legacy-only** module AND a **native-only** module (20)

These are the symbols a cutover can silently break: each has one caller that only exists on the legacy path and one
that only exists on the native path.

| shared symbol | file (module) | legacy-side callers | native-side callers |
|---|---|---|---|
| `createForensicEvent` | `src/specialist/forensic-events.ts` | `specialist/supervisor.ts` | `mcp/request-meta.ts`, `server.ts` |
| `deploymentEnvironment` | `src/specialist/forensic-events.ts` | `specialist/supervisor.ts` | `mcp/request-meta.ts`, `server.ts` |
| `resolveCommonGitRoot` | `src/specialist/job-root.ts` | `specialist/worktree.ts` | `activation/workspace-reconcile.ts` |
| `SpecialistLoader` | `src/specialist/loader.ts` | `cli/chat.ts`, `cli/node.ts`, `cli/run.ts` | `activation/native-host.ts`, `mcp/v2-server.ts`, `server.ts` |
| `get` | `src/specialist/loader.ts` | `cli/chat.ts`, `cli/run.ts` | `activation/native-host.ts`, `tools/specialist/specialist_list.tool.ts` |
| `list` | `src/specialist/loader.ts` | `cli/node.ts` | `tools/specialist/specialist_list.tool.ts`, `tools/specialist/specialist_status.tool.ts` |
| `resolveObservabilityDbLocation` | `src/specialist/observability-db.ts` | `cli/run.ts`, `specialist/epic-reconciler.ts`, `specialist/supervisor.ts` | `specialist/script-runner.ts` |
| `createObservabilitySqliteClient` | `src/specialist/observability-sqlite.ts` | `cli/chat.ts`, `cli/merge.ts`, `cli/node.ts`, `cli/run.ts`, `specialist/job-control.ts`, `specialist/launch.ts`, `specialist/node-resolve.ts`, `specialist/node-supervisor.ts`, `specialist/status-load.ts`, `specialist/supervisor.ts` | `mcp/v2-server.ts`, `server.ts` |
| `createObservabilitySqliteClientAtPath` | `src/specialist/observability-sqlite.ts` | `cli/run.ts` | `specialist/script-runner.ts` |
| `upsertStatus` | `src/specialist/observability-sqlite.ts` | `specialist/epic-reconciler.ts` | `activation/forensic-sink.ts` |
| `createControlSignalEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts` |
| `createFinishReasonEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `createMetaEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `createRunCompleteEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `createRunStartEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `createStatusChangeEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts` |
| `createTokenUsageEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `createTurnSummaryEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `mapCallbackEventToTimelineEvent` | `src/specialist/timeline-events.ts` | `specialist/supervisor.ts` | `specialist/native-activation-observability.ts`, `specialist/script-runner.ts` |
| `CircuitBreaker` | `src/utils/circuitBreaker.ts` | `cli/node.ts`, `cli/run.ts` | `mcp/v2-server.ts`, `server.ts` |

### B.2 Reachable from both stacks, but all callers live inside shared modules (47)

Weaker evidence (the caller modules themselves are shared), still a both-stacks coupling:

| shared symbol | file (module) | legacy-side callers | native-side callers |
|---|---|---|---|
| `extractSections` | `src/activation/contract-sections.ts` | specialist/beads.ts | activation/workitem-store.ts, specialist/bead-gate.ts, specialist/beads.ts |
| `getProviderArgs` | `src/pi/backendMap.ts` | pi/session.ts | pi/session.ts |
| `mapSpecialistBackend` | `src/pi/backendMap.ts` | pi/session.ts | pi/session.ts |
| `getExtensionToolPolicyExtensionPath` | `src/pi/extension-tool-policy-extension.ts` | pi/session.ts | pi/session.ts |
| `resolvePiExtensionsPythonKernelPath` | `src/pi/python-kernel-extension.ts` | pi/session.ts | pi/session.ts |
| `getReadLineNumbersExtensionPath` | `src/pi/read-line-numbers-extension.ts` | pi/session.ts | pi/session.ts, specialist/script-runner.ts |
| `resolveExecutionExtensionSelection` | `src/pi/session.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts, specialist/script-runner.ts, tools/specialist/specialist_list.tool.ts |
| `resolveRuntimeToolContract` | `src/pi/session.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts, specialist/script-runner.ts, tools/specialist/specialist_list.tool.ts |
| `BeadsClient` | `src/specialist/beads.ts` | cli/node.ts, cli/run.ts, specialist/control.ts, specialist/runner.ts, specialist/system-prompt.ts | specialist/runner.ts, specialist/system-prompt.ts |
| `buildBeadContext` | `src/specialist/beads.ts` | cli/node.ts, cli/run.ts, specialist/runner.ts, specialist/task-prompt.ts | specialist/runner.ts, specialist/task-prompt.ts |
| `readBead` | `src/specialist/beads.ts` | cli/node.ts, specialist/system-prompt.ts | specialist/system-prompt.ts |
| `shouldCreateBead` | `src/specialist/beads.ts` | specialist/runner.ts | specialist/runner.ts |
| `resolveCanonicalAssetDir` | `src/specialist/canonical-asset-resolver.ts` | cli/node.ts, pi/session.ts, specialist/loader.ts, specialist/mandatory-rules.ts | pi/session.ts, specialist/loader.ts, specialist/mandatory-rules.ts |
| `deriveParticipantId` | `src/specialist/forensic-events.ts` | specialist/observability-sqlite.ts | specialist/observability-sqlite.ts |
| `forensicEventFromTimelineEvent` | `src/specialist/forensic-events.ts` | specialist/observability-sqlite.ts | specialist/observability-sqlite.ts |
| `getGlobalUserConfigPath` | `src/specialist/global-config.ts` | specialist/loader.ts | specialist/loader.ts |
| `readGlobalUserConfig` | `src/specialist/global-config.ts` | specialist/loader.ts | specialist/loader.ts |
| `writeJobFileOutput` | `src/specialist/job-file-output.ts` | specialist/runner.ts | specialist/runner.ts |
| `resolveJobsDir` | `src/specialist/job-root.ts` | cli/node.ts, cli/run.ts, specialist/control.ts, specialist/job-control.ts, specialist/node-supervisor.ts | specialist/observability-sqlite.ts |
| `stripJsonFences` | `src/specialist/json-output.ts` | specialist/runner.ts | specialist/runner.ts |
| `buildMandatoryRulesInjection` | `src/specialist/mandatory-rules.ts` | specialist/required-platform-rules.ts, specialist/task-prompt.ts | specialist/required-platform-rules.ts, specialist/script-runner.ts, specialist/task-prompt.ts |
| `compileMandatoryRulesBudget` | `src/specialist/mandatory-rules.ts` | specialist/required-platform-rules.ts | specialist/required-platform-rules.ts |
| `resolveEffectiveExtensionState` | `src/specialist/manifest-resolver.ts` | specialist/resolved-tool-contract.ts | specialist/resolved-tool-contract.ts |
| `resolveManifestTools` | `src/specialist/manifest-resolver.ts` | specialist/resolved-tool-contract.ts | specialist/resolved-tool-contract.ts |
| `estimateInjectedTokens` | `src/specialist/memory-retrieval.ts` | specialist/system-prompt.ts | specialist/system-prompt.ts |
| `resolveModelChain` | `src/specialist/model-chain.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts, specialist/script-runner.ts, tools/specialist/specialist_list.tool.ts |
| `readEvents` | `src/specialist/observability-sqlite.ts` | specialist/runner.ts | specialist/runner.ts |
| `measurePayloadComponent` | `src/specialist/payload-measure.ts` | specialist/runner.ts, specialist/system-prompt.ts, specialist/task-prompt.ts | specialist/runner.ts, specialist/system-prompt.ts, specialist/task-prompt.ts |
| `summarizePayloadBreakdown` | `src/specialist/payload-measure.ts` | specialist/runner.ts | specialist/runner.ts |
| `loadPresets` | `src/specialist/preset-resolver.ts` | specialist/loader.ts | specialist/loader.ts |
| `resolvePresetReference` | `src/specialist/preset-resolver.ts` | specialist/loader.ts | specialist/loader.ts |
| `resolveSkillPath` | `src/specialist/project-pack-skill-resolver.ts` | specialist/loader.ts | specialist/loader.ts |
| `buildRequiredPlatformRulesBlock` | `src/specialist/required-platform-rules.ts` | specialist/system-prompt.ts | specialist/script-runner.ts, specialist/system-prompt.ts |
| `buildResolvedToolContract` | `src/specialist/resolved-tool-contract.ts` | pi/session.ts | pi/session.ts |
| `formatResolvedToolContract` | `src/specialist/resolved-tool-contract.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts, specialist/script-runner.ts |
| `parseSpecialist` | `src/specialist/schema.ts` | specialist/loader.ts | specialist/loader.ts |
| `buildSystemPrompt` | `src/specialist/system-prompt.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts |
| `buildBeadBoundaryInstruction` | `src/specialist/task-prompt.ts` | specialist/runner.ts | specialist/runner.ts |
| `renderTaskPrompt` | `src/specialist/task-prompt.ts` | specialist/runner.ts | activation/native-host.ts, specialist/runner.ts |
| `extractTemplateTokens` | `src/specialist/templateEngine.ts` | specialist/task-prompt.ts | specialist/task-prompt.ts |
| `renderTemplate` | `src/specialist/templateEngine.ts` | specialist/system-prompt.ts, specialist/task-prompt.ts | specialist/script-runner.ts, specialist/system-prompt.ts, specialist/task-prompt.ts |
| `loadToolCatalogIndex` | `src/specialist/tool-catalog.ts` | pi/session.ts | pi/session.ts |
| `resolveCatalogVersionVerdict` | `src/specialist/tool-catalog.ts` | pi/session.ts | pi/session.ts |
| `isAuthError` | `src/utils/circuitBreaker.ts` | specialist/runner.ts | specialist/runner.ts |
| `isAvailable` | `src/utils/circuitBreaker.ts` | specialist/runner.ts | specialist/runner.ts |
| `isRateLimitError` | `src/utils/circuitBreaker.ts` | specialist/runner.ts | specialist/runner.ts |
| `isTransientError` | `src/utils/circuitBreaker.ts` | specialist/runner.ts | specialist/runner.ts |

## C. Frontend set — must survive untouched (UX/transport over a service boundary)

| frontend surface | modules | boundary it talks to |
|---|---|---|
| CLI (legacy operator UX) | `src/index.ts`, `src/cli/*.ts` (except `run.ts`/`chat.ts`/`node.ts`), `src/cli/chat/*`, `src/cli/console/*` | job files + `observability.db` + `Supervisor` (legacy), never a native host |
| MCP v2 (Claude) | `src/mcp/v2-server.ts`, `src/mcp/resume-tool.ts`, `src/mcp/channel.ts`, `src/mcp/request-meta.ts` | `NativeActivationHost` (native) + Substrate boundary |
| MCP legacy server | `src/server.ts` | both: `use_specialist` -> legacy `SpecialistRunner`; activation tools -> native host |
| MCP tool adapters | `src/tools/specialist/activation.tool.ts`, `specialist_status.tool.ts`, `specialist_list.tool.ts`, `feed_specialist.tool.ts`, `resume_specialist.tool.ts`, `steer_specialist.tool.ts`, `stop_specialist.tool.ts`, `src/tools/substrate/*.ts` | `getHost()` / Substrate service handles |
| Pi plugin | `config/pi-extensions/specialist-subagents/index.mjs` (+ `package.json`) | `dist/lib.js` -> `NativeActivationHost` |
| Claude plugin | `plugins/specialists/scripts/{mcp-server,session-start,wake-watch,lease-warn}.mjs`, `plugins/specialists/hooks/hooks.json`, `plugins/specialists/.mcp.json`, `plugins/specialists/skills/supervising-activations/SKILL.md` | `dist/index.js` MCP server; read-only Substrate DB and lease reads |
| Client SDK | `clients/python/specialists_client.py` | out-of-band |

These modules should not move or shrink during the cutover. Their reachability columns in the table above are
`n/a`/`frontend` because they are the *entry* side of the boundary, not consumers of an execution root.

## D. UNKNOWN modules

No path from either core execution root, and not attributable to a frontend by path prefix. Each row shows the graph
query result (importers) that would let a follow-up lane classify it. Query used:
`MATCH (a:File)-[r:CodeRelation {type:'IMPORTS'}]->(b:File) WHERE b.filePath = '<module>' RETURN a.filePath, r.reason`.

| module | producer importers (result) | reading |
|---|---|---|
| `src/activation/transport/peer-registration.ts` | none | orphan; 1 test-only consumer |
| `src/specialist/benchmarks.ts` | `src/cli/setup.ts` | CLI-aux (`sp setup`) |
| `src/specialist/channel-doctor.ts` | `src/cli/doctor.ts` | CLI-aux (`sp doctor`) |
| `src/specialist/dead-job-audit.ts` | `src/cli/doctor.ts` | CLI-aux |
| `src/specialist/drift-detector.ts` | `src/cli/doctor.ts`, `src/cli/prune-stale-defaults.ts` | CLI-aux |
| `src/specialist/forensic-renderer.ts` | `src/cli/log.ts`, `src/cli/console/forensic.ts` | CLI read surface |
| `src/specialist/live-aggregates.ts` | `src/cli/console/runtime.ts` | console TUI |
| `src/specialist/model-probes.ts` | `src/cli/setup.ts` | CLI-aux |
| `src/specialist/native-activation-summary.ts` | `src/cli/feed.ts`, `src/cli/ps.ts` | **native data rendered by legacy CLI** — classify alongside the Fleet projection |
| `src/specialist/pipeline.ts` | none | orphan; 1 test-only consumer |
| `src/specialist/pr-drift-refresh.ts` | `src/cli/doctor.ts` | CLI-aux |
| `src/specialist/process-health.ts` | `src/cli/clean.ts`, `src/cli/console/runtime.ts`, `src/cli/ps.ts`, `src/cli/console/types.ts` | CLI-aux / console |
| `src/specialist/prometheus-projection.ts` | `src/cli/metrics.ts`, `src/cli/serve.ts` | metrics read surface |
| `src/specialist/resolution-diagnostics.ts` | `src/cli/config.ts` | CLI-aux |
| `src/specialist/runtime-origin-reconstruct.ts` | none | orphan; 1 test-only consumer |
| `src/specialist/snapshot-diff.ts` | `src/cli/console/components.ts` | console TUI |
| `src/specialist/source-queue.ts` | `src/cli/console/components.ts` | console TUI |
| `src/specialist/timeline-query.ts` | `src/cli/feed.ts`, `src/tools/specialist/feed_specialist.tool.ts` | legacy feed read path (type-only import from the MCP tool) |
| `src/specialist/worktree-gc.ts` | `src/cli/clean.ts` | CLI-aux |

Four of these (`benchmarks`, `model-probes`, `channel-doctor`, `pr-drift-refresh`) are only reachable from
`sp setup`/`sp doctor`, which are operator tooling rather than either runtime; they are genuinely out of scope for
both closures.

## E. Reproducible commands and queries

All commands were run from the worktree root
(`/home/dawid/dev/specialists/.xtrm/worktrees/specialists-xt-pi-akkh`) with GitNexus CLI 1.6.11.

### E.1 Index identity

```bash
gitnexus status
gitnexus list | grep -A6 akkh
```

### E.2 Graph schema discovery

```bash
gitnexus cypher "CALL show_tables() RETURN *" -l 100
gitnexus cypher "CALL table_info('File') RETURN *" -l 50
gitnexus cypher "CALL table_info('Class') RETURN *" -l 50
gitnexus cypher "CALL table_info('Function') RETURN *" -l 50
gitnexus cypher "MATCH ()-[r:CodeRelation]->() RETURN r.type AS t, count(*) AS c ORDER BY c DESC" -l 60
gitnexus cypher "MATCH (a)-[r:CodeRelation]->(b) RETURN r.type AS rel, label(a) AS fromLabel, label(b) AS toLabel, count(*) AS c ORDER BY rel, c DESC" -l 200
```

### E.3 The reachability edge sets (the raw `cypher` used for the label work)

`IMPORTS` File -> File, with the reason that distinguishes live vs type-only (paged because the CLI caps stdout at
64 KiB — a single unpaged query returns truncated JSON):

```bash
gitnexus cypher "MATCH (a:File)-[r:CodeRelation {type:'IMPORTS'}]->(b:File) WHERE b.filePath STARTS WITH 'src/' RETURN a.filePath AS src, b.filePath AS dst, r.reason AS reason, r.confidence AS conf, r.staticGated AS sg SKIP 0 LIMIT 400"
# ... repeated with SKIP 400, 800, 1200 ... (1178 rows total)
gitnexus cypher "MATCH (a:File)-[r:CodeRelation {type:'IMPORTS'}]->(b:File) RETURN a.filePath AS src, b.filePath AS dst ORDER BY src, dst SKIP 0 LIMIT 400"
# ... repeated (1358 rows total over all files, incl. docs/tests)
```

`CALLS` symbol -> symbol (target inside `src/`), the edge set used for both callers on each side and for symbol
reachability (8550 rows, paged at 200 rows):

```bash
gitnexus cypher "MATCH (a)-[r:CodeRelation {type:'CALLS'}]->(b) WHERE b.filePath STARTS WITH 'src/' RETURN a.filePath AS af, a.name AS an, label(a) AS al, a.startLine AS aln, b.filePath AS bf, b.name AS bn, label(b) AS bl, r.confidence AS conf, r.staticGated AS sg ORDER BY af, aln, bf SKIP 0 LIMIT 200"
```

`USES` and `HAS_METHOD`:

```bash
gitnexus cypher "MATCH (a)-[r:CodeRelation {type:'USES'}]->(b) WHERE b.filePath STARTS WITH 'src/' RETURN a.filePath AS af, a.name AS an, label(a) AS al, b.filePath AS bf, b.name AS bn, label(b) AS bl ORDER BY af, bf SKIP 0 LIMIT 300"
gitnexus cypher "MATCH (c:Class)-[r:CodeRelation {type:'HAS_METHOD'}]->(m) RETURN c.name AS cls, c.filePath AS cf, m.name AS meth, m.filePath AS mf, m.startLine AS line ORDER BY cf, line SKIP 0 LIMIT 500"
```

The closures (`legacy` = BFS from the legacy roots, `native` = BFS from the native roots) were computed client-side
over exactly those two edge dumps, keeping `IMPORTS` with `reason` containing neither `type-only` nor `markdown-link`,
and `CALLS` with `confidence >= 0.80`.

### E.4 An in-graph traversal attempt (failed — recorded for completeness)

```bash
gitnexus cypher "MATCH (a:File {filePath:'src/cli/run.ts'})-[:CodeRelation*1..3]->(b:File) RETURN DISTINCT b.filePath AS reachable LIMIT 40" -l 40
# -> {"error": "Buffer manager exception: Unable to allocate memory! The buffer pool is full and no memory could be freed!"}
```

Variable-length traversal over the shared `CodeRelation` table OOMs the Kuzu buffer pool, which is why closure
computation is done client-side over the paged edge dumps instead.

### E.5 Symbol-level callers (the `impact`/`query`/`trace` evidence)

```bash
gitnexus context NativeActivationHost
gitnexus context launchSpecialist
gitnexus impact createObservabilitySqliteClient --direction upstream -l 30
gitnexus impact SpecialistLoader --kind Class --direction upstream -l 1
gitnexus impact resolveRuntimeToolContract --kind Function --direction upstream -l 1
gitnexus impact buildBeadContext --kind Function --direction upstream -l 1
gitnexus impact buildSystemPrompt --kind Function --direction upstream -l 1
gitnexus trace launchSpecialist Supervisor
gitnexus trace createSpecialistDispatchTool NativeActivationHost
#   -> {"status":"no_path","suggestion":"The call chain likely breaks at dynamic dispatch, reflection, or an external API boundary."}
gitnexus trace "Function:src/specialist/runner.ts:SpecialistRunner" "Class:src/activation/native-host.ts:NativeActivationHost"
#   -> {"status":"not_found"} (trace takes a name, not a uid string, for --from/--to)
gitnexus query "specialist dispatch native activation host pi session settlement" -l 6
gitnexus query "supervisor job run specialist runner pi rpc" -l 6
gitnexus query "activation start lease workitem settlement publication" -l 6
```

`impact` results recorded: `createObservabilitySqliteClient` CRITICAL, 127 impacted (75 direct);
`SpecialistLoader` CRITICAL, 138 impacted; `resolveRuntimeToolContract` CRITICAL, 15; `buildBeadContext` CRITICAL, 13;
`buildSystemPrompt` LOW, 4. `impact upsertStatus` and `impact resolveJobsDir` returned `ambiguous` (method-name
collisions) and were resolved with `--kind`/`--file` in the module columns instead.

### E.6 Cross-boundary import direction counts

```bash
# count live vs type-only imports crossing the legacy/native boundary
python3 - <<'PY'
import json, collections
imp = [r for r in json.load(open('/tmp/imports_src.json')) if r['reason'] != 'markdown-link']
def legacyish(a): return a.startswith(('src/cli/', 'src/specialist/', 'src/pi/'))
kind = lambda r: 'type' if 'type-only' in r['reason'] else ('deferred' if 'deferred' in r['reason'] else 'live')
c = collections.Counter()
for r in imp:
    if legacyish(r['src']) and r['dst'].startswith('src/activation/'):       c[('legacy->native', kind(r))] += 1
    if r['src'].startswith('src/activation/') and legacyish(r['dst']):        c[('native->legacy', kind(r))] += 1
print(c)
PY
# -> {('legacy->native','live'):3, ('legacy->native','type'):1,
#      ('native->legacy','live'):13, ('native->legacy','type'):2}
```

The raw rows that feed `imports_src.json` come from query E.3; the file is a direct dump of the paged `cypher`
result so the counts above are reproducible from the graph.

### E.7 Dynamic-dispatch gap checks (used to justify INFERRED edges)

```bash
gitnexus cypher "MATCH (a)-[r:CodeRelation {type:'CALLS'}]->(b) WHERE a.filePath='src/specialist/supervisor.ts' AND b.filePath IN ['src/specialist/runner.ts','src/pi/session.ts'] RETURN a.name, a.startLine, b.filePath, b.name, r.confidence" -l 60
#   -> 0 rows
gitnexus cypher "MATCH (a)-[r:CodeRelation {type:'CALLS'}]->(b) WHERE a.filePath='src/tools/specialist/activation.tool.ts' AND b.filePath STARTS WITH 'src/activation/' RETURN a.name, b.filePath, b.name" -l 60
#   -> only build-identity/rejection/contract-sections helpers; no NativeActivationHost method calls
gitnexus cypher "MATCH (a:File)-[r:CodeRelation {type:'IMPORTS'}]->(b:File) WHERE a.filePath='config/pi-extensions/specialist-subagents/index.mjs' RETURN b.filePath, r.reason" -l 30
#   -> 0 rows (imports the built dist/lib.js, outside the indexed source graph)
```
