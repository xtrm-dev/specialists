import { describe, it, expect } from 'vitest';
import { renderRejection, supersedeStaleRefusal } from '../../../src/activation/rejection.js';
import { describeBuildIdentity, isBuildStale } from '../../../src/activation/build-identity.js';
import { DispatchRejectedError } from '../../../src/activation/types.js';
import { createSpecialistDispatchTool } from '../../../src/tools/specialist/activation.tool.js';
import type { NativeActivationHost } from '../../../src/activation/native-host.js';

/**
 * Shared refusal renderer (unitAI-t2kol.4). Pure given explicit ids — no
 * filesystem reads. The before/after payloads mirror design §2 (unitAI-t2kol.3 notes).
 */

const FRESH_BUILD = describeBuildIdentity('aaaabbbbcccc', 'aaaabbbbcccc');
const STALE_BUILD = describeBuildIdentity('aaaabbbbcccc', 'ddddffff0000');

describe('renderRejection', () => {
  it('keeps the bead-draft envelope and attaches build (today\'s shape + build)', () => {
    const detail = {
      specialist: 'codebase-explorer',
      beadId: 'bd-1',
      note: 'bead contract is marked draft — promote it with `bd set-state <id> contract=ready` first',
    };
    expect(renderRejection({ reason: 'bead_contract_incomplete', detail }, FRESH_BUILD)).toEqual({
      status: 'rejected',
      reason: 'bead_contract_incomplete',
      detail,
      build: FRESH_BUILD,
    });
  });

  it('promotes missing top-level without stripping it from detail', () => {
    const missing = ['PROBLEM', 'SCRUTINY'];
    const detail = { specialist: 'codebase-explorer', beadId: 'bd-1', note: 'x', missing };
    const out = renderRejection({ reason: 'bead_contract_incomplete', detail, missing }, FRESH_BUILD);
    expect(out.missing).toEqual(missing);
    // Never removed from detail where the host put it.
    expect(out.detail).toEqual(detail);
  });

  it('renders the inline-incomplete shape with no detail envelope', () => {
    expect(
      renderRejection({ reason: 'bead is not a usable task contract: ...', missing: ['PROBLEM'] }, FRESH_BUILD),
    ).toEqual({
      status: 'rejected',
      reason: 'bead is not a usable task contract: ...',
      missing: ['PROBLEM'],
      build: FRESH_BUILD,
    });
  });

  it('omits build, detail and missing when absent or empty', () => {
    expect(renderRejection({ reason: 'bead_unreadable' })).toEqual({
      status: 'rejected',
      reason: 'bead_unreadable',
    });
    expect(renderRejection({ reason: 'x', missing: [] }, undefined)).not.toHaveProperty('missing');
  });

  it('a stale build reads as stale, never as a broken contract', () => {
    expect(STALE_BUILD).toContain('rebuilt after');
    const out = renderRejection({ reason: 'bead_contract_incomplete' }, STALE_BUILD);
    expect(out.build).toContain('module loaded aaaabbbbcccc, file on disk ddddffff0000');
  });
});

/**
 * SPECIALISTS-2. Measured in the field: a long-running MCP server that had loaded an
 * older `dist/lib.js` refused every dispatch with `work_item_store_unavailable: no
 * Substrate package configured (install @jaggerxtrm/substrate, ...)` while the SAME
 * response carried the correct `build: module loaded ..., file on disk ...` line. The
 * operator was told to install a package that was already installed, and the tooling
 * already knew why. The comparison existed; it just did not outrank the symptom.
 */
describe('staleness outranks the downstream symptom (SPECIALISTS-2)', () => {
  const STALE_NOTE =
    'no Substrate package configured (install @jaggerxtrm/substrate, ' +
    'or set XTRM_SUBSTRATE_DIR to a checkout of it)';

  it('isBuildStale is true only when both ids are known and differ', () => {
    expect(isBuildStale('aaaabbbbcccc', 'ddddffff0000')).toBe(true);
    expect(isBuildStale('aaaabbbbcccc', 'aaaabbbbcccc')).toBe(false);
    // An unreadable side cannot rule staleness out, but it cannot assert it either.
    expect(isBuildStale('unknown', 'ddddffff0000')).toBe(false);
    expect(isBuildStale('aaaabbbbcccc', 'unknown')).toBe(false);
  });

  it('a stale build makes staleness the PRIMARY reason and instructs a restart', () => {
    const out = renderRejection(
      { reason: 'work_item_store_unavailable', detail: { note: STALE_NOTE } },
      STALE_BUILD,
      true,
    );
    expect(out.reason).toMatch(/^stale_runtime:/);
    expect(out.reason).toContain('Restart the session');
    // The downstream symptom stays, subordinate, and is never suppressed.
    expect(out.detail?.refused_by_stale_runtime).toBe('work_item_store_unavailable');
    expect(out.detail?.note).toBe(STALE_NOTE);
    expect(out.build).toBe(STALE_BUILD);
  });

  it('a matching build renders exactly as today', () => {
    const detail = { note: STALE_NOTE };
    expect(
      renderRejection({ reason: 'work_item_store_unavailable', detail }, FRESH_BUILD, false),
    ).toEqual({
      status: 'rejected',
      reason: 'work_item_store_unavailable',
      detail,
      build: FRESH_BUILD,
    });
  });

  it('staleness does not rewrite a refusal it does not explain', () => {
    const out = renderRejection(
      { reason: 'bead_contract_incomplete', detail: { note: 'draft' } },
      STALE_BUILD,
      true,
    );
    expect(out.reason).toBe('bead_contract_incomplete');
    expect(out.detail).toEqual({ note: 'draft' });
  });

  it('supersedeStaleRefusal leaves a payload byte-identical when not stale', () => {
    const payload = { status: 'rejected' as const, reason: 'work_item_store_unavailable', detail: { note: 'x' } };
    expect(supersedeStaleRefusal(payload, false, FRESH_BUILD)).toEqual(payload);
  });
});

describe('MCP dispatch refusal adoption (unitAI-t2kol.4)', () => {
  function toolWith(start: () => Promise<never>) {
    const host = { start, inspect: () => undefined };
    return createSpecialistDispatchTool(() => host as unknown as NativeActivationHost);
  }

  it('a draft-bead refusal keeps detail.note and carries a build block', async () => {
    const error = new DispatchRejectedError('bead_contract_incomplete', {
      specialist: 'codebase-explorer',
      beadId: 'bd-1',
      note: 'bead contract is marked draft — promote it first',
    });
    const tool = toolWith(async () => { throw error; });
    const out = await tool.execute({ specialist: 'codebase-explorer', bead_id: 'bd-1' }) as Record<string, unknown>;
    expect(out.status).toBe('rejected');
    // Reason strings byte-identical to today: the host's rendered message, not the code.
    expect(out.reason).toBe(error.message);
    expect(out.detail).toEqual(error.detail);
    expect(out.detail).toMatchObject({ note: expect.stringContaining('draft') });
    expect(out).not.toHaveProperty('missing');
    expect(typeof out.build).toBe('string');
    expect(out.build as string).toContain('build: ');
  });

  it('an incomplete-bead refusal promotes missing top-level and keeps the envelope', async () => {
    const error = new DispatchRejectedError('bead_contract_incomplete', {
      specialist: 'codebase-explorer',
      beadId: 'bd-1',
      note: 'bead is not a usable task contract',
      missing: ['PROBLEM', 'SCRUTINY'],
    });
    const tool = toolWith(async () => { throw error; });
    const out = await tool.execute({ specialist: 'codebase-explorer', bead_id: 'bd-1' }) as Record<string, unknown>;
    expect(out.status).toBe('rejected');
    expect(out.missing).toEqual(['PROBLEM', 'SCRUTINY']);
    expect(out.detail).toEqual(error.detail);
    expect(typeof out.build).toBe('string');
  });
});
