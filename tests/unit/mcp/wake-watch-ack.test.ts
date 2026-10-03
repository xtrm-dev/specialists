import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Database } from 'bun:sqlite';

/**
 * Wake dedupe between the Channel push and the fallback watcher (SPECIALISTS-4214).
 *
 * The companion specialists-ui plugin writes an ack marker the moment a Specialists
 * channel wake reaches the session; this watcher drops any fresh row whose marker is
 * already present, so a push that arrived is not woken a second time by the slow net.
 * Exit code is still the contract: a spurious 2 trains the operator to ignore wakes.
 */
const hook = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../plugins/specialists/scripts/wake-watch.mjs',
);

const roots: string[] = [];
const children: Array<{ kill: (s?: NodeJS.Signals) => boolean }> = [];

/** Creates a store plus, when `acks` is given, an ack dir holding those marker names. */
function setup(rows: Array<[string, string]>, acks: string[] = []): { dbPath: string; ackDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'wake-watch-ack-'));
  roots.push(root);
  const dbPath = join(root, 'state.db');
  const db = new Database(dbPath);
  try {
    db.exec(
      `CREATE TABLE activations (activation_id TEXT PRIMARY KEY, specialist TEXT, state TEXT, bead_id TEXT, last_activity_at TEXT)`,
    );
    for (const [id, state] of rows) {
      db.prepare(`INSERT INTO activations VALUES (?, 'executor', ?, 'B-1', '1000')`).run(id, state);
    }
  } finally {
    db.close();
  }
  const ackDir = join(root, 'acks');
  if (acks.length > 0) {
    mkdirSync(ackDir, { recursive: true });
    for (const name of acks) writeFileSync(join(ackDir, name), '');
  }
  return { dbPath, ackDir };
}

/** Alternates a row between `running` and the target state from a DETACHED process. */
function flipUntil(dbPath: string, id: string, state: string, cycles = 40) {
  const script =
    `const {Database}=require('bun:sqlite');const db=new Database(${JSON.stringify(dbPath)});` +
    `const set=(s)=>db.prepare("INSERT OR REPLACE INTO activations VALUES (?, 'executor', ?, 'B-1', '2000')")` +
    `.run(${JSON.stringify(id)}, s);` +
    `for(let i=0;i<${cycles};i++){set('running');await Bun.sleep(150);set(${JSON.stringify(state)});await Bun.sleep(150);}` +
    `db.close();`;
  const child = spawn('bun', ['-e', script], { detached: true, stdio: 'ignore' });
  child.unref();
  children.push(child);
}

function watch(dbPath: string, ackDir: string, maxMs = 20000) {
  return spawnSync('bun', [hook], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      CLAUDE_CODE_ENTRYPOINT: 'cli',
      XTRM_STATE_DB: dbPath,
      SPECIALISTS_WAKE_ACK_DIR: ackDir,
      SUBSTRATE_WAKE_POLL_MS: '250',
      SUBSTRATE_WAKE_GRACE_MS: '50',
      SUBSTRATE_WAKE_MAX_MS: String(maxMs),
    },
    timeout: 60000,
  });
}

afterEach(() => {
  while (children.length > 0) { try { children.pop()?.kill('SIGKILL'); } catch { /* already gone */ } }
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
});

describe('specialists wake-watch ack dedupe', () => {
  it('does not exit 2 for a settled transition the coordinator already acknowledged', () => {
    const { dbPath, ackDir } = setup([['act:live', 'running']], ['act:live.settled']);
    flipUntil(dbPath, 'act:live', 'settled');
    const r = watch(dbPath, ackDir, 3000);
    // Acknowledged by the Channel push: the watcher must keep watching and die idle.
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('does not exit 2 for an acknowledged needs_reply transition', () => {
    const { dbPath, ackDir } = setup([['act:q', 'running']], ['act:q.needs_reply']);
    flipUntil(dbPath, 'act:q', 'needs_reply');
    const r = watch(dbPath, ackDir, 3000);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });

  it('still wakes for an unacknowledged settled transition, pointing at specialist_result', () => {
    const { dbPath, ackDir } = setup([['act:live', 'running']]);
    flipUntil(dbPath, 'act:live', 'settled');
    const r = watch(dbPath, ackDir);
    expect(r.status).toBe(2);
    const payload = JSON.parse(r.stdout.trim().split('\n').pop() as string);
    expect(payload.activations).toEqual([
      { activation_id: 'act:live', state: 'settled', bead_id: 'B-1' },
    ]);
    expect(payload.read_with).toBe('specialist_result');
  });

  it('still wakes for an unacknowledged needs_reply, pointing at specialist_status', () => {
    const { dbPath, ackDir } = setup([['act:q', 'running']]);
    flipUntil(dbPath, 'act:q', 'needs_reply');
    const r = watch(dbPath, ackDir);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout.trim().split('\n').pop() as string).read_with).toBe('specialist_status');
  });

  it('never wakes for a backlog that already carried ack markers at baseline', () => {
    const { dbPath, ackDir } = setup(
      [['act:old', 'settled'], ['act:asking', 'needs_reply']],
      ['act:old.settled', 'act:asking.needs_reply'],
    );
    const r = watch(dbPath, ackDir, 2500);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('');
  });
});