// The remote work-item port (SPECIALISTS-4398, XTRM-693).
//
// With `substrate.remote` configured the store lives on another machine, so the host must reach it
// through Substrate's typed service rather than open ~/.xtrm/state.db. These tests pin the three
// rules the coordinator set, plus the wire mapping read from the producer's own operation table
// (substrate src/service/ops.ts):
//
//   1. fail closed — a configured remote that cannot answer refuses with the transport code and
//      never falls back to a local store; with no remote configured the local path is unchanged;
//   2. one call per mutation, never retried (the protocol has no idempotency key);
//   3. `completedBlockers` answers [] over the wire, because no operation returns active `blocks`
//      edges (XTRM-715 is the unscheduled parity draft) — the local port still walks them.
//
// The unreachable-remote test needs a real Substrate module tree, like substrate-parity and the
// stale-store guard test: set XTRM_SUBSTRATE_DIR=<abs path to @jaggerxtrm/substrate>. The rest use
// a structural fake and run everywhere.

import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createWorkItemBoundary,
  openWorkItemBoundary,
  resolveWorkItemDbPath,
  selectWorkItemStore,
  type IssueServicePort,
  type WorkItemPorts,
} from '../../../src/activation/workitem-store.js';
import {
  createRemoteWorkItemPorts,
  createReopeningService,
  type RemoteWorkItemService,
} from '../../../src/activation/workitem-remote.js';

const SUBSTRATE_DIR = (process.env['XTRM_SUBSTRATE_DIR'] ?? '').trim();
const substrateSuite = SUBSTRATE_DIR ? describe : describe.skip;
const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function scratchDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

/** A remote config file naming an unreachable host, with the absolute server sb path it requires. */
function unreachableRemoteConfig(): string {
  const dir = scratchDir('wi-remote-config-');
  const path = join(dir, 'substrate.json');
  writeFileSync(
    path,
    JSON.stringify({ remote: 'ssh:nonexistent-host.invalid', remoteSb: '/usr/local/bin/sb', checkouts: {} }),
  );
  return path;
}

type FakeService = RemoteWorkItemService & { calls: Array<{ op: string; args: Record<string, unknown> }> };

/** A service that records every call and answers from `handler`; nothing else is reachable. */
function fakeService(handler: (op: string, args: Record<string, unknown>) => unknown): FakeService {
  const calls: FakeService['calls'] = [];
  return {
    calls,
    call: (async <T>(op: string, args: Record<string, unknown> = {}): Promise<T> => {
      calls.push({ op, args });
      return (await handler(op, args)) as T;
    }) as RemoteWorkItemService['call'],
    close: async () => {},
  };
}

/** The minimum issue surface the boundary calls when it walks completed blockers. */
function stubIssues(overrides: Partial<IssueServicePort> = {}): IssueServicePort {
  return {
    resolveRef: async (ref: string) => ({ id: `id_${ref}`, humanRef: ref }),
    getActiveClaim: async () => null,
    getParent: async () => null,
    getRevision: async () => ({ contract: { problem: 'p' } }),
    resolveProject: async () => ({ projectId: 'prj_test' }),
    createIssue: async () => ({ id: 'iss_new' }),
    claimReady: async () => ({ claim: { id: 1 } }),
    ...overrides,
  };
}

/**
 * A boundary whose ports the test can inspect. Only `issues` and `store` matter for the blocker
 * walk; the rest refuse so an unexpected call is a visible failure rather than a silent default.
 */
function boundaryOver(issues: IssueServicePort): ReturnType<typeof createWorkItemBoundary> {
  const refuse = async (): Promise<never> => {
    throw new Error('unexpected port call');
  };
  const ports: WorkItemPorts = {
    issues,
    provenance: null,
    store: { get: refuse, addJournal: refuse },
    gate: { check: refuse, dispatch: refuse },
  };
  return createWorkItemBoundary(ports);
}

substrateSuite('the remote store the operator chose', () => {
  it('refuses a dispatch when the configured remote cannot be reached, and opens no local store', async () => {
    const home = scratchDir('wi-remote-home-');
    const env = {
      PATH: process.env['PATH'],
      LANG: process.env['LANG'],
      HOME: home,
      XTRM_SUBSTRATE_DIR: SUBSTRATE_DIR,
      SUBSTRATE_REMOTE_CONFIG: unreachableRemoteConfig(),
    };
    const boundary = await openWorkItemBoundary({ env, substrateDir: SUBSTRATE_DIR });
    // The dispatch path's first read is exactly this call; it must refuse with the transport code
    // rather than answer from a store on this machine.
    const error = (await boundary.view('SPECIALISTS-4398').catch((caught: Error) => caught)) as Error & {
      code?: string;
    };
    expect(error.message).toMatch(/connection_lost|not_installed|spawn_failed|timeout/);
    expect(error.message).toContain('ssh:nonexistent-host.invalid');
    expect(error.message).not.toMatch(/cannot open the Substrate store/);
    expect(existsSync(join(home, '.xtrm', 'state.db'))).toBe(false);
  }, 30_000);

  it('names the transport code on the error, not only inside the service error field', async () => {
    const home = scratchDir('wi-remote-home-');
    const env = {
      PATH: process.env['PATH'],
      LANG: process.env['LANG'],
      HOME: home,
      XTRM_SUBSTRATE_DIR: SUBSTRATE_DIR,
      SUBSTRATE_REMOTE_CONFIG: unreachableRemoteConfig(),
    };
    const boundary = await openWorkItemBoundary({ env, substrateDir: SUBSTRATE_DIR });
    const error = (await boundary.view('SPECIALISTS-4398').catch((caught: Error) => caught)) as Error & {
      code?: string;
    };
    expect(['connection_lost', 'not_installed', 'spawn_failed', 'timeout']).toContain(error.code);
    expect(error.message).toContain(String(error.code));
  }, 30_000);
});

describe('choosing the store', () => {
  it('keeps the local store when no remote is configured', async () => {
    const dir = scratchDir('wi-local-env-');
    const env = { SUBSTRATE_REMOTE_CONFIG: join(dir, 'absent.json') };
    expect(await selectWorkItemStore(env, { substrateDir: dir })).toEqual({
      kind: 'local',
      dbPath: resolveWorkItemDbPath(env),
    });
  });
});

describe('one call per mutation, never retried', () => {
  it('attempts a journal append exactly once when the link drops mid-call', async () => {
    const service = fakeService(() => {
      throw Object.assign(new Error('the service connection ended (exit 255)'), { code: 'connection_lost' });
    });
    const ports = createRemoteWorkItemPorts(service, { remote: 'ssh:server' });
    const error = (await ports
      .journalService!.appendEntry('iss_1', { kind: 'note', semantic: { summary: 'evidence' } })
      .catch((caught: Error) => caught)) as Error & { code?: string };
    expect(service.calls.map((entry) => entry.op)).toEqual(['journal.appendEntry']);
    expect(error.code).toBe('connection_lost');
    expect(error.message).toContain('connection_lost');
  });

  it('attempts the gate binding exactly once when the link drops mid-call', async () => {
    const service = fakeService(() => {
      throw Object.assign(new Error('the service connection ended (exit 255)'), { code: 'connection_lost' });
    });
    const ports = createRemoteWorkItemPorts(service, { remote: 'ssh:server' });
    await expect(
      ports.gate.dispatch(null, null, { ref: 'X', specialist: 's', holder: 'h' } as never),
    ).rejects.toThrow(/connection_lost/);
    expect(service.calls.map((entry) => entry.op)).toEqual(['gate.dispatch']);
  });
});

describe('completedBlockers over the wire', () => {
  it('answers [] because Substrate exposes no active-edge read (XTRM-715)', async () => {
    const service = fakeService((op) => {
      if (op === 'issue.resolveRef') return { id: 'iss_1', humanRef: 'X' };
      throw new Error(`unexpected ${op}`);
    });
    const ports = createRemoteWorkItemPorts(service, { remote: 'ssh:server' });
    // Absence is the pin: a getBlockers that returned [] would claim "no blockers", while an
    // absent read says "no blocker information" and the boundary refuses to invent the rest.
    expect('getBlockers' in ports.issues).toBe(false);
    expect(await createWorkItemBoundary(ports).completedBlockers('X', 2)).toEqual([]);
  });

  it('still walks satisfied blockers on the local ports', async () => {
    const boundary = boundaryOver(
      stubIssues({
        getBlockers: async (childId: string) =>
          childId === 'id_X'
            ? [
                {
                  id: 'id_B',
                  humanRef: 'B',
                  title: 'Blocker',
                  currentRevision: 3,
                  lifecycleState: 'done',
                },
                {
                  id: 'id_C',
                  humanRef: 'C',
                  title: 'Unsatisfied',
                  currentRevision: 1,
                  lifecycleState: 'open',
                },
              ]
            : [],
      }),
    );
    expect(await boundary.completedBlockers('X', 1)).toEqual([
      { ref: 'B', title: 'Blocker', description: 'p' },
    ]);
  });
});

describe('resolving the project on the store-owning machine', () => {
  it('refuses inline creation when setup recorded no server checkout for this repository', async () => {
    const service = fakeService(() => {
      throw new Error('no call may reach the wire');
    });
    const ports = createRemoteWorkItemPorts(service, {
      remote: 'ssh:server',
      project: { localRoot: '/home/pc/core', repositoryKey: 'github.com/xtrm-dev/core', serverRoot: null },
    });
    await expect(ports.issues.resolveProject({ gitRoot: '/home/pc/core' })).rejects.toThrow(/sb remote setup ssh:server/);
    expect(service.calls).toEqual([]);
  });

  it('refuses a checkout the connection was not opened for', async () => {
    const service = fakeService(() => {
      throw new Error('no call may reach the wire');
    });
    const ports = createRemoteWorkItemPorts(service, {
      remote: 'ssh:server',
      project: { localRoot: '/home/pc/core', repositoryKey: 'github.com/xtrm-dev/core', serverRoot: '/srv/core' },
    });
    await expect(ports.issues.resolveProject({ gitRoot: '/home/pc/other' })).rejects.toThrow(/outside \/home\/pc\/core/);
    expect(service.calls).toEqual([]);
  });
});

describe('the wire mapping', () => {
  it('uses the operation names and argument names the producer registers', async () => {
    const service = fakeService((op) => {
      switch (op) {
        case 'issue.resolveRef': return { id: 'iss_1', humanRef: 'X' };
        case 'issue.getActiveClaim': return null;
        case 'issue.getParent': return null;
        case 'issue.getRevision': return { contract: {} };
        case 'issue.getResolvedContext': return { entries: [], hash: 'h' };
        case 'issue.resolveProject': return { projectId: 'prj_1' };
        case 'issue.create': return { id: 'iss_new' };
        case 'issue.claimReady': return { claim: { id: 7 } };
        case 'issue.releaseClaim': return { id: 7 };
        case 'store.get': return { issue: { humanRef: 'X', id: 'iss_1', currentRevision: 1, currentContractHash: 'h', title: 't', lifecycleState: 'open' }, contract: {}, readinessState: 'ready', dispatchable: true, reasons: [] };
        case 'store.addJournal': return { ok: true };
        case 'gate.check': return { issueId: 'iss_1', revision: 1, contractHash: 'h', report: {} };
        case 'gate.dispatch': return { binding: { id: 'exb_1' } };
        case 'journal.appendEntry': return { id: 'jrn_1', sequence: 1 };
        case 'journal.listEntries': return [];
        case 'provenance.allocateReceipt': return { id: 'rcp_1', executionBindingId: 'exb_1', issueId: 'iss_1', issueRevision: 1, contractHash: 'h' };
        case 'provenance.attachArtifact': return { receiptId: 'rcp_1', kind: 'artifact', value: 'v' };
        case 'provenance.listReceipts': return [];
        default: throw new Error(`unexpected ${op}`);
      }
    });
    const ports = createRemoteWorkItemPorts(service, {
      remote: 'ssh:server',
      project: { localRoot: '/home/pc/core', repositoryKey: 'github.com/xtrm-dev/core', serverRoot: '/srv/core' },
    });
    const req = { ref: 'X', specialist: 's', holder: 'h' } as never;

    await ports.issues.resolveRef('X');
    await ports.issues.getActiveClaim('iss_1');
    await ports.issues.releaseClaim('iss_1', 'h', { activationId: 'act_1' });
    await ports.issues.getParent('iss_1');
    await ports.issues.getRevision('iss_1', 1);
    await ports.issues.getResolvedContext('iss_1');
    await ports.issues.resolveProject({ gitRoot: '/home/pc/core/.xtrm/worktrees/w1' });
    await ports.issues.createIssue({ projectId: 'prj_1', title: 't', kind: 'task', contract: {}, scrutiny: 'LOW', authoredBy: 'h' });
    await ports.issues.claimReady('iss_1', 'h', { outcome: 'ready', policy: 'default', attestedBy: 'h' }, { activationId: 'act_1' });
    await ports.store.get('X');
    await ports.store.addJournal('X', 'note', { participantId: 'p', activationId: 'act_1' });
    await ports.gate.check(null, req);
    await ports.gate.dispatch(null, null, req);
    await ports.journalService!.appendEntry('iss_1', { kind: 'result' });
    await ports.journalService!.listEntries!('iss_1', { kind: 'result' });
    await ports.provenanceService!.allocateReceipt('exb_1');
    await ports.provenanceService!.attachArtifact('rcp_1', 'artifact', 'v');
    await ports.provenanceService!.listReceipts!('iss_1');

    expect(service.calls.map((entry) => entry.op)).toEqual([
      'issue.resolveRef',
      'issue.getActiveClaim',
      'issue.releaseClaim',
      'issue.getParent',
      'issue.getRevision',
      'issue.getResolvedContext',
      'issue.resolveProject',
      'issue.create',
      'issue.claimReady',
      'store.get',
      'store.addJournal',
      'gate.check',
      'gate.dispatch',
      'journal.appendEntry',
      'journal.listEntries',
      'provenance.allocateReceipt',
      'provenance.attachArtifact',
      'provenance.listReceipts',
    ]);
    expect(service.calls.find((entry) => entry.op === 'issue.getRevision')?.args).toEqual({
      issueId: 'iss_1',
      revision: 1,
    });
    // The gitRoot that travels is the VERIFIED server checkout, not the PC path: the store matches
    // links of its own machine, and two identical-looking layouts are not evidence.
    expect(service.calls.find((entry) => entry.op === 'issue.resolveProject')?.args).toEqual({
      gitRoot: '/srv/core',
    });
    expect(service.calls.find((entry) => entry.op === 'gate.check')?.args).toEqual({ request: req });
    expect(service.calls.find((entry) => entry.op === 'store.addJournal')?.args).toEqual({
      ref: 'X',
      kind: 'note',
      participantId: 'p',
      activationId: 'act_1',
    });
  });
});

/** A failure shaped like Substrate's ServiceCallError: the code is a field, the message is prose. */
function codedError(code: string): Error & { code: string; name: string } {
  const error = new Error(`ssh: none: the service connection ended (exit 255) [${code}]`) as Error & {
    code: string;
    name: string;
  };
  error.code = code;
  error.name = 'ServiceCallError';
  return error;
}

/** A service whose link can be dropped on demand, counting its own closes so a leak is visible. */
function droppableService(behaviour: 'drop-first-call' | 'refuse-first-call' | 'answer'): RemoteWorkItemService & {
  calls: string[];
  closes: number;
} {
  let remaining = 1;
  const link = {
    calls: [] as string[],
    closes: 0,
    call: (async <T>(op: string): Promise<T> => {
      link.calls.push(op);
      if (remaining > 0) {
        remaining -= 1;
        if (behaviour === 'drop-first-call') throw codedError('connection_lost');
        if (behaviour === 'refuse-first-call') throw codedError('bad_request');
      }
      return { ok: op } as T;
    }) as RemoteWorkItemService['call'],
    close: async (): Promise<void> => {
      link.closes += 1;
    },
  };
  return link;
}

describe('a dropped link recovers on the next call', () => {
  it('refuses once, then reopens on a fresh link without retrying the failed call', async () => {
    const dead = droppableService('drop-first-call');
    const fresh = droppableService('answer');
    const opened: Array<ReturnType<typeof droppableService>> = [];
    const service = createReopeningService(dead, async () => {
      opened.push(fresh);
      return fresh;
    });

    // The failed call is one attempt: the host renders its refusal, and nothing was retried.
    await expect(service.call('issue.resolveRef', { ref: 'X' })).rejects.toThrow(/connection_lost/);
    expect(dead.calls).toEqual(['issue.resolveRef']);
    // Reopening belongs to the NEXT call, not to this one.
    expect(opened).toHaveLength(0);

    // The next dispatch in the same host gets a link that works.
    await expect(service.call('issue.resolveRef', { ref: 'X' })).resolves.toEqual({ ok: 'issue.resolveRef' });
    expect(opened).toHaveLength(1);
    expect(fresh.calls).toEqual(['issue.resolveRef']);
    expect(dead.calls).toEqual(['issue.resolveRef']);
    // The dead ssh child is closed before the new one is opened: no second process is left behind.
    expect(dead.closes).toBe(1);
  });

  it('does not reopen when the far side refused the call', async () => {
    const live = droppableService('refuse-first-call');
    let opened = 0;
    const service = createReopeningService(live, async () => {
      opened += 1;
      return droppableService('answer');
    });

    await expect(service.call('store.addJournal', { ref: 'X' })).rejects.toThrow(/bad_request/);
    await expect(service.call('store.addJournal', { ref: 'X' })).resolves.toEqual({ ok: 'store.addJournal' });
    expect(opened).toBe(0);
    expect(live.closes).toBe(0);
    expect(live.calls).toEqual(['store.addJournal', 'store.addJournal']);
  });

  it('shares one reopen across concurrent callers that arrive after the same drop', async () => {
    const dead = droppableService('drop-first-call');
    const fresh = droppableService('answer');
    let opened = 0;
    const service = createReopeningService(dead, async () => {
      opened += 1;
      return fresh;
    });

    await expect(service.call('issue.getRevision', { issueId: 'iss_1', revision: 1 })).rejects.toThrow(/connection_lost/);
    const results = await Promise.all([
      service.call('issue.resolveRef', { ref: 'A' }),
      service.call('issue.resolveRef', { ref: 'B' }),
    ]);
    expect(results).toHaveLength(2);
    expect(opened).toBe(1);
    expect(dead.closes).toBe(1);
    expect(fresh.calls).toEqual(['issue.resolveRef', 'issue.resolveRef']);
  });
});

