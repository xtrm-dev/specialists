import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { NativeActivationHost } from '../../../src/activation/native-host.js';
import { createMemorySettlementStore } from '../../../src/activation/settlement-store.js';
import type { ActivationResult } from '../../../src/activation/types.js';
import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import type { TimelineEvent } from '../../../src/specialist/timeline-events.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';

/**
 * SPECIALISTS-4322. A lease-holding activation woken by its own background timer
 * left durable records that disagreed and was never finalised: specialist_jobs
 * stayed `waiting` while specialist_job_metrics recorded `error`, although
 * specialist_events carried run_complete COMPLETE and the wake-turn bash succeeded.
 *
 * Two defects combined. First, the mid-settle `output_validation_failed` signal was
 * treated as terminal: it smeared `error` onto the jobs row (with no event behind
 * it) and triggered the metrics aggregation, and the once-per-attempt guard then
 * froze that error row when the real terminal event followed. Second, the
 * background-woken wake turn settles through the session subscription only — no
 * runToSettled frames it — so nothing emitted its terminal record or refreshed
 * metrics, and no observer learned the superseding result.
 */

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) rmSync(dirs.pop() as string, { recursive: true, force: true });
});

function scratch(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

function gitRepo(): string {
  const repo = scratch('wake-settle-repo-');
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf-8' }).trim();
  git('init', '-q', '-b', 'main');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '--allow-empty', '-m', 'init');
  return repo;
}

const BG_TEXT =
  'Started background task sleep 30 (abc123)\nStatus: running\nPID: 424242\nTerminal notification: enabled.';

interface WakeHarness {
  host: NativeActivationHost;
  session: PiAgentSessionLike & { __emit: (event: PiAgentSessionEvent) => void };
  messages: unknown[];
  dbPath: string;
}

/** Lease-waived watcher whose turn 1 starts a background sleep, then settles uncertain. */
function wakeHarness(opts: { alive: { value: boolean }; onWakeSettlement?: (result: ActivationResult) => void }): WakeHarness {
  const listeners: Array<(event: PiAgentSessionEvent) => void> = [];
  const messages: unknown[] = [];
  const emit = (event: PiAgentSessionEvent) => listeners.forEach((l) => l(event));
  let activeTools: string[] = [];
  const session = {
    sessionId: 'pi-sess-wake',
    messages,
    isIdle: true,
    async prompt() {
      emit({ type: 'agent_start' });
      emit({
        type: 'tool_execution_end', toolName: 'bg_run', toolCallId: 'call-bg',
        isError: false,
        result: { content: [{ type: 'text', text: BG_TEXT }] },
      });
      messages.push({ role: 'assistant', content: 'sleep started in background', stopReason: 'stop' });
      emit({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: 'sleep started' }] } });
      emit({ type: 'agent_end', willRetry: false });
      emit({ type: 'agent_settled' });
    },
    async steer() {},
    async followUp() {},
    async waitForIdle() {},
    async getSessionStats() { return null as never; },
    async abort() {},
    dispose() {},
    subscribe(l: (event: PiAgentSessionEvent) => void) {
      listeners.push(l);
      return () => listeners.splice(listeners.indexOf(l), 1);
    },
    getActiveToolNames: () => activeTools,
    setActiveToolsByName(names: string[]) { activeTools = names; },
    __emit: emit,
  } as unknown as PiAgentSessionLike & { __emit: (event: PiAgentSessionEvent) => void };
  const sdk: PiSdk = {
    createAgentSession: async (options?: Record<string, unknown>) => {
      if (Array.isArray(options?.tools)) session.setActiveToolsByName((options.tools as string[]));
      return { session };
    },
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({ scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }], diagnostics: [] }),
    defineTool: (d: unknown) => d,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
  const waiverSpec = {
    specialist: {
      metadata: { name: 'watcher', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model', permission_required: 'LOW', lease_waiver: true,
        response_format: 'text', output_type: 'analysis', bare: false,
      },
      prompt: { system: 'You watch.', task_template: 'Watch: {{bead_id}}' },
    },
  };
  const workRoot = scratch('wake-settle-ws-');
  const dbPath = join(workRoot, 'observability.db');
  mkdirSync(workRoot, { recursive: true });
  const client = createObservabilitySqliteClientAtPath(dbPath)!;
  const host = new NativeActivationHost({
    loader: { get: async () => waiverSpec } as never,
    workItems: testWorkItems({ ref: 'CORE-2412' }),
    loadSdk: async () => sdk,
    settlements: createMemorySettlementStore(),
    forensics: createActivationForensicSink(client),
    cwd: gitRepo(),
    backgroundTaskAlive: () => opts.alive.value,
    backgroundPollMs: 5,
    piVersion: 'test-pi',
    sessionStatsTimeoutMs: 20,
    ...(opts.onWakeSettlement ? { onWakeSettlement: opts.onWakeSettlement } : {}),
  });
  return { host, session, messages, dbPath };
}

const dispatch = { specialist: 'watcher', issueRef: 'CORE-2412', requestedByParticipantId: 'coordinator' };

function runCompleteStatuses(client: NonNullable<ReturnType<typeof createObservabilitySqliteClientAtPath>>, jobId: string): string[] {
  return client.readEvents(jobId)
    .filter((e) => e.type === 'run_complete')
    .map((e) => (e as { status?: string }).status ?? '?');
}

describe('background-woken wake settlement (SPECIALISTS-4322)', () => {
  it('an uncertain settlement leaves jobs terminal and metrics done, never error', async () => {
    const alive = { value: true };
    const { host, dbPath } = wakeHarness({ alive });
    const client = createObservabilitySqliteClientAtPath(dbPath)!;
    try {
      const handle = await host.start(dispatch);
      const first = await handle.result;
      expect(first.status).toBe('uncertain');

      // The mid-settle validation signal owns no status transition and no
      // aggregation: the terminal event settles every surface by the same rule.
      expect(client.readStatus(handle.activationId)?.status).toBe('done');
      const metrics = client.listJobMetrics().find((m) => m.job_id === handle.activationId);
      expect(metrics?.status).toBe('done');
      expect(runCompleteStatuses(client, handle.activationId)).toEqual(['COMPLETE']);
      await host.stop(handle.activationId);
    } finally {
      client.close();
    }
  });

  it('a background-woken wake turn finalises the activation on every surface', async () => {
    const alive = { value: true };
    const seen: ActivationResult[] = [];
    const { host, session, messages, dbPath } = wakeHarness({
      alive,
      onWakeSettlement: (result) => { seen.push(result); },
    });
    const client = createObservabilitySqliteClientAtPath(dbPath)!;
    try {
      const handle = await host.start(dispatch);
      expect((await handle.result).status).toBe('uncertain');

      // The background task exits; the watch releases the lease. Pi then wakes the
      // live session on its own — no resume()/retry() call frames this turn.
      alive.value = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const fire = session.__emit;
      fire({ type: 'agent_start' });
      fire({ type: 'turn_start' });
      fire({ type: 'tool_execution_start', toolName: 'bash', toolCallId: 'call-wake', args: { command: 'sleep 0.1' } });
      fire({
        type: 'tool_execution_end', toolName: 'bash', toolCallId: 'call-wake',
        isError: false, result: { content: [{ type: 'text', text: 'background sleep done' }] },
      });
      const wakeText = 'wake turn: background sleep is done, all quiet';
      messages.push({ role: 'assistant', content: wakeText, stopReason: 'stop' });
      fire({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: wakeText }] } });
      fire({ type: 'agent_end', willRetry: false });
      fire({ type: 'agent_settled' });
      // The finalise path awaits a bounded session-stats capture.
      await new Promise((resolve) => setTimeout(resolve, 150));

      // One outcome on all three surfaces: the job leaves waiting, metrics agree
      // with the job (done, not error), and the stream carries the wake COMPLETE.
      expect(client.readStatus(handle.activationId)?.status).toBe('done');
      const metrics = client.listJobMetrics().find((m) => m.job_id === handle.activationId);
      expect(metrics?.status).toBe('done');
      expect(metrics?.total_turns).toBe(2);
      expect(runCompleteStatuses(client, handle.activationId)).toEqual(['COMPLETE', 'COMPLETE']);
      // The outward seam reports the superseding result, so specialist_status reads
      // the wake settlement instead of the stale uncertain one.
      expect(seen.map((r) => r.status)).toEqual(['completed']);
      expect(host.list().find((s) => s.activationId === handle.activationId)?.state).toBe('settled');
      await host.stop(handle.activationId);
    } finally {
      client.close();
    }
  });

  it('a genuinely failing wake records failed on every surface', async () => {
    const alive = { value: true };
    const seen: ActivationResult[] = [];
    const { host, session, messages, dbPath } = wakeHarness({
      alive,
      onWakeSettlement: (result) => { seen.push(result); },
    });
    const client = createObservabilitySqliteClientAtPath(dbPath)!;
    try {
      const handle = await host.start(dispatch);
      expect((await handle.result).status).toBe('uncertain');

      alive.value = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const fire = session.__emit;
      fire({ type: 'agent_start' });
      messages.push({ role: 'assistant', content: '', stopReason: 'error', errorMessage: 'wake bash blew up' });
      fire({ type: 'message_end', message: { role: 'assistant', stopReason: 'error', content: [] } });
      fire({ type: 'agent_end', willRetry: false });
      fire({ type: 'agent_settled' });
      await new Promise((resolve) => setTimeout(resolve, 150));

      // Failed stays failed: a failed wake is never laundered into completed.
      expect(client.readStatus(handle.activationId)?.status).toBe('error');
      const metrics = client.listJobMetrics().find((m) => m.job_id === handle.activationId);
      expect(metrics?.status).toBe('error');
      const events = client.readEvents(handle.activationId) as TimelineEvent[];
      expect(events.filter((e) => e.type === 'run_complete').at(-1))
        .toMatchObject({ status: 'ERROR' });
      expect(seen.map((r) => r.status)).toEqual(['failed']);
      expect(host.list().find((s) => s.activationId === handle.activationId)?.state).toBe('failed');
      await host.stop(handle.activationId);
    } finally {
      client.close();
    }
  });

  it('a duplicate settle with no new wake turn finalises nothing twice', async () => {
    const alive = { value: true };
    const seen: ActivationResult[] = [];
    const { host, session, messages, dbPath } = wakeHarness({
      alive,
      onWakeSettlement: (result) => { seen.push(result); },
    });
    const client = createObservabilitySqliteClientAtPath(dbPath)!;
    try {
      const handle = await host.start(dispatch);
      expect((await handle.result).status).toBe('uncertain');

      alive.value = false;
      await new Promise((resolve) => setTimeout(resolve, 50));
      const fire = session.__emit;
      fire({ type: 'agent_start' });
      const wakeText = 'wake turn done';
      messages.push({ role: 'assistant', content: wakeText, stopReason: 'stop' });
      fire({ type: 'message_end', message: { role: 'assistant', stopReason: 'stop', content: [{ type: 'text', text: wakeText }] } });
      fire({ type: 'agent_end', willRetry: false });
      fire({ type: 'agent_settled' });
      await new Promise((resolve) => setTimeout(resolve, 150));
      // Redelivered quiescence with no new turn behind it: no second terminal.
      fire({ type: 'agent_settled' });
      await new Promise((resolve) => setTimeout(resolve, 150));

      expect(seen.map((r) => r.status)).toEqual(['completed']);
      expect(runCompleteStatuses(client, handle.activationId)).toEqual(['COMPLETE', 'COMPLETE']);
      await host.stop(handle.activationId);
    } finally {
      client.close();
    }
  });
});
