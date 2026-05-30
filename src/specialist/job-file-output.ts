export type JobFileOutputMode = 'on' | 'off';
export type JobFileWriteMode = 'append' | 'overwrite';

function normalizeMode(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase();
}

export function detectJobFileOutputMode(env: NodeJS.ProcessEnv = process.env): JobFileOutputMode {
  const normalized = normalizeMode(env.SPECIALISTS_JOB_FILE_OUTPUT);
  if (normalized === 'on' || normalized === '1' || normalized === 'true') return 'on';
  if (normalized === 'off' || normalized === '0' || normalized === 'false') return 'off';
  return 'off';
}

export function isJobFileOutputEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return detectJobFileOutputMode(env) === 'on';
}

export async function writeJobFileOutput(
  path: string,
  content: string,
  mode: JobFileWriteMode,
): Promise<void> {
  const { appendFile, writeFile } = await import('node:fs/promises');
  if (mode === 'append') {
    await appendFile(path, content, 'utf-8');
    return;
  }
  await writeFile(path, content, 'utf-8');
}
