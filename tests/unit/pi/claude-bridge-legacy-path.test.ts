import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tempDir } from '../../utils/temp-dir.js';

/**
 * The legacy argv path must agree with the native host about the Claude Code route
 * (SPECIALISTS-4405 review survivors g, h, i).
 *
 * `spawn` is replaced with a sentinel: reaching it proves the session got past the route
 * decision, and never reaching it proves the refusal happened before any process was started.
 * That is the only honest way to test this path without launching a real `pi`.
 */
const spawnReached = vi.hoisted(() => ({ calls: [] as unknown[][] }));

vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => {
    spawnReached.calls.push(args);
    throw new Error('spawn-reached');
  },
}));

const { PiAgentSession } = await import('../../../src/pi/session.js');

function withOperatorSwitch(enabled: boolean): () => void {
  const dir = tempDir('claude-bridge-legacy-');
  mkdirSync(join(dir, 'specialists'), { recursive: true });
  if (enabled) {
    writeFileSync(join(dir, 'specialists', 'user.json'), JSON.stringify({ claude_bridge: { enabled: true } }));
  }
  const previousXdg = process.env.XDG_CONFIG_HOME;
  const previousPath = process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH;
  process.env.XDG_CONFIG_HOME = dir;
  return () => {
    if (previousXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = previousXdg;
    if (previousPath === undefined) delete process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH;
    else process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH = previousPath;
  };
}

function bridgeEntry(): string {
  const dir = tempDir('claude-bridge-legacy-');
  const entry = join(dir, 'index.js');
  writeFileSync(entry, 'export default () => {};\n');
  process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH = entry;
  return entry;
}

afterEach(() => {
  spawnReached.calls.length = 0;
});

async function legacySession(claudeBridge: boolean) {
  return PiAgentSession.create({
    model: 'claude-bridge/claude-opus-5-5',
    claudeBridge,
    permissionLevel: 'HIGH',
    cwd: process.cwd(),
  });
}

describe('legacy argv path — Claude Code route (SPECIALISTS-4405)', () => {
  it('throws claude_bridge_unavailable before spawning when both halves are on and the entry is missing', async () => {
    const restore = withOperatorSwitch(true);
    process.env.SPECIALISTS_CLAUDE_BRIDGE_PATH = '/nonexistent/pi-claude-bridge/src/index.ts';
    try {
      const { claudeBridgeUnavailableNote } = await import('../../../src/pi/session.js');
      // Identity, not a prefix match: an inline copy of the message must fail this assertion.
      await expect((await legacySession(true)).start()).rejects.toThrow(
        `claude_bridge_unavailable: ${claudeBridgeUnavailableNote()}`,
      );
      expect(spawnReached.calls).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('loads the bridge entry into the argv when both halves are on', async () => {
    const entry = bridgeEntry();
    const restore = withOperatorSwitch(true);
    try {
      await expect((await legacySession(true)).start()).rejects.toThrow(/spawn-reached/);
      const argv = spawnReached.calls[0]?.[1] as string[] | undefined;
      expect(argv).toBeDefined();
      expect(argv).toContain(entry);
      expect((argv as string[])[(argv as string[]).indexOf(entry) - 1]).toBe('-e');
    } finally {
      restore();
    }
  });

  it('does NOT load the bridge when the OPERATOR switch is off, even with the definition flag on', async () => {
    const entry = bridgeEntry();
    const restore = withOperatorSwitch(false);
    try {
      // No throw: with the operator half off the route is simply absent, and the definition's
      // bridged model is then refused by the gate exactly as it is today.
      await expect((await legacySession(true)).start()).rejects.toThrow(/spawn-reached/);
      const argv = spawnReached.calls[0]?.[1] as string[] | undefined;
      expect(argv).not.toContain(entry);
    } finally {
      restore();
    }
  });

  it('does NOT load the bridge when the definition does not select it, even with the operator switch on', async () => {
    const entry = bridgeEntry();
    const restore = withOperatorSwitch(true);
    try {
      await expect((await legacySession(false)).start()).rejects.toThrow(/spawn-reached/);
      const argv = spawnReached.calls[0]?.[1] as string[] | undefined;
      expect(argv).not.toContain(entry);
    } finally {
      restore();
    }
  });
});
