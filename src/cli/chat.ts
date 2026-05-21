import { spawnSync } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { launchSpecialist } from '../specialist/launch.js';
import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
import { loadStatuses } from '../specialist/status-load.js';
import { SpecialistLoader } from '../specialist/loader.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';

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
  let resolveExitRequest: (() => void) | null = null;
  const exitRequested = new Promise<true>((resolve) => {
    resolveExitRequest = () => resolve(true);
  });

  const appendEvent = (type: string, details: string) => {
    feed.appendEvent(type, details);
    tui.requestRender();
  };

  const restoreStderr = redirectStderrToFeed({
    append: (text) => appendEvent('stderr', text),
  });

  input.onSubmit = (text: string) => {
    input.setValue('');
    void handleSubmittedInput({
      text,
      getJobId: () => currentJobId,
      getJobState: async () => currentJobId ? await loadJobState(currentJobId) : 'running',
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
    dbg('try block enter — setting root + focus');
    tui.root = root;
    tui.setFocus(input);
    dbg('status.start()');
    status.start();
    feed.appendEvent('chat', `launching ${args.name}`);
    feed.appendEvent('chat', `context depth ${args.contextDepth}`);
    if (args.model) feed.appendEvent('chat', `model ${args.model}`);
    if (!args.beadId) feed.appendEvent('chat', `ephemeral bead ${ephemeralTitle} (${beadId})`);

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
      onProgress: (delta) => appendEvent('assistant', delta),
      onMeta: (meta) => appendEvent('chat', `${meta.backend}/${meta.model}`),
      onJobStarted: ({ id }) => {
        currentJobId = id;
        appendEvent('chat', `job started: ${id}`);
      },
    });

    const launchDone = launchPromise.then(() => {
      dbg('launchPromise resolved');
      return true;
    }).catch((error) => {
      dbg('launchPromise rejected', { error: error instanceof Error ? error.message : String(error) });
      feed.appendEvent('chat', error instanceof Error ? error.message : String(error));
      return true;
    });
    dbg('about to await tui.start()');
    await tui.start();
    dbg('tui.start() returned');
    if (!shouldExit) {
      dbg('awaiting launchDone');
      await launchDone;
      dbg('launchDone awaited');
    }
  } finally {
    dbg('finally — cleanup');
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
  const statuses = loadStatuses();
  return statuses.find((status) => status.id === jobId)?.status ?? null;
}

function formatFooterModel(backend?: string, model?: string): string {
  return model ?? backend ?? '';
}

interface SubmittedInputDeps {
  text: string;
  getJobId: () => string;
  getJobState: () => Promise<string | null>;
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

  if (action.kind === 'steer' || action.kind === 'resume') {
    deps.appendEvent('chat', `${action.kind} queued for ${jobId || 'pending job'}`);
    return;
  }

  if ('message' in action) deps.appendEvent('chat', action.message);
  else deps.appendEvent('chat', `${action.kind} requested for ${jobId || 'pending job'}`);
  deps.requestRender();
}

function redirectStderrToFeed(feed: { append(text: string): void }): () => void {
  const originalWrite = process.stderr.write.bind(process.stderr) as any;
  (process.stderr as any).write = (chunk: unknown, encoding?: BufferEncoding | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): boolean => {
    const text = Buffer.isBuffer(chunk)
      ? chunk.toString(typeof encoding === 'string' ? encoding : 'utf8')
      : String(chunk);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trimEnd();
      if (trimmed) feed.append(trimmed);
    }
    if (typeof encoding === 'function') encoding(null);
    if (typeof callback === 'function') callback(null);
    return true;
  };
  return () => {
    (process.stderr as any).write = originalWrite;
  };
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
      if (jobId) process.stderr.write(`Stopping job ${jobId}\n`);
      await this.stop();
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
