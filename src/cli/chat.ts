import { spawnSync } from 'node:child_process';
import { launchSpecialist } from '../specialist/launch.js';
import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
import { loadStatuses } from '../specialist/status-load.js';
import { SpecialistLoader } from '../specialist/loader.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';

const DEFAULT_CONTEXT_DEPTH = 3;
const DEFAULT_POLL_INTERVAL_MS = 500;

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
  const args = parseArgs(process.argv.slice(3));
  const ephemeralTitle = args.beadId ? '' : buildEphemeralBeadTitle(args.prompt);
  const beadId = args.beadId ?? createEphemeralBead(args.prompt);
  const loader = new SpecialistLoader();
  const specialist = await loader.get(args.name).catch((error: unknown) => {
    process.stderr.write(`Error: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });

  const piTui = (await import('@earendil-works/pi-tui')) as PiTuiModule;
  const { TUI, ProcessTerminal, Container, Input, addInputListener } = piTui as any;

  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const feed = new ChatFeed();
  const status = new ChatStatus(tui, { pollIntervalMs: DEFAULT_POLL_INTERVAL_MS });
  const control = createChatControl({
    getJobState: async (jobId: string) => loadJobState(jobId),
    stopJob: async () => ({ ok: true, message: 'stop requested' }),
    finalizeJob: async () => ({ ok: true, message: 'finalize requested' }),
    appendBeadNote: async () => ({ ok: true, message: 'note appended' }),
  });

  const input = new Input({ placeholder: 'Type message, /quit, /stop, /finalize, /show, /notes ...' });
  const root = new Container({
    direction: 'column',
    children: [feed, status, input],
  });

  const cleanup = createCleanup(tui, terminal, status);
  const signalCleanup = installSignalGuards(cleanup, input);
  const onStdinData = (data: Buffer) => {
    if (data.toString('utf8') !== '\u0003') return;
    void cleanup.stopJobAndExit(beadId);
  };
  process.stdin.on('data', onStdinData);

  let shouldExit = false;
  const removeInputListener = typeof addInputListener === 'function'
    ? addInputListener(async (text: string) => {
      const action = control.dispatchInput(text, { jobState: 'running' as any });
      if (action.kind === 'quit') {
        shouldExit = true;
        await cleanup.stop();
      }
      feed.appendEvent('user', text);
    })
    : () => undefined;

  try {
    tui.root = root;
    status.start();
    feed.appendEvent('chat', `launching ${args.name}`);
    feed.appendEvent('chat', `context depth ${args.contextDepth}`);
    if (args.model) feed.appendEvent('chat', `model ${args.model}`);
    if (!args.beadId) feed.appendEvent('chat', `ephemeral bead ${ephemeralTitle} (${beadId})`);

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
      beadsWriteNotes: true,
      perm: specialist.specialist.execution.permission_required,
      jobsDir: '.specialists/jobs',
      startEventTailer: () => undefined,
      formatFooterModel: (backend, model) => formatFooterModel(backend, model),
      onProgress: (delta) => feed.appendEvent('assistant', delta),
      onMeta: (meta) => feed.appendEvent('chat', `${meta.backend}/${meta.model}`),
      onJobStarted: ({ id }) => feed.appendEvent('chat', `job started: ${id}`),
    });

    const launchDone = launchPromise.then(() => true).catch((error) => {
      feed.appendEvent('chat', error instanceof Error ? error.message : String(error));
      return true;
    });
    await tui.start();
    if (!shouldExit) await launchDone;
  } finally {
    removeInputListener?.();
    process.stdin.off('data', onStdinData);
    signalCleanup();
    await cleanup.stop();
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
