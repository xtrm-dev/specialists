import { describe, expect, it } from 'vitest';

import { abandonEpic, syncEpicState } from '../../../src/specialist/epic-reconciler.js';

describe('syncEpicState stale chain cleanup', () => {
  it('prunes stale chain refs during --apply and unblocks readiness state', () => {
    const epicRun = {
      epic_id: 'unitAI-gc2a',
      status: 'resolving',
      status_json: '{}',
      updated_at_ms: 1,
    };

    const chainMembership = [{ chain_id: 'chain-stale', epic_id: 'unitAI-gc2a' }];

    const sqlite = {
      readEpicRun: () => epicRun,
      listEpicChains: () => chainMembership,
      listStatuses: () => [],
      listChainJobIds: (_chainId: string) => [],
      readResult: (_jobId: string) => null,
      upsertStatus: () => undefined,
      deleteEpicChainMembership: (_epicId: string, chainIds: readonly string[]) => {
        const deleted = [...chainIds];
        chainMembership.splice(0, chainMembership.length);
        return deleted;
      },
      upsertEpicRun: (next: any) => {
        epicRun.status = next.status;
        epicRun.status_json = next.status_json;
        epicRun.updated_at_ms = next.updated_at_ms;
      },
    } as any;

    const result = syncEpicState(sqlite, 'unitAI-gc2a', true);

    expect(result.drift.stale_chain_refs).toEqual(['chain-stale']);
    expect(result.repairs.stale_chain_refs_pruned).toEqual(['chain-stale']);
    expect(result.readiness_before.readiness_state).toBe('resolving');
    expect(result.readiness_after.readiness_state).toBe('merge_ready');
    expect(epicRun.status).toBe('merge_ready');
  });
});

describe('abandonEpic state recovery', () => {
  function makeMockSqlite(initialStatus: string) {
    const epicRun: any = {
      epic_id: 'unitAI-stuck',
      status: initialStatus,
      status_json: '{}',
      updated_at_ms: 1,
    };
    return {
      epicRun,
      sqlite: {
        readEpicRun: () => epicRun,
        listEpicChains: () => [],
        listChainJobIds: () => [],
        listStatuses: () => [],
        upsertEpicRun: (next: any) => {
          epicRun.status = next.status;
          epicRun.status_json = next.status_json;
          epicRun.updated_at_ms = next.updated_at_ms;
        },
      } as any,
    };
  }

  it('allows failed -> abandoned recovery when no live members', () => {
    const { epicRun, sqlite } = makeMockSqlite('failed');
    const result = abandonEpic(sqlite, 'unitAI-stuck', 'cleanup', false);
    expect(result.from_state).toBe('failed');
    expect(result.to_state).toBe('abandoned');
    expect(epicRun.status).toBe('abandoned');
  });

  it('refuses to re-abandon an already-abandoned epic', () => {
    const { sqlite } = makeMockSqlite('abandoned');
    expect(() => abandonEpic(sqlite, 'unitAI-stuck', 'cleanup', false)).toThrow(/already abandoned/);
  });

  it('refuses to abandon a merged epic', () => {
    const { sqlite } = makeMockSqlite('merged');
    expect(() => abandonEpic(sqlite, 'unitAI-stuck', 'cleanup', false)).toThrow(/already merged/);
  });
});
