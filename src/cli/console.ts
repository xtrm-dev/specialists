import { Container, ProcessTerminal, TuiMainScreen } from '@earendil-works/pi-tui';
import { ConsoleApp } from './console/components.js';
import { createRuntimeClient } from './console/runtime.js';

export async function run(): Promise<void> {
  const terminal = new ProcessTerminal();
  // pi-tui 1.x replaced the concrete `TUI` class with two implementations; this console renders
  // into the main screen and scrollback, which is TuiMainScreen's mode.
  const tui = new TuiMainScreen(terminal);
  const root = new Container();
  let resolveExit: (() => void) | null = null;
  const exit = new Promise<void>((resolve) => { resolveExit = resolve; });

  const app = new ConsoleApp({
    runtime: createRuntimeClient(process.cwd()),
    requestRender: () => tui.requestRender(),
    rows: () => terminal.rows,
    stop: () => resolveExit?.(),
  });

  const stop = async (): Promise<void> => {
    app.stop();
    tui.stop();
    await terminal.drainInput(250, 25).catch(() => undefined);
  };

  process.once('SIGINT', () => resolveExit?.());
  process.once('SIGTERM', () => resolveExit?.());

  try {
    root.addChild(app);
    tui.addChild(root);
    tui.setFocus(app);
    tui.start();
    await app.start();
    tui.requestRender(true);
    await exit;
  } finally {
    await stop();
  }
}
