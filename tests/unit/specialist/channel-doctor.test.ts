// tests/unit/specialist/channel-doctor.test.ts
// unitAI-xuclj.1: doctor --channels 8-gate chain (spec AM.3).
// All paths are injected temp fixtures — never the real /etc or ~/.claude.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runChannelDoctorChecks, type ChannelDoctorInputs } from '../../../src/specialist/channel-doctor.js';

describe('runChannelDoctorChecks', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'channel-doctor-'));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  function baseInputs(overrides: Partial<ChannelDoctorInputs> = {}): ChannelDoctorInputs {
    const serverSourcePath = join(root, 'v2-server.ts');
    writeFileSync(serverSourcePath, `experimental: { ...CHANNEL_CAPABILITY }`);
    return {
      managedSettingsPath: join(root, 'managed-settings.json'), // absent by default
      installedPluginsPath: join(root, 'installed_plugins.json'), // absent by default
      serverSourcePath,
      expectedPluginName: 'specialists',
      expectedMarketplaceName: 'xtrm',
      isInteractiveTty: true,
      ...overrides,
    };
  }

  function writeManagedSettings(value: unknown): string {
    const path = join(root, 'managed-settings.json');
    writeFileSync(path, JSON.stringify(value));
    return path;
  }

  function writeInstalledPlugins(pluginKey: string): string {
    const path = join(root, 'installed_plugins.json');
    writeFileSync(path, JSON.stringify({ version: 2, plugins: { [pluginKey]: [{ scope: 'user' }] } }));
    return path;
  }

  it('reports the four live-session gates as unknown, never inferred as a pass', () => {
    const report = runChannelDoctorChecks(baseInputs());
    const liveGateIds = [2, 3, 4, 6];
    for (const id of liveGateIds) {
      const gate = report.gates.find(g => g.id === id);
      expect(gate?.status).toBe('unknown');
    }
  });

  it('passes gate 5 and fails gate 8 with a specific refusal reason when no policy file exists', () => {
    const inputs = baseInputs(); // managedSettingsPath left absent
    const report = runChannelDoctorChecks(inputs);
    expect(report.gates.find(g => g.id === 5)?.status).toBe('pass');
    const gate8 = report.gates.find(g => g.id === 8);
    expect(gate8?.status).toBe('fail');
    expect(gate8?.detail).toMatch(/server-fetched default allowlist does not carry this plugin/);
  });

  it('catches the string-vs-object allowlist schema mistake', () => {
    const managedSettingsPath = writeManagedSettings({
      channelsEnabled: true,
      allowedChannelPlugins: ['specialists@xtrm'],
    });
    const installedPluginsPath = writeInstalledPlugins('specialists@xtrm');
    const report = runChannelDoctorChecks(baseInputs({ managedSettingsPath, installedPluginsPath }));
    const gate8 = report.gates.find(g => g.id === 8);
    expect(gate8?.status).toBe('fail');
    expect(gate8?.detail).toMatch(/OBJECTS/);
    expect(report.firstClosedGate?.id).toBe(8);
  });

  it('catches the missing-channelsEnabled trap: file present arms the policy gate that absence left open', () => {
    const managedSettingsPath = writeManagedSettings({
      allowedChannelPlugins: [{ plugin: 'specialists', marketplace: 'xtrm' }],
    });
    const report = runChannelDoctorChecks(baseInputs({ managedSettingsPath }));
    const gate5 = report.gates.find(g => g.id === 5);
    expect(gate5?.status).toBe('fail');
    expect(gate5?.detail).toMatch(/ARMS the gate/);
    expect(report.firstClosedGate?.id).toBe(5);
  });

  it('passes all locally-observable gates with a correct policy file and matching install', () => {
    const managedSettingsPath = writeManagedSettings({
      channelsEnabled: true,
      allowedChannelPlugins: [{ plugin: 'specialists', marketplace: 'xtrm' }],
    });
    const installedPluginsPath = writeInstalledPlugins('specialists@xtrm');
    const report = runChannelDoctorChecks(baseInputs({ managedSettingsPath, installedPluginsPath }));
    for (const id of [1, 5, 7, 8]) {
      expect(report.gates.find(g => g.id === id)?.status).toBe('pass');
    }
    expect(report.firstClosedGate).toBeNull();
  });

  it('fails gate 7 when the plugin is installed under a different marketplace', () => {
    const installedPluginsPath = writeInstalledPlugins('specialists@local-dev');
    const report = runChannelDoctorChecks(baseInputs({ installedPluginsPath }));
    const gate7 = report.gates.find(g => g.id === 7);
    expect(gate7?.status).toBe('fail');
  });

  it('reports a headless warning when not attached to a TTY', () => {
    const report = runChannelDoctorChecks(baseInputs({ isInteractiveTty: false }));
    expect(report.headlessWarning).toMatch(/interactive-TUI-only/);
  });

  it('reports capability gate as unknown when the server source cannot be found', () => {
    const report = runChannelDoctorChecks(baseInputs({ serverSourcePath: join(root, 'missing.ts') }));
    expect(report.gates.find(g => g.id === 1)?.status).toBe('unknown');
  });
});
