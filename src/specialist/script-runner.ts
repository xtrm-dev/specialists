import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { SpecialistLoader } from './loader.js';
import { renderTemplate } from './templateEngine.js';
import { createObservabilitySqliteClient } from './observability-sqlite.js';
import type { Specialist } from './schema.js';
import type { SupervisorStatus } from './supervisor.js';

export type ScriptSpecialistErrorType =
  | 'specialist_not_found'
  | 'specialist_load_error'
  | 'template_variable_missing'
  | 'auth'
  | 'quota'
  | 'timeout'
  | 'network'
  | 'invalid_json'
  | 'output_too_large'
  | 'internal';

export interface ScriptGenerateRequest {
  specialist: string;
  variables?: Record<string, string>;
  template?: string;
  model_override?: string;
  thinking_level?: string;
  timeout_ms?: number;
  trace?: boolean;
}

export interface ScriptGenerateSuccess {
  success: true;
  output: string;
  parsed_json?: unknown;
  meta: { specialist: string; model: string; duration_ms: number; trace_id: string };
}

export interface ScriptGenerateFailure {
  success: false;
  error: string;
  error_type: ScriptSpecialistErrorType;
  meta?: { specialist?: string; model?: string; duration_ms?: number; trace_id?: string };
}

export type ScriptGenerateResult = ScriptGenerateSuccess | ScriptGenerateFailure;

export interface TrustOptions {
  allowSkills?: boolean;
  allowSkillsRoots?: string[];
  allowLocalScripts?: boolean;
}

export interface SkillSource {
  path: string;
  sha256: string;
}

export interface ScriptRunnerOptions {
  loader: SpecialistLoader;
  projectDir?: string;
  fallbackModel?: string;
  observabilityDbPath?: string;
  onChild?: (child: ChildProcess) => void;
  onAuditFailure?: (error: unknown) => void;
  trust?: TrustOptions;
}

function hasUnsubstitutedVariables(template: string, variables: Record<string, string>): string | null {
  const matches = template.match(/\$([a-zA-Z_][a-zA-Z0-9_]*)/g) ?? [];
  for (const match of matches) {
    const key = match.slice(1);
    if (variables[key] === undefined) return key;
  }
  return null;
}

export function compatGuard(spec: Specialist, trust?: TrustOptions): void {
  const execution = spec.specialist.execution;
  if (execution.interactive) throw new Error('interactive specialists are not allowed');
  if (execution.requires_worktree) throw new Error('worktree specialists are not allowed');
  if (execution.permission_required !== 'READ_ONLY') throw new Error('permission_required must be READ_ONLY');

  const hasScripts = (spec.specialist.skills?.scripts?.length ?? 0) > 0;
  if (hasScripts && !trust?.allowLocalScripts) {
    throw new Error('scripts not allowed (enable with --allow-local-scripts)');
  }

  const hasPaths = (spec.specialist.skills?.paths?.length ?? 0) > 0;
  const hasSkillInherit = Boolean(spec.specialist.prompt.skill_inherit);
  if ((hasPaths || hasSkillInherit) && !trust?.allowSkills) {
    throw new Error('skills not allowed (enable with --allow-skills)');
  }

  if (hasPaths && trust?.allowSkills && trust.allowSkillsRoots && trust.allowSkillsRoots.length > 0) {
    const paths = spec.specialist.skills?.paths ?? [];
    for (const path of paths) {
      const allowed = trust.allowSkillsRoots.some((root) => path.startsWith(root));
      if (!allowed) {
        throw new Error(`skill path '${path}' not under any --allow-skills-roots entry`);
      }
    }
  }
}

export function computeSkillSources(spec: Specialist): SkillSource[] {
  const paths = spec.specialist.skills?.paths ?? [];
  const sources: SkillSource[] = [];
  for (const path of paths) {
    try {
      const content = readFileSync(path);
      const sha256 = createHash('sha256').update(content).digest('hex');
      sources.push({ path, sha256 });
    } catch {
      sources.push({ path, sha256: 'unreadable' });
    }
  }
  return sources;
}

export function renderTaskTemplate(template: string, variables: Record<string, string>): string {
  const missing = hasUnsubstitutedVariables(template, variables);
  if (missing) throw new Error(`Missing template variable: ${missing}`);
  return renderTemplate(template, variables);
}

function mapErrorType(message: string): ScriptSpecialistErrorType {
  if (message.includes('Specialist not found')) return 'specialist_not_found';
  if (message.includes('interactive') || message.includes('worktree') || message.includes('permission_required') || message.includes('scripts not allowed')) return 'specialist_load_error';
  if (message.includes('Missing template variable')) return 'template_variable_missing';
  if (message.includes('output too large')) return 'output_too_large';
  if (message.includes('auth') || message.includes('403') || message.includes('401')) return 'auth';
  if (message.includes('quota') || message.includes('rate limit') || message.includes('out of extra usage') || message.includes('insufficient_quota') || message.includes('429')) return 'quota';
  if (message.includes('timeout')) return 'timeout';
  if (message.includes('network') || message.includes('ECONN')) return 'network';
  if (message.includes('invalid JSON') || message.includes('Unexpected token')) return 'invalid_json';
  return 'internal';
}

interface PiMessage {
  role?: string;
  content?: Array<{ type?: string; text?: string }>;
  errorMessage?: string;
}

interface PiEvent {
  type?: string;
  message?: PiMessage;
  messages?: PiMessage[];
  data?: { text?: string; content?: Array<{ text?: string }> };
}

function textFromMessage(message: PiMessage | undefined): string {
  if (!message || message.role !== 'assistant') return '';
  if (!Array.isArray(message.content)) return '';
  return message.content
    .filter(part => part.type === 'text' && typeof part.text === 'string')
    .map(part => part.text as string)
    .join('');
}

function extractAssistantText(lines: string[]): string {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    let event: PiEvent;
    try {
      event = JSON.parse(line) as PiEvent;
    } catch {
      continue;
    }
    if (event.type === 'message_end') {
      const text = textFromMessage(event.message);
      if (text) return text;
    }
    if (event.type === 'agent_end' && Array.isArray(event.messages)) {
      for (let j = event.messages.length - 1; j >= 0; j--) {
        const text = textFromMessage(event.messages[j]);
        if (text) return text;
      }
    }
    if (event.type === 'assistant' && typeof event.data?.text === 'string') return event.data.text;
    const legacyContent = event.data?.content?.[0]?.text;
    if (typeof legacyContent === 'string') return legacyContent;
  }
  return '';
}

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json|JSON)?\s*\n?([\s\S]*?)\n?```\s*$/);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractPiErrorMessage(lines: string[]): string | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim();
    if (!line) continue;
    try {
      const event = JSON.parse(line) as PiEvent;
      const errMsg = event.message?.errorMessage;
      if (typeof errMsg === 'string' && errMsg.length > 0) return errMsg;
    } catch {
      continue;
    }
  }
  return null;
}

function writeTraceRow(client: ReturnType<typeof createObservabilitySqliteClient>, specialist: string, model: string, traceId: string, output: string, durationMs: number, skillSources: SkillSource[] | undefined, onAuditFailure?: (error: unknown) => void): void {
  if (!client) return;
  const status = {
    id: traceId,
    specialist,
    status: 'done',
    model,
    started_at_ms: Date.now() - durationMs,
    elapsed_s: durationMs / 1000,
    last_event_at_ms: Date.now(),
    surface: 'script_specialist',
    ...(skillSources && skillSources.length > 0 ? { skill_sources: skillSources } : {}),
  } as unknown as SupervisorStatus;
  try {
    client.upsertStatus(status);
    client.upsertResult(traceId, output);
  } catch (error: unknown) {
    onAuditFailure?.(error);
  }
}

// pi-mode-json emits dense per-token-delta + assistant-message events. Even with --no-extensions --no-tools,
// a moderate changelog-keeper range (~40 commits, ~38KB pre-script injection) exceeds 32MB. 128MB gives
// headroom for typical release ranges without env override. Cap is on raw bytes received from pipe — stream
// compaction in parser does not lower this number.
export const DEFAULT_STDOUT_LIMIT_BYTES = 128 * 1024 * 1024;

export function resolveStdoutLimitBytes(spec: Specialist): number {
  return spec.specialist.execution.stdout_limit_bytes ?? resolveEnvStdoutLimitBytes() ?? DEFAULT_STDOUT_LIMIT_BYTES;
}

function resolveEnvStdoutLimitBytes(): number | undefined {
  const envLimit = Number(process.env.SPECIALISTS_SCRIPT_STDOUT_LIMIT_BYTES);
  return Number.isFinite(envLimit) && envLimit > 0 ? Math.floor(envLimit) : undefined;
}

function openObservabilityClient(options: ScriptRunnerOptions): ReturnType<typeof createObservabilitySqliteClient> {
  const dbPath = options.observabilityDbPath ?? options.projectDir;
  return createObservabilitySqliteClient(dbPath);
}

export async function runScriptSpecialist(input: ScriptGenerateRequest, options: ScriptRunnerOptions): Promise<ScriptGenerateResult> {
  const traceId = randomUUID();
  const startedAt = Date.now();
  try {
    const spec = await options.loader.get(input.specialist);
    compatGuard(spec, options.trust);
    const skillSources = options.trust?.allowSkills ? computeSkillSources(spec) : undefined;

    const template = input.template ?? spec.specialist.prompt.task_template;
    const prompt = renderTaskTemplate(template, input.variables ?? {});
    const timeoutMs = input.timeout_ms ?? spec.specialist.execution.timeout_ms ?? 120_000;
    const modelCandidates = collectModelCandidates(input, spec, options);
    const stdoutLimitBytes = resolveStdoutLimitBytes(spec);
    const attempts: Array<{ model: string; text: string; stderr: string }> = [];

    for (const model of modelCandidates) {
      const attempt = await runSingleAttempt(prompt, model, input.thinking_level ?? spec.specialist.execution.thinking_level, timeoutMs, stdoutLimitBytes, options);
      attempts.push(attempt);
      const parsed = classifyAttempt(attempt);
      if (parsed.retryable) continue;

      const durationMs = Date.now() - startedAt;
      const observability = openObservabilityClient(options);
      if (input.trace !== false && observability) writeTraceRow(observability, input.specialist, model, traceId, parsed.text, durationMs, skillSources, options.onAuditFailure);

      if (parsed.kind === 'success') {
        let parsed_json: unknown;
        if (spec.specialist.execution.response_format === 'json') {
          try {
            parsed_json = JSON.parse(stripMarkdownFences(parsed.text));
            const required = Array.isArray(spec.specialist.prompt.output_schema?.required)
              ? spec.specialist.prompt.output_schema.required.filter((value): value is string => typeof value === 'string')
              : [];
            for (const key of required) {
              if (parsed_json === null || typeof parsed_json !== 'object' || !(key in parsed_json)) throw new Error(`Missing required output field: ${key}`);
            }
          } catch (error) {
            return { success: false, error: error instanceof Error ? error.message : String(error), error_type: 'invalid_json', meta: { specialist: input.specialist, model, duration_ms: durationMs, trace_id: traceId } };
          }
        }
        return { success: true, output: parsed.text, parsed_json, meta: { specialist: input.specialist, model, duration_ms: durationMs, trace_id: traceId } };
      }
      return { success: false, error: parsed.error, error_type: parsed.errorType, meta: { specialist: input.specialist, model, duration_ms: durationMs, trace_id: traceId } };
    }

    const lastAttempt = attempts.at(-1);
    const durationMs = Date.now() - startedAt;
    const observability = openObservabilityClient(options);
    if (input.trace !== false && observability) writeTraceRow(observability, input.specialist, modelCandidates.at(-1) ?? 'unknown', traceId, lastAttempt?.text ?? '', durationMs, skillSources, options.onAuditFailure);
    return { success: false, error: lastAttempt?.stderr || 'pi produced no assistant text', error_type: 'internal', meta: { specialist: input.specialist, model: modelCandidates.at(-1) ?? 'unknown', duration_ms: durationMs, trace_id: traceId } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, error: message, error_type: mapErrorType(message), meta: { specialist: input.specialist, duration_ms: Date.now() - startedAt, trace_id: traceId } };
  }
}

export function collectModelCandidates(input: ScriptGenerateRequest, spec: Specialist, options: ScriptRunnerOptions): string[] {
  const candidates = [input.model_override, spec.specialist.execution.model, spec.specialist.execution.fallback_model, options.fallbackModel]
    .filter((value): value is string => typeof value === 'string' && value.length > 0);
  return [...new Set(candidates)];
}

function runSingleAttempt(prompt: string, model: string, thinkingLevel: string | undefined, timeoutMs: number, stdoutLimitBytes: number, options: ScriptRunnerOptions): Promise<{ model: string; text: string; stderr: string; exitCode: number; timedOut: boolean; outputTooLarge: boolean }> {
  return new Promise((resolve, reject) => {
    const args = ['--mode', 'json', '--no-session', '--no-extensions', '--no-tools', '--model', model];
    if (thinkingLevel) args.push('--thinking', thinkingLevel);
    args.push(prompt);

    const pi = spawn('pi', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    options.onChild?.(pi);

    let stderr = '';
    let timedOut = false;
    let outputTooLarge = false;
    let stdoutBytes = 0;
    let pending = '';
    let assistantText = '';

    const timer = setTimeout(() => {
      timedOut = true;
      pi.kill('SIGTERM');
      setTimeout(() => pi.kill('SIGKILL'), 2000);
    }, timeoutMs);

    pi.stdout.on('data', chunk => {
      const buffer = Buffer.from(chunk);
      stdoutBytes += buffer.length;
      if (stdoutBytes > stdoutLimitBytes && !outputTooLarge) {
        outputTooLarge = true;
        pi.kill('SIGTERM');
        setTimeout(() => pi.kill('SIGKILL'), 2000);
        return;
      }

      pending += buffer.toString('utf-8');
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? '';
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) continue;
        try {
          const event = JSON.parse(line) as PiEvent;
          if (event.type === 'message_end') {
            const text = textFromMessage(event.message);
            if (text) assistantText = text;
          }
          if (event.type === 'agent_end' && Array.isArray(event.messages)) {
            for (let j = event.messages.length - 1; j >= 0; j--) {
              const text = textFromMessage(event.messages[j]);
              if (text) {
                assistantText = text;
                break;
              }
            }
          }
          if (event.type === 'assistant' && typeof event.data?.text === 'string') assistantText = event.data.text;
          const legacyContent = event.data?.content?.[0]?.text;
          if (typeof legacyContent === 'string') assistantText = legacyContent;
        } catch {
          continue;
        }
      }
    });
    pi.stderr.on('data', chunk => { stderr += String(chunk); });

    pi.on('error', reject);
    pi.on('close', code => {
      clearTimeout(timer);
      resolve({
        model,
        text: assistantText,
        stderr,
        exitCode: code ?? 0,
        timedOut,
        outputTooLarge,
      });
    });
  });
}

export function classifyAttempt(attempt: { text: string; stderr: string; exitCode: number; timedOut: boolean; outputTooLarge: boolean }): { retryable: boolean; kind: 'success' | 'failure'; error: string; errorType: ScriptSpecialistErrorType; text: string } {
  if (attempt.outputTooLarge) return { retryable: false, kind: 'failure', error: 'stdout exceeded cap', errorType: 'output_too_large', text: attempt.text };
  if (attempt.timedOut) return { retryable: false, kind: 'failure', error: attempt.stderr || 'timed out', errorType: 'timeout', text: attempt.text };
  const retryable = isRetryableModelFailure(attempt.stderr, attempt.text);
  if (attempt.exitCode !== 0) {
    const errorType = mapErrorType(attempt.stderr);
    return { retryable, kind: 'failure', error: attempt.stderr || `pi exit ${attempt.exitCode}`, errorType, text: attempt.text };
  }
  if (!attempt.text) {
    return { retryable, kind: 'failure', error: attempt.stderr || 'pi produced no assistant text', errorType: mapErrorType(attempt.stderr), text: attempt.text };
  }
  return { retryable: false, kind: 'success', error: '', errorType: 'internal', text: attempt.text };
}

export function isRetryableModelFailure(stderr: string, text: string): boolean {
  return stderr.includes('0 tokens') || stderr.includes('quota') || stderr.includes('rate limit') || stderr.includes('403') || stderr.includes('401') || stderr.includes('insufficient_quota') || (!text && !stderr.trim());
}
