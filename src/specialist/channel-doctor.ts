/**
 * `specialists doctor --channels` — walks the eight-gate chain Claude Code
 * enforces before it delivers a `notifications/claude/channel` push
 * (spec `docs/claude-native-integration-spec-2026-09-09.md` AM.3; schema and
 * trap details in `~/dev/core/docs/xt-claude-channels.md`).
 *
 * Every gate fails SILENTLY on the client — one `[DEBUG]` line, no error, no
 * non-zero exit. This module turns that into one named cause.
 *
 * Only four of the eight gates are observable from a CLI: capability
 * declaration (ours), org policy, marketplace match, and the allowlist. The
 * other four (protocol era, provider, feature flag, `--channels` membership)
 * are properties of a LIVE Claude Code session and are always reported
 * `unknown` — never inferred as a pass.
 *
 * All paths are injected so tests never touch the real `/etc` or the
 * developer's real `~/.claude`.
 */
import { existsSync, readFileSync } from 'node:fs';

export type GateStatus = 'pass' | 'fail' | 'unknown';

export interface GateResult {
  readonly id: number;
  readonly name: string;
  readonly status: GateStatus;
  readonly detail: string;
  readonly fixHint?: string;
}

export interface ChannelDoctorInputs {
  /** `/etc/claude-code/managed-settings.json` (or platform equivalent). */
  readonly managedSettingsPath: string;
  /** `~/.claude/plugins/installed_plugins.json`. */
  readonly installedPluginsPath: string;
  /** The MCP server entrypoint that declares the channel capability. */
  readonly serverSourcePath: string;
  /** Plugin name this repo ships under the marketplace, e.g. `specialists`. */
  readonly expectedPluginName: string;
  /** Marketplace this plugin ships under, e.g. `xtrm` (spec AN.2). */
  readonly expectedMarketplaceName: string;
  /** True when doctor itself is attached to an interactive terminal. */
  readonly isInteractiveTty: boolean;
}

export interface ChannelDoctorReport {
  readonly gates: readonly GateResult[];
  readonly firstClosedGate: GateResult | null;
  readonly headlessWarning: string | null;
}

function readJson(path: string): { exists: boolean; value: unknown; parseError: string | null } {
  if (!existsSync(path)) return { exists: false, value: null, parseError: null };
  try {
    return { exists: true, value: JSON.parse(readFileSync(path, 'utf8')), parseError: null };
  } catch (err) {
    return { exists: true, value: null, parseError: err instanceof Error ? err.message : String(err) };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkCapabilityDeclared(serverSourcePath: string): GateResult {
  const id = 1;
  const name = 'MCP server declares the claude/channel capability';
  if (!existsSync(serverSourcePath)) {
    return { id, name, status: 'unknown', detail: `server source not found at ${serverSourcePath}` };
  }
  const source = readFileSync(serverSourcePath, 'utf8');
  const declares = source.includes('CHANNEL_CAPABILITY') && source.includes('experimental');
  return declares
    ? { id, name, status: 'pass', detail: 'server capabilities spread CHANNEL_CAPABILITY into experimental' }
    : {
        id, name, status: 'fail',
        detail: 'server entrypoint no longer declares the claude/channel capability',
        fixHint: 'restore `experimental: { ...CHANNEL_CAPABILITY }` in the server capabilities object (src/mcp/v2-server.ts)',
      };
}

function unknownLiveGate(id: number, name: string, confirmVia: string): GateResult {
  return { id, name, status: 'unknown', detail: `property of a live session, not observable from a CLI — confirm via ${confirmVia}` };
}

function checkOrgPolicy(managedSettingsPath: string): GateResult {
  const id = 5;
  const name = 'org policy channelsEnabled';
  const { exists, value, parseError } = readJson(managedSettingsPath);
  if (!exists) {
    return {
      id, name, status: 'pass',
      detail: `no managed-settings.json at ${managedSettingsPath} — the gate itself defaults to open, but gate 8's allowlist then falls back to a server-fetched default that does not carry this plugin, so registration still refuses`,
    };
  }
  if (parseError) {
    return { id, name, status: 'unknown', detail: `managed-settings.json is not valid JSON: ${parseError}` };
  }
  const channelsEnabled = isRecord(value) ? value.channelsEnabled : undefined;
  if (channelsEnabled === true) {
    return { id, name, status: 'pass', detail: 'channelsEnabled: true' };
  }
  return {
    id, name, status: 'fail',
    detail: `managed-settings.json exists — this ARMS the gate that absence left open — but channelsEnabled is ${JSON.stringify(channelsEnabled)}, not true. This is the classic trap: creating the file for the allowlist without also setting channelsEnabled closes a previously-open gate.`,
    fixHint: `add "channelsEnabled": true to ${managedSettingsPath}`,
  };
}

function checkMarketplaceMatch(
  installedPluginsPath: string,
  expectedPluginName: string,
  marketplace: string,
): GateResult {
  const id = 7;
  const name = "installed plugin's marketplace matches the entry";
  const expectedKey = `${expectedPluginName}@${marketplace}`;
  const { exists, value, parseError } = readJson(installedPluginsPath);
  if (!exists) {
    return {
      id, name, status: 'fail',
      detail: `no installed_plugins.json at ${installedPluginsPath} — plugin ${expectedKey} is not installed`,
      fixHint: `install via the marketplace: expected key "${expectedKey}"`,
    };
  }
  if (parseError) return { id, name, status: 'unknown', detail: `installed_plugins.json is not valid JSON: ${parseError}` };

  const plugins = isRecord(value) && isRecord(value.plugins) ? value.plugins : {};
  if (expectedKey in plugins) {
    return { id, name, status: 'pass', detail: `installed under "${expectedKey}"` };
  }
  return {
    id, name, status: 'fail',
    detail: `installed_plugins.json has no "${expectedKey}" entry — plugin ${expectedPluginName} is installed under a different marketplace, or not installed`,
    fixHint: `reinstall so the plugin registers as "${expectedKey}"`,
  };
}

function checkAllowlist(
  managedSettingsPath: string,
  expectedPluginName: string,
  marketplace: string,
): GateResult {
  const id = 8;
  const name = 'plugin is on the allowedChannelPlugins allowlist';
  const { exists, value, parseError } = readJson(managedSettingsPath);

  if (!exists) {
    return {
      id, name, status: 'fail',
      detail: 'no managed-settings.json — absence arms nothing here, but the server-fetched default allowlist does not carry this plugin, so the outcome is refusal',
      fixHint: `create ${managedSettingsPath} with allowedChannelPlugins: [{ "plugin": "${expectedPluginName}", "marketplace": "${marketplace}" }]`,
    };
  }
  if (parseError) return { id, name, status: 'unknown', detail: `managed-settings.json is not valid JSON: ${parseError}` };

  const allowlist = isRecord(value) ? value.allowedChannelPlugins : undefined;
  if (!Array.isArray(allowlist) || allowlist.length === 0) {
    return {
      id, name, status: 'fail',
      detail: 'managed-settings.json has no allowedChannelPlugins entries',
      fixHint: `add [{ "plugin": "${expectedPluginName}", "marketplace": "${marketplace}" }]`,
    };
  }

  if (allowlist.some(entry => typeof entry === 'string')) {
    return {
      id, name, status: 'fail',
      detail: 'allowedChannelPlugins contains string entries — the schema is an array of {plugin, marketplace} OBJECTS; a string such as "specialists@xtrm" never matches and the channel stays blocked',
      fixHint: `replace strings with { "plugin": "${expectedPluginName}", "marketplace": "${marketplace}" }`,
    };
  }

  const matches = allowlist.some(entry =>
    isRecord(entry) && entry.plugin === expectedPluginName && entry.marketplace === marketplace);
  if (matches) return { id, name, status: 'pass', detail: `allowlist contains {plugin: "${expectedPluginName}", marketplace: "${marketplace}"}` };

  return {
    id, name, status: 'fail',
    detail: `allowlist present but does not include {plugin: "${expectedPluginName}", marketplace: "${marketplace}"}`,
    fixHint: `add { "plugin": "${expectedPluginName}", "marketplace": "${marketplace}" } to allowedChannelPlugins`,
  };
}

/** Runs all eight gate checks against injected paths. Never writes anything. */
export function runChannelDoctorChecks(inputs: ChannelDoctorInputs): ChannelDoctorReport {
  const gates: GateResult[] = [
    checkCapabilityDeclared(inputs.serverSourcePath),
    unknownLiveGate(2, 'connection era is legacy, not modern', 'claude --debug --debug-file <path>, look for the legacy-serve negotiation'),
    unknownLiveGate(3, 'provider is first-party (not Bedrock, Vertex, Foundry)', 'the session\'s active provider configuration'),
    unknownLiveGate(4, 'channels feature is available', 'the session\'s feature-flag state'),
    checkOrgPolicy(inputs.managedSettingsPath),
    unknownLiveGate(6, "server is named in this session's --channels list", 'the launcher argv, e.g. `xt claude` adding --channels plugin:<name>@<marketplace>'),
    checkMarketplaceMatch(inputs.installedPluginsPath, inputs.expectedPluginName, inputs.expectedMarketplaceName),
    checkAllowlist(inputs.managedSettingsPath, inputs.expectedPluginName, inputs.expectedMarketplaceName),
  ];

  const firstClosedGate = gates.find(g => g.status === 'fail') ?? null;
  const headlessWarning = inputs.isInteractiveTty
    ? null
    : 'doctor is running non-interactively (no TTY). Registration itself is interactive-TUI-only — `claude -p` has no channel path at ANY gate setting, so a pass on every gate below still would not produce a headless wake.';

  return { gates, firstClosedGate, headlessWarning };
}
