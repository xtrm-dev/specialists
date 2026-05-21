import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { launchSpecialist } from '../specialist/launch.js';
import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
import { loadStatuses } from '../specialist/status-load.js';
import { SpecialistLoader } from '../specialist/loader.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
import type { TimelineEvent } from '../specialist/timeline-events.js';
import { JobColorMap, dim, formatEventLine } from './format-helpers.js';
import { formatSpecialistModel } from '../specialist/model-display.js';

const DEFAULT_CONTEXT_DEPTH = 3;
const DEFAULT_POLL_INTERVAL_MS = 500;

// File-based debug tracing. stderr/stdout are owned by the TUI once it starts,
// so console.log/error from within chat.ts is invisible to the operator.
// Enable with: SP_CHAT_DEBUG=1 sp chat ...   (defaults log path to /tmp/sp-chat-debug.log)
// Override path with: SP_CHAT_DEBUG=/path/to/file
const DEBUG_LOG_PATH: string | null = (() => {
  const v = process.env.SP_CHAT_DEBUG;
  if (!v || v === '0' || v === 'false') return null;
  return v === '1' || v === 'true' ? '/tmp/sp-chat-debug.log' : v;
})();
if (DEBUG_LOG_PATH) {
  try { writeFileSync(DEBUG_LOG_PATH, `# sp chat debug log started ${new Date().toISOString()}\n`); } catch { /* ignore */ }
}
function dbg(msg: string, extra?: Record<string, unknown>): void {
  if (!DEBUG_LOG_PATH) return;
  const line = `${new Date().toISOString()} ${msg}${extra ? ' ' + JSON.stringify(extra) : ''}\n`;
  try { appendFileSync(DEBUG_LOG_PATH, line); } catch { /* ignore */ }
}

type PiTuiModule = typeof import('@earendil-works/pi-tui');

interface ChatArgs {
  name: string;
  prompt: string;
  beadId?: string;
  contextDepth: number;
  model?: string;
}

interface CleanupState {
  done: boolean;
}

export async function run(): Promise<void> {
  dbg('run() start', { argv: process.argv.slice(3), stdoutTTY: process.stdout.isTTY === true, stdinTTY: process.stdin.isTTY === true });
  const args = parseArgs(process.argv.slice(3));
  dbg('parsed args', { name: args.name, beadId: args.beadId, hasPrompt: !!args.prompt });
  const ephemeralTitle = args.beadId ? '' : buildEphemeralBeadTitle(args.prompt);
  const beadId = args.beadId ?? createEphemeralBead(args.prompt);
  dbg('bead resolved', { beadId, ephemeralTitle: ephemeralTitle || null });
  const loader = new SpecialistLoader();
  const specialist = await loader.get(args.name).catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
  dbg('specialist loaded', { name: args.name });

  const piTui = (await import('@earendil-works/pi-tui')) as PiTuiModule;
  dbg('pi-tui imported', { hasTUI: !!(piTui as any).TUI, hasInput: !!(piTui as any).Input, hasMatchesKey: !!(piTui as any).matchesKey });
  const { TUI, ProcessTerminal, Container, Input, matchesKey, Key } = piTui as any;

  const terminal = new ProcessTerminal();
  dbg('ProcessTerminal constructed');
  const tui = new TUI(terminal);
  dbg('TUI constructed', { hasAddInputListener: typeof tui.addInputListener === 'function', hasSetFocus: typeof tui.setFocus === 'function' });
  const feed = new ChatFeed();
  const status = new ChatStatus(tui, { pollIntervalMs: DEFAULT_POLL_INTERVAL_MS });
  const control = createChatControl({
    getJobState: async (jobId: string) => loadJobState(jobId),
    stopJob: async () => ({ ok: true, message: 'stop requested' }),
    finalizeJob: async () => ({ ok: true, message: 'finalize requested' }),
    appendBeadNote: async () => ({ ok: true, message: 'note appended' }),
  });

  const input = new Input({ placeholder: 'Type message, /quit, /stop, /finalize, /show, /notes ...' });
  const root = new Container();
  root.addChild(feed);
  root.addChild({
    render: (width: number) => [status.render(width)],
    invalidate: () => undefined,
  });
  root.addChild(input);

  const cleanup = createCleanup(tui, terminal, status);
  const signalCleanup = installSignalGuards(cleanup, input);

  let shouldExit = false;
  let currentJobId = '';
  let stopChatEventTailer: (() => void) | undefined;
  let resolveExitRequest: (() => void) | null = null;
  const exitRequested = new Promise<true>((resolve) => {
    resolveExitRequest = () => resolve(true);
  });

  const appendEvent = (type: string, details: string) => {
    feed.appendEvent(type, details);
    tui.requestRender();
  };

  const restoreStderr = silenceStderrDuringTui();

  input.onSubmit = (text: string) => {
    input.setValue('');
    void handleSubmittedInput({
      text,
      getJobId: () => currentJobId,
      getJobState: async () => currentJobId ? await loadJobState(currentJobId) : 'running',
      getJobStatus: async () => currentJobId ? await loadJobStatus(currentJobId) : null,
      beadId,
      control,
      appendEvent,
      requestRender: () => tui.requestRender(),
      requestExit: () => {
        shouldExit = true;
        resolveExitRequest?.();
      },
    });
  };
  // Single TUI-owned listener. Do NOT attach process.stdin.on('data') —
  // that flips stdin into flowing mode and breaks ProcessTerminal raw-mode
  // acquisition; the chat would render nothing and hang. pi-tui owns stdin.
  const removeInputListener = typeof tui.addInputListener === 'function'
    ? tui.addInputListener((data: string) => {
      if (matchesKey && Key && matchesKey(data, Key.ctrl('c'))) {
        void cleanup.stopJobAndExit(currentJobId);
        return { consume: true };
      }
      return undefined;
    })
    : () => undefined;

  try {
    dbg('try block enter — adding components + focus');
    tui.addChild(root);
    tui.setFocus(input);
    dbg('status.start()');
    status.start();
    dbg('about to tui.start()', { stdoutTTY: process.stdout.isTTY === true, stdinTTY: process.stdin.isTTY === true });
    tui.start();
    tui.requestRender(true);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    dbg('tui.start() returned');

    dbg('calling launchSpecialist (non-awaited)');
    const launchPromise = launchSpecialist({
      args: { name: args.name, prompt: args.prompt, model: args.model, keepAlive: true, noKeepAlive: false, forceJob: false, outputMode: 'json', background: false } as any,
      specialist,
      loader,
      hooks: (specialist as any).hooks ?? { emit: () => undefined },
      circuitBreaker: (specialist as any).circuitBreaker ?? {
        isAvailable: () => true,
        getState: () => 'CLOSED',
        recordFailure: () => undefined,
        recordSuccess: () => undefined,
      },
      prompt: buildPrompt(args),
      effectiveBeadId: beadId,
      beadsWriteNotes: true,
      perm: specialist.specialist.execution.permission_required,
      jobsDir: '.specialists/jobs',
      startEventTailer: () => undefined,
      formatFooterModel: (backend, model) => formatFooterModel(backend, model),
      onJobStarted: ({ id }) => {
        currentJobId = id;
        status.setJobId(id);
        stopChatEventTailer = startChatEventTailer({
          jobId: id,
          jobsDir: '.specialists/jobs',
          specialist: args.name,
          beadId,
          feed,
          requestRender: () => tui.requestRender(),
        });
      },
    });

    const launchDone = launchPromise.then(() => {
      dbg('launchPromise resolved');
      return true;
    }).catch((error) => {
      dbg('launchPromise rejected', { error: error instanceof Error ? error.message : String(error) });
      appendEvent('chat', error instanceof Error ? error.message : String(error));
      return true;
    });
    if (!shouldExit) {
      dbg('awaiting launchDone or exit request');
      await Promise.race([launchDone, exitRequested]);
      dbg('launchDone/exit request settled');
    }
  } finally {
    dbg('finally — cleanup');
    stopChatEventTailer?.();
    restoreStderr();
    removeInputListener?.();
    signalCleanup();
    await cleanup.stop();
    dbg('cleanup done — exiting run()');
  }
}

function parseArgs(argv: string[]): ChatArgs {
  const name = argv[0];
  if (!name) throw new Error('Usage: sp chat <specialist> [prompt...] [--bead <id>] [--prompt <text>] [--context-depth N] [--model M]');

  let beadId: string | undefined;
  let contextDepth = DEFAULT_CONTEXT_DEPTH;
  let model: string | undefined;
  const promptParts: string[] = [];

  for (let i = 1; i < argv.length; i++) {
    const token = argv[i];
    if (token === '--bead') beadId = argv[++i] ?? '';
    else if (token === '--prompt') promptParts.push(argv[++i] ?? '');
    else if (token === '--context-depth') contextDepth = Number(argv[++i] ?? DEFAULT_CONTEXT_DEPTH);
    else if (token === '--model') model = argv[++i];
    else if (!token.startsWith('--')) promptParts.push(token);
  }

  const prompt = promptParts.join(' ').trim();
  if (!beadId && !prompt) throw new Error('Usage: sp chat <specialist> [prompt...] [--bead <id>] [--prompt <text>] [--context-depth N] [--model M]');
  return { name, prompt, beadId, contextDepth, model };
}

function buildPrompt(args: ChatArgs): string {
  return [args.prompt, args.contextDepth ? `\n(context-depth: ${args.contextDepth})` : ''].join('').trim();
}

function createEphemeralBead(prompt: string): string {
  const title = buildEphemeralBeadTitle(prompt);
  const result = spawnSync('bd', ['create', title, '-t', 'task', '-p3', '--json'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.status !== 0) {
    const error = result.stderr?.trim() || result.stdout?.trim() || `bd create failed with exit code ${result.status}`;
    throw new Error(`Error: unable to auto-create chat bead: ${error}`);
  }
  const parsed = JSON.parse(result.stdout.trim()) as { id?: string } | Array<{ id?: string }>;
  const beadId = Array.isArray(parsed) ? parsed[0]?.id : parsed.id;
  if (!beadId) throw new Error('Error: bd create returned no bead id for chat prompt');
  return beadId;
}

function buildEphemeralBeadTitle(prompt: string): string {
  const firstLine = prompt.split('\n', 1)[0]?.trim() ?? '';
  const normalized = firstLine.replace(/\s+/g, ' ');
  return (normalized || 'sp chat ephemeral').slice(0, 60);
}

async function loadJobState(jobId: string) {
  return (await loadJobStatus(jobId))?.status ?? null;
}

async function loadJobStatus(jobId: string) {
  const statuses = loadStatuses();
  return statuses.find((status) => status.id === jobId) ?? null;
}

function formatFooterModel(backend?: string, model?: string): string {
  return model ?? backend ?? '';
}

interface ChatEventTailerOptions {
  jobId: string;
  jobsDir: string;
  specialist: string;
  beadId?: string;
  feed: ChatFeed;
  requestRender: () => void;
}

function startChatEventTailer(options: ChatEventTailerOptions): () => void {
  const eventsPath = `${options.jobsDir}/${options.jobId}/events.jsonl`;
  const sqliteClient = createObservabilitySqliteClient(process.cwd());
  const colorize = new JobColorMap().get(options.jobId);
  let linesRead = 0;
  let lastSeq = 0;
  let model: string | undefined;
  let contextPct: number | undefined;
  const lastPrintedEventKey = new Map<string, string>();
  const seenMetaKey = new Map<string, string>();

  const appendLine = (line: string) => {
    options.feed.appendResult(line);
    options.requestRender();
  };

  const readFileEvents = (): TimelineEvent[] => {
    let content = '';
    try { content = readFileSync(eventsPath, 'utf8'); } catch { return []; }
    if (!content) return [];
    const lastNewline = content.lastIndexOf('\n');
    if (lastNewline < 0) return [];
    const lines = content.slice(0, lastNewline).split('\n');
    const events: TimelineEvent[] = [];
    for (let index = linesRead; index < lines.length; index += 1) {
      linesRead += 1;
      const raw = lines[index]?.trim();
      if (!raw) continue;
      try { events.push(JSON.parse(raw) as TimelineEvent); } catch { /* ignore malformed */ }
    }
    return events;
  };

  const readEvents = (): TimelineEvent[] => {
    if (sqliteClient) {
      const events = sqliteClient.readEventsAfterSeq(options.jobId, lastSeq);
      for (const event of events) {
        if (typeof event.seq === 'number') lastSeq = Math.max(lastSeq, event.seq);
      }
      return events;
    }
    return readFileEvents();
  };

  const drain = () => {
    const status = readChatJobStatus(options.jobsDir, options.jobId);
    model = status.model ?? model;
    contextPct = status.contextPct ?? contextPct;

    for (const event of readEvents()) {
      if (event.type === 'turn' && event.phase === 'start') {
        lastPrintedEventKey.delete(options.jobId);
      }
      if (!shouldRenderChatFeedEvent(event)) continue;
      if (shouldSkipChatFeedEvent(event, options.jobId, lastPrintedEventKey, seenMetaKey)) continue;
      if (event.type === 'meta') model = event.model;
      if (event.type === 'run_complete') model = event.model ?? model;

      appendLine(formatEventLine(event, {
        jobId: options.jobId,
        specialist: formatSpecialistModel(options.specialist, model),
        beadId: options.beadId,
        contextPct,
        colorize,
      }));

      const contextLine = formatChatStartupContextLine(event);
      if (contextLine) appendLine(contextLine);
      if (event.type === 'run_complete' && event.output) appendLine(event.output);
    }
  };

  const interval = setInterval(drain, 100);
  return () => {
    clearInterval(interval);
    drain();
    sqliteClient?.close();
  };
}

function shouldRenderChatFeedEvent(event: TimelineEvent): boolean {
  if (event.type === 'message' || event.type === 'turn') return false;
  if (event.type === 'tool') {
    if (event.phase === 'update') return false;
    if (event.phase === 'end' && !event.is_error) return false;
  }
  return true;
}


function shouldSkipChatFeedEvent(
  event: TimelineEvent,
  jobId: string,
  lastPrintedEventKey: Map<string, string>,
  seenMetaKey: Map<string, string>,
): boolean {
  if (event.type === 'meta') {
    const metaKey = `${event.backend}:${event.model}`;
    if (seenMetaKey.get(jobId) === metaKey) return true;
    seenMetaKey.set(jobId, metaKey);
  }

  if (event.type === 'tool') return false;

  const key = getChatFeedEventKey(event);
  if (lastPrintedEventKey.get(jobId) === key) return true;
  lastPrintedEventKey.set(jobId, key);
  return false;
}

function getChatFeedEventKey(event: TimelineEvent): string {
  switch (event.type) {
    case 'meta':
      return `meta:${event.backend}:${event.model}`;
    case 'tool':
      return `tool:${event.tool}:${event.phase}:${event.tool_call_id ?? event.t}`;
    case 'text':
      return 'text';
    case 'thinking':
      return 'thinking';
    case 'message':
      return `message:${event.role}:${event.phase}`;
    case 'turn':
      return `turn:${event.phase}`;
    case 'status_change':
      return `status_change:${event.previous_status ?? ''}:${event.status}`;
    case 'run_start':
      return `run_start:${event.specialist}:${event.bead_id ?? ''}`;
    case 'run_complete':
      return `run_complete:${event.status}:${event.error ?? ''}`;
    case 'error':
      return `error:${event.source}:${event.error_message}`;
    case 'token_usage':
      return `token_usage:${event.token_usage.total_tokens ?? ''}:${event.source}`;
    case 'finish_reason':
      return `finish_reason:${event.finish_reason}:${event.source}`;
    case 'turn_summary':
      return `turn_summary:${event.turn_index}`;
    case 'compaction':
    case 'retry':
      return `${event.type}:${event.phase}`;
    default:
      return (event as { type?: string }).type ?? 'unknown';
  }
}

function formatChatStartupContextLine(event: TimelineEvent): string | null {
  if (event.type === 'run_start') {
    const snapshot = event.startup_snapshot;
    if (!snapshot) return null;
    const parts: string[] = [];
    if (snapshot.job_id) parts.push(`job=${snapshot.job_id}`);
    if (snapshot.specialist_name) parts.push(`specialist=${snapshot.specialist_name}`);
    if (snapshot.bead_id) parts.push(`bead=${snapshot.bead_id}`);
    if (snapshot.reused_from_job_id) parts.push(`reused=${snapshot.reused_from_job_id}`);
    if (snapshot.worktree_owner_job_id) parts.push(`owner=${snapshot.worktree_owner_job_id}`);
    if (snapshot.chain_id) parts.push(`chain=${snapshot.chain_id}`);
    if (snapshot.chain_root_job_id) parts.push(`chain_root_job=${snapshot.chain_root_job_id}`);
    if (snapshot.chain_root_bead_id) parts.push(`chain_root_bead=${snapshot.chain_root_bead_id}`);
    if (snapshot.worktree_path) parts.push(`worktree=${snapshot.worktree_path}`);
    if (snapshot.branch) parts.push(`branch=${snapshot.branch}`);
    if (snapshot.variables_keys) parts.push(`vars=[${snapshot.variables_keys.join(',')}]`);
    if (snapshot.reviewed_job_id_present !== undefined) parts.push(`reviewed_present=${snapshot.reviewed_job_id_present}`);
    if (snapshot.reused_worktree_awareness_present !== undefined) parts.push(`reuse_awareness_present=${snapshot.reused_worktree_awareness_present}`);
    if (snapshot.bead_context_present !== undefined) parts.push(`bead_context_present=${snapshot.bead_context_present}`);
    if (snapshot.skills) parts.push(`skills=${snapshot.skills.count}`);
    return parts.length > 0 ? dim(`  ↳ startup ${parts.join(' ')}`) : null;
  }

  if (event.type === 'payload_breakdown') {
    const payload = event.payload_breakdown;
    const totals = payload?.totals;
    if (!totals) return null;
    const components = (payload.components ?? []).filter((component) => Number.isFinite(component.tokens) && component.tokens > 0);
    return dim(`  ↳ payload: ${(totals.bytes / 1024).toFixed(1)}kb · ${(totals.tokens / 1000).toFixed(1)}kt across ${components.length} components`);
  }

  if (event.type === 'meta' && event.source === 'mandatory_rules_injection' && event.data) {
    const data = event.data as { sets_loaded?: string[]; rules_count?: number; token_estimate?: number };
    return dim(`  ↳ mandatory_rules sets=${(data.sets_loaded ?? []).join(',') || 'none'} rules=${data.rules_count ?? 0} tokens=~${data.token_estimate ?? 0}`);
  }

  if (event.type === 'meta' && event.memory_injection) {
    const mem = event.memory_injection;
    return dim(`  ↳ memory static=${mem.static_tokens} dynamic=${mem.memory_tokens} gitnexus=${mem.gitnexus_tokens} total=${mem.total_tokens}`);
  }

  return null;
}

function readChatJobStatus(jobsDir: string, jobId: string): { model?: string; contextPct?: number } {
  try {
    const status = JSON.parse(readFileSync(`${jobsDir}/${jobId}/status.json`, 'utf8')) as {
      model?: string;
      metrics?: { context_pct?: number };
    };
    return { model: status.model, contextPct: status.metrics?.context_pct };
  } catch {
    return {};
  }
}

function silenceStderrDuringTui(): () => void {
  const originalWrite = process.stderr.write.bind(process.stderr) as any;
  (process.stderr as any).write = (_chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    if (typeof encoding === 'function') encoding(null);
    if (typeof callback === 'function') callback(null);
    return true;
  };
  return () => {
    (process.stderr as any).write = originalWrite;
  };
}

interface SubmittedInputDeps {
  text: string;
  getJobId: () => string;
  getJobState: () => Promise<string | null>;
  getJobStatus: () => Promise<{ fifo_path?: string; status?: string } | null>;
  beadId?: string;
  control: ReturnType<typeof createChatControl>;
  appendEvent: (type: string, details: string) => void;
  requestRender: () => void;
  requestExit: () => void;
}

async function handleSubmittedInput(deps: SubmittedInputDeps): Promise<void> {
  deps.appendEvent('user', deps.text);
  const jobId = deps.getJobId();
  const jobState = (await deps.getJobState()) ?? 'running';
  const action = deps.control.dispatchInput(deps.text, { jobState: jobState as any });

  if (action.kind === 'quit') {
    deps.appendEvent('chat', 'detaching; specialist job left running');
    deps.requestExit();
    return;
  }

  if (!jobId && action.kind !== 'info' && action.kind !== 'error') {
    deps.appendEvent('chat', 'job not ready yet; try again after job started');
    return;
  }

  if (action.kind === 'steer' || action.kind === 'resume') {
    await sendChatJobMessage(deps, action.kind, action.text);
    return;
  }

  if (action.kind === 'stop') {
    await runChatControlAction(deps, async () => {
      const { stopJob } = await import('../specialist/control.js');
      await stopJob(jobId, { jobsDir: '.specialists/jobs' });
      return 'stop sent';
    });
    return;
  }

  if (action.kind === 'finalize') {
    await runChatControlAction(deps, async () => {
      const { finalizeJob } = await import('../specialist/control.js');
      await finalizeJob(jobId, { jobsDir: '.specialists/jobs' });
      return 'finalize sent';
    });
    return;
  }

  if (action.kind === 'notes') {
    await runChatControlAction(deps, async () => {
      if (!deps.beadId) throw new Error('bead id missing');
      const { appendBeadNote } = await import('../specialist/bead-notes.js');
      const result = await appendBeadNote(deps.beadId, action.text, { timeoutMs: 5000 });
      if (!result.ok) throw new Error(result.error ?? 'append note failed');
      return 'note appended';
    });
    return;
  }

  if ('message' in action) deps.appendEvent('chat', action.message);
  else deps.appendEvent('chat', `${action.kind} requested for ${jobId || 'pending job'}`);
  deps.requestRender();
}

async function sendChatJobMessage(deps: SubmittedInputDeps, type: 'steer' | 'resume', text: string): Promise<void> {
  await runChatControlAction(deps, async () => {
    const status = await deps.getJobStatus();
    if (!status?.fifo_path) throw new Error(`Job ${deps.getJobId()} has no steer pipe`);
    const payload = type === 'resume'
      ? { type: 'resume', task: text }
      : { type: 'steer', message: text };
    writeFileSync(status.fifo_path, `${JSON.stringify(payload)}\n`, { flag: 'a' });
    return `${type} sent to ${deps.getJobId()}`;
  });
}

async function runChatControlAction(deps: SubmittedInputDeps, action: () => Promise<string>): Promise<void> {
  try {
    deps.appendEvent('chat', await action());
  } catch (error) {
    deps.appendEvent('chat', `error: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    deps.requestRender();
  }
}

function createCleanup(tui: any, terminal: any, status: ChatStatus) {
  const state: CleanupState = { done: false };
  return {
    async stop(): Promise<void> {
      if (state.done) return;
      state.done = true;
      status.stop();
      try { tui.stop(); } catch {}
      try { terminal.stop(); } catch {}
    },
    async stopJobAndExit(jobId: string): Promise<void> {
      await this.stop();
      if (jobId) {
        process.stderr.write(`Stopping job ${jobId}\n`);
        const { stopJob } = await import('../specialist/control.js');
        await stopJob(jobId, { jobsDir: '.specialists/jobs' }).catch((error: unknown) => {
          process.stderr.write(`[chat] stop failed: ${error instanceof Error ? error.message : String(error)}\n`);
        });
      }
      process.exit(0);
    },
  };
}

function installSignalGuards(cleanup: { stop(): Promise<void> }, input: any): () => void {
  const handle = async (reason: string, error?: unknown) => {
    try { input?.drainInput?.(); } catch {}
    try { await cleanup.stop(); } catch {}
    if (error) process.stderr.write(`[chat] ${reason}: ${error instanceof Error ? error.message : String(error)}\n`);
  };

  const onSigterm = () => void handle('SIGTERM').finally(() => process.exit(0));
  const onSighup = () => void handle('SIGHUP').finally(() => process.exit(0));
  const onUnhandled = (error: unknown) => void handle('unhandledRejection', error).finally(() => process.exit(1));
  const onUncaught = (error: unknown) => void handle('uncaughtException', error).finally(() => process.exit(1));

  process.once('SIGTERM', onSigterm);
  process.once('SIGHUP', onSighup);
  process.once('unhandledRejection', onUnhandled);
  process.once('uncaughtException', onUncaught);

  return () => {
    process.off('SIGTERM', onSigterm);
    process.off('SIGHUP', onSighup);
    process.off('unhandledRejection', onUnhandled);
    process.off('uncaughtException', onUncaught);
  };
}
