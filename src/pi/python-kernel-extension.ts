// Resolves the python-kernel Pi extension from the @jaggerxtrm/pi-extensions
// package (global node_modules), mirroring the gitnexus package resolution.
//
// Why the package path and not ~/.pi/agent/extensions:
//   The loose per-user copies under ~/.pi/agent/extensions are not managed and
//   can diverge (the brief forbids touching them). The npm-installed package
//   @jaggerxtrm/pi-extensions is the canonical source — on this machine it is
//   a symlink to the core source checkout, so it is live with v2 (skillbridge,
//   audit seam, QoL). A missing package returns null and callers fail open —
//   the specialist session simply runs without the `python` tool.
//
// Path shape: <global node_modules>/@jaggerxtrm/pi-extensions/extensions/
//   python-kernel/index.ts (pi loads a raw TS entrypoint directly).

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveGlobalNodeModulesDirs } from './session.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKAGE_DIR = join('@jaggerxtrm', 'pi-extensions');
const EXT_REL = join('extensions', 'python-kernel', 'index.ts');

/** First entry file found across every global root (not just the first root that exists). */
function findGlobalEntry(...segments: string[]): string | null {
  const found = resolveGlobalNodeModulesDirs()
    .map((root) => join(root, ...segments))
    .find((candidate) => existsSync(candidate));
  return found ? resolve(found) : null;
}

let cached: string | null | undefined;

export function getPiExtensionsPythonKernelPath(): string | null {
  if (cached !== undefined) return cached;
  cached = findGlobalEntry(PACKAGE_DIR, EXT_REL);
  return cached;
}

/** Alias used by session.ts injection site (kept short for the diff). */
export function resolvePiExtensionsPythonKernelPath(): string | null {
  return getPiExtensionsPythonKernelPath();
}

/** Test-only reset for the module-level cache. */
export function __resetPiExtensionsPythonKernelPathCacheForTest(): void {
  cached = undefined;
}

// service-knowledge ext (relocated xtrm-6z6.5): resolves the index.ts entry of
// the @jaggerxtrm/pi-service-knowledge npm package (global node_modules). The
// ext self-gates (no registry -> zero surface), so injecting it when present
// is safe in every session. Same candidate-dir walk as the python-kernel
// resolver above.
const SK_PACKAGE_DIR = join('@jaggerxtrm', 'pi-service-knowledge');

let skCached: string | null | undefined;

export function getServiceKnowledgeExtensionPath(): string | null {
  if (skCached !== undefined) return skCached;
  skCached = findGlobalEntry(SK_PACKAGE_DIR, 'index.ts');
  return skCached;
}

/** Alias used by session.ts injection site. */
export function resolveServiceKnowledgeExtensionPath(): string | null {
  return getServiceKnowledgeExtensionPath();
}

/** Test-only reset for the service-knowledge path cache. */
export function __resetServiceKnowledgeExtensionPathCacheForTest(): void {
  skCached = undefined;
}
