import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectProcessHealth } from '../../../src/specialist/process-health.js';

function writeProcProcess(root: string, pid: number, data: { cmdline: string; comm: string; stat: string; status: string; cwd?: string }): void {
  const dir = join(root, String(pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cmdline'), data.cmdline, 'utf-8');
  writeFileSync(join(dir, 'comm'), data.comm, 'utf-8');
  writeFileSync(join(dir, 'stat'), data.stat, 'utf-8');
  writeFileSync(join(dir, 'status'), data.status, 'utf-8');
  if (data.cwd) writeFileSync(join(dir, 'cwd'), data.cwd, 'utf-8');
}

describe('process-health', () => {
  let root = '';

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('collects rss, dolt, serena, and orphan signals from proc snapshot fixtures', () => {
    root = mkdtempSync(join(tmpdir(), 'process-health-'));
    const meminfo = join(root, 'meminfo');
    writeFileSync(meminfo, 'MemAvailable:       1000 kB\n', 'utf-8');
    writeFileSync(join(root, 'uptime'), '2000.00 1000.00\n', 'utf-8');

    writeProcProcess(root, 101, {
      cmdline: 'specialists\0run\0',
      comm: 'specialists',
      stat: '101 (specialists) R   1 1 1 0 -1 4194560 100 0 0 200 50 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t2048 kB\n',
      cwd: '/home/me/.worktrees/alpha',
    });
    writeProcProcess(root, 102, {
      cmdline: 'dolt sql-server\0',
      comm: 'dolt',
      stat: '102 (dolt) S  1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/home/me/.worktrees/alpha/.beads',
    });
    writeProcProcess(root, 103, {
      cmdline: 'serena language-server\0',
      comm: 'serena',
      stat: '103 (serena) S    1 1 1 0 -1 4194560 100 0 0 60 10 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t512 kB\n',
      cwd: '/home/me/.worktrees/alpha/.serena',
    });
    writeProcProcess(root, 104, {
      cmdline: 'gitnexus mcp\0',
      comm: 'gitnexus',
      stat: '104 (gitnexus) S  1 1 1 0 -1 4194560 100 0 0 50 10 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t256 kB\n',
      cwd: '/tmp/orphan',
    });

    const report = collectProcessHealth({ procRoot: root, meminfoPath: meminfo, nowMs: 200_000 });

    expect(report.specialistCount).toBe(1);
    expect(report.doltCount).toBe(1);
    expect(report.serenaLspCount).toBe(1);
    expect(report.orphanCount).toBe(1);
    expect(report.warnPct).toBe(70);
    expect(report.refusePct).toBe(85);
    expect(report.totalRssBytes).toBe(3840 * 1024);
    expect(report.serenaWorkspaces[0]?.count).toBe(1);
    expect(report.specialistProcesses[0]?.ageSeconds).toBeCloseTo(2000, 1);
    expect(report.specialistProcesses[0]?.cpuPct).toBeGreaterThan(0);
  });
});
