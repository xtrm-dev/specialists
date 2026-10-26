#!/usr/bin/env bun
// specialists plugin PostToolUse chain-reference suggestion (SPECIALISTS-4364).
//
// After a specialist_dispatch the coordinator receives no pointer to a next step,
// so the canonical pipeline (seconder, test-engineer, test-runner, security-auditor
// when sensitive, obligations-scanner, reviewer) is re-derived or skipped. The chain
// reference (SPECIALISTS-4363) exists at
// the using-specialists skill, references/chain-recipes.md. This hook surfaces it
// at the moment it matters: one informational suggestion naming that path.
//
//   - SUGGEST, never prescribe. The text names the reference path and asks the
//     coordinator to choose the next step by scrutiny and its own judgment. It never
//     names a role, never denies, never rewrites or delays any call.
//   - PostToolUse, not PreToolUse: the once-per-activation rule keys on the
//     activation id in the tool RESULT, which only exists after execution.
//   - At most once per session per activation: a marker file under
//     ~/.xtrm/chain-suggest-seen (overridable via SPECIALISTS_CHAIN_SUGGEST_DIR
//     for tests) records which (session, activation) pairs already suggested.
//     Markers older than 7 days are pruned best-effort. When the payload has no
//     session id, the key falls back to the cwd, then to "default".
//   - FAILS OPEN, always exits 0. Malformed input, an unrelated tool name, a
//     missing activation id, or any filesystem error produces no output.
//
// Live trace note (first commit): the Claude client reports the MCP dispatch tool
// with a namespaced name — mcp__specialists__specialist_dispatch in a local
// --plugin-dir checkout and mcp__plugin_specialists_specialists__specialist_dispatch
// for a marketplace install (see plugins/specialists-ui isSpecialistsTool:
// /^mcp__(?:plugin_specialists_)?specialists__(.+)$/). The hooks.json matcher
// lists both forms explicitly, and this script additionally accepts any tool name
// containing specialist_dispatch, so a future server rename degrades to suggesting,
// never to blocking.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const CHAIN_REFERENCE_SUGGESTION =
  'Chain reference: the using-specialists skill, references/chain-recipes.md \u2014 read it and choose the next step by scrutiny and your own judgment.';

function markerDir() {
  const override = (process.env.SPECIALISTS_CHAIN_SUGGEST_DIR ?? '').trim();
  if (override) return override;
  return join(homedir(), '.xtrm', 'chain-suggest-seen');
}

const MARKER_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// Best effort: markers older than a week belong to finished sessions. Any error is ignored.
function pruneMarkers(dir) {
  try {
    const cutoff = Date.now() - MARKER_MAX_AGE_MS;
    for (const name of readdirSync(dir)) {
      const file = join(dir, name);
      if (statSync(file).mtimeMs < cutoff) unlinkSync(file);
    }
  } catch {
    // Pruning must never suppress the suggestion.
  }
}

function sanitize(part) {
  return String(part ?? '').replace(/[^A-Za-z0-9_.-]+/g, '_').slice(0, 128) || 'unknown';
}

function findActivationId(node, depth = 0) {
  if (node == null || depth > 6) return null;
  if (typeof node === 'string') {
    const trimmed = node.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        return findActivationId(parsed, depth + 1);
      } catch {
        return null;
      }
    }
    return null;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      const found = findActivationId(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof node === 'object') {
    const direct = node.activation_id ?? node.activationId;
    if (typeof direct === 'string' && direct.trim()) return direct.trim();
    for (const value of Object.values(node)) {
      const found = findActivationId(value, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

try {
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    process.exit(0);
  }
  if (!payload || typeof payload !== 'object') process.exit(0);

  const toolName = String(payload.tool_name ?? payload.toolName ?? '');
  if (!toolName.includes('specialist_dispatch')) process.exit(0);

  const response = payload.tool_response ?? payload.toolResponse ?? payload.tool_result ?? payload.toolResult;
  const activationId = findActivationId(response) ?? findActivationId(payload);
  if (!activationId) process.exit(0);

  const sessionId = String(
    payload.session_id ?? payload.sessionId ?? payload.sessionID ?? payload.cwd ?? 'default',
  );
  const marker = join(markerDir(), `${sanitize(sessionId)}.${sanitize(activationId)}`);
  if (existsSync(marker)) process.exit(0);
  try {
    mkdirSync(markerDir(), { recursive: true });
    writeFileSync(marker, `${sessionId} ${activationId}\n`);
    pruneMarkers(markerDir());
  } catch {
    // Marker write failure must not suppress the suggestion (fails open).
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: CHAIN_REFERENCE_SUGGESTION },
    }),
  );
} catch {
  // Fail open and silent: a suggestion hook must never break a dispatch.
}

process.exit(0);
