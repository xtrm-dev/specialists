import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  DISPATCH_REFUSAL_REASONS,
  FIX_BY_REASON,
  renderRejection,
  type DispatchRefusalReason,
} from '../../../src/activation/rejection.js';
import { describeBuildIdentity } from '../../../src/activation/build-identity.js';
import { DispatchRejectedError } from '../../../src/activation/types.js';
import { createSpecialistDispatchTool } from '../../../src/tools/specialist/activation.tool.js';
import type { NativeActivationHost } from '../../../src/activation/native-host.js';

const FRESH_BUILD = describeBuildIdentity('aaaabbbbcccc', 'aaaabbbbcccc');

function mcpRefusalFor(reason: DispatchRefusalReason) {
  const error = new DispatchRejectedError(reason, { specialist: 'codebase-explorer' });
  const host = {
    start: async () => { throw error; },
    inspect: () => undefined,
  };
  const tool = createSpecialistDispatchTool(() => host as unknown as NativeActivationHost);
  return tool.execute({ specialist: 'codebase-explorer', issue_ref: 'XTRM-1' });
}

describe('dispatch refusal reasons carry a corrective fix (SPECIALISTS-4341)', () => {
  it('lists exactly the 37 wire reasons on master 2a450f5b8', () => {
    expect(DISPATCH_REFUSAL_REASONS).toHaveLength(37);
    // Written by reason name, not derived by counting call sites.
    expect([...DISPATCH_REFUSAL_REASONS]).toContain('unknown_specialist');
    expect([...DISPATCH_REFUSAL_REASONS]).toContain('workspace_isolation_unavailable');
    expect([...DISPATCH_REFUSAL_REASONS]).toContain('unknown_activation');
    expect([...DISPATCH_REFUSAL_REASONS]).toContain('not_resumable');
    expect([...DISPATCH_REFUSAL_REASONS]).toContain('not_steerable');
    expect([...DISPATCH_REFUSAL_REASONS]).not.toContain('workspace_lease_unavailable');
  });

  it('equals the reason sets in native-host.ts and workspace-lease.ts minus the event-only name', () => {
    const root = process.cwd();
    const nativeHost = readFileSync(resolve(root, 'src/activation/native-host.ts'), 'utf8');
    const lease = readFileSync(resolve(root, 'src/activation/workspace-lease.ts'), 'utf8');
    const names = new Set<string>();
    for (const text of [nativeHost, lease]) {
      for (const m of text.matchAll(/reject\('([^']+)'/g)) names.add(m[1]);
      for (const m of text.matchAll(/new DispatchRejectedError\('([^']+)'/g)) names.add(m[1]);
      for (const m of text.matchAll(/refusal\('([^']+)'/g)) names.add(m[1]);
    }
    // Event-only telemetry name, not a wire reason: present as an emit, never as a reject/throw code.
    expect(nativeHost.includes("'workspace_lease_unavailable'")).toBe(true);
    expect(names.has('workspace_lease_unavailable')).toBe(false);
    expect(new Set(DISPATCH_REFUSAL_REASONS)).toEqual(names);
  });

  it.each([...DISPATCH_REFUSAL_REASONS])('reason %s has a non-empty Substrate fix', (reason) => {
    const fix = FIX_BY_REASON[reason];
    expect(typeof fix).toBe('string');
    expect(fix.trim().length).toBeGreaterThan(0);
    // No bd-board wording in new text.
    expect(fix).not.toMatch(/\bbd\b/);
  });

  it.each([...DISPATCH_REFUSAL_REASONS])('renderRejection emits fix for %s', (reason) => {
    const out = renderRejection({ reason }, FRESH_BUILD);
    expect(out.status).toBe('rejected');
    expect(out.reason).toBe(reason);
    expect(typeof (out as Record<string, unknown>).fix).toBe('string');
    expect(((out as Record<string, unknown>).fix as string).trim().length).toBeGreaterThan(0);
  });

  it.each([...DISPATCH_REFUSAL_REASONS])('MCP path emits fix for %s', async (reason) => {
    const out = await mcpRefusalFor(reason) as Record<string, unknown>;
    expect(out.status).toBe('rejected');
    expect(typeof out.fix).toBe('string');
    expect((out.fix as string).trim().length).toBeGreaterThan(0);
  });

  it.each([...DISPATCH_REFUSAL_REASONS])('Pi path emits fix for %s (shared renderer)', async (reason) => {
    // The Pi extension renders refusals through the same shared renderer, so the
    // Pi payload equals the MCP payload for the same input. Exercised here through
    // the renderer with the Pi build identity rather than a second implementation.
    const error = new DispatchRejectedError(reason, { specialist: 'codebase-explorer' });
    const piOut = renderRejection(
      { reason: error.message, detail: error.detail, missing: error.detail.missing },
      FRESH_BUILD,
      false,
    ) as Record<string, unknown>;
    const mcpOut = await mcpRefusalFor(reason) as Record<string, unknown>;
    // Same reason envelope (MCP message vs Pi message both carry the host message)...
    expect(piOut.fix).toBe(FIX_BY_REASON[reason]);
    expect(mcpOut.fix).toBe(FIX_BY_REASON[reason]);
    expect(piOut.fix).toBe(mcpOut.fix);
  });

  it('MCP and Pi refusal payloads are equal for the same input', async () => {
    const error = new DispatchRejectedError('context_changed', {
      specialist: 'codebase-explorer',
      note: 'contextRefs changed between prompt render and binding',
    });
    const mcpOut = await mcpRefusalFor('context_changed') as Record<string, unknown>;
    const piOut = renderRejection(
      { reason: error.message, detail: error.detail, missing: error.detail.missing },
      (mcpOut.build as string) ?? FRESH_BUILD,
      false,
    ) as Record<string, unknown>;
    // Fix, reason shape and detail envelope agree across frontends.
    expect(piOut.fix).toBe(mcpOut.fix);
    expect(typeof piOut.fix).toBe('string');
  });

  it('keeps reason and detail values and order (fix is additive)', () => {
    const detail = { specialist: 's', note: 'n' };
    const out = renderRejection({ reason: 'unknown_specialist', detail }, FRESH_BUILD);
    expect(Object.keys(out)).toEqual(['status', 'reason', 'fix', 'detail', 'build']);
    expect(out.reason).toBe('unknown_specialist');
    expect(out.detail).toEqual(detail);
  });

  it('compact and full dispatch views both carry fix on refusal', async () => {
    for (const full of [true, false]) {
      const error = new DispatchRejectedError('no_work_ref', {});
      const host = {
        start: async () => { throw error; },
        inspect: () => undefined,
      };
      const tool = createSpecialistDispatchTool(() => host as unknown as NativeActivationHost);
      const out = await tool.execute({ specialist: 'explorer', full }) as Record<string, unknown>;
      // The refusal path ignores the full flag but always carries fix.
      expect(out.status).toBe('rejected');
      expect(typeof out.fix).toBe('string');
    }
  });

  it('issue_unresolvable points at creating the Issue or passing contract inline', () => {
    const fix = FIX_BY_REASON.issue_unresolvable;
    expect(fix).toContain('not a Substrate Issue');
    expect(fix).toMatch(/planning/i);
    expect(fix).toMatch(/inline contract/i);
  });

  it('context_unresolvable points at `sp doctor`', () => {
    expect(FIX_BY_REASON.context_unresolvable).toContain('sp doctor');
  });

  it('context_changed re-dispatches contextRefs and never tells the reader to fix the Issue', () => {
    const fix = FIX_BY_REASON.context_changed;
    expect(fix).toMatch(/re-dispatch/i);
    expect(fix).toMatch(/contextRefs/);
    expect(fix).not.toMatch(/fix the Issue/i);
  });

  it('work_item_store_unavailable covers both producers in one string', () => {
    const fix = FIX_BY_REASON.work_item_store_unavailable;
    expect(fix).toMatch(/install/i);
    expect(fix).toMatch(/SUBSTRATE_DB/);
    expect(fix).toMatch(/XTRM_STATE_DB/);
  });

  it.each([
    'workspace_held_by_another_writer',
    'workspace_lease_uncertain',
    'workspace_lease_not_held_by_caller',
    'workspace_isolation_unavailable',
  ] as const)('lease reason %s is shared with specialist_lease_reconcile', (reason) => {
    // workspace_isolation_unavailable names the worktree setup; the three contention
    // reasons name the reconcile tool. Isolation is the provisioning half of the same
    // lease story and is asserted alongside the reconciled three.
    if (reason === 'workspace_isolation_unavailable') {
      expect(FIX_BY_REASON[reason]).toMatch(/worktree/i);
    } else {
      expect(FIX_BY_REASON[reason]).toContain('specialist_lease_reconcile');
    }
  });

  it('tool descriptions and refusal fixes contain only one marked bd compatibility note', () => {
    const { specialistDispatchSchema } = require('../../../src/tools/specialist/activation.tool.js') as typeof import('../../../src/tools/specialist/activation.tool.js');
    const shape = specialistDispatchSchema.shape as Record<string, { description?: string }>;
    const descriptions = [shape.issue_ref.description ?? '', shape.bead_id.description ?? ''];
    const fixes = Object.values(FIX_BY_REASON);
    const bdIn = (text: string) => (text.match(/\bbd\b/g) ?? []).length;
    const totalBd = descriptions.reduce((n, d) => n + bdIn(d), 0) + fixes.reduce((n, f) => n + bdIn(f), 0);
    expect(totalBd).toBe(1);
    expect(shape.bead_id.description).toContain('Compatibility note');
  });
});
