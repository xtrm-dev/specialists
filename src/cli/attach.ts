import readline from 'node:readline';
import { loadStatuses } from '../specialist/status-load.js';
import type { ChatState } from './chat/control.js';

interface JobStatus {
  status?: ChatState;
  bead_id?: string;
  specialist?: string;
  fifo_path?: string;
}

interface AttachTarget {
  id: string;
  status: JobStatus['status'];
  specialist: string;
  beadId?: string;
  fifoPath?: string;
  terminal: boolean;
}

export interface AttachRuntimeDeps {
  runTui?: (target: AttachTarget) => Promise<void>;
}

function exitWithError(message: string): never {
  console.error(message);
  process.exit(1);
}

function isTerminalStatus(status?: string): boolean {
  return status === 'done' || status === 'error' || status === 'cancelled' || status === 'stopped';
}

function toTarget(status: { id: string; status: ChatState; specialist?: string; bead_id?: string; fifo_path?: string }): AttachTarget {
  return {
    id: status.id,
    status: status.status,
    specialist: status.specialist ?? 'job',
    beadId: status.bead_id,
    fifoPath: status.fifo_path,
    terminal: isTerminalStatus(status.status),
  };
}

function loadTarget(jobId: string): AttachTarget {
  const status = loadStatuses().find((item) => item.id === jobId);
  if (!status) exitWithError(`Job \`${jobId}\` not found. Run \`specialists status\` to see active jobs in current mode.`);
  if (isTerminalStatus(status.status)) exitWithError(`Job \`${jobId}\` is terminal. Attach only supports running, waiting, starting jobs.`);
  return toTarget(status);
}

function loadTargets(): AttachTarget[] {
  return loadStatuses()
    .map(toTarget)
    .filter((target) => !target.terminal)
    .sort((left, right) => priorityOf(left.status) - priorityOf(right.status) || left.id.localeCompare(right.id));
}

function priorityOf(status?: string): number {
  if (status === 'running') return 0;
  if (status === 'waiting') return 1;
  if (status === 'starting') return 2;
  return 3;
}

function formatChoice(target: AttachTarget): string {
  return `${target.id}  ${target.specialist}  ${target.status}`;
}

function renderPicker(targets: readonly AttachTarget[], selectedIndex: number): string[] {
  return [
    '',
    'Attach job (↑/↓, Enter to select, Ctrl+C to cancel)',
    '',
    ...targets.map((target, index) => `${index === selectedIndex ? '❯' : ' '} ${formatChoice(target)}`),
    '',
  ];
}

function pickTarget(targets: readonly AttachTarget[]): Promise<AttachTarget> {
  return new Promise((resolve) => {
    const input = process.stdin;
    const output = process.stdout;
    const wasRawMode = input.isTTY ? Boolean(input.isRaw) : false;
    let selectedIndex = 0;
    let renderedLineCount = 0;

    const render = (): void => {
      if (renderedLineCount > 0) {
        readline.moveCursor(output, 0, -renderedLineCount);
        readline.clearScreenDown(output);
      }
      const lines = renderPicker(targets, selectedIndex);
      output.write(lines.join('\n'));
      renderedLineCount = lines.length;
    };

    const cleanup = (): void => {
      input.off('keypress', onKeypress);
      if (input.isTTY && !wasRawMode && typeof input.setRawMode === 'function') {
        input.setRawMode(false);
      }
      output.write('\x1B[?25h');
      if (renderedLineCount > 0) {
        readline.moveCursor(output, 0, -renderedLineCount);
        readline.clearScreenDown(output);
      }
    };

    const choose = (index: number): void => {
      cleanup();
      resolve(targets[index]!);
    };

    const onKeypress = (value: string, key: readline.Key): void => {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        process.exit(130);
      }

      if (key.name === 'up') {
        selectedIndex = (selectedIndex - 1 + targets.length) % targets.length;
        render();
        return;
      }

      if (key.name === 'down') {
        selectedIndex = (selectedIndex + 1) % targets.length;
        render();
        return;
      }

      if (key.name === 'return') {
        choose(selectedIndex);
        return;
      }

      const choice = Number(value);
      if (Number.isInteger(choice) && choice >= 1 && choice <= targets.length) {
        choose(choice - 1);
      }
    };

    readline.emitKeypressEvents(input);
    if (input.isTTY && !wasRawMode && typeof input.setRawMode === 'function') {
      input.setRawMode(true);
    }
    output.write('\x1B[?25l');
    input.on('keypress', onKeypress);
    render();
  });
}

export async function run(deps: AttachRuntimeDeps = {}): Promise<void> {
  const [jobId] = process.argv.slice(3);
  if (!jobId) {
    if (!process.stdout.isTTY || !process.stdin.isTTY) exitWithError('Usage: specialists attach <job-id>');
    const targets = loadTargets();
    if (targets.length === 0) exitWithError('No jobs found. Run `specialists status` to see active jobs in current mode.');
    return attachTarget(await pickTarget(targets), deps);
  }

  if (!process.stdout.isTTY || !process.stdin.isTTY) exitWithError('Usage: specialists attach <job-id>');
  return attachTarget(loadTarget(jobId), deps);
}

async function attachTarget(target: AttachTarget, deps: AttachRuntimeDeps): Promise<void> {
  const runTui = deps.runTui ?? (async (resolvedTarget: AttachTarget) => {
    const { run } = await import('./attach-tui.js');
    return run(resolvedTarget, deps);
  });
  return runTui(target);
}
