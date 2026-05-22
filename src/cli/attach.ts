import { readFileSync } from 'node:fs';
import { loadStatuses } from '../specialist/status-load.js';
import { ChatFeed } from './chat/feed.js';
import { ChatStatus } from './chat/status.js';
import { createChatControl } from './chat/control.js';
import { createCleanup, formatChatShow, handleSubmittedInput, silenceStderrDuringTui, startChatEventTailer } from './chat.js';

interface JobStatus {
  status?: string;
  bead_id?: string;
  specialist?: string;
  fifo_path?: string;
}

interface AttachTarget {
  id: string;
  status: JobStatus['status'];
  specialist: string;
  beadId?: string;
  terminal: boolean;
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}


function resolveAttachTarget(jobId: string): AttachTarget {
  const status = loadStatuses().find((item) => item.id === jobId);
  if (!status) exitWithError(`Job \`${jobId}\` not found. Run \`specialists status\` to see active jobs in current mode.`);
  return {
    id: status.id,
    status: status.status,
    specialist: status.specialist ?? 'job',
    beadId: status.bead_id,
    terminal: status.status === 'done' || status.status === 'error' || status.status === 'cancelled',
  };
}

function statusesForTarget(jobId: string): JobStatus {
  const status = loadStatuses().find((item) => item.id === jobId);
  if (!status) exitWithError(`Job \`${jobId}\` not found. Run \`specialists status\` to see active jobs in current mode.`);
  return status;
}

function resolveAttachTargets(): AttachTarget[] {
  return loadStatuses()
    .map((status) => ({
      id: status.id,
      status: status.status,
      specialist: status.specialist ?? 'job',
      beadId: status.bead_id,
      terminal: status.status === 'done' || status.status === 'error' || status.status === 'cancelled',
    }))
    .sort((left, right) => priorityOf(left.status) - priorityOf(right.status) || left.id.localeCompare(right.id));
}

function priorityOf(status?: string): number {
  if (status === 'running') return 0;
  if (status === 'waiting') return 1;
  if (status === 'starting') return 2;
  if (status === 'done') return 3;
  if (status === 'error') return 4;
  if (status === 'cancelled') return 5;
  return 6;
}

function pickAttachTarget(targets: AttachTarget[]): AttachTarget {
  process.stdout.write(['', 'Attach job:', ...targets.map((target, index) => `  ${index + 1}. ${target.id}  ${target.specialist}  ${target.status}`), ''].join('\n'));
  process.stdout.write('Select job number: ');
  const answer = readFileSync(0, 'utf8').trim();
  const choice = Number(answer);
  if (!Number.isInteger(choice) || choice < 1 || choice > targets.length) exitWithError('Invalid selection.');
  return targets[choice - 1]!;
}

export async function run(): Promise<void> {
  const [jobId] = process.argv.slice(3);
  if (!jobId) {
    if (!process.stdout.isTTY) exitWithError('Usage: specialists attach <job-id>');
    const targets = resolveAttachTargets();
    if (targets.length === 0) exitWithError('No jobs found. Run `specialists status` to see active jobs in current mode.');
    const target = pickAttachTarget(targets);
    return attachJob(target);
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    exitWithError('Usage: specialists attach <job-id>');
  }

  return attachJob(resolveAttachTarget(jobId));
}

async function attachJob(target: AttachTarget): Promise<void> {
  if (process.stdout.isTTY && process.stdin.isTTY) {
    return runAttachTui(target);
  }

  exitWithError('Usage: specialists attach <job-id>');
}

async function runAttachTui(target: AttachTarget): Promise<void> {
  const status = statusesForTarget(target.id);
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
      getJobStatus: async () => status,
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
    feed.appendEvent('chat', formatChatShow(target.id, target.beadId, status));
    tui.requestRender(true);
    await new Promise<void>(() => undefined);
  } finally {
    stopTailer();
    restoreStderr();
    removeInputListener?.();
    await cleanup.stop();
  }
}
