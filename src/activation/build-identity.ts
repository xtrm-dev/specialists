/**
 * Build identity for the stale-build refusal (unitAI-rrdnt.55).
 *
 * The Pi extension statically imports the bundled `dist/lib.js` at session
 * load, so a running coordinator keeps whatever build existed when it
 * started. When that stale build refuses a dispatch, the refusal is
 * byte-identical to a genuinely broken contract — the message blames the
 * operator's input when the process is stale.
 *
 * This module is the single source of the identity wording every frontend
 * uses: a short content hash of the loaded artifact. A content hash is cheap
 * (one small file read) and stable across identical builds, which a
 * timestamp or mtime would not be. It deliberately does NOT re-import dist
 * per call — the static import is what keeps one session on one gate; only
 * the identity bytes are re-read.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const BUILD_ID_BYTES = 12;
export const UNKNOWN_BUILD_ID = 'unknown';

/** sha256 hex of a file's bytes. Throws if the file cannot be read. */
export function hashFileBytes(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

export function shortBuildId(hash: string): string {
  return hash.slice(0, BUILD_ID_BYTES);
}

/** Short content id of an artifact file, or 'unknown' — never throws. */
export function readBuildId(path: string): string {
  try {
    return shortBuildId(hashFileBytes(path));
  } catch {
    return UNKNOWN_BUILD_ID;
  }
}

/**
 * True when the loaded module and the artifact on disk are both identified and
 * differ — the running process is stale. An unreadable side cannot rule
 * staleness out, but it cannot assert it either, so it returns false and the
 * `describeBuildIdentity` line keeps saying so.
 *
 * The single staleness predicate: `describeBuildIdentity` renders the same
 * comparison, so a caller never derives staleness a second way.
 */
export function isBuildStale(loadedId: string, onDiskId: string): boolean {
  return (
    loadedId !== UNKNOWN_BUILD_ID &&
    onDiskId !== UNKNOWN_BUILD_ID &&
    loadedId !== onDiskId
  );
}

/**
 * One line stating which build rendered this outcome and whether the
 * artifact on disk has changed since this process loaded it. When the ids
 * differ the line names staleness outright, so a stale-build refusal can
 * never again read as a broken contract.
 */
export function describeBuildIdentity(loadedId: string, onDiskId: string): string {
  if (loadedId === UNKNOWN_BUILD_ID || onDiskId === UNKNOWN_BUILD_ID) {
    const known = loadedId !== UNKNOWN_BUILD_ID ? loadedId : onDiskId;
    return known !== UNKNOWN_BUILD_ID
      ? `build: ${known} (the other side of the comparison could not be read, so staleness cannot be ruled out)`
      : 'build: unknown (build identity unavailable)';
  }
  if (loadedId === onDiskId) {
    return `build: ${loadedId} (loaded module matches the file on disk)`;
  }
  return (
    `build: module loaded ${loadedId}, file on disk ${onDiskId} — ` +
    'the runtime was rebuilt after this session loaded it. Restart the session to pick up ' +
    'the new build; until then, treat a refusal below as possibly stale rather than broken.'
  );
}
