import { spawn } from 'node:child_process';

export interface AppendBeadNoteOptions {
  timeoutMs?: number;
}

export async function appendBeadNote(beadId: string, text: string, opts: AppendBeadNoteOptions = {}): Promise<{ ok: boolean; error?: string }> {
  if (!beadId || !text) return { ok: false, error: 'beads unavailable or empty payload' };

  return await new Promise((resolve) => {
    const child = spawn('bd', ['update', beadId, '--append-notes', text], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill('SIGKILL');
          resolve({ ok: false, error: `bd update timed out after ${opts.timeoutMs}ms` });
        }, opts.timeoutMs)
      : null;

    let stderr = '';
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: false, error: error.message });
    });

    child.on('close', (code, signal) => {
      if (timer) clearTimeout(timer);
      if (signal === 'SIGKILL' && opts.timeoutMs) return;
      if (code === 0) return resolve({ ok: true });
      resolve({ ok: false, error: stderr.trim() || `bd update failed with exit code ${code}` });
    });
  });
}
