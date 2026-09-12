#!/usr/bin/env bun
// specialists plugin PreToolUse lease WARNING hook.
//
// The workspace lease fences native activations against each other. The coordinator is NOT a
// participant in it: a Claude Code session edits through its own tools without acquiring or
// inspecting the lease. Because native activations run IN PLACE (see resolveWorkspace in
// src/activation/native-host.ts), a coordinator edit and a write-tier activation's edit to the
// same file can interleave and silently lose one of the two writes.
//
// This hook makes that loss visible. It does NOT prevent it.
//
//   - WARN, never block. The coordinator writing alongside a Specialist is accepted
//     behaviour; a blocking gate here would be worse than the hazard, so this script always
//     exits 0 and never emits a `permissionDecision`.
//   - READ-ONLY. It calls `inspect()` and does nothing else. It never acquires, rewrites or
//     releases a lease.
//   - SILENT on every other state. `free` (no activation), `uncertain` (stale, unreadable or
//     unverifiable lease) and any error produce NO output and NO error. A noisy hook gets
//     disabled, and then it protects nothing.
//   - Cheap. One small file read plus the lease's own liveness probe, on the coordinator's
//     hot path. The record and the verdict come from the runtime's own `inspect()`, imported
//     from the shipped bundle, so this cannot drift from what the lease actually means.
//
// Emits the Claude hook JSON shape: `systemMessage` warns the operator, and
// `hookSpecificOutput.additionalContext` tells the model, without steering either.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

function resolveRuntime() {
  // The runtime shipped alongside this plugin, in both supported layouts.
  const local = fileURLToPath(new URL('../../../dist/lib.js', import.meta.url));
  return existsSync(local) ? local : null;
}

const runtimePath = resolveRuntime();
if (runtimePath) {
  try {
    const { inspectWorkspaceLease: inspect, leaseScopeFor } = await import(runtimePath);
    let payload = {};
    try {
      payload = JSON.parse(readFileSync(0, 'utf8'));
    } catch {
      // No or malformed stdin: fall back to the process cwd rather than refusing.
    }
    const cwd = typeof payload?.cwd === 'string' && payload.cwd ? payload.cwd : process.cwd();
    const workspace = leaseScopeFor(cwd);
    const status = inspect(workspace);
    if (status.state === 'held' && status.lease) {
      const specialist = status.lease.specialist ?? 'a write-tier specialist';
      const message =
        `specialist-subagents: ${specialist} (${status.lease.activationId}) holds the workspace ` +
        `lease on ${workspace.worktreePath}. Your edit still applies, but it can interleave with ` +
        'that activation\'s writes and one of the two can be lost. Stop the activation first if ' +
        'you need the file to yourself.';
      process.stdout.write(JSON.stringify({
        systemMessage: message,
        hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: message },
      }));
    }
  } catch {
    // Fail open and silent: a warning hook must never be the reason an edit misbehaves.
  }
}

process.exit(0);
