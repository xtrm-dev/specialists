import { describe, expect, it, vi } from 'vitest';

const requestRender = vi.fn();
const stop = vi.fn();
let listener: ((data: string) => { consume: boolean } | undefined) | undefined;
let lastInput: { onSubmit?: (text: string) => void } | undefined;

vi.mock('@earendil-works/pi-tui', () => {
  class FakeTerminal { stop() {} }
  class FakeTUI {
    addChild() {}
    setFocus() {}
    start() { listener?.('ctrl-c'); }
    stop() {}
    requestRender(force?: boolean) { requestRender(force); }
    addInputListener(fn: (data: string) => { consume: boolean } | undefined) {
      listener = fn;
      return stop;
    }
  }
  class FakeContainer { addChild() {} }
  class FakeInput {
    onSubmit?: (text: string) => void;
    constructor() { lastInput = this; }
    setValue() {}
  }
  return {
    TUI: FakeTUI,
    ProcessTerminal: FakeTerminal,
    Container: FakeContainer,
    Input: FakeInput,
    matchesKey: (data: string, key: string) => data === key,
    Key: { ctrl: (key: string) => `ctrl-${key}` },
  };
});

const createCleanup = vi.fn(() => ({ stop: vi.fn().mockResolvedValue(undefined) }));
const formatChatShow = vi.fn(() => 'job=job-1 fifo=ready');
const startChatEventTailer = vi.fn(() => vi.fn());

vi.mock('../../../src/cli/chat.js', () => ({
  createCleanup,
  formatChatShow,
  handleSubmittedInput: vi.fn().mockResolvedValue(undefined),
  silenceStderrDuringTui: vi.fn(() => vi.fn()),
  startChatEventTailer,
}));

vi.mock('../../../src/cli/chat/feed.js', () => ({ ChatFeed: class { appendEvent() {} } }));
vi.mock('../../../src/cli/chat/status.js', () => ({ ChatStatus: class { setJobId() {} start() {} render() { return ''; } } }));
vi.mock('../../../src/cli/chat/control.js', () => ({ createChatControl: vi.fn(() => ({})) }));
vi.mock('../../../src/specialist/status-load.js', () => ({ loadStatuses: vi.fn(() => []) }));

describe('attach-tui runtime', () => {
  it('detaches on Ctrl+C and passes fifo_path to chat state', async () => {
    const { run } = await import('../../../src/cli/attach-tui.js');
    const runPromise = run({ id: 'job-1', status: 'running', specialist: 'reviewer', fifoPath: '/tmp/fifo', terminal: false });

    listener?.('ctrl-c');
    await expect(runPromise).resolves.toBeUndefined();

    expect(formatChatShow).toHaveBeenCalledWith('job-1', undefined, { status: 'running', fifo_path: '/tmp/fifo' });
    expect(startChatEventTailer).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 'job-1',
      specialist: 'reviewer',
      beadId: undefined,
    }));
    expect(createCleanup).toHaveBeenCalled();
  });

  it('uses live waiting status for submitted plain text', async () => {
    const { loadStatuses } = await import('../../../src/specialist/status-load.js');
    vi.mocked(loadStatuses).mockReturnValue([{ id: 'job-1', status: 'waiting', fifo_path: '/tmp/live-fifo' } as any]);
    const { handleSubmittedInput } = await import('../../../src/cli/chat.js');
    const { run } = await import('../../../src/cli/attach-tui.js');

    const runPromise = run({ id: 'job-1', status: 'running', specialist: 'reviewer', fifoPath: '/tmp/old-fifo', terminal: false });
    await Promise.resolve();
    lastInput?.onSubmit?.('where is runner.ts');
    await Promise.resolve();

    const call = vi.mocked(handleSubmittedInput).mock.calls.at(-1)?.[0] as any;
    expect(await call.getJobState()).toBe('waiting');
    expect(await call.getJobStatus()).toEqual({ status: 'waiting', fifo_path: '/tmp/live-fifo' });
    expect((await call.getJobState()) === 'waiting' ? 'resume' : 'steer').toBe('resume');

    listener?.('ctrl-c');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('uses live running status for submitted plain text and keeps steer route', async () => {
    const { loadStatuses } = await import('../../../src/specialist/status-load.js');
    vi.mocked(loadStatuses).mockReturnValue([{ id: 'job-1', status: 'running', fifo_path: '/tmp/live-fifo' } as any]);
    const { handleSubmittedInput } = await import('../../../src/cli/chat.js');
    const { run } = await import('../../../src/cli/attach-tui.js');

    const runPromise = run({ id: 'job-1', status: 'waiting', specialist: 'reviewer', fifoPath: '/tmp/old-fifo', terminal: false });
    await Promise.resolve();
    lastInput?.onSubmit?.('where is runner.ts');
    await Promise.resolve();

    const call = vi.mocked(handleSubmittedInput).mock.calls.at(-1)?.[0] as any;
    expect(await call.getJobState()).toBe('running');
    expect((await call.getJobState()) === 'waiting' ? 'resume' : 'steer').toBe('steer');

    listener?.('ctrl-c');
    await expect(runPromise).resolves.toBeUndefined();
  });

  it('uses live starting status for submitted plain text and keeps steer route', async () => {
    const { loadStatuses } = await import('../../../src/specialist/status-load.js');
    vi.mocked(loadStatuses).mockReturnValue([{ id: 'job-1', status: 'starting', fifo_path: '/tmp/live-fifo' } as any]);
    const { handleSubmittedInput } = await import('../../../src/cli/chat.js');
    const { run } = await import('../../../src/cli/attach-tui.js');

    const runPromise = run({ id: 'job-1', status: 'waiting', specialist: 'reviewer', fifoPath: '/tmp/old-fifo', terminal: false });
    await Promise.resolve();
    lastInput?.onSubmit?.('where is runner.ts');
    await Promise.resolve();

    const call = vi.mocked(handleSubmittedInput).mock.calls.at(-1)?.[0] as any;
    expect(await call.getJobState()).toBe('starting');
    expect((await call.getJobState()) === 'waiting' ? 'resume' : 'steer').toBe('steer');

    listener?.('ctrl-c');
    await expect(runPromise).resolves.toBeUndefined();
  });
});
