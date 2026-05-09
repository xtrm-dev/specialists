import { existsSync, readFileSync, readdirSync, readlinkSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { SupervisorStatus } from '../specialist/supervisor.js';
import { resolveJobsDir } from '../specialist/job-root.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
import {
  collectWorktreeGcCandidates,
  pruneWorktrees,
  type WorktreeGcCandidate,
} from '../specialist/worktree-gc.js';

interface CleanOptions {
  removeAllCompleted: boolean;
  dryRun: boolean;
  keepRecentCount: number | null;
  aggressivePrune: boolean;
  staleProcessesOnly: boolean;
  staleAfterHours: number;
  reapOrphans: boolean;
}

interface OrphanProcess {
  pid: number;
  ppid: number;
  comm: string;
  cmdline: string;
  cwd: string | null;
  reason: 'dolt-worktree-local' | 'gitnexus-orphan' | 'pi-orphan';
}

interface CompletedJobRecord {
  id: string;
  directoryPath: string;
  completedAtMs: number;
  createdAtMs: number;
  sizeBytes: number;
}

interface StaleProcessCandidate {
  status: SupervisorStatus;
  reason: 'dead-pid' | 'stale-update';
}

const MS_PER_DAY = 86_400_000;
const DEFAULT_TTL_DAYS = 7;
const DEFAULT_STALE_AFTER_HOURS = 24;
const COMPLETED_STATUSES = new Set<SupervisorStatus['status']>(['done', 'error', 'cancelled']);
const STALE_PROCESS_STATUSES = new Set<SupervisorStatus['status']>(['running', 'starting', 'waiting']);
const PROTECTED_SQLITE_SUFFIXES = ['.db', '.db-wal', '.db-shm'] as const;

function parseTtlDaysFromEnvironment(): number {
  const rawValue = process.env.SPECIALISTS_JOB_TTL_DAYS ?? process.env.JOB_TTL_DAYS;
  if (!rawValue) return DEFAULT_TTL_DAYS;

  const parsedValue = Number(rawValue);
  if (!Number.isFinite(parsedValue) || parsedValue < 0) return DEFAULT_TTL_DAYS;

  return parsedValue;
}

function parseOptions(argv: readonly string[]): CleanOptions {
  let removeAllCompleted = false;
  let dryRun = false;
  let keepRecentCount: number | null = null;
  let aggressivePrune = false;
  let staleProcessesOnly = false;
  let staleAfterHours = DEFAULT_STALE_AFTER_HOURS;
  let reapOrphans = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === '--all') {
      removeAllCompleted = true;
      continue;
    }

    if (argument === '--dry-run') {
      dryRun = true;
      continue;
    }

    if (argument === '--processes') {
      staleProcessesOnly = true;
      continue;
    }

    if (argument === '--reap-orphans') {
      reapOrphans = true;
      continue;
    }

    if (argument === '--aggressive-prune') {
      aggressivePrune = true;
      continue;
    }

    if (argument === '--stale-after') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --stale-after');
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) throw new Error('--stale-after must be a non-negative number');
      staleAfterHours = parsedValue;
      index += 1;
      continue;
    }

    if (argument.startsWith('--stale-after=')) {
      const value = argument.slice('--stale-after='.length);
      const parsedValue = Number(value);
      if (!Number.isFinite(parsedValue) || parsedValue < 0) throw new Error('--stale-after must be a non-negative number');
      staleAfterHours = parsedValue;
      continue;
    }

    if (argument === '--keep') {
      const value = argv[index + 1];
      if (!value) throw new Error('Missing value for --keep');
      const parsedValue = Number(value);
      if (!Number.isInteger(parsedValue) || parsedValue < 0) throw new Error('--keep must be a non-negative integer');
      keepRecentCount = parsedValue;
      index += 1;
      continue;
    }

    if (argument.startsWith('--keep=')) {
      const value = argument.slice('--keep='.length);
      const parsedValue = Number(value);
      if (!Number.isInteger(parsedValue) || parsedValue < 0) throw new Error('--keep must be a non-negative integer');
      keepRecentCount = parsedValue;
      continue;
    }

    throw new Error(`Unknown option: ${argument}`);
  }

  if (staleProcessesOnly && (removeAllCompleted || keepRecentCount !== null)) {
    throw new Error('--processes cannot be combined with --all or --keep');
  }
  if (reapOrphans && (removeAllCompleted || keepRecentCount !== null || staleProcessesOnly)) {
    throw new Error('--reap-orphans cannot be combined with --all, --keep, or --processes');
  }

  return { removeAllCompleted, dryRun, keepRecentCount, aggressivePrune, staleProcessesOnly, staleAfterHours, reapOrphans };
}

function readDirectorySizeBytes(directoryPath: string): number {
  let totalBytes = 0;
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    const stats = statSync(entryPath);
    totalBytes += stats.isDirectory() ? readDirectorySizeBytes(entryPath) : stats.size;
  }
  return totalBytes;
}

function containsProtectedSqliteArtifact(directoryPath: string): boolean {
  for (const entry of readdirSync(directoryPath, { withFileTypes: true })) {
    const entryPath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      if (containsProtectedSqliteArtifact(entryPath)) return true;
      continue;
    }
    if (PROTECTED_SQLITE_SUFFIXES.some(suffix => entry.name.endsWith(suffix))) return true;
  }
  return false;
}

function getJobTimestamps(status: SupervisorStatus): { createdAtMs: number; completedAtMs: number; updatedAtMs: number } {
  const typedStatus = status as SupervisorStatus & { created_at_ms?: number; completed_at_ms?: number; updated_at_ms?: number };
  const createdAtMs = typedStatus.started_at_ms ?? typedStatus.created_at_ms ?? typedStatus.updated_at_ms ?? 0;
  const updatedAtMs = typedStatus.updated_at_ms ?? createdAtMs;
  const completedAtMs = typedStatus.completed_at_ms ?? updatedAtMs;
  return { createdAtMs, completedAtMs, updatedAtMs };
}

function readCompletedJobDirectory(baseDirectory: string, entry: { name: string; isDirectory(): boolean }): CompletedJobRecord | null {
  if (!entry.isDirectory()) return null;
  const directoryPath = join(baseDirectory, entry.name);
  if (containsProtectedSqliteArtifact(directoryPath)) return null;
  const statusFilePath = join(directoryPath, 'status.json');
  if (!existsSync(statusFilePath)) return null;

  let statusData: SupervisorStatus;
  try {
    statusData = JSON.parse(readFileSync(statusFilePath, 'utf-8')) as SupervisorStatus;
  } catch {
    return null;
  }

  if (!COMPLETED_STATUSES.has(statusData.status)) return null;
  const { createdAtMs, completedAtMs } = getJobTimestamps(statusData);
  return { id: entry.name, directoryPath, completedAtMs, createdAtMs, sizeBytes: readDirectorySizeBytes(directoryPath) };
}

function collectCompletedJobs(jobsDirectoryPath: string): CompletedJobRecord[] {
  const sqliteClient = createObservabilitySqliteClient();
  const statuses = sqliteClient?.listStatuses() ?? [];
  if (statuses.length > 0) {
    return statuses
      .filter(status => COMPLETED_STATUSES.has(status.status))
      .map(status => {
        const directoryPath = join(jobsDirectoryPath, status.id);
        if (!existsSync(directoryPath) || containsProtectedSqliteArtifact(directoryPath)) return null;
        const { createdAtMs, completedAtMs } = getJobTimestamps(status);
        return { id: status.id, directoryPath, completedAtMs, createdAtMs, sizeBytes: readDirectorySizeBytes(directoryPath) };
      })
      .filter((job): job is CompletedJobRecord => job !== null);
  }

  if (process.env.SPECIALISTS_JOB_FILE_OUTPUT !== 'on') return [];
  return readdirSync(jobsDirectoryPath, { withFileTypes: true })
    .map(entry => readCompletedJobDirectory(jobsDirectoryPath, entry))
    .filter((job): job is CompletedJobRecord => job !== null);
}

function selectJobsToRemove(
  completedJobs: readonly CompletedJobRecord[],
  options: CleanOptions,
  protectedJobIds: ReadonlySet<string>,
): CompletedJobRecord[] {
  const jobsByNewest = [...completedJobs].sort((left, right) => {
    if (right.createdAtMs !== left.createdAtMs) return right.createdAtMs - left.createdAtMs;
    return right.completedAtMs - left.completedAtMs;
  });

  if (options.keepRecentCount !== null) {
    const removable = jobsByNewest.slice(options.keepRecentCount);
    if (options.aggressivePrune) return removable;
    return removable.filter(job => !protectedJobIds.has(job.id));
  }
  if (options.removeAllCompleted) return jobsByNewest;

  const cutoffMs = Date.now() - parseTtlDaysFromEnvironment() * MS_PER_DAY;
  return jobsByNewest.filter(job => job.completedAtMs < cutoffMs);
}

function getProcessLiveness(status: SupervisorStatus): 'alive' | 'dead' | 'invalid' {
  const typedStatus = status as SupervisorStatus & { pid?: number };
  const pid = typedStatus.pid;
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) return 'invalid';

  try {
    process.kill(pid, 0);
    return 'alive';
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ESRCH') {
      return 'dead';
    }
    return 'invalid';
  }
}

/** No-PID 'starting' rows are nearly always orphans from a failed dispatch.
 * They never received a heartbeat, so the long --stale-after window is
 * inappropriate. Shorten it so default `sp clean --processes` reclaims them. */
const STARTING_NO_PID_STALE_MS = 5 * 60 * 1000;

function selectStaleProcesses(statuses: readonly SupervisorStatus[], staleAfterHours: number): StaleProcessCandidate[] {
  const cutoffMs = Date.now() - staleAfterHours * 60 * 60 * 1000;
  const startingNoPidCutoffMs = Date.now() - STARTING_NO_PID_STALE_MS;
  const staleJobs: StaleProcessCandidate[] = [];
  for (const status of statuses) {
    if (!STALE_PROCESS_STATUSES.has(status.status)) continue;

    const liveness = getProcessLiveness(status);
    if (liveness === 'alive') continue;
    if (liveness === 'dead') {
      staleJobs.push({ status, reason: 'dead-pid' });
      continue;
    }

    const updatedAtMs = (status as SupervisorStatus & { updated_at_ms?: number }).updated_at_ms ?? 0;
    const effectiveCutoff = status.status === 'starting' ? Math.max(startingNoPidCutoffMs, cutoffMs) : cutoffMs;
    if (updatedAtMs < effectiveCutoff) staleJobs.push({ status, reason: 'stale-update' });
  }
  return staleJobs;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(1)} ${units[unitIndex]}`;
}

function renderSummary(removedCount: number, freedBytes: number, dryRun: boolean): string {
  const action = dryRun ? 'Would remove' : 'Removed';
  const noun = removedCount === 1 ? 'directory' : 'directories';
  return `${action} ${removedCount} job ${noun} (${formatBytes(freedBytes)} freed)`;
}

function printDryRunPlan(jobs: readonly CompletedJobRecord[]): void {
  if (jobs.length === 0) return;
  console.log('Would remove:');
  for (const job of jobs) console.log(`  - ${job.id}`);
}

function printProcessPlan(jobs: readonly StaleProcessCandidate[]): void {
  if (jobs.length === 0) return;
  console.log('Would cancel:');
  for (const job of jobs) console.log(`  - ${job.status.id} (${job.reason})`);
}

function printWorktreeDryRunPlan(candidates: readonly WorktreeGcCandidate[]): void {
  if (candidates.length === 0) return;
  console.log('Would remove worktrees:');
  for (const candidate of candidates) {
    const label = candidate.branch ? ` (${candidate.branch})` : '';
    console.log(`  - ${candidate.jobId}${label}: ${candidate.worktreePath}`);
  }
}

function printWorktreeGcSummary(removed: readonly WorktreeGcCandidate[], skipped: readonly WorktreeGcCandidate[]): void {
  if (removed.length === 0 && skipped.length === 0) return;
  const noun = removed.length === 1 ? 'worktree' : 'worktrees';
  console.log(`Removed ${removed.length} ${noun}` + (skipped.length > 0 ? ` (${skipped.length} skipped)` : '') + '.');
}

function printUsageAndExit(message: string): never {
  console.error(message);
  console.error('Usage: specialists|sp clean [--all] [--keep <n>] [--aggressive-prune] [--processes [--stale-after <hours>]] [--reap-orphans] [--dry-run]');
  process.exit(1);
}

// ── Orphan-process reaper (Linux /proc) ────────────────────────────────────────
// Reaps three classes of pre-fix leaks (see unitAI-85xxp / unitAI-1phu7 /
// unitAI-0wz2p):
//   1. dolt sql-server processes whose cwd is under */.worktrees/* (per-worktree
//      dolt servers from the bd-stub-was-rescaffolded bug, fixed in 7c2b630a)
//   2. gitnexus mcp processes orphaned to PID 1 (from --keep-alive teardown leaks
//      before b12dd0fc shipped detached + group-SIGKILL)
//   3. pi / pi-coding-agent processes orphaned to PID 1 (same root cause)
//
// Strict matching: only reap processes that meet BOTH the command pattern AND
// the orphan/cwd condition. Never touch the bd shared-server dolt or any
// dolt/gitnexus process under a live supervisor.

function readProcStringOrNull(path: string): string | null {
  try { return readFileSync(path, 'utf-8'); } catch { return null; }
}

function readProcCwdOrNull(pid: number): string | null {
  try { return readlinkSync(`/proc/${pid}/cwd`); } catch { return null; }
}

function getProcPpid(pid: number): number | null {
  const stat = readProcStringOrNull(`/proc/${pid}/stat`);
  if (!stat) return null;
  // Format: "<pid> (<comm>) <state> <ppid> ...". `comm` may contain spaces or
  // parens; locate the last ')' to anchor the rest.
  const closeParen = stat.lastIndexOf(')');
  if (closeParen < 0) return null;
  const fields = stat.slice(closeParen + 2).split(' ');
  const ppid = Number(fields[1]);
  return Number.isInteger(ppid) ? ppid : null;
}

function listAllPids(): number[] {
  if (!existsSync('/proc')) return [];
  const pids: number[] = [];
  for (const entry of readdirSync('/proc', { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const pid = Number(entry.name);
    if (Number.isInteger(pid) && pid > 0) pids.push(pid);
  }
  return pids;
}

function findOrphanProcesses(): OrphanProcess[] {
  const orphans: OrphanProcess[] = [];
  for (const pid of listAllPids()) {
    const cmdlineRaw = readProcStringOrNull(`/proc/${pid}/cmdline`);
    if (!cmdlineRaw) continue;
    const cmdline = cmdlineRaw.replace(/\0/g, ' ').trim();
    if (!cmdline) continue;

    const comm = (readProcStringOrNull(`/proc/${pid}/comm`) ?? '').trim();
    const ppid = getProcPpid(pid) ?? -1;
    const cwd = readProcCwdOrNull(pid);

    // (1) per-worktree dolt sql-server
    if (cmdline.includes('dolt sql-server') && cwd && (cwd.includes('/.worktrees/') || cwd.includes('/.xtrm/worktrees/'))) {
      orphans.push({ pid, ppid, comm, cmdline, cwd, reason: 'dolt-worktree-local' });
      continue;
    }
    // (2) gitnexus mcp orphans (parent dead → reparented to PID 1)
    if (cmdline.includes('gitnexus') && cmdline.includes('mcp') && ppid === 1) {
      orphans.push({ pid, ppid, comm, cmdline, cwd, reason: 'gitnexus-orphan' });
      continue;
    }
    // (3) pi-coding-agent orphans
    if ((comm === 'pi' || cmdline.includes('pi-coding-agent')) && ppid === 1) {
      orphans.push({ pid, ppid, comm, cmdline, cwd, reason: 'pi-orphan' });
      continue;
    }
  }
  return orphans;
}

async function killOrphanProcesses(orphans: readonly OrphanProcess[], dryRun: boolean): Promise<number> {
  if (dryRun) return orphans.length;
  let killed = 0;
  for (const orphan of orphans) {
    try {
      // SIGTERM first to give graceful shutdown a chance.
      process.kill(orphan.pid, 'SIGTERM');
    } catch { /* already dead */ }
  }
  // Brief grace period then SIGKILL anything still alive.
  if (orphans.length > 0) await new Promise(resolve => setTimeout(resolve, 1500));
  for (const orphan of orphans) {
    try {
      process.kill(orphan.pid, 0);
      try { process.kill(orphan.pid, 'SIGKILL'); } catch { /* race */ }
    } catch {
      // ESRCH = already gone
    }
    killed += 1;
  }
  return killed;
}

function printOrphanPlan(orphans: readonly OrphanProcess[]): void {
  if (orphans.length === 0) {
    console.log('No orphan processes found.');
    return;
  }
  const action = 'Would reap';
  console.log(`${action} ${orphans.length} orphan process(es):`);
  for (const orphan of orphans) {
    const cwdSuffix = orphan.cwd ? ` cwd=${orphan.cwd}` : '';
    console.log(`  - pid=${orphan.pid} ppid=${orphan.ppid} reason=${orphan.reason} comm=${orphan.comm}${cwdSuffix}`);
  }
}

function printOrphanSummary(killedCount: number): void {
  if (killedCount === 0) return;
  const noun = killedCount === 1 ? 'orphan' : 'orphans';
  console.log(`Reaped ${killedCount} ${noun}.`);
}

function deleteJobDirectories(jobs: readonly CompletedJobRecord[]): number {
  for (const job of jobs) {
    rmSync(job.directoryPath, { recursive: true, force: true });
  }
  return jobs.length;
}

function removeStaleProcesses(statuses: readonly StaleProcessCandidate[], dryRun: boolean): number {
  const sqliteClient = createObservabilitySqliteClient();
  if (!sqliteClient) return 0;
  if (dryRun) return statuses.length;

  let updatedCount = 0;
  for (const candidate of statuses) {
    const typedStatus = candidate.status as SupervisorStatus & { completed_at_ms?: number; updated_at_ms?: number };
    const cancelledStatus: SupervisorStatus = {
      ...candidate.status,
      status: 'cancelled',
      completed_at_ms: typedStatus.completed_at_ms ?? Date.now(),
      updated_at_ms: Date.now(),
    } as SupervisorStatus;
    sqliteClient.upsertStatus(cancelledStatus);
    updatedCount += 1;
  }
  return updatedCount;
}

export async function run(): Promise<void> {
  let options: CleanOptions;
  try {
    options = parseOptions(process.argv.slice(3));
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    printUsageAndExit(message);
  }

  if (options.reapOrphans) {
    const orphans = findOrphanProcesses();
    if (options.dryRun) {
      printOrphanPlan(orphans);
      return;
    }
    if (orphans.length === 0) {
      console.log('No orphan processes found.');
      return;
    }
    printOrphanPlan(orphans);
    const killedCount = await killOrphanProcesses(orphans, false);
    printOrphanSummary(killedCount);
    return;
  }

  const jobsDirectoryPath = resolveJobsDir();
  if (!existsSync(jobsDirectoryPath)) {
    console.log('No jobs directory found.');
    return;
  }

  const sqliteClient = createObservabilitySqliteClient();
  const statuses = sqliteClient?.listStatuses() ?? [];
  const worktreeCandidates = collectWorktreeGcCandidates(jobsDirectoryPath);
  const protectedJobIds = options.keepRecentCount !== null && !options.aggressivePrune && sqliteClient
    ? new Set(sqliteClient.listReferencedChainRootJobIds())
    : new Set<string>();

  if (options.staleProcessesOnly) {
    const staleJobs = selectStaleProcesses(statuses, options.staleAfterHours);
    if (options.dryRun) {
      printProcessPlan(staleJobs);
      console.log(renderSummary(staleJobs.length, 0, true));
      printWorktreeDryRunPlan(worktreeCandidates);
      return;
    }

    const cancelledCount = removeStaleProcesses(staleJobs, false);
    console.log(renderSummary(cancelledCount, 0, false));

    if (worktreeCandidates.length > 0) {
      const worktreeResult = pruneWorktrees(worktreeCandidates);
      printWorktreeGcSummary(worktreeResult.removed, worktreeResult.skipped);
    }
    return;
  }

  const completedJobs = collectCompletedJobs(jobsDirectoryPath);
  const jobsToRemove = selectJobsToRemove(completedJobs, options, protectedJobIds);
  const freedBytes = jobsToRemove.reduce((total, job) => total + job.sizeBytes, 0);

  if (options.dryRun) {
    printDryRunPlan(jobsToRemove);
    console.log(renderSummary(jobsToRemove.length, freedBytes, true));
    printWorktreeDryRunPlan(worktreeCandidates);
    return;
  }

  deleteJobDirectories(jobsToRemove);
  console.log(renderSummary(jobsToRemove.length, freedBytes, false));

  if (worktreeCandidates.length > 0) {
    const worktreeResult = pruneWorktrees(worktreeCandidates);
    printWorktreeGcSummary(worktreeResult.removed, worktreeResult.skipped);
  }
}
