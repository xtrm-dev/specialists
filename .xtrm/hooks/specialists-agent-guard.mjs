#!/usr/bin/env node
// specialists-agent-guard — Claude Code PreToolUse hook
// Blocks raw Agent tool usage only when a specialists workflow skill is active.
// Fail-open unless the active transcript/system prompt clearly contains using-specialists.

import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { logEvent } from './xtrm-logger.mjs';

function readJsonStdin() {
  try {
    return JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    return null;
  }
}

function tailText(filePath, maxBytes = 256 * 1024) {
  try {
    if (!filePath || !existsSync(filePath)) return '';
    const stat = statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const raw = readFileSync(filePath);
    return raw.subarray(start).toString('utf8');
  } catch {
    return '';
  }
}

function hasSpecialistsSkillMarker(text) {
  return /<skill\s+name=["']using-specialists(?:-v2)?["']/i.test(text)
    || /name:\s*using-specialists(?:-v2)?\b/i.test(text)
    || /#\s*Specialists V2\b/i.test(text)
    || /#\s*Specialists Usage\b/i.test(text);
}

function isSpecialistsWorkflowActive(input) {
  const directText = [
    input?.system_prompt,
    input?.systemPrompt,
    input?.prompt,
    input?.message,
  ].filter(Boolean).join('\n');

  if (hasSpecialistsSkillMarker(directText)) return true;

  const transcriptPath = input?.transcript_path ?? input?.transcriptPath;
  return hasSpecialistsSkillMarker(tailText(transcriptPath));
}

const input = readJsonStdin();
if (!input) process.exit(0);

const toolName = input.tool_name ?? input.toolName ?? '';
if (toolName !== 'Agent') process.exit(0);
if (!isSpecialistsWorkflowActive(input)) process.exit(0);

const cwd = input.cwd ?? process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
const sessionId = input.session_id ?? input.sessionId ?? null;
const reason = 'Use specialists CLI instead of Agent tool. Route via: specialists run <name> --bead <id>';

try {
  logEvent({
    cwd: resolve(cwd),
    runtime: 'claude',
    sessionId,
    layer: 'gate',
    kind: 'gate.specialists_agent.block',
    outcome: 'block',
    toolName: 'Agent',
    message: reason,
  });
} catch { /* fail closed for the Agent tool, but ignore logging failures */ }

process.stdout.write(JSON.stringify({ decision: 'block', reason }) + '\n');
process.exit(0);
