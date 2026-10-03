import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { CircuitBreaker } from '../../../src/utils/circuitBreaker.js';
import { resolveWorkspace } from '../../../src/activation/native-host.js';
import {
  acquire,
  leaseDir,
  leasePath,
  workspaceKey,
  type LeaseProcessProbe,
} from '../../../src/activation/workspace-lease.js';
import {
  leaseScopeFor,
  projectUncertainWorkspaces,
  reconcile,
} from '../../../src/activation/workspace-reconcile.js';
import { createSpecialistStatusTool } from '../../../src/tools/specialist/specialist_status.tool.js';
import type { SpecialistLoader } from '../../../src/specialist/loader.js';

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('workspace identity across runtime and operator surfaces', () => {
  it('projects and reconciles a dead runtime lease, including specialist_status full', async () => {
    const root = mkdtempSync(join(process.cwd(), '.tmp-specialists-4250-'));
    temporaryRoots.push(root);

    const liveHolderProbe: LeaseProcessProbe = {
      canVerify: () => true,
      startTicks: pid => pid === process.pid ? 111 : undefined,
    };
    const deadHolderProbe: LeaseProcessProbe = {
      canVerify: () => true,
      startTicks: () => undefined,
    };

    const runtimeIdentity = resolveWorkspace(root);
    acquire({
      workspace: runtimeIdentity,
      activationId: 'act:SPECIALISTS-4250',
      attemptId: 'att:SPECIALISTS-4250:1',
      specialist: 'executor',
    }, liveHolderProbe);

    // Preserve the real runtime-written record while replacing only its holder PID with an
    // impossible one: this is the deterministic dead-holder simulation used by the test.
    const leaseFile = leasePath(runtimeIdentity);
    const leaseRecord = JSON.parse(readFileSync(leaseFile, 'utf8')) as { holder: { pid: number } };
    leaseRecord.holder.pid = 4_000_000_000;
    writeFileSync(leaseFile, `${JSON.stringify(leaseRecord)}\n`);

    const operatorScope = leaseScopeFor(root);
    expect(leaseDir(operatorScope)).toBe(leaseDir(runtimeIdentity));

    const uncertain = projectUncertainWorkspaces(operatorScope, deadHolderProbe);
    expect(uncertain).toHaveLength(1);
    expect(uncertain[0]).toMatchObject({
      workspace_key: workspaceKey(runtimeIdentity),
      worktree_path: root,
      uncertain_reason: 'holder_process_gone',
      holder_activation_id: 'act:SPECIALISTS-4250',
      holder_specialist: 'executor',
    });

    const cwd = vi.spyOn(process, 'cwd').mockReturnValue(root);
    try {
      const loader = { list: async () => [] } as unknown as SpecialistLoader;
      const status = createSpecialistStatusTool(loader, new CircuitBreaker());
      const full = await status.execute({ full: true });
      expect(full.uncertain_workspaces).toHaveLength(1);
      expect(full.uncertain_workspaces[0]).toMatchObject({
        worktree_path: root,
        holder_activation_id: 'act:SPECIALISTS-4250',
      });
      // The status surface uses its real /proc probe (it has no probe injection), which
      // sees the simulated holder PID as gone too.
      expect(full.uncertain_workspaces[0]?.uncertain_reason).toBe('holder_process_gone');
    } finally {
      cwd.mockRestore();
    }

    const reconciled = reconcile(
      operatorScope,
      {
        outcome: 'safe_free',
        decidedBy: 'operator:SPECIALISTS-4250',
        basis: ['proc:holder gone', 'test:runtime lease identity'],
      },
      { probe: deadHolderProbe },
    );
    expect(reconciled).toMatchObject({
      applied: true,
      outcome: 'safe_free',
      observedUncertainReason: 'holder_process_gone',
    });
    expect(projectUncertainWorkspaces(operatorScope, deadHolderProbe)).toEqual([]);
  });
});
