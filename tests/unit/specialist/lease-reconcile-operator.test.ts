import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { resolveWorkspace } from '../../../src/activation/native-host.js';
import { acquire, leasePath, type LeaseProcessProbe } from '../../../src/activation/workspace-lease.js';
import { runLeaseCommand } from '../../../src/cli/lease.js';
import { createSpecialistLeaseReconcileTool } from '../../../src/tools/specialist/specialist_lease_reconcile.tool.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const liveProbe: LeaseProcessProbe = { canVerify: () => true, startTicks: pid => pid === process.pid ? 111 : undefined };
const deadProbe: LeaseProcessProbe = { canVerify: () => true, startTicks: () => undefined };
const blindProbe: LeaseProcessProbe = { canVerify: () => false, startTicks: () => undefined };

/** A real runtime-written lease whose holder PID is replaced by an impossible one. */
function deadHolderWorkspace(): string {
  const root = mkdtempSync(join(process.cwd(), '.tmp-specialists-4251-'));
  roots.push(root);
  const identity = resolveWorkspace(root);
  acquire({ workspace: identity, activationId: 'act:holder', attemptId: 'att:holder:1', specialist: 'executor' }, liveProbe);
  const file = leasePath(identity);
  const record = JSON.parse(readFileSync(file, 'utf8')) as { holder: { pid: number } };
  record.holder.pid = 4_000_000_000;
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return root;
}

function cli(argv: string[], cwd: string, probe: LeaseProcessProbe = deadProbe) {
  let out = '';
  let err = '';
  const code = runLeaseCommand(argv, {
    cwd, probe, decidedBy: 'operator:test',
    out: t => { out += t; }, err: t => { err += t; },
  });
  return { code, out, err };
}

describe('specialists lease list', () => {
  it('prints holder, reason and permitted outcomes, and supports --json', () => {
    const root = deadHolderWorkspace();
    const text = cli(['list'], root);
    expect(text.code).toBe(0);
    expect(text.out).toContain('act:holder');
    expect(text.out).toContain('executor');
    expect(text.out).toContain('holder_process_gone');
    expect(text.out).toContain('safe_free, superseded, manual_attention_required');

    const json = JSON.parse(cli(['list', '--json'], root).out) as Array<Record<string, unknown>>;
    expect(json).toHaveLength(1);
    expect(json[0]).toMatchObject({ uncertain_reason: 'holder_process_gone', holder_activation_id: 'act:holder' });
  });

  it('reports no uncertain workspaces for a clean checkout', () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-specialists-4251-'));
    roots.push(root);
    expect(cli(['list'], root).out).toContain('No uncertain workspaces');
  });
});

describe('specialists lease reconcile', () => {
  it('applies safe_free with a stated basis, records the operator and frees the lease', () => {
    const root = deadHolderWorkspace();
    const result = cli(['reconcile', root, '--outcome', 'safe_free', '--basis', 'forensic evt-1', '--basis', 'git status clean', '--note', 'ok'], root);
    expect(result.code).toBe(0);
    expect(result.out).toContain('applied: safe_free');
    expect(result.out).toContain('operator:test');
    expect(result.out).toContain('forensic evt-1; git status clean');
    expect(existsSync(leasePath(resolveWorkspace(root)))).toBe(false);
  });

  it('exits non-zero with the refusalReason when the reason forbids the outcome', () => {
    const root = deadHolderWorkspace();
    const result = cli(['reconcile', root, '--outcome', 'safe_free', '--basis', 'looked'], root, blindProbe);
    expect(result.code).toBe(1);
    expect(result.err).toContain('reason_forbids_outcome');
    expect(existsSync(leasePath(resolveWorkspace(root)))).toBe(true);
  });

  it('refuses an empty basis and rejects an unknown outcome as a usage error', () => {
    const root = deadHolderWorkspace();
    const empty = cli(['reconcile', root, '--outcome', 'safe_free'], root);
    expect(empty.code).toBe(1);
    expect(empty.err).toContain('insufficient_evidence');
    const bad = cli(['reconcile', root, '--outcome', 'recovered_holder', '--basis', 'x'], root);
    expect(bad.code).toBe(1);
    expect(bad.err).toContain('--outcome');
  });
});

describe('specialist_lease_reconcile MCP tool', () => {
  it('lists uncertain workspaces and reconciles one to success', async () => {
    const root = deadHolderWorkspace();
    const tool = createSpecialistLeaseReconcileTool(deadProbe);
    const prior = process.cwd();
    process.chdir(root);
    try {
      const listed = await tool.execute({ action: 'list' });
      expect(listed).toMatchObject({ uncertain_workspaces: [{ uncertain_reason: 'holder_process_gone' }] });
    } finally {
      process.chdir(prior);
    }
    const done = await tool.execute({ action: 'reconcile', worktree: root, outcome: 'safe_free', basis: ['forensic evt-1'] });
    expect(done).toMatchObject({ applied: true, outcome: 'safe_free', refusal_reason: null });
    expect(existsSync(leasePath(resolveWorkspace(root)))).toBe(false);
  });

  it('returns the refusal_reason for a refused outcome', async () => {
    const root = deadHolderWorkspace();
    const tool = createSpecialistLeaseReconcileTool(blindProbe);
    const refused = await tool.execute({ action: 'reconcile', worktree: root, outcome: 'safe_free', basis: ['looked'] });
    expect(refused).toMatchObject({ applied: false, refusal_reason: 'reason_forbids_outcome' });
    expect(existsSync(leasePath(resolveWorkspace(root)))).toBe(true);
  });
});
