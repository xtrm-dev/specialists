// src/cli/log.ts
// Runtime-oriented specialist log stream. Unlike feed, this does not suppress
// lifecycle/control rows and always prefixes rows with job/bead/repo/path data.

import { basename } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
import type { SupervisorStatus } from '../specialist/supervisor.js';
import type { TimelineEvent } from '../specialist/timeline-events.js';
import { formatDateTime, formatElapsed, formatTokenUsageSummary } from './format-helpers.js';

interface LogOptions {
  jobId?: string;
  specialist?: string;
  beadId?: string;
  nodeId?: string;
  since?: number;
  limit: number;
  follow: boolean;
  json: boolean;
}

interface LogRow {
  jobId: string;
  specialist: string;
  beadId?: string;
  nodeId?: string;
  repo?: string;
  path?: string;
  branch?: string;
  status?: string;
  pid?: number;
  model?: string;
  backend?: string;
  chainId?: string;
  chainRootJobId?: string;
  chainRootBeadId?: string;
  event: TimelineEvent;
}

function parseSince(value: string): number | undefined {
  if (value.includes('T') || value.includes('-')) return new Date(value).getTime();
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2];
  const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Date.now() - n * ms[unit];
}

function parseArgs(argv: readonly string[]): LogOptions {
  let jobId: string | undefined;
  let specialist: string | undefined;
  let beadId: string | undefined;
  let nodeId: string | undefined;
  let since: number | undefined;
  let limit = 200;
  let follow = false;
  let json = false;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if ((token === '--job' || token === '--job-id') && argv[i + 1]) { jobId = argv[++i]; continue; }
    if (token === '--specialist' && argv[i + 1]) { specialist = argv[++i]; continue; }
    if ((token === '--bead' || token === '--bead-id') && argv[i + 1]) { beadId = argv[++i]; continue; }
    if (token === '--node' && argv[i + 1]) { nodeId = argv[++i]; continue; }
    if (token === '--since' && argv[i + 1]) { since = parseSince(argv[++i]); continue; }
    if (token === '--limit' && argv[i + 1]) { limit = Math.max(1, Number(argv[++i]) || limit); continue; }
    if (token === '--follow' || token === '-f') { follow = true; continue; }
    if (token === '--json') { json = true; continue; }
    if (!token.startsWith('-') && !jobId) { jobId = token; continue; }
    throw new Error(`Unknown option: ${token}`);
  }

  return { jobId, specialist, beadId, nodeId, since, limit, follow, json };
}

const repoCache = new Map<string, { repo?: string; path?: string }>();

function resolveRepo(path: string | undefined): { repo?: string; path?: string } {
  if (!path) return { path: process.cwd(), repo: basename(process.cwd()) };
  const cached = repoCache.get(path);
  if (cached) return cached;

  try {
    const root = execFileSync('git', ['-C', path, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const result = { repo: basename(root), path: root || path };
    repoCache.set(path, result);
    return result;
  } catch {
    const result = { repo: basename(path), path };
    repoCache.set(path, result);
    return result;
  }
}

function matches(status: SupervisorStatus, options: LogOptions): boolean {
  if (options.jobId && status.id !== options.jobId) return false;
  if (options.specialist && status.specialist !== options.specialist) return false;
  if (options.beadId && status.bead_id !== options.beadId) return false;
  if (options.nodeId && status.node_id !== options.nodeId) return false;
  return true;
}

function toRows(statuses: SupervisorStatus[], options: LogOptions, readEvents: (jobId: string) => TimelineEvent[]): LogRow[] {
  const rows: LogRow[] = [];
  for (const status of statuses) {
    if (!matches(status, options)) continue;
    const repo = resolveRepo(status.worktree_path);
    const events = readEvents(status.id).filter((event) => options.since === undefined || event.t >= options.since);
    for (const event of events) {
      rows.push({
        jobId: status.id,
        specialist: status.specialist,
        beadId: status.bead_id,
        nodeId: status.node_id,
        repo: repo.repo,
        path: repo.path,
        branch: status.branch,
        status: status.status,
        pid: status.pid,
        model: status.model,
        backend: status.backend,
        chainId: status.chain_id,
        chainRootJobId: status.chain_root_job_id,
        chainRootBeadId: status.chain_root_bead_id,
        event,
      });
    }

    if (events.length === 0 && (options.jobId || options.beadId || options.specialist || options.nodeId)) {
      rows.push({
        jobId: status.id,
        specialist: status.specialist,
        beadId: status.bead_id,
        nodeId: status.node_id,
        repo: repo.repo,
        path: repo.path,
        branch: status.branch,
        status: status.status,
        pid: status.pid,
        model: status.model,
        backend: status.backend,
        chainId: status.chain_id,
        chainRootJobId: status.chain_root_job_id,
        chainRootBeadId: status.chain_root_bead_id,
        event: { t: status.last_event_at_ms ?? status.started_at_ms, type: 'status_snapshot' } as unknown as TimelineEvent,
      });
    }
  }

  rows.sort((a, b) => a.event.t - b.event.t || a.jobId.localeCompare(b.jobId) || ((a.event.seq ?? 0) - (b.event.seq ?? 0)));
  return rows.slice(Math.max(0, rows.length - options.limit));
}

function compact(value: unknown, max = 240): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const flat = (raw ?? '').replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

function eventDetail(event: TimelineEvent): string {
  if (event.type === 'run_start') {
    return `specialist=${event.specialist}${event.bead_id ? ` bead=${event.bead_id}` : ''}`;
  }
  if (event.type === 'control_signal') {
    return [
      `action=${event.action}`,
      `source=${event.source}`,
      event.previous_status || event.next_status ? `status=${event.previous_status ?? '?'}->${event.next_status ?? '?'}` : null,
      event.pid !== undefined ? `pid=${event.pid}` : null,
      event.signal ? `signal=${event.signal}` : null,
      event.force !== undefined ? `force=${event.force}` : null,
      event.reason ? `reason=${compact(event.reason, 160)}` : null,
      event.message_preview ? `message="${compact(event.message_preview, 180)}"` : null,
      event.task_preview ? `task="${compact(event.task_preview, 180)}"` : null,
      event.error_message ? `error=${compact(event.error_message, 180)}` : null,
    ].filter(Boolean).join(' ');
  }
  if (event.type === 'status_change') {
    return `status=${event.previous_status ?? '?'}->${event.status}`;
  }
  if (event.type === 'run_complete') {
    return [
      `status=${event.status}`,
      `elapsed=${formatElapsed(event.elapsed_s)}`,
      event.exit_reason ? `exit=${event.exit_reason}` : null,
      event.finish_reason ? `finish=${event.finish_reason}` : null,
      event.error ? `error=${compact(event.error, 500)}` : null,
      ...formatTokenUsageSummary(event.token_usage ?? event.metrics?.token_usage),
      event.tool_calls ? `tools=${event.tool_calls.length}` : null,
    ].filter(Boolean).join(' ');
  }
  if (event.type === 'tool') {
    const args = event.args ? ` args=${compact(event.args, 300)}` : '';
    const result = event.result_summary ? ` result=${compact(event.result_summary, 300)}` : '';
    return `tool=${event.tool} phase=${event.phase}${event.is_error ? ' error=true' : ''}${args}${result}`;
  }
  if (event.type === 'error') return `source=${event.source} error=${compact(event.error_message, 500)}`;
  if (event.type === 'meta') return `model=${event.model} backend=${event.backend}${event.source ? ` source=${event.source}` : ''}`;
  if (event.type === 'stale_warning') return `reason=${event.reason} silence_ms=${event.silence_ms} threshold_ms=${event.threshold_ms}${event.tool ? ` tool=${event.tool}` : ''}`;
  if (event.type === 'token_usage') return `${formatTokenUsageSummary(event.token_usage).join(' ')} source=${event.source}`;
  if (event.type === 'turn_summary') return `turn=${event.turn_index}${event.finish_reason ? ` finish=${event.finish_reason}` : ''}${event.context_pct !== undefined ? ` context=${event.context_pct.toFixed(2)}%` : ''}${event.text_content ? ` text="${compact(event.text_content, 160)}"` : ''}`;
  if (event.type === 'auto_commit_success' || event.type === 'auto_commit_skipped' || event.type === 'auto_commit_failed') return `reason=${event.reason ?? ''}${event.commit_sha ? ` commit=${event.commit_sha}` : ''}${event.committed_files ? ` files=${event.committed_files.join(',')}` : ''}`.trim();
  if (event.type === 'finish_reason') return `reason=${event.finish_reason} source=${event.source}`;
  if (event.type === 'compaction' || event.type === 'retry') return `phase=${event.phase}`;
  if (event.type === 'message') return `phase=${event.phase} role=${event.role}`;
  if (event.type === 'turn') return `phase=${event.phase}`;
  return compact(event, 500);
}

function printRow(row: LogRow, json: boolean): void {
  if (json) {
    console.log(JSON.stringify({
      timestamp: new Date(row.event.t).toISOString(),
      job_id: row.jobId,
      specialist: row.specialist,
      bead_id: row.beadId ?? null,
      node_id: row.nodeId ?? null,
      repo: row.repo ?? null,
      path: row.path ?? null,
      branch: row.branch ?? null,
      status: row.status ?? null,
      pid: row.pid ?? null,
      model: row.model ?? null,
      backend: row.backend ?? null,
      chain_id: row.chainId ?? null,
      chain_root_job_id: row.chainRootJobId ?? null,
      chain_root_bead_id: row.chainRootBeadId ?? null,
      event: row.event,
    }));
    return;
  }

  const prefix = [
    formatDateTime(row.event.t),
    `job=${row.jobId}`,
    `specialist=${row.specialist}`,
    `bead=${row.beadId ?? '-'}`,
    row.nodeId ? `node=${row.nodeId}` : null,
    `repo=${row.repo ?? '-'}`,
    `path=${row.path ?? '-'}`,
    row.branch ? `branch=${row.branch}` : null,
    `status=${row.status ?? '-'}`,
    row.pid !== undefined ? `pid=${row.pid}` : null,
    row.model ? `model=${row.backend ? `${row.backend}/` : ''}${row.model}` : null,
    row.chainId ? `chain=${row.chainId}` : null,
    `seq=${row.event.seq ?? '-'}`,
    `event=${row.event.type}`,
  ].filter(Boolean).join(' ');
  console.log(`${prefix} ${eventDetail(row.event)}`.trim());
}

export async function run(argv: readonly string[] = process.argv.slice(3)): Promise<void> {
  let options: LogOptions;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error('Usage: specialists|sp log [job-id] [--specialist <name>] [--bead <id>] [--node <id>] [--since <5m|iso>] [--limit <n>] [-f|--follow] [--json]');
    process.exit(1);
  }

  const sqlite = createObservabilitySqliteClient();
  if (!sqlite) {
    console.error('Observability SQLite DB is unavailable. Run: specialists db setup');
    process.exit(1);
  }

  const printed = new Set<string>();
  const printSnapshot = (): void => {
    const statuses = sqlite.listStatuses();
    const rows = toRows(statuses, options, (jobId) => sqlite.readEvents(jobId));
    for (const row of rows) {
      const key = `${row.jobId}:${row.event.seq ?? row.event.t}:${row.event.type}`;
      if (printed.has(key)) continue;
      printed.add(key);
      printRow(row, options.json);
    }
    if (rows.length === 0 && !options.json && printed.size === 0) console.error('No matching specialist log rows.');
  };

  try {
    printSnapshot();
    if (!options.follow) return;

    if (!options.json) console.error('Following specialist runtime logs... (Ctrl+C to stop)');
    await new Promise<void>((resolve) => {
      const interval = setInterval(printSnapshot, 750);
      const stop = () => { clearInterval(interval); resolve(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } finally {
    sqlite.close();
  }
}
