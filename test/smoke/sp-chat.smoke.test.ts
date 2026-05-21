import { afterAll, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dir, '../..');
const transcriptDir = mkdtempSync(join(tmpdir(), 'sp-chat-smoke-'));
const createdBeads = new Set<string>();
const createdJobs = new Set<string>();

afterAll(() => {
  for (const jobId of createdJobs) {
    try {
      spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), 'stop', jobId], {
        cwd: repoRoot,
        stdio: 'ignore',
        env: { ...process.env, NO_COLOR: '1' },
      });
    } catch {}
  }
  for (const beadId of createdBeads) {
    try {
      spawnSync('bd', ['close', beadId, '-r', 'smoke cleanup'], {
        cwd: repoRoot,
        stdio: 'ignore',
        env: { ...process.env, NO_COLOR: '1' },
      });
    } catch {}
  }
  try {
    rmSync(transcriptDir, { recursive: true, force: true });
  } catch {}
});

function runCli(args: string[]): Promise<{ status: number; stdout: string; stderr: string }> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn('bun', ['run', join(repoRoot, 'src/index.ts'), ...args], {
      cwd: repoRoot,
      env: { ...process.env, NO_COLOR: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.once('error', rejectRun);
    child.once('close', (status) => resolveRun({ status: status ?? 1, stdout, stderr }));
  });
}

function createBead(title: string): string {
  const result = spawnSync('bd', ['create', title, '-t', 'task', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  expect(result.status).toBe(0);
  const parsed = JSON.parse(result.stdout.trim());
  const beadId = Array.isArray(parsed) ? parsed[0].id : parsed.id;
  createdBeads.add(beadId);
  return beadId;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolveWait) => setTimeout(resolveWait, ms));
}

function readTranscript(path: string): string {
  return readFileSync(path, 'utf8');
}

function findJobIdForBead(beadId: string): string | null {
  const result = spawnSync('bun', ['run', join(repoRoot, 'src/index.ts'), 'ps', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  expect(result.status).toBe(0);
  const rows = JSON.parse(result.stdout);
  const match = Array.isArray(rows)
    ? rows.find((row: { bead_id?: string; specialist?: string; job_id?: string }) => row.bead_id === beadId && row.specialist === 'reviewer')
    : null;
  const jobId = match?.job_id ?? null;
  if (jobId) createdJobs.add(jobId);
  return jobId;
}

test('sp chat reviewer smoke', async () => {
  const beadId = createBead(`unitAI-smoke-${Date.now()}`);
  const transcriptPath = join(transcriptDir, `sp-chat-${Date.now()}.log`);

  const command = `bun run ${JSON.stringify(join(repoRoot, 'src/index.ts'))} chat reviewer --bead ${JSON.stringify(beadId)}`;
  const session = spawn('script', ['-qfec', command, transcriptPath], {
    cwd: repoRoot,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, NO_COLOR: '1', TERM: 'xterm-256color' },
  });

  let combined = '';
  session.stdout.setEncoding('utf8');
  session.stderr.setEncoding('utf8');
  session.stdout.on('data', (chunk) => {
    combined += chunk;
  });
  session.stderr.on('data', (chunk) => {
    combined += chunk;
  });

  await wait(1500);
  session.stdin.write('hello from smoke\n');
  await wait(1000);
  session.stdin.write('/notes hello\n');
  await wait(1000);
  session.stdin.write('\u0003');
  session.kill('SIGINT');

  const exitCode = await Promise.race([
    new Promise<number>((resolveExit) => {
      session.once('close', (code) => resolveExit(code ?? 1));
    }),
    wait(8000).then(() => 124),
  ]);

  const transcript = readTranscript(transcriptPath);
  const output = `${combined}\n${transcript}`;

  expect(exitCode).toBe(0);
  expect(output).toMatch(new RegExp(`executor/[^/]+/${beadId} · (starting|running|waiting|done|error|cancelled) ·`));

  const jobId = findJobIdForBead(beadId);
  expect(jobId).toBeTruthy();
  if (!jobId) throw new Error(`No reviewer job found for bead ${beadId}`);

  const ps = await runCli(['ps', '--json']);
  expect(ps.status).toBe(0);
  const jobs = JSON.parse(ps.stdout) as Array<{ job_id?: string; status?: string }>;
  const job = jobs.find((row) => row.job_id === jobId);
  expect(job?.status).toBe('cancelled');

  const bead = spawnSync('bd', ['show', beadId], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, NO_COLOR: '1' },
  });
  expect(bead.status).toBe(0);
  expect(bead.stdout).toContain('hello');
}, 30000);
