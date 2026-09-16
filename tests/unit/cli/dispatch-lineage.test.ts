// Step 0 inventory codified (unitAI-vc7tl): of the three dispatch surfaces,
// only the legacy CLI creates a tmux pane.
//
//   (a) pi subagents extension (config/pi-extensions/specialist-subagents/index.mjs)
//       dispatches onto the in-process NativeActivationHost — the file header
//       states it never spawns a process, so there is no child pane to stamp.
//   (b) claude plugin (plugins/specialists/scripts/mcp-server.mjs) only resolves
//       and imports the in-process runtime (dist MCP stdio server, same
//       NativeActivationHost) — again, no child pane.
//   (c) legacy CLI (`sp run --background`) is the sole pane creator, via
//       createTmuxSession in src/cli/tmux-utils.ts, which stamps the parent
//       edge from the dispatching pane's runtime origin.
//
// These assertions guard the inventory: if (a) or (b) ever gains tmux pane
// creation, this test fails loudly and the new pane must stamp
// @agent_parent_session / @agent_parent_pane like (c) does.
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..', '..');

const PI_EXTENSION = join(REPO_ROOT, 'config', 'pi-extensions', 'specialist-subagents', 'index.mjs');
const CLAUDE_PLUGIN_SERVER = join(REPO_ROOT, 'plugins', 'specialists', 'scripts', 'mcp-server.mjs');

// Markers that prove a module creates a tmux pane (and would therefore own a
// pane that needs the parent edge stamped on it).
const PANE_CREATION_MARKERS = ['new-session', 'new_session', 'split-window', 'split_window'];

function createsTmuxPane(source: string): string[] {
  return PANE_CREATION_MARKERS.filter((marker) => source.includes(marker));
}

describe('dispatch surface inventory (unitAI-vc7tl)', () => {
  it('pi subagents extension creates no tmux pane (in-process dispatch only)', () => {
    const source = readFileSync(PI_EXTENSION, 'utf-8');
    expect(createsTmuxPane(source)).toEqual([]);
  });

  it('claude plugin server creates no tmux pane (imports in-process runtime only)', () => {
    const source = readFileSync(CLAUDE_PLUGIN_SERVER, 'utf-8');
    expect(createsTmuxPane(source)).toEqual([]);
  });

  it('legacy CLI remains the sole pane creator', () => {
    const source = readFileSync(join(REPO_ROOT, 'src', 'cli', 'tmux-utils.ts'), 'utf-8');
    expect(createsTmuxPane(source)).not.toEqual([]);
  });
});
