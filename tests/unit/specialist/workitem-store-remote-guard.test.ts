// Adopting Substrate's stale-store guard (SPECIALISTS-4398, XTRM-693).
//
// With `substrate.remote` set, the store lives on another machine. The host used to open
// ~/.xtrm/state.db anyway and report its empty, foreign answers as the operator's own — which
// is how SPECIALISTS-4398 was first diagnosed as a worktree-path bug. The guard makes that a
// named refusal, and it is Substrate's rule, not a second copy of it here.
//
// Needs a real Substrate module tree, like substrate-parity: set
//   XTRM_SUBSTRATE_DIR=<abs path to @jaggerxtrm/substrate>
// so the test exercises the export rather than a fake that cannot drift.
import { afterEach, describe, expect, it } from 'vitest';
import { rmSync, writeFileSync } from 'node:fs';

import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { tempDir } from '../../utils/temp-dir.js';

const SUBSTRATE_DIR = (process.env['XTRM_SUBSTRATE_DIR'] ?? '').trim();
const suite = SUBSTRATE_DIR ? describe : describe.skip;
const dirs: string[] = [];

async function guard(): Promise<(dbPath: string, env: NodeJS.ProcessEnv) => void> {
  // A source checkout has the guard on main before any release carries it, so both shapes are
  // tried: bun imports the .ts directly, node-shaped trees use the built .js.
  const candidates = [
    join(SUBSTRATE_DIR, 'src', 'store', 'sqlite.ts'),
    join(SUBSTRATE_DIR, 'dist', 'src', 'store', 'sqlite.js'),
  ];
  let mod: Record<string, any> | null = null;
  for (const candidate of candidates) {
    try {
      mod = (await import(pathToFileURL(candidate).href)) as Record<string, any>;
      break;
    } catch {
      // try the next layout
    }
  }
  expect(mod).not.toBeNull();
  expect(typeof mod!['assertStoreIsChosen']).toBe('function');
  return mod!['assertStoreIsChosen'];
}

function configWith(remote: string | null): NodeJS.ProcessEnv {
  const dir = tempDir('wi-guard-');
  dirs.push(dir);
  const path = join(dir, 'substrate.json');
  if (remote !== null) writeFileSync(path, JSON.stringify({ remote, remoteSb: '/usr/local/bin/sb', checkouts: {} }));
  return { SUBSTRATE_REMOTE_CONFIG: path };
}

const CANONICAL = join(process.env['HOME'] ?? '', '.xtrm', 'state.db');

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

suite('the guard the host adopts', () => {
  it('refuses the canonical store when a remote is configured, naming remote and path', async () => {
    const check = await guard();
    const env = configWith('ssh:server');
    expect(() => check(CANONICAL, env)).toThrow(/ssh:server/);
    expect(() => check(CANONICAL, env)).toThrow(/state\.db/);
    // The message the old failure produced sent readers to the wrong remedy.
    expect(() => check(CANONICAL, env)).not.toThrow(/sb init/);
  });

  it('allows the canonical store when no remote is configured, so local deployments are unchanged', async () => {
    const check = await guard();
    expect(() => check(CANONICAL, configWith(null))).not.toThrow();
  });

  it('allows an explicit store while a remote is configured, because that is a deliberate choice', async () => {
    const check = await guard();
    expect(() => check(join(dirname(CANONICAL), 'explicit.db'), configWith('ssh:server'))).not.toThrow();
  });
});
