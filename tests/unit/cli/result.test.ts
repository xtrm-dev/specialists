import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveObservabilityDbLocation } from '../../../src/specialist/observability-db.js';

let tempRoot: string;
let specialistsDir: string;
let jobsDir: string;

function createJob(jobId: string, status: 'starting' | 'running' | 'waiting' | 'done' | 'error', withResult = false): void {
  const jobDir = join(jobsDir, jobId);
  mkdirSync(jobDir, { recursive: true });
  writeFileSync(
    join(jobDir, 'status.json'),
    JSON.stringify({
      id: jobId,
      specialist: 'bug-hunt',
      status,
      started_at_ms: Date.now() - 1000,
      metrics: {
        turns: 2,
        tool_calls: 3,
        finish_reason: 'stop',
        exit_reason: status === 'done' ? 'agent_end' : undefined,
        token_usage: {
          total_tokens: 99,
          input_tokens: 60,
          output_tokens: 39,
        },
      },
    }),
    'utf-8',
  );

  if (withResult) {
    writeFileSync(join(jobDir, 'result.txt'), 'last completed output', 'utf-8');
  }
}

async function seedSqliteResult(jobId: string, status: Record<string, unknown>, output: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Database } = require('bun:sqlite');
    const location = resolveObservabilityDbLocation(tempRoot);
    mkdirSync(location.dbDirectory, { recursive: true });
    const db = new Database(location.dbPath);
    const { initSchema } = await import('../../../src/specialist/observability-sqlite.js');
    initSchema(db);

    db.run(
      `INSERT INTO specialist_jobs (job_id, specialist, status, status_json, updated_at_ms)
       VALUES (?, ?, ?, ?, ?)`,
      [jobId, String(status.specialist ?? 'bug-hunt'), String(status.status ?? 'done'), JSON.stringify(status), Date.now()]
    );

    db.run(
      `INSERT INTO specialist_results (job_id, output, updated_at_ms)
       VALUES (?, ?, ?)`,
      [jobId, output, Date.now()]
    );

    db.close();
    return true;
  } catch {
    return false;
  }
}

describe('result CLI', () => {
  const originalArgv = process.argv;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-result-test-'));
    specialistsDir = join(tempRoot, '.specialists');
    jobsDir = join(specialistsDir, 'jobs');
    mkdirSync(jobsDir, { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.doUnmock('../../../src/specialist/observability-sqlite.js');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('prints last completed output when job is running but result.txt exists', async () => {
    createJob('job1', 'running', true);
    process.argv = ['node', 'specialists', 'result', 'job1'];

    const stderrWrites: string[] = [];
    const stdoutWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });

    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/result.js');
    await run();

    expect(stdoutWrites.join('')).toContain('last completed output');
    expect(stderrWrites.join('')).toContain('Showing last completed output');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('prints JSON payload with metrics when --json is set', async () => {
    createJob('job-json', 'done', true);
    process.argv = ['node', 'specialists', 'result', 'job-json', '--json'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ''));
    });

    const { run } = await import('../../../src/cli/result.js');
    await run();

    const payload = JSON.parse(logs.join('\n')) as {
      job: { id: string; metrics: { turns: number; tool_calls: number; token_usage: { total_tokens: number } } };
      output: string;
      error: string | null;
    };

    expect(payload.job.id).toBe('job-json');
    expect(payload.job.metrics.turns).toBe(2);
    expect(payload.job.metrics.tool_calls).toBe(3);
    expect(payload.job.metrics.token_usage.total_tokens).toBe(99);
    expect(payload.output).toContain('last completed output');
    expect(payload.error).toBeNull();
  });

  it('reads result from SQLite when DB exists', async () => {
    createJob('job-sqlite', 'done', false);
    const seeded = await seedSqliteResult(
      'job-sqlite',
      { id: 'job-sqlite', specialist: 'bug-hunt', status: 'done', started_at_ms: Date.now() - 1000 },
      'sqlite output'
    );
    if (!seeded) return;

    process.argv = ['node', 'specialists', 'result', 'job-sqlite'];

    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });

    const { run } = await import('../../../src/cli/result.js');
    await run();

    expect(stdoutWrites.join('')).toContain('sqlite output');
  });

  it('returns SQLite-backed output in --json mode', async () => {
    createJob('job-sqlite-json', 'done', true);
    const seeded = await seedSqliteResult(
      'job-sqlite-json',
      { id: 'job-sqlite-json', specialist: 'bug-hunt', status: 'done', started_at_ms: Date.now() - 1000 },
      'sqlite json output'
    );
    if (!seeded) return;

    process.argv = ['node', 'specialists', 'result', 'job-sqlite-json', '--json'];

    const logs: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ''));
    });

    const { run } = await import('../../../src/cli/result.js');
    await run();

    const payload = JSON.parse(logs.join('\n')) as { output: string };
    expect(payload.output).toContain('sqlite json output');
  });

  it('falls back to result.txt when SQLite read fails', async () => {
    createJob('job-fallback', 'done', true);

    vi.resetModules();
    vi.doMock('../../../src/specialist/observability-sqlite.js', () => ({
      createObservabilitySqliteClient: () => ({
        readResult: () => {
          throw new Error('sqlite read failed');
        },
        close: () => {},
      }),
    }));

    process.argv = ['node', 'specialists', 'result', 'job-fallback'];

    const stdoutWrites: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdoutWrites.push(String(chunk));
      return true;
    });

    const { run } = await import('../../../src/cli/result.js');
    await run();

    expect(stdoutWrites.join('')).toContain('last completed output');
  });

  it('surfaces api error when done job has no result output', async () => {
    createJob('job-error', 'done', false);
    process.argv = ['node', 'specialists', 'result', 'job-error'];

    writeFileSync(
      join(jobsDir, 'job-error', 'events.jsonl'),
      JSON.stringify({ t: Date.now(), type: 'error', source: 'stderr', error_message: 'You have hit your ChatGPT usage limit' }),
      'utf-8',
    );

    const stderrWrites: string[] = [];
    vi.spyOn(process.stderr, 'write').mockImplementation((chunk: any) => {
      stderrWrites.push(String(chunk));
      return true;
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/result.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(stderrWrites.join('')).toContain('usage limit');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it('exits with code 1 when job is running and result.txt does not exist', async () => {
    createJob('job2', 'running', false);
    process.argv = ['node', 'specialists', 'result', 'job2'];

    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    const { run } = await import('../../../src/cli/result.js');
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
  });
});

describe('result CLI identity grammar (XTRM-93 N2A)', () => {
  const originalArgv = process.argv;

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function loadParse(): Promise<typeof import('../../../src/cli/result.js')> {
    return import('../../../src/cli/result.js');
  }

  function mockExit(): { errors: string[]; exitSpy: ReturnType<typeof vi.spyOn> } {
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ''));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    return { errors, exitSpy };
  }

  it('00270d legacy 6-hex -> jobId preserved', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['00270d']);
    expect(args.jobId).toBe('00270d');
    expect(args.nodeId).toBeUndefined();
    expect(args.memberKey).toBeUndefined();
  });

  it('legacy uuid -> jobId preserved', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['0007c574-26ba-4817-8bbb-b2338aa7bdfb']);
    expect(args.jobId).toBe('0007c574-26ba-4817-8bbb-b2338aa7bdfb');
    expect(args.nodeId).toBeUndefined();
    expect(args.memberKey).toBeUndefined();
  });

  it('node-1:some-member legacy node:member -> split preserved', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['node-1:some-member']);
    expect(args.jobId).toBeUndefined();
    expect(args.nodeId).toBe('node-1');
    expect(args.memberKey).toBe('some-member');
  });

  it('act:0293a2bc-f48 positional colon ref is retained for legacy-first resolution (N2A fix)', async () => {
    // N2A-fix: identity is never decided by syntax alone. Parse retains the raw
    // positional value and the historical first-colon split; run() attempts the
    // legacy node/member pair first and only falls through to native.
    const { parseArgs } = await loadParse();
    const args = parseArgs(['act:0293a2bc-f48']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('act:0293a2bc-f48');
    expect(args.nodeId).toBe('act');
    expect(args.memberKey).toBe('0293a2bc-f48');
  });

  it('att:0293a2bc-f48:1 positional colon ref is retained for legacy-first resolution (N2A fix)', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['att:0293a2bc-f48:1']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('att:0293a2bc-f48:1');
    expect(args.nodeId).toBe('att');
    expect(args.memberKey).toBe('0293a2bc-f48:1');
  });

  it('att attempt maps to its activation for lookup', async () => {
    const { resolveNativeAttemptToActivationId } = await loadParse();
    expect(resolveNativeAttemptToActivationId('att:0293a2bc-f48:1')).toBe('act:0293a2bc-f48');
    expect(resolveNativeAttemptToActivationId('att:758931b7-9ce:1')).toBe('act:758931b7-9ce');
  });

  it('act: malformed native shape is NOT rejected at parse (N2A fix moves validation to run())', async () => {
    // N2A-fix: parse retains the positional value; the native grammar error is
    // emitted by run() only when the legacy pair demonstrably does not exist.
    // `act:` has an empty member, so the pre-N2A empty-member error still fires
    // here (parse preserves the historical empty checks).
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['act:'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('member key cannot be empty');
  });

  it('att:foo malformed native shape is retained at parse (grammar error moves to run())', async () => {
    const { parseArgs } = await loadParse();
    mockExit();
    const args = parseArgs(['att:foo']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('att:foo');
    expect(args.nodeId).toBe('att');
    expect(args.memberKey).toBe('foo');
  });

  it('att::1 malformed native shape is retained at parse (grammar error moves to run())', async () => {
    const { parseArgs } = await loadParse();
    mockExit();
    const args = parseArgs(['att::1']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('att::1');
    expect(args.nodeId).toBe('att');
    expect(args.memberKey).toBe(':1');
  });

  it(':member empty node ref -> existing error path', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs([':member'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('node ref cannot be empty');
  });

  it('node-1: empty member key -> existing error path', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['node-1:'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('member key cannot be empty');
  });

  it('--node/--member explicit flags are untouched by native prefix rule', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['--node', 'node-1', '--member', 'some-member']);
    expect(args.jobId).toBeUndefined();
    expect(args.nodeId).toBe('node-1');
    expect(args.memberKey).toBe('some-member');
  });

  it('att well-formed non-1 suffixes are retained as positional refs at parse (existence is runtime)', async () => {
    const { parseArgs } = await loadParse();
    for (const ref of ['att:758931b7-9ce:0', 'att:758931b7-9ce:2', 'att:758931b7-9ce:99']) {
      const args = parseArgs([ref]);
      expect(args.jobId).toBeUndefined();
      expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe(ref);
      expect(args.nodeId).toBe('att');
    }
  });

  it('att:<id>:abc malformed native shape is retained at parse (grammar error moves to run())', async () => {
    const { parseArgs } = await loadParse();
    mockExit();
    const args = parseArgs(['att:758931b7-9ce:abc']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('att:758931b7-9ce:abc');
    expect(args.nodeId).toBe('att');
    expect(args.memberKey).toBe('758931b7-9ce:abc');
  });

  it('att:<nonexistent>:1 is retained as positional ref at parse (runtime reports No job found)', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['att:nonexistentcore:1']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('att:nonexistentcore:1');
    expect(args.nodeId).toBe('att');
    expect(args.memberKey).toBe('nonexistentcore:1');
  });

  it('trailing space is byte-exact and retained as positional ref (no trim, accepted strictness)', async () => {
    // Accepted: refs match byte-exact. 'act:foo ' is retained as a positional
    // colon ref (node 'act', member 'foo '); trimming would only churn legacy
    // failure modes.
    const { parseArgs } = await loadParse();
    const args = parseArgs(['act:foo ']);
    expect(args.jobId).toBeUndefined();
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('act:foo ');
    expect(args.nodeId).toBe('act');
    expect(args.memberKey).toBe('foo ');
  });

  it('leading space falls through to the legacy node split (accepted strictness)', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs([' act:foo']);
    expect(args.jobId).toBeUndefined();
    expect(args.nodeId).toBe(' act');
    expect(args.memberKey).toBe('foo');
  });

  it('positional colon ref with --member keeps positional-wins (intended)', async () => {
    // Same rule as legacy: the colon branch only runs when neither explicit
    // flag was given, and jobId wins downstream. No new error here.
    const { parseArgs } = await loadParse();
    const args = parseArgs(['act:foo:bar', '--member', 'x']);
    expect(args.jobId).toBe('act:foo:bar');
    expect(args.memberKey).toBe('x');
  });

  it('--node/--member with native-looking values goes to node lookup (intended)', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['--node', 'act:foo', '--member', 'bar']);
    expect(args.jobId).toBeUndefined();
    expect(args.nodeId).toBe('act:foo');
    expect(args.memberKey).toBe('bar');
  });

  it('resolveNativeAttemptToActivationId throws on malformed input (precondition)', async () => {
    const { resolveNativeAttemptToActivationId } = await loadParse();
    expect(() => resolveNativeAttemptToActivationId('att:foo:1:2')).toThrow("Invalid attempt id 'att:foo:1:2'");
    expect(() => resolveNativeAttemptToActivationId('act:foo')).toThrow("Invalid attempt id 'act:foo'");
  });
});

describe('result CLI native attempt validation', () => {
  const originalArgv = process.argv;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-result-att-test-'));
    mkdirSync(join(tempRoot, '.specialists', 'jobs'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.doUnmock('../../../src/specialist/observability-sqlite.js');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  async function loadRunWithAttemptMocks(opts: { statusId: string | null; forensicAttemptIds: string[]; result: string | null }) {
    const statusId = opts.statusId;
    const forensicAttemptIds = opts.forensicAttemptIds;
    const result = opts.result;
    vi.resetModules();
    vi.doMock('../../../src/specialist/observability-sqlite.js', () => ({
      createObservabilitySqliteClient: () => ({
        // N2A-fix: run() attempts the legacy node/member pair first through the
        // real resolver, so the mock must implement the node surface. An empty
        // node table means legacy is absent and the native path applies.
        listNodeRunsByRef: () => [],
        readNodeRun: () => null,
        readNodeMembers: () => [],
        listNodeRunsByStatuses: () => [],
        readStatus: (jobId: string) => (statusId !== null && jobId === statusId
          ? { id: statusId, specialist: 'bug-hunt', status: 'done', started_at_ms: Date.now() - 1000 }
          : null),
        readEvents: () => [],
        readResult: (jobId: string) => (statusId !== null && jobId === statusId ? result : null),
        listForensicAttemptIds: (jobId: string) =>
          (statusId !== null && jobId === statusId ? [...forensicAttemptIds] : []),
        close: () => {},
      }),
    }));
    return import('../../../src/cli/result.js');
  }

  function captureOutput(): { stdout: string[]; errors: string[]; logs: string[]; exitSpy: ReturnType<typeof vi.spyOn> } {
    const stdout: string[] = [];
    const errors: string[] = [];
    const logs: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: any) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ''));
    });
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      logs.push(String(msg ?? ''));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    return { stdout, errors, logs, exitSpy };
  }

  it('att:<id>:1 resolves when minted', async () => {
    const { run } = await loadRunWithAttemptMocks({ statusId: 'act:core', forensicAttemptIds: ['att:core:1'], result: 'attempt output' });
    process.argv = ['node', 'specialists', 'result', 'att:core:1'];
    const { stdout, exitSpy } = captureOutput();
    await run();
    expect(stdout.join('')).toContain('attempt output');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('att:<id>:2 resolves when a retry minted it', async () => {
    const { run } = await loadRunWithAttemptMocks({ statusId: 'act:core', forensicAttemptIds: ['att:core:1', 'att:core:2'], result: 'attempt output' });
    process.argv = ['node', 'specialists', 'result', 'att:core:2'];
    const { stdout, exitSpy } = captureOutput();
    await run();
    expect(stdout.join('')).toContain('attempt output');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it.each([['att:core:0'], ['att:core:2'], ['att:core:99']])('%s refuses when never minted', async (ref) => {
    const { run } = await loadRunWithAttemptMocks({ statusId: 'act:core', forensicAttemptIds: ['att:core:1'], result: 'attempt output' });
    process.argv = ['node', 'specialists', 'result', ref];
    const { errors, exitSpy } = captureOutput();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain(`No such attempt '${ref}'`);
    expect(errors.join('\n')).toContain(`for activation 'act:core'`);
  });

  it('att:<missing>:1 keeps the No-job-found path (bad core unchanged)', async () => {
    const { run } = await loadRunWithAttemptMocks({ statusId: null, forensicAttemptIds: [], result: null });
    process.argv = ['node', 'specialists', 'result', 'att:missing:1'];
    const { errors, exitSpy } = captureOutput();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('No job found: act:missing');
    expect(errors.join('\n')).not.toContain('No such attempt');
  });

  it('--json refusal keeps shape with job null and a naming error', async () => {
    const { run } = await loadRunWithAttemptMocks({ statusId: 'act:core', forensicAttemptIds: ['att:core:1'], result: 'attempt output' });
    process.argv = ['node', 'specialists', 'result', 'att:core:99', '--json'];
    const { logs, exitSpy } = captureOutput();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    const payload = JSON.parse(logs[0] as string) as { job: null; output: null; error: string };
    expect(payload.job).toBeNull();
    expect(payload.output).toBeNull();
    expect(payload.error).toContain("No such attempt 'att:core:99'");
  });

  it('act:<id> still resolves without attempt validation', async () => {
    const { run } = await loadRunWithAttemptMocks({ statusId: 'act:core', forensicAttemptIds: ['att:core:1'], result: 'attempt output' });
    process.argv = ['node', 'specialists', 'result', 'act:core'];
    const { stdout, exitSpy } = captureOutput();
    await run();
    expect(stdout.join('')).toContain('attempt output');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('result CLI N2A namespace fix (legacy positional preserved)', () => {
  const originalArgv = process.argv;
  let tempRoot: string;

  beforeEach(() => {
    tempRoot = mkdtempSync(join(tmpdir(), 'sp-result-n2afix-'));
    mkdirSync(join(tempRoot, '.specialists', 'jobs'), { recursive: true });
    vi.spyOn(process, 'cwd').mockReturnValue(tempRoot);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (existsSync(tempRoot)) rmSync(tempRoot, { recursive: true, force: true });
    vi.doUnmock('../../../src/specialist/observability-sqlite.js');
    vi.resetModules();
    vi.restoreAllMocks();
  });

  type FakeNode = { id: string; node_name: string; status: string };
  type FakeMember = { node_run_id: string; member_id: string; job_id?: string };

  async function loadRunWithNodes(opts: {
    nodes: FakeNode[];
    members: FakeMember[];
    statuses: Record<string, { id: string; status: string }>;
    results: Record<string, string>;
    forensicByActivation?: Record<string, string[]>;
    listThrows?: boolean;
  }) {
    const nodes = opts.nodes;
    const members = opts.members;
    const statuses = opts.statuses;
    const results = opts.results;
    const forensicByActivation = opts.forensicByActivation ?? {};
    const listThrows = opts.listThrows ?? false;
    vi.resetModules();
    vi.doMock('../../../src/specialist/observability-sqlite.js', () => ({
      createObservabilitySqliteClient: () => ({
        // Generic prefix contract mirroring listNodeRunsByRef semantics
        // (id LIKE '<ref>%' OR node_name LIKE '<ref>%'): no assumption about
        // act/att prefixes, so `act` genuinely resolves via `action-plan`.
        listNodeRunsByRef: (ref: string) => {
          if (listThrows) throw new Error('DB failure: listNodeRunsByRef exploded');
          return nodes.filter((n) => n.id.startsWith(ref) || n.node_name.startsWith(ref));
        },
        listNodeRunsByStatuses: () => [],
        readNodeRun: (id: string) => nodes.find((n) => n.id === id) ?? null,
        readNodeMembers: (id: string) =>
          members
            .filter((m) => m.node_run_id === id)
            .map((m) => ({ node_run_id: m.node_run_id, member_id: m.member_id, job_id: m.job_id })),
        readStatus: (jobId: string) =>
          (statuses[jobId]
            ? { id: statuses[jobId]!.id, specialist: 'bug-hunt', status: statuses[jobId]!.status, started_at_ms: Date.now() - 1000 }
            : null),
        readEvents: () => [],
        readResult: (jobId: string) => results[jobId] ?? null,
        listForensicAttemptIds: (jobId: string) => [...(forensicByActivation[jobId] ?? [])],
        close: () => {},
      }),
    }));
    return import('../../../src/cli/result.js');
  }

  function capture(): { stdout: string[]; errors: string[]; exitSpy: ReturnType<typeof vi.spyOn> } {
    const stdout: string[] = [];
    const errors: string[] = [];
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdout.push(String(chunk));
      return true;
    });
    vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ''));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    return { stdout, errors, exitSpy };
  }

  it('legacy unique node prefix act + member resolves through the real resolver', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [{ id: 'action-plan-node1', node_name: 'action-plan', status: 'running' }],
      members: [{ node_run_id: 'action-plan-node1', member_id: 'my-member', job_id: 'legacy-job-1' }],
      statuses: { 'legacy-job-1': { id: 'legacy-job-1', status: 'done' } },
      results: { 'legacy-job-1': 'LEGACY OUTPUT act' },
    });
    process.argv = ['node', 'specialists', 'result', 'act:my-member'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('LEGACY OUTPUT act');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('legacy unique node prefix att + member resolves through the real resolver', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [{ id: 'attribution-node1', node_name: 'attribution-sweep', status: 'running' }],
      members: [{ node_run_id: 'attribution-node1', member_id: 'my-member', job_id: 'legacy-job-2' }],
      statuses: { 'legacy-job-2': { id: 'legacy-job-2', status: 'done' } },
      results: { 'legacy-job-2': 'LEGACY OUTPUT att' },
    });
    process.argv = ['node', 'specialists', 'result', 'att:my-member'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('LEGACY OUTPUT att');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('act:<id> with no matching legacy node/member falls through to the native result', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [],
      members: [],
      statuses: { 'act:core': { id: 'act:core', status: 'done' } },
      results: { 'act:core': 'NATIVE OUTPUT' },
    });
    process.argv = ['node', 'specialists', 'result', 'act:core'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('NATIVE OUTPUT');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('att:<id>:<n> with no matching legacy node/member resolves the exact native attempt', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [],
      members: [],
      statuses: { 'act:core': { id: 'act:core', status: 'done' } },
      results: { 'act:core': 'NATIVE ATTEMPT OUTPUT' },
      forensicByActivation: { 'act:core': ['att:core:1', 'att:core:2'] },
    });
    process.argv = ['node', 'specialists', 'result', 'att:core:2'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('NATIVE ATTEMPT OUTPUT');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('collision: legacy + native both exist -> legacy wins (documented compatibility default)', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [{ id: 'action-plan-node1', node_name: 'action-plan', status: 'running' }],
      members: [{ node_run_id: 'action-plan-node1', member_id: 'core', job_id: 'legacy-job-1' }],
      statuses: {
        'legacy-job-1': { id: 'legacy-job-1', status: 'done' },
        'act:core': { id: 'act:core', status: 'done' },
      },
      results: { 'legacy-job-1': 'LEGACY WINS', 'act:core': 'NATIVE OUTPUT' },
    });
    process.argv = ['node', 'specialists', 'result', 'act:core'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('LEGACY WINS');
    expect(stdout.join('')).not.toContain('NATIVE OUTPUT');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('malformed native-looking value that IS a valid legacy pair keeps the legacy result', async () => {
    // `act:foo:bar` is malformed as native (act core must not contain a colon)
    // but valid as legacy (node `act*` + member `foo:bar`).
    const { run } = await loadRunWithNodes({
      nodes: [{ id: 'action-plan-node1', node_name: 'action-plan', status: 'running' }],
      members: [{ node_run_id: 'action-plan-node1', member_id: 'foo:bar', job_id: 'legacy-job-1' }],
      statuses: { 'legacy-job-1': { id: 'legacy-job-1', status: 'done' } },
      results: { 'legacy-job-1': 'LEGACY MALFORMED WINS' },
    });
    process.argv = ['node', 'specialists', 'result', 'act:foo:bar'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('LEGACY MALFORMED WINS');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('malformed native-looking value with no legacy match emits the native grammar error', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [],
      members: [],
      statuses: {},
      results: {},
    });
    process.argv = ['node', 'specialists', 'result', 'att:foo'];
    const { errors, exitSpy } = capture();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain("invalid attempt id 'att:foo'");
  });

  it('explicit --native forces native when both interpretations exist', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [{ id: 'action-plan-node1', node_name: 'action-plan', status: 'running' }],
      members: [{ node_run_id: 'action-plan-node1', member_id: 'core', job_id: 'legacy-job-1' }],
      statuses: {
        'legacy-job-1': { id: 'legacy-job-1', status: 'done' },
        'act:core': { id: 'act:core', status: 'done' },
      },
      results: { 'legacy-job-1': 'LEGACY WINS', 'act:core': 'NATIVE FORCED' },
    });
    process.argv = ['node', 'specialists', 'result', 'act:core', '--native'];
    const { stdout, exitSpy } = capture();
    await run();
    expect(stdout.join('')).toContain('NATIVE FORCED');
    expect(stdout.join('')).not.toContain('LEGACY WINS');
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it('resolver THROW (DB failure) surfaces as-is and is never reinterpreted as native', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [],
      members: [],
      statuses: { 'act:core': { id: 'act:core', status: 'done' } },
      results: { 'act:core': 'NATIVE OUTPUT' },
      listThrows: true,
    });
    process.argv = ['node', 'specialists', 'result', 'act:core'];
    const { stdout, errors, exitSpy } = capture();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('DB failure');
    expect(stdout.join('')).not.toContain('NATIVE OUTPUT');
  });

  it('ambiguous legacy prefix surfaces the existing ambiguity error', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [
        { id: 'action-plan-1', node_name: 'action-plan', status: 'running' },
        { id: 'action-plan-2', node_name: 'action-plan-2', status: 'running' },
      ],
      members: [],
      statuses: {},
      results: {},
    });
    process.argv = ['node', 'specialists', 'result', 'act:my-member'];
    const { errors, exitSpy } = capture();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('Ambiguous node ref act matches:');
  });

  it('non-native positional with no legacy match re-raises the legacy node error', async () => {
    const { run } = await loadRunWithNodes({
      nodes: [],
      members: [],
      statuses: {},
      results: {},
    });
    process.argv = ['node', 'specialists', 'result', 'node-9:my-member'];
    const { errors, exitSpy } = capture();
    await expect(run()).rejects.toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('No node matching ref: node-9');
  });

  it('parseArgs retains positionalColonRef and --native, and usage mentions --native', async () => {
    const mod = await import('../../../src/cli/result.js');
    const args = mod.parseArgs(['act:core', '--native']);
    expect((args as unknown as { positionalColonRef?: string }).positionalColonRef).toBe('act:core');
    expect(args.native).toBe(true);
    expect(args.jobId).toBeUndefined();
    const errors: string[] = [];
    vi.spyOn(console, 'error').mockImplementation((msg?: unknown) => {
      errors.push(String(msg ?? ''));
    });
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);
    expect(() => mod.parseArgs([])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain('--native');
  });

  it('tryResolveNodeRefWithClient discriminates resolved/absent/ambiguous and propagates throws', async () => {
    const mod = await import('../../../src/specialist/node-resolve.js');
    const resolved = mod.tryResolveNodeRefWithClient('act', {
      listNodeRunsByRef: () => [{ id: 'action-plan-node1', node_name: 'action-plan' }],
    } as never);
    expect(resolved).toEqual({ kind: 'resolved', id: 'action-plan-node1' });
    const absent = mod.tryResolveNodeRefWithClient('missing', {
      listNodeRunsByRef: () => [],
    } as never);
    expect(absent).toEqual({ kind: 'absent' });
    const ambiguous = mod.tryResolveNodeRefWithClient('act', {
      listNodeRunsByRef: () => [
        { id: 'a1', node_name: 'action-plan' },
        { id: 'a2', node_name: 'action-plan-2' },
      ],
    } as never);
    expect(ambiguous.kind).toBe('ambiguous');
    expect(() =>
      mod.tryResolveNodeRefWithClient('act', {
        listNodeRunsByRef: () => {
          throw new Error('DB down');
        },
      } as never),
    ).toThrow('DB down');
    // Throwing wrapper preserves exact messages.
    expect(() =>
      mod.resolveNodeRefWithClient('missing', { listNodeRunsByRef: () => [] } as never),
    ).toThrow('No node matching ref: missing');
  });

  it('tryResolveJobIdFromNodeMember discriminates all outcomes; wrapper messages are exact', async () => {
    const mod = await import('../../../src/cli/result.js');
    const client = (over: Record<string, unknown>) =>
      ({
        readNodeRun: () => null,
        readNodeMembers: () => [],
        ...over,
      }) as never;
    expect(
      mod.tryResolveJobIdFromNodeMember(client({ readNodeRun: () => ({ id: 'n1' }), readNodeMembers: () => [{ member_id: 'm', job_id: 'j1' }] }), 'n1', 'm'),
    ).toEqual({ kind: 'resolved', jobId: 'j1' });
    expect(mod.tryResolveJobIdFromNodeMember(client({}), 'n1', 'm')).toEqual({ kind: 'node_absent' });
    expect(
      mod.tryResolveJobIdFromNodeMember(client({ readNodeRun: () => ({ id: 'n1' }) }), 'n1', 'm'),
    ).toEqual({ kind: 'member_absent' });
    expect(
      mod.tryResolveJobIdFromNodeMember(
        client({ readNodeRun: () => ({ id: 'n1' }), readNodeMembers: () => [{ member_id: 'm' }] }),
        'n1',
        'm',
      ),
    ).toEqual({ kind: 'member_without_job_id' });
    expect(() => mod.resolveJobIdFromNodeMember(client({}), 'n1', 'm')).toThrow('Node run not found: n1');
    expect(() => mod.resolveJobIdFromNodeMember(client({ readNodeRun: () => ({ id: 'n1' }) }), 'n1', 'm')).toThrow(
      "Member 'm' not found in node 'n1'",
    );
    expect(() =>
      mod.resolveJobIdFromNodeMember(
        client({ readNodeRun: () => ({ id: 'n1' }), readNodeMembers: () => [{ member_id: 'm' }] }),
        'n1',
        'm',
      ),
    ).toThrow("Member 'm' in node 'n1' has no job id yet");
  });
});
