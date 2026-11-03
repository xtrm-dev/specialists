// src/utils/runtime-diagnostics.ts
//
// The Specialists runtime can execute inside another process's lifetime: a native
// activation runs it in the coordinator's Pi process. Anything that runtime writes to
// that process's stdio bypasses the host's TUI and paints raw text over the operator's
// screen — measured, not hypothesised: one `console.debug` in the model chain drew
// `[model-chain] plural fallback_models wins; ...` across the Pi statusline.
//
// Every runtime warning therefore goes through ONE sink (the same single-sink rule
// `src/cli/log.ts` already states). The default preserves CLI behaviour — stderr — and
// an in-process host installs a file-backed sink before any activation can warn, so the
// evidence survives while the terminal stays untouched.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export type RuntimeDiagnosticsSink = (line: string) => void;

const STDERR_SINK: RuntimeDiagnosticsSink = (line) => {
  process.stderr.write(`${line}\n`);
};

let sink: RuntimeDiagnosticsSink = STDERR_SINK;

/** Install the process-wide sink. `null` discards runtime diagnostics. */
export function setRuntimeDiagnosticsSink(next: RuntimeDiagnosticsSink | null): void {
  sink = next ?? (() => {});
}

/** Restore the CLI default (stderr). Tests use this; production code does not. */
export function resetRuntimeDiagnosticsSink(): void {
  sink = STDERR_SINK;
}

/** Canonical file sink location, beside the other `.specialists` runtime state. */
export function runtimeDiagnosticsSinkPath(root: string): string {
  return join(root, '.specialists', 'logs', 'runtime-diagnostics.log');
}

/**
 * A sink that appends to `path` and never throws: a diagnostics write must not abort
 * an activation, and an unwritable path must not degrade the run.
 */
export function createFileDiagnosticsSink(path: string): RuntimeDiagnosticsSink {
  let directoryReady = false;
  return (line) => {
    try {
      if (!directoryReady) {
        mkdirSync(dirname(path), { recursive: true });
        directoryReady = true;
      }
      appendFileSync(path, `${new Date().toISOString()} ${line}\n`);
    } catch {
      /* never abort the runtime for a log write */
    }
  };
}

function describeDetail(detail: unknown): string {
  if (detail === undefined) return '';
  if (typeof detail === 'string') return `: ${detail}`;
  try {
    return `: ${JSON.stringify(detail)}`;
  } catch {
    return `: ${String(detail)}`;
  }
}

function emit(level: 'WARN' | 'DEBUG', tag: string, message: string, detail?: unknown): void {
  sink(`[${level}]${tag ? ` [${tag}]` : ''} ${message}${describeDetail(detail)}`);
}

/** A runtime warning: emitted in CLI mode, redirected away from stdio in-process. */
export function runtimeWarn(tag: string, message: string, detail?: unknown): void {
  emit('WARN', tag, message, detail);
}

/** A runtime debug line: emitted only under `DEBUG`, redirected in-process. */
export function runtimeDebug(tag: string, message: string, detail?: unknown): void {
  if (!process.env.DEBUG) return;
  emit('DEBUG', tag, message, detail);
}
