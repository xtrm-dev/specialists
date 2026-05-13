import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { collectOrphanProcesses, collectProcessHealth, collectStaleSpecialistJobs } from '../../../src/specialist/process-health.js';

function writeProcProcess(root: string, pid: number, data: { cmdline: string; comm: string; stat: string; status: string; cwd?: string }): void {
  const dir = join(root, String(pid));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'cmdline'), data.cmdline, 'utf-8');
  writeFileSync(join(dir, 'comm'), data.comm, 'utf-8');
  writeFileSync(join(dir, 'stat'), data.stat, 'utf-8');
  writeFileSync(join(dir, 'status'), data.status, 'utf-8');
  if (data.cwd) symlinkSync(data.cwd, join(dir, 'cwd')); 
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

  it('warns when dolt or orphan process counts exceed safe defaults', () => {
    root = mkdtempSync(join(tmpdir(), 'process-health-'));
    const meminfo = join(root, 'meminfo');
    writeFileSync(meminfo, 'MemAvailable:       100000 kB\n', 'utf-8');
    writeFileSync(join(root, 'uptime'), '2000.00 1000.00\n', 'utf-8');

    for (const pid of [201, 202]) {
      writeProcProcess(root, pid, {
        cmdline: 'dolt sql-server\0',
        comm: 'dolt',
        stat: `${pid} (dolt) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0`,
        status: 'VmRSS:\t1024 kB\n',
        cwd: '/home/me/.worktrees/alpha/.beads',
      });
    }

    const report = collectProcessHealth({ procRoot: root, meminfoPath: meminfo });

    expect(report.status).toBe('WARN');
    expect(report.statusReasons).toContain('dolt sql-server count 2 > expected 1');
  });

  it('collects deleted-cwd dolt and tool processes as reapable leaks', () => {
    root = mkdtempSync(join(tmpdir(), 'process-health-'));
    const meminfo = join(root, 'meminfo');
    writeFileSync(meminfo, 'MemAvailable:       100000 kB\n', 'utf-8');
    writeFileSync(join(root, 'uptime'), '2000.00 1000.00\n', 'utf-8');

    writeProcProcess(root, 301, {
      cmdline: 'dolt sql-server\0',
      comm: 'dolt',
      stat: '301 (dolt) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo/.worktrees/a/a/.beads/dolt (deleted)',
    });
    writeProcProcess(root, 302, {
      cmdline: 'serena language-server\0',
      comm: 'serena',
      stat: '302 (serena) S 2 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo/.worktrees/a/a (deleted)',
    });
    writeProcProcess(root, 303, {
      cmdline: 'dolt sql-server\0',
      comm: 'dolt',
      stat: '303 (dolt) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo/.beads/dolt',
    });

    const reapable = collectOrphanProcesses({ procRoot: root, meminfoPath: meminfo });

    expect(reapable.map(process => process.pid)).toEqual([301, 302]);
    expect(reapable[0]?.reason).toBe('dolt-worktree-local');
    expect(reapable[1]?.reason).toBe('deleted-worktree-process');
  });

  it('collects stale specialist jobs for dead pids and orphaned keep-alives', () => {
    root = mkdtempSync(join(tmpdir(), 'process-health-'));
    const meminfo = join(root, 'meminfo');
    writeFileSync(meminfo, 'MemAvailable:	100000 kB\n', 'utf-8');
    writeFileSync(join(root, 'uptime'), '4000.00 1000.00\n', 'utf-8');

    const alivePid = 601;
    const keepAlivePid = 602;
    writeProcProcess(root, keepAlivePid, {
      cmdline: 'specialists run executor --bead abc\0',
      comm: 'bun',
      stat: '602 (bun) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 0 100000',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo/.worktrees/xtrm-tools',
    });

    const jobs = collectStaleSpecialistJobs({
      procRoot: root,
      nowMs: 4_000_000,
      minKeepAliveAgeMs: 30 * 60 * 1000,
      observabilityClient: {
        listStatuses: () => [
          { id: 'dead-job', bead_id: 'bead-dead', specialist: 'tester', status: 'running', pid: 600, updated_at_ms: 1_000_000 },
          { id: 'keepalive-job', bead_id: 'bead-live', specialist: 'tester', status: 'waiting', pid: keepAlivePid, updated_at_ms: 1_000_000 },
          { id: 'too-fresh', bead_id: 'bead-fresh', specialist: 'tester', status: 'waiting', pid: alivePid, updated_at_ms: 3_900_000 },
        ],
      },
    });

    expect(jobs).toEqual([
      { jobId: 'dead-job', pid: 600, beadId: 'bead-dead', specialist: 'tester', cwd: null, ageMs: 3_000_000, reason: 'dead-pid' },
      { jobId: 'keepalive-job', pid: keepAlivePid, beadId: 'bead-live', specialist: 'tester', cwd: '/repo/.worktrees/xtrm-tools', ageMs: 3_000_000, reason: 'orphaned-keep-alive' },
    ]);
  });
  it('does not count MCP, tsserver, or shell tooling as specialist jobs', () => {
    root = mkdtempSync(join(tmpdir(), 'process-health-'));
    const meminfo = join(root, 'meminfo');
    writeFileSync(meminfo, 'MemAvailable:       100000 kB\n', 'utf-8');
    writeFileSync(join(root, 'uptime'), '2000.00 1000.00\n', 'utf-8');

    writeProcProcess(root, 401, {
      cmdline: 'serena start-mcp-server\0',
      comm: 'python',
      stat: '401 (python) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo',
    });
    writeProcProcess(root, 402, {
      cmdline: 'node gitnexus mcp\0',
      comm: 'node',
      stat: '402 (node) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo',
    });
    writeProcProcess(root, 403, {
      cmdline: 'node node_modules/typescript/lib/tsserver.js\0',
      comm: 'node',
      stat: '403 (node) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo',
    });
    writeProcProcess(root, 404, {
      cmdline: 'bun /path/to/specialists run executor --bead abc\0',
      comm: 'bun',
      stat: '404 (bun) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo',
    });
    writeProcProcess(root, 405, {
      cmdline: '/usr/bin/zsh -c specialists run executor --bead abc\0',
      comm: 'zsh',
      stat: '405 (zsh) S 1 1 1 0 -1 4194560 100 0 0 80 20 0 0 20 0 1 0 1000 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0',
      status: 'VmRSS:\t1024 kB\n',
      cwd: '/repo',
    });

    const report = collectProcessHealth({ procRoot: root, meminfoPath: meminfo });

    expect(report.specialistCount).toBe(1);
    expect(report.specialistProcesses[0]?.pid).toBe(404);
  });

});
