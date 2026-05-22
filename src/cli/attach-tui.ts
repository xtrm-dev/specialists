import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl, type ChatState } from './chat/control.js';
import { createCleanup, formatChatShow, handleSubmittedInput, silenceStderrDuringTui, startChatEventTailer } from './chat.js';
import type { AttachRuntimeDeps } from './attach.js';

type PiTuiModule = typeof import('@earendil-works/pi-tui');

type TuiInstance = {
  addChild(child: unknown): void;
  setFocus(component: unknown): void;
  start(): void;
  stop(): void;
  requestRender(force?: boolean): void;
  addInputListener?(listener: (data: string) => { consume: boolean } | undefined): () => void;
};

type InputInstance = {
  onSubmit?: (text: string) => void;
  setValue(value: string): void;
};

interface AttachTarget {
  id: string;
  status?: ChatState;
  specialist: string;
  beadId?: string;
  terminal: boolean;
  fifoPath?: string;
}

interface JobStatusView {
  status?: ChatState;
  fifo_path?: string;
}

const ALWAYS_READ_ONLY_MESSAGE = 'input unavailable in terminal job; /show or /quit only';

export async function run(target: AttachTarget, deps: AttachRuntimeDeps = {}): Promise<void> {
  const piTui = (await import('@earendil-works/pi-tui')) as PiTuiModule;
  const { TUI, ProcessTerminal, Container, Input, matchesKey, Key } = piTui;
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal) as TuiInstance;
  const feed = new ChatFeed();
  const statusBar = new ChatStatus(tui, { pollIntervalMs: 500 });
  statusBar.setJobId(target.id);
  const control = createChatControl({
    getJobState: async () => target.status ?? 'running',
    stopJob: async () => ({ ok: true, message: 'stop requested' }),
    finalizeJob: async () => ({ ok: true, message: 'finalize requested' }),
    appendBeadNote: async () => ({ ok: false, error_code: 'missing_notes', likely_cause: 'notes unavailable', next_safe_action: 'none' }),
  });

  const input: InputInstance = new Input();
  const root = new Container() as { addChild(child: unknown): void };
  root.addChild(feed);
  root.addChild({ render: (width: number) => [statusBar.render(width)], invalidate: () => undefined });
  if (!target.terminal) root.addChild(input);
  const cleanup = createCleanup(tui, terminal, statusBar);
  const restoreStderr = silenceStderrDuringTui();
  const stopTailer = startChatEventTailer({
    jobId: target.id,
    jobsDir: '.specialists/jobs',
    specialist: target.specialist,
    beadId: target.beadId,
    feed,
    requestRender: () => tui.requestRender(),
  });

  let detached = false;
  let resolveDetach: (() => void) | null = null;
  const detachedPromise = new Promise<void>((resolve) => {
    resolveDetach = resolve;
  });
  const requestDetach = (): void => {
    if (detached) return;
    detached = true;
    feed.appendEvent('chat', 'detaching; specialist job left running');
    tui.requestRender();
    resolveDetach?.();
  };

  const removeInputListener = typeof tui.addInputListener === 'function'
    ? tui.addInputListener((data: string) => {
      if (matchesKey && Key && matchesKey(data, Key.ctrl('c'))) {
        requestDetach();
        return { consume: true };
      }
      return undefined;
    })
    : undefined;

  input.onSubmit = (text: string) => {
    if (target.terminal && !text.trim().startsWith('/')) {
      feed.appendEvent('chat', ALWAYS_READ_ONLY_MESSAGE);
      tui.requestRender();
      return;
    }
    void handleSubmittedInput({
      text,
      getJobId: () => target.id,
      getJobState: async () => target.status ?? 'running',
      getJobStatus: async (): Promise<JobStatusView> => ({ status: target.status, fifo_path: target.fifoPath }),
      beadId: target.beadId,
      control,
      appendEvent: (type, details) => {
        feed.appendEvent(type, details);
        tui.requestRender();
      },
      requestRender: () => tui.requestRender(),
      requestExit: requestDetach,
    });
  };

  try {
    tui.addChild(root);
    tui.setFocus(input);
    statusBar.start();
    tui.start();
    feed.appendEvent('chat', formatChatShow(target.id, target.beadId, { status: target.status, fifo_path: target.fifoPath }));
    tui.requestRender(true);
    await detachedPromise;
  } finally {
    stopTailer();
    restoreStderr();
    removeInputListener?.();
    await cleanup.stop();
  }
}
