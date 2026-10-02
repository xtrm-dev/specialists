// Registers the bundled native-specialists Pi extension in the operator's Pi
// settings (`<agentDir>/settings.json` `packages`), so every Pi session loads the
// specialist coordinator tools without a manual settings edit. Called by
// `sp init --global` and by the global-install postinstall hook.
//
// Rules, in order:
//  - an existing `…/pi-extensions/native-specialists` entry is kept as-is
//    (a dev checkout override wins over the installed package);
//  - legacy `…/pi-extensions/specialist-subagents` entries (pre-rename) are
//    migrated in place to the sibling `native-specialists` directory when it
//    exists, otherwise to the bundled path, or dropped if a current entry exists;
//  - otherwise the bundled path is appended.
// An unreadable settings file is never rewritten.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT = '/pi-extensions/native-specialists';
const LEGACY = '/pi-extensions/specialist-subagents';
const REL = join('config', 'pi-extensions', 'native-specialists');

export type RegistrationResult =
  | { status: 'added' | 'migrated' | 'present'; settingsPath: string; source: string }
  | { status: 'skipped'; settingsPath: string; reason: string };

export function getNativeSpecialistsExtensionPath(): string | null {
  const here = dirname(fileURLToPath(import.meta.url));
  // bundled: dist/../config · dev: src/pi/../../config
  for (const candidate of [join(here, '..', REL), join(here, '..', '..', REL)]) {
    if (existsSync(join(candidate, 'index.mjs'))) return resolve(candidate);
  }
  return null;
}

export function getPiSettingsPath(env: NodeJS.ProcessEnv = process.env): string {
  const agentDir = env.PI_CODING_AGENT_DIR || join(homedir(), '.pi', 'agent');
  return join(agentDir, 'settings.json');
}

type PackageEntry = string | { source?: unknown; [key: string]: unknown };

function sourceOf(entry: PackageEntry): string {
  const source = typeof entry === 'string' ? entry : entry?.source;
  return typeof source === 'string' ? source.replace(/\/+$/, '') : '';
}

function withSource(entry: PackageEntry, source: string): PackageEntry {
  return typeof entry === 'string' ? source : { ...entry, source };
}

export function registerNativeSpecialists(
  bundledPath: string | null = getNativeSpecialistsExtensionPath(),
  settingsPath: string = getPiSettingsPath(),
): RegistrationResult {
  if (!bundledPath) return { status: 'skipped', settingsPath, reason: 'bundled extension not found' };

  let settings: Record<string, unknown> = {};
  if (existsSync(settingsPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(settingsPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not an object');
      settings = parsed as Record<string, unknown>;
    } catch (error) {
      return { status: 'skipped', settingsPath, reason: `unreadable settings: ${(error as Error).message}` };
    }
  }
  if (settings.packages !== undefined && !Array.isArray(settings.packages)) {
    return { status: 'skipped', settingsPath, reason: '`packages` is not an array' };
  }

  const packages = [...((settings.packages as PackageEntry[] | undefined) ?? [])];
  const current = packages.find((entry) => sourceOf(entry).endsWith(CURRENT));
  let source = current ? sourceOf(current) : bundledPath;
  let legacyFound = false;

  const next: PackageEntry[] = [];
  for (const entry of packages) {
    const entrySource = sourceOf(entry);
    if (!entrySource.endsWith(LEGACY)) {
      next.push(entry);
      continue;
    }
    // Keep one migrated entry; drop the rest (and all of them when a current entry exists).
    if (current || legacyFound) {
      legacyFound = true;
      continue;
    }
    legacyFound = true;
    const sibling = entrySource.slice(0, -LEGACY.length) + CURRENT;
    source = existsSync(join(sibling, 'index.mjs')) ? sibling : bundledPath;
    next.push(withSource(entry, source));
  }
  if (!current && !legacyFound) next.push(bundledPath);

  const status = legacyFound ? 'migrated' : current ? 'present' : 'added';
  if (status === 'present') return { status, settingsPath, source };

  settings.packages = next;
  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
  return { status, settingsPath, source };
}
