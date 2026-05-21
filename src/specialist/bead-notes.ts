import { spawnSync } from 'node:child_process';

export interface AppendBeadNoteOptions {
  timeoutMs?: number;
}

export function appendBeadNote(beadId: string, text: string, opts: AppendBeadNoteOptions = {}): { ok: boolean; error?: string } {
  if (!beadId || !text) return { ok: false, error: 'beads unavailable or empty payload' };
  const result = spawnSync('bd', ['update', beadId, '--append-notes', text], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs,
  });
  if (result.error) return { ok: false, error: result.error.message };
  if (result.status !== 0) return { ok: false, error: result.stderr?.trim() || `bd update failed with exit code ${result.status}` };
  return { ok: true };
}
