import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');

function runCli(args: string[]) {
  return spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), ...args], { cwd: repoRoot, encoding: 'utf-8', env: { ...process.env, NO_COLOR: '1' } });
}

describe('chat launch boundary', () => {
  it('keeps sp run stdout stable across identical launches', () => {
    const bead = spawnSync('bd', ['create', `unitAI-launch-${Date.now()}`, '-t', 'task', '--json'], { cwd: repoRoot, encoding: 'utf-8' });
    expect(bead.status).toBe(0);
    const beadId = JSON.parse(bead.stdout.trim()).id as string;

    const args = ['run', 'reviewer', '--bead', beadId, '--background', '--no-beads', '--no-bead-notes'];
    const first = runCli(args);
    expect(first.status).toBe(0);

    const second = runCli(args);
    expect(second.status).toBe(1);
    expect(second.stderr).toContain('existing starting job');

    spawnSync('bd', ['close', beadId, '-r', 'test cleanup'], { cwd: repoRoot, stdio: 'ignore' });
  }, 30000);
});
