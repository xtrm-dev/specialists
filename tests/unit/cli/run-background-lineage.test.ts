// Pane-lineage stamp source for `sp run --background` (unitAI-vc7tl).
//
// The stamp carries the IMMEDIATE dispatching pane: a fresh ambient capture
// wins over a propagated forensic origin, so a specialist that dispatches
// another specialist nests under the middle pane (no special case).
// Propagated origin is the fallback; neither means the edge stays unset —
// the documented "no dispatcher" state.
//
// NOTE: this lives outside tests/unit/cli/run.test.ts (quarantined under
// xtrm-wiy5n.4.11) so the lineage contract runs in the default baseline.
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import * as fs from 'node:fs';
import * as childProcess from 'node:child_process';

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual };
});

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual };
});

import * as tmuxUtils from '../../../src/cli/tmux-utils.js';
import { SpecialistLoader } from '../../../src/specialist/loader.js';
import { Supervisor } from '../../../src/specialist/supervisor.js';
import { run } from '../../../src/cli/run.js';
import {
  encodePropagatedOrigin,
  SPECIALISTS_RUNTIME_ORIGIN_V1,
  type RuntimeOriginV1,
} from '../../../src/specialist/runtime-origin.js';

const AMBIENT_ORIGIN: RuntimeOriginV1 = {
  schema_version: 'xtrm.runtime-origin.v1',
  kind: 'xtmux.agent_instance',
  host_id: 'host-middle',
  tmux_session_id: '$9',
  tmux_window_id: '@90',
  tmux_pane_id: '%91',
  captured_at_ms: 1_700_000_000_000,
  capture_source: 'xtmux-context',
  verified: true,
};

const ROOT_ORIGIN: RuntimeOriginV1 = {
  schema_version: 'xtrm.runtime-origin.v1',
  kind: 'xtmux.agent_instance',
  host_id: 'host-root',
  tmux_session_id: '$3',
  tmux_window_id: '@7',
  tmux_pane_id: '%17',
  captured_at_ms: 1_700_000_000_000,
  capture_source: 'xtmux-context',
  verified: true,
};

describe('background launch pane lineage', () => {
  const originalArgv = process.argv;
  const savedEnv = {
    TMUX_PANE: process.env.TMUX_PANE,
    [SPECIALISTS_RUNTIME_ORIGIN_V1]: process.env[SPECIALISTS_RUNTIME_ORIGIN_V1],
  };

  beforeEach(() => {
    vi.spyOn(Supervisor.prototype, 'run').mockImplementation(async function (this: any) {
      const runner = this.opts?.runner;
      const runOptions = this.opts?.runOptions ?? {};
      if (runner && typeof runner.run === 'function') {
        await runner.run(runOptions);
      }
      return 'job-test';
    });
    vi.spyOn(Supervisor.prototype, 'readStatus').mockReturnValue({
      id: 'job-test',
      specialist: 'code-review',
      status: 'done',
      started_at_ms: 0,
      last_event_at_ms: 1000,
      backend: 'google-gemini-cli',
      model: 'gemini',
    } as any);
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (savedEnv.TMUX_PANE === undefined) delete process.env.TMUX_PANE;
    else process.env.TMUX_PANE = savedEnv.TMUX_PANE;
    if (savedEnv[SPECIALISTS_RUNTIME_ORIGIN_V1] === undefined) delete process.env[SPECIALISTS_RUNTIME_ORIGIN_V1];
    else process.env[SPECIALISTS_RUNTIME_ORIGIN_V1] = savedEnv[SPECIALISTS_RUNTIME_ORIGIN_V1];
    vi.restoreAllMocks();
  });

  async function launchBackgroundAndReadStamp(): Promise<Record<string, string>> {
    process.argv = ['node', '/repo/src/index.ts', 'run', 'code-review', '--prompt', 'hello', '--background'];
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });

    vi.spyOn(SpecialistLoader.prototype, 'get').mockResolvedValue({
      specialist: {
        metadata: { name: 'code-review', version: '1.0.0' },
        execution: { model: 'gemini', timeout_ms: 5000, mode: 'tool', permission_required: 'READ_ONLY' },
        prompt: { task_template: 'Do $prompt' },
      },
    } as any);

    vi.spyOn(tmuxUtils, 'isTmuxAvailable').mockReturnValue(true);
    const createTmuxSessionSpy = vi.spyOn(tmuxUtils, 'createTmuxSession').mockImplementation(() => {});
    vi.spyOn(childProcess, 'spawnSync').mockImplementation(((cmd: string) => {
      if (cmd === 'xtmux') {
        return { status: 0, stdout: JSON.stringify(AMBIENT_ORIGIN), stderr: '', error: undefined };
      }
      throw new Error(`unexpected spawnSync: ${cmd}`);
    }) as any);

    let latestReads = 0;
    vi.spyOn(fs, 'readFileSync').mockImplementation((path: any) => {
      if (String(path).endsWith('/.specialists/jobs/latest')) {
        latestReads += 1;
        return latestReads === 1 ? 'old-job' : 'job-from-tmux';
      }
      throw new Error('unexpected path');
    });

    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    vi.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`exit:${code}`);
    }) as never);

    await expect(run()).rejects.toThrow('exit:0');
    return createTmuxSessionSpy.mock.calls[0]?.[4] as Record<string, string>;
  }

  it('stamps the ambient pane identity when dispatched from tmux', async () => {
    process.env.TMUX_PANE = '%91';
    delete process.env[SPECIALISTS_RUNTIME_ORIGIN_V1];
    expect(await launchBackgroundAndReadStamp()).toEqual({
      '@agent_parent_session': '$9',
      '@agent_parent_pane': '%91',
    });
  });

  it('nested dispatch stamps the middle pane, not the propagated root', async () => {
    process.env.TMUX_PANE = '%91';
    process.env[SPECIALISTS_RUNTIME_ORIGIN_V1] = encodePropagatedOrigin(ROOT_ORIGIN);
    expect(await launchBackgroundAndReadStamp()).toEqual({
      '@agent_parent_session': '$9',
      '@agent_parent_pane': '%91',
    });
  });

  it('falls back to the propagated origin when ambient capture is unavailable', async () => {
    delete process.env.TMUX_PANE;
    process.env[SPECIALISTS_RUNTIME_ORIGIN_V1] = encodePropagatedOrigin(ROOT_ORIGIN);
    expect(await launchBackgroundAndReadStamp()).toEqual({
      '@agent_parent_session': '$3',
      '@agent_parent_pane': '%17',
    });
  });

  it('leaves the edge unset outside tmux with no propagated origin', async () => {
    delete process.env.TMUX_PANE;
    delete process.env[SPECIALISTS_RUNTIME_ORIGIN_V1];
    expect(await launchBackgroundAndReadStamp()).toEqual({});
  });
});
