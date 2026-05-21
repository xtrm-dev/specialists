import { afterEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const createdBeads: string[] = [];
const createdJobs: string[] = [];

function runCli(args: string[]) {
  return spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), ...args], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
}

function createBead(title: string): string {
  const bead = spawnSync('bd', ['create', title, '-t', 'task', '--json'], { cwd: repoRoot, encoding: 'utf-8' });
  expect(bead.status).toBe(0);
  const parsed = JSON.parse(bead.stdout.trim());
  const id = Array.isArray(parsed) ? parsed[0].id : parsed.id;
  createdBeads.push(id);
  return id;
}

function cleanupJob(jobId: string): void {
  spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), 'stop', jobId], { cwd: repoRoot, stdio: 'ignore', encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
}

afterEach(() => {
  for (const jobId of createdJobs) {
    try { cleanupJob(jobId); } catch {}
  }
  for (const beadId of createdBeads) {
    try { spawnSync('bd', ['close', beadId, '-r', 'test cleanup'], { cwd: repoRoot, stdio: 'ignore' }); } catch {}
  }
  createdJobs.length = 0;
  createdBeads.length = 0;
});

describe('chat launch boundary', () => {
  it('keeps sp run stdout stable across identical launches', () => {
    const beadId = createBead(`unitAI-launch-${Date.now()}`);
    const args = ['run', 'reviewer', '--bead', beadId, '--background', '--no-beads', '--no-bead-notes'];

    const first = runCli(args);
    expect(first.status).toBe(0);
    createdJobs.push(first.stdout.trim());

    const second = runCli(args);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('existing starting job');
  }, 30000);
});
