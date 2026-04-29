import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
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
  staleProcessesOnly: boolean;
  staleAfterHours: number;
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
  let staleProcessesOnly = false;
  let staleAfterHours = DEFAULT_STALE_AFTER_HOURS;

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

  return { removeAllCompleted, dryRun, keepRecentCount, staleProcessesOnly, staleAfterHours };
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

function selectJobsToRemove(completedJobs: readonly CompletedJobRecord[], options: CleanOptions): CompletedJobRecord[] {
  const jobsByNewest = [...completedJobs].sort((left, right) => {
    if (right.createdAtMs !== left.createdAtMs) return right.createdAtMs - left.createdAtMs;
    return right.completedAtMs - left.completedAtMs;
  });

  if (options.keepRecentCount !== null) return jobsByNewest.slice(options.keepRecentCount);
  if (options.removeAllCompleted) return jobsByNewest;

  const cutoffMs = Date.now() - parseTtlDaysFromEnvironment() * MS_PER_DAY;
  return jobsByNewest.filter(job => job.completedAtMs < cutoffMs);
}

function getProcessLiveness(status: SupervisorStatus): StaleProcessCandidate | null {
  const typedStatus = status as SupervisorStatus & { pid?: number; updated_at_ms?: number };
  const pid = typeof typedStatus.pid === 'number' ? typedStatus.pid : null;
  if (pid !== null && pid > 0) {
    try {
      process.kill(pid, 0);
    } catch (error: unknown) {
      if (error instanceof Error && 'code' in error && (error as { code?: string }).code === 'ESRCH') {
        return { status, reason: 'dead-pid' };
      }
    }
  }
  return null;
}

function selectStaleProcesses(statuses: readonly SupervisorStatus[], staleAfterHours: number): StaleProcessCandidate[] {
  const cutoffMs = Date.now() - staleAfterHours * 60 * 60 * 1000;
  return statuses
    .filter(status => STALE_PROCESS_STATUSES.has(status.status))
    .map(status => {
      const liveness = getProcessLiveness(status);
      if (liveness) return liveness;
      const updatedAtMs = (status as SupervisorStatus & { updated_at_ms?: number }).updated_at_ms ?? 0;
      return updatedAtMs < cutoffMs ? { status, reason: 'stale-update' } : null;
    })
    .filter((candidate): candidate is StaleProcessCandidate => candidate !== null);
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
  console.error('Usage: specialists|sp clean [--all] [--keep <n>] [--processes [--stale-after <hours>]] [--dry-run]');
  process.exit(1);
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

  const jobsDirectoryPath = resolveJobsDir();
  if (!existsSync(jobsDirectoryPath)) {
    console.log('No jobs directory found.');
    return;
  }

  const sqliteClient = createObservabilitySqliteClient();
  const statuses = sqliteClient?.listStatuses() ?? [];
  const worktreeCandidates = collectWorktreeGcCandidates(jobsDirectoryPath);

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
  const jobsToRemove = selectJobsToRemove(completedJobs, options);
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
