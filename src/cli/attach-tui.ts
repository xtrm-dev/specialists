import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
import { createCleanup, formatChatShow, handleSubmittedInput, silenceStderrDuringTui, startChatEventTailer } from './chat.js';

interface AttachTarget {
  id: string;
  status?: string;
  specialist: string;
  beadId?: string;
  terminal: boolean;
}

export async function run(target: AttachTarget): Promise<void> {
  const piTui = await import('@earendil-works/pi-tui');
  const { TUI, ProcessTerminal, Container, Input, matchesKey, Key } = piTui as any;
  const terminal = new ProcessTerminal();
  const tui = new TUI(terminal);
  const feed = new ChatFeed();
  const statusBar = new ChatStatus(tui, { pollIntervalMs: 500 });
  statusBar.setJobId(target.id);
  const control = createChatControl({
    getJobState: async () => target.status as any,
    stopJob: async () => ({ ok: true, message: 'stop requested' }),
    finalizeJob: async () => ({ ok: true, message: 'finalize requested' }),
    appendBeadNote: async () => ({ ok: false, error_code: 'missing_notes', likely_cause: 'notes unavailable', next_safe_action: 'none' }),
  });

  const input = new Input({ placeholder: target.terminal ? 'Read-only attach; input unavailable for terminal job' : 'Type message, /quit, /stop, /finalize, /show' });
  const root = new Container();
  root.addChild(feed);
  root.addChild({ render: (width: number) => [statusBar.render(width)], invalidate: () => undefined });
  if (!target.terminal) root.addChild(input);
  const cleanup = createCleanup(tui, terminal, statusBar);
  const restoreStderr = silenceStderrDuringTui();
  const removeInputListener = typeof tui.addInputListener === 'function'
    ? tui.addInputListener((data: string) => {
      if (matchesKey && Key && matchesKey(data, Key.ctrl('c'))) {
        feed.appendEvent('chat', 'detaching; specialist job left running');
        tui.requestRender();
        return { consume: true };
      }
      return undefined;
    })
    : () => undefined;

  input.onSubmit = (text: string) => {
    if (target.terminal && !text.trim().startsWith('/')) {
      feed.appendEvent('chat', 'input unavailable in terminal job; /show or /quit only');
      tui.requestRender();
      return;
    }
    void handleSubmittedInput({
      text,
      getJobId: () => target.id,
      getJobState: async () => target.status as any,
      getJobStatus: async () => ({ status: target.status }),
      beadId: target.beadId,
      control,
      appendEvent: (type, details) => {
        feed.appendEvent(type, details);
        tui.requestRender();
      },
      requestRender: () => tui.requestRender(),
      requestExit: () => process.exit(0),
    });
  };

  const stopTailer = startChatEventTailer({ jobId: target.id, jobsDir: '.specialists/jobs', specialist: target.specialist, beadId: target.beadId, feed, requestRender: () => tui.requestRender() });

  try {
    tui.addChild(root);
    tui.setFocus(input);
    statusBar.start();
    tui.start();
    feed.appendEvent('chat', formatChatShow(target.id, target.beadId, { status: target.status }));
    tui.requestRender(true);
    await new Promise<void>(() => undefined);
  } finally {
    stopTailer();
    restoreStderr();
    removeInputListener?.();
    await cleanup.stop();
  }
}
