import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs';
import { join } from 'node:path';

export type ProcessHealthThresholds = {
  warnPct: number;
  refusePct: number;
};

export type ProcessHealthProcessKind = 'specialist' | 'dolt' | 'serena-lsp' | 'orphan';

export interface ProcessHealthProcess {
  pid: number;
  ppid: number;
  kind: ProcessHealthProcessKind;
  role: string;
  cmdline: string;
  cwd: string | null;
  rssBytes: number;
  cpuPct: number;
  ageSeconds: number;
  worktree: string | null;
  reason?: 'dolt-worktree-local' | 'gitnexus-orphan' | 'pi-orphan';
}

export interface ProcessHealthWorkspaceGroup {
  workspace: string;
  count: number;
  rssBytes: number;
  processes: ProcessHealthProcess[];
}

export interface ProcessHealthReport {
  memAvailableBytes: number;
  totalRssBytes: number;
  totalCpuPct: number;
  specialistCount: number;
  doltCount: number;
  serenaLspCount: number;
  orphanCount: number;
  thresholdPct: number;
  warnPct: number;
  refusePct: number;
  warnLimitBytes: number;
  refuseLimitBytes: number;
  specialistProcesses: ProcessHealthProcess[];
  doltProcesses: ProcessHealthProcess[];
  serenaWorkspaces: ProcessHealthWorkspaceGroup[];
  orphanProcesses: ProcessHealthProcess[];
}

interface ProcStatSnapshot {
  ppid: number;
  utimeTicks: number;
  stimeTicks: number;
  startTimeTicks: number;
}

interface ProcessSnapshot {
  pid: number;
  ppid: number;
  cmdline: string;
  comm: string;
  cwd: string | null;
  rssBytes: number;
  cpuPct: number;
  ageSeconds: number;
}

const DEFAULT_WARN_PCT = 70;
const DEFAULT_REFUSE_PCT = 85;
const CLOCK_TICKS_PER_SECOND = 100;

function parseThreshold(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function getProcessHealthThresholds(env: NodeJS.ProcessEnv = process.env): ProcessHealthThresholds {
  const warnPct = parseThreshold(env.SPECIALISTS_HEALTH_WARN_PCT, DEFAULT_WARN_PCT);
  const refusePct = parseThreshold(env.SPECIALISTS_HEALTH_REFUSE_PCT, DEFAULT_REFUSE_PCT);
  return { warnPct, refusePct };
}

function readMemAvailableBytes(meminfoPath: string): number {
  try {
    const content = readFileSync(meminfoPath, 'utf-8');
    const match = /^MemAvailable:\s+(\d+)\s+kB$/m.exec(content);
    if (!match) return 0;
    return Number(match[1]) * 1024;
  } catch {
    return 0;
  }
}

function readProcStringOrNull(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return null;
  }
}

function readProcCwdOrNull(pid: number, procRoot: string): string | null {
  try {
    return readlinkSync(join(procRoot, String(pid), 'cwd'));
  } catch {
    return null;
  }
}

function parseStat(stat: string): ProcStatSnapshot | null {
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fields = stat.slice(closeParen + 2).split(' ');
  const ppid = Number(fields[1]);
  const utimeTicks = Number(fields[11]);
  const stimeTicks = Number(fields[12]);
  const startTimeTicks = Number(fields[19]);
  if (![ppid, utimeTicks, stimeTicks, startTimeTicks].every(Number.isFinite)) return null;
  return { ppid, utimeTicks, stimeTicks, startTimeTicks };
}

function readProcessSnapshot(pid: number, procRoot: string, nowMs: number): ProcessSnapshot | null {
  const basePath = join(procRoot, String(pid));
  const cmdlineRaw = readProcStringOrNull(join(basePath, 'cmdline'));
  if (!cmdlineRaw) return null;
  const cmdline = cmdlineRaw.replace(/\0/g, ' ').trim();
  if (!cmdline) return null;

  const comm = (readProcStringOrNull(join(basePath, 'comm')) ?? '').trim();
  const stat = readProcStringOrNull(join(basePath, 'stat'));
  const parsedStat = stat ? parseStat(stat) : null;
  if (!parsedStat) return null;

  const status = readProcStringOrNull(join(basePath, 'status')) ?? '';
  const rssMatch = /VmRSS:\s+(\d+)\s+kB/m.exec(status);
  const rssBytes = rssMatch ? Number(rssMatch[1]) * 1024 : 0;
  const cwd = readProcCwdOrNull(pid, procRoot);
  const cpuSeconds = (parsedStat.utimeTicks + parsedStat.stimeTicks) / CLOCK_TICKS_PER_SECOND;
  const ageSeconds = Math.max(0, (nowMs / 1000) - (parsedStat.startTimeTicks / CLOCK_TICKS_PER_SECOND));
  const cpuPct = ageSeconds > 0 ? (cpuSeconds / ageSeconds) * 100 : 0;

  return { pid, ppid: parsedStat.ppid, cmdline, comm, cwd, rssBytes, cpuPct, ageSeconds };
}

function listPids(procRoot: string): number[] {
  if (!existsSync(procRoot)) return [];
  const pids: number[] = [];
  for (const entry of readdirSync(procRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pid = Number(entry.name);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

function getWorktreeFromCwd(cwd: string | null): string | null {
  if (!cwd) return null;
  const marker = '/.worktrees/';
  const index = cwd.indexOf(marker);
  if (index < 0) return null;
  const tail = cwd.slice(index + marker.length);
  const slash = tail.indexOf('/');
  return cwd.slice(0, index + marker.length + (slash < 0 ? tail.length : slash));
}

function classifyProcess(snapshot: ProcessSnapshot): ProcessHealthProcessKind | null {
  const { cmdline, comm, cwd, ppid } = snapshot;
  const isSpecialist = cmdline.includes('pi-coding-agent') || cmdline.includes('specialists') || cmdline.includes('gitnexus') || cmdline.includes('serena');
  if (cmdline.includes('dolt sql-server')) return 'dolt';
  if (cmdline.includes('serena') && (cmdline.includes('language-server') || cmdline.includes('lsp'))) return 'serena-lsp';
  if ((comm === 'pi' || cmdline.includes('pi-coding-agent') || cmdline.includes('gitnexus') || cmdline.includes('serena')) && ppid === 1) return 'orphan';
  if (isSpecialist || cwd?.includes('/.worktrees/')) return 'specialist';
  return null;
}

function getOrphanReason(snapshot: ProcessSnapshot): 'dolt-worktree-local' | 'gitnexus-orphan' | 'pi-orphan' | null {
  if (snapshot.cmdline.includes('dolt sql-server')) return 'dolt-worktree-local';
  if (snapshot.cmdline.includes('gitnexus') && snapshot.cmdline.includes('mcp') && snapshot.ppid === 1) return 'gitnexus-orphan';
  if ((snapshot.comm === 'pi' || snapshot.cmdline.includes('pi-coding-agent')) && snapshot.ppid === 1) return 'pi-orphan';
  return null;
}

function toProcessHealthProcess(snapshot: ProcessSnapshot, kind: ProcessHealthProcessKind): ProcessHealthProcess {
  return {
    pid: snapshot.pid,
    ppid: snapshot.ppid,
    kind,
    role: kind,
    cmdline: snapshot.cmdline,
    cwd: snapshot.cwd,
    rssBytes: snapshot.rssBytes,
    cpuPct: snapshot.cpuPct,
    ageSeconds: snapshot.ageSeconds,
    worktree: getWorktreeFromCwd(snapshot.cwd),
  };
}

export function collectProcessHealth(options: { procRoot?: string; meminfoPath?: string; nowMs?: number } = {}): ProcessHealthReport {
  const procRoot = options.procRoot ?? '/proc';
  const meminfoPath = options.meminfoPath ?? '/proc/meminfo';
  const nowMs = options.nowMs ?? Date.now();
  const thresholds = getProcessHealthThresholds();
  const memAvailableBytes = readMemAvailableBytes(meminfoPath);
  const processes: ProcessHealthProcess[] = [];

  for (const pid of listPids(procRoot)) {
    const snapshot = readProcessSnapshot(pid, procRoot, nowMs);
    if (!snapshot) continue;
    const kind = classifyProcess(snapshot);
    if (!kind) continue;
    const process = toProcessHealthProcess(snapshot, kind);
    if (kind === 'orphan') process.reason = getOrphanReason(snapshot) ?? undefined;
    processes.push(process);
  }

  const specialistProcesses = processes.filter((process) => process.kind === 'specialist');
  const doltProcesses = processes.filter((process) => process.kind === 'dolt');
  const serenaProcesses = processes.filter((process) => process.kind === 'serena-lsp');
  const orphanProcesses = processes.filter((process) => process.kind === 'orphan');

  const serenaMap = new Map<string, ProcessHealthProcess[]>();
  for (const process of serenaProcesses) {
    const workspace = process.worktree ?? process.cwd ?? 'unknown';
    if (!serenaMap.has(workspace)) serenaMap.set(workspace, []);
    serenaMap.get(workspace)!.push(process);
  }

  const warnLimitBytes = Math.floor(memAvailableBytes * (thresholds.warnPct / 100));
  const refuseLimitBytes = Math.floor(memAvailableBytes * (thresholds.refusePct / 100));
  const totalRssBytes = processes.reduce((sum, process) => sum + process.rssBytes, 0);
  const totalCpuPct = processes.reduce((sum, process) => sum + process.cpuPct, 0);

  return {
    memAvailableBytes,
    totalRssBytes,
    totalCpuPct,
    specialistCount: specialistProcesses.length,
    doltCount: doltProcesses.length,
    serenaLspCount: serenaProcesses.length,
    orphanCount: orphanProcesses.length,
    thresholdPct: memAvailableBytes > 0 ? (totalRssBytes / memAvailableBytes) * 100 : 0,
    warnPct: thresholds.warnPct,
    refusePct: thresholds.refusePct,
    warnLimitBytes,
    refuseLimitBytes,
    specialistProcesses,
    doltProcesses,
    serenaWorkspaces: [...serenaMap.entries()].map(([workspace, workspaceProcesses]) => ({
      workspace,
      count: workspaceProcesses.length,
      rssBytes: workspaceProcesses.reduce((sum, process) => sum + process.rssBytes, 0),
      processes: workspaceProcesses,
    })).sort((left, right) => right.rssBytes - left.rssBytes),
    orphanProcesses,
  };
}

export function collectOrphanProcesses(options: { procRoot?: string; nowMs?: number } = {}): ProcessHealthProcess[] {
  return collectProcessHealth(options).orphanProcesses;
}
