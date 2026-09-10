/**
 * Bead readiness gate for native Specialist activation — PRD Phase 3.
 *
 * `--bead` is the prompt. A Specialist dispatched against a Bead that is only a title and
 * a sentence has nothing to work from, so it invents the missing scope; that is how
 * durable work silently loses its boundaries. The seven sections are not paperwork, they
 * are the task contract, and a Bead without them is not dispatchable.
 *
 * Before this module the discipline existed only in CLAUDE.md and hooks — nothing in
 * `src/` mentioned PROBLEM, NON_GOALS or SCRUTINY. The gate moves it into the admission
 * path, where a refusal is cheap and reversible, rather than leaving it to be discovered
 * by a child that already spent a model turn guessing.
 *
 * Deliberately NOT here: the contract's *quality*. The gate proves a section exists and is
 * non-empty. Whether SCOPE is a good scope is a judgement no parser makes, and pretending
 * otherwise would trade a useful gate for a bureaucratic one.
 */

import { spawnSync } from 'node:child_process';
import type { BeadRecord } from '../specialist/beads.js';

import { extractSections, REQUIRED_SECTIONS } from './contract-sections.js';
export { extractSections, REQUIRED_SECTIONS } from './contract-sections.js';
import { SCRUTINY_LEVELS } from './contract-sections.js';

export type BeadGateResult =
  | { ok: true }
  | { ok: false; reason: string; missing: string[] };

/** Closed and deferred Beads are not work; dispatching against them resurrects dead scope. */
const NON_DISPATCHABLE_STATUSES = new Set(['closed', 'deferred']);

export interface BeadGateOptions {
  readContractState?: (beadId: string) => string | undefined;
}

/** Read `bd state <id> contract`. Returns undefined when bd is absent or the state is unset. */
export function readContractState(beadId: string): string | undefined {
  const result = spawnSync('bd', ['state', beadId, 'contract'], {
    encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 5000,
  });
  if (result.error || result.status !== 0) return undefined;
  const value = result.stdout?.trim().toLowerCase();
  return value ? value : undefined;
}

/** Max chars of a purpose excerpt carried on a fleet row. Single line, whitespace-collapsed. */
export const PURPOSE_EXCERPT_MAX = 60;

/**
 * One-line purpose excerpt for a fleet row, from an already-validated contract.
 *
 * First meaningful line of SCOPE, falling back to SUCCESS. Cheap and bounded:
 * whitespace-collapsed, single line, truncated to PURPOSE_EXCERPT_MAX chars.
 * Returns undefined when neither section yields text — the field is omitted,
 * never fabricated.
 */
export function extractPurposeExcerpt(description: string): string | undefined {
  const sections = extractSections(description ?? '');
  for (const name of ['SCOPE', 'SUCCESS'] as const) {
    const line = (sections.get(name) ?? '').split('\n').map(s => s.trim()).find(Boolean);
    if (!line) continue;
    const flat = line.replace(/\s+/g, ' ');
    return flat.length <= PURPOSE_EXCERPT_MAX ? flat : `${flat.slice(0, PURPOSE_EXCERPT_MAX - 1)}…`;
  }
  return undefined;
}

/** Extract the declared SCRUTINY level, if any. */
function scrutinyLevel(description: string): string | undefined {
  const match = description.match(/SCRUTINY\b[^\n]*\n?\s*\**\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i)
    ?? description.match(/SCRUTINY\b\s*[:\-—]?\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i);
  return match?.[1]?.toUpperCase();
}

/**
 * Decide whether a Bead is a dispatchable task contract.
 *
 * Returns a result rather than throwing so the caller owns the refusal shape — the host
 * renders one `DispatchRejectedError` for every rejection reason, and a gate that threw its
 * own error type would give operators two.
 */
export function evaluateBeadReadiness(bead: BeadRecord, options: BeadGateOptions = {}): BeadGateResult {
  const status = bead.status?.trim().toLowerCase();
  if (status && NON_DISPATCHABLE_STATUSES.has(status)) {
    return { ok: false, reason: `bead is ${status} and is not dispatchable`, missing: [] };
  }

  // An explicit draft marker is decisive. An ABSENT marker is not treated as draft: most
  // Beads predate the marker, and refusing them all would make the gate unusable.
  const contractState = (options.readContractState ?? readContractState)(bead.id);
  if (contractState === 'draft') {
    return {
      ok: false,
      reason: 'bead contract is marked draft — promote it with `bd set-state <id> contract=ready` first',
      missing: [],
    };
  }

  const description = bead.description ?? '';
  const sections = extractSections(description);
  const missing = REQUIRED_SECTIONS.filter(section => !sections.get(section));

  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'bead is not a usable task contract: required sections are missing or empty',
      missing: [...missing],
    };
  }

  if (!scrutinyLevel(description)) {
    return {
      ok: false,
      reason: `bead declares no SCRUTINY level (expected one of ${SCRUTINY_LEVELS.join(', ')})`,
      missing: ['SCRUTINY'],
    };
  }

  return { ok: true };
}
