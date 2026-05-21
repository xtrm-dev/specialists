import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import type { SupervisorStatus } from '../../../src/specialist/supervisor.js';

export const repoRoot = resolve(import.meta.dirname, '../../..');

export async function createTempWorkspace(prefix: string): Promise<string> {
  return mkdtemp(join(tmpdir(), prefix));
}

export async function cleanupTempWorkspace(path: string | undefined): Promise<void> {
  if (!path) return;
  await rm(path, { recursive: true, force: true });
}

export function hasBd(): boolean {
  return spawnSync('bd', ['--version'], { stdio: 'ignore' }).status === 0;
}

export function runCli(args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env) {
  return spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), ...args], {
    cwd,
    encoding: 'utf-8',
    env: { ...env, NO_COLOR: '1' },
  });
}

export async function writeSpecialist(tempDir: string, name: string, model = 'anthropic/claude-4.6') {
  await mkdir(join(tempDir, 'specialists'), { recursive: true });
  await writeFile(join(tempDir, 'specialists', `${name}.specialist.json`), JSON.stringify({
    specialist: {
      metadata: { name, version: '1.0.0', description: 'test specialist', category: 'test' },
      execution: { model, timeout_ms: 1000, permission_required: 'READ_ONLY' },
      prompt: { task_template: 'Do $prompt' },
    },
  }));
}

export async function readStatus(cwd: string, jobId: string): Promise<SupervisorStatus> {
  const statusPath = join(cwd, '.specialists', 'jobs', jobId, 'status.json');
  if (existsSync(statusPath)) return JSON.parse(await readFile(statusPath, 'utf-8')) as SupervisorStatus;
  const dbPath = join(cwd, '.specialists', 'db', 'observability.db');
  const script = [
    "import { Database } from 'bun:sqlite';",
    `const db = new Database(${JSON.stringify(dbPath)});`,
    `const row = db.query('SELECT status_json FROM specialist_jobs WHERE job_id = ?').get(${JSON.stringify(jobId)});`,
    "if (!row?.status_json) process.exit(2);",
    "console.log(row.status_json);",
  ].join(' ');
  const result = spawnSync('bun', ['-e', script], { encoding: 'utf-8' });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `status for ${jobId} not found`);
  return JSON.parse(result.stdout) as SupervisorStatus;
}
