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

  it('act:0293a2bc-f48 native activation -> jobId preserved, NOT split', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['act:0293a2bc-f48']);
    expect(args.jobId).toBe('act:0293a2bc-f48');
    expect(args.nodeId).toBeUndefined();
    expect(args.memberKey).toBeUndefined();
  });

  it('att:0293a2bc-f48:1 native attempt -> jobId preserved, NOT split', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['att:0293a2bc-f48:1']);
    expect(args.jobId).toBe('att:0293a2bc-f48:1');
    expect(args.nodeId).toBeUndefined();
    expect(args.memberKey).toBeUndefined();
  });

  it('att attempt maps to its activation for lookup', async () => {
    const { resolveNativeAttemptToActivationId } = await loadParse();
    expect(resolveNativeAttemptToActivationId('att:0293a2bc-f48:1')).toBe('act:0293a2bc-f48');
    expect(resolveNativeAttemptToActivationId('att:758931b7-9ce:1')).toBe('act:758931b7-9ce');
  });

  it('act: malformed -> explicit error', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['act:'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain("invalid activation id 'act:'");
  });

  it('att:foo malformed -> explicit error', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['att:foo'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain("invalid attempt id 'att:foo'");
  });

  it('att::1 malformed -> explicit error', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['att::1'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain("invalid attempt id 'att::1'");
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

  it('att well-formed non-1 suffixes stay preserved at parse (existence is runtime)', async () => {
    const { parseArgs } = await loadParse();
    for (const ref of ['att:758931b7-9ce:0', 'att:758931b7-9ce:2', 'att:758931b7-9ce:99']) {
      const args = parseArgs([ref]);
      expect(args.jobId).toBe(ref);
      expect(args.nodeId).toBeUndefined();
      expect(args.memberKey).toBeUndefined();
    }
  });

  it('att:<id>:abc malformed -> explicit error', async () => {
    const { parseArgs } = await loadParse();
    const { errors, exitSpy } = mockExit();
    expect(() => parseArgs(['att:758931b7-9ce:abc'])).toThrow('exit:1');
    expect(exitSpy).toHaveBeenCalledWith(1);
    expect(errors.join('\n')).toContain("invalid attempt id 'att:758931b7-9ce:abc'");
  });

  it('att:<nonexistent>:1 well-formed -> preserved (runtime reports No job found)', async () => {
    const { parseArgs } = await loadParse();
    const args = parseArgs(['att:nonexistentcore:1']);
    expect(args.jobId).toBe('att:nonexistentcore:1');
    expect(args.nodeId).toBeUndefined();
    expect(args.memberKey).toBeUndefined();
  });

  it('trailing space is byte-exact (no trim, accepted strictness)', async () => {
    // Accepted: refs match byte-exact. 'act:foo ' stays a jobId and fails
    // closed at lookup; trimming would only churn legacy failure modes.
    const { parseArgs } = await loadParse();
    const args = parseArgs(['act:foo ']);
    expect(args.jobId).toBe('act:foo ');
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
        readStatus: (jobId: string) => (statusId !== null && jobId === statusId
          ? { id: statusId, specialist: 'bug-hunt', status: 'done', started_at_ms: Date.now() - 1000 }
          : null),
        readEvents: () => [],
        readResult: (jobId: string) => (statusId !== null && jobId === statusId ? result : null),
        readForensicEvents: (filters?: { jobId?: string }) => (statusId !== null && filters?.jobId === statusId
          ? forensicAttemptIds.map((attempt_id, index) => ({
            id: index + 1, job_id: statusId, seq: index + 1, t: Date.now(),
            schema_version: 'v15', event_family: 'job', event_name: 'job.started',
            participant_kind: null, participant_role: null, participant_id: null,
            attempt_id, redaction_status: 'none', event_json: '{}',
          }))
          : []),
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
