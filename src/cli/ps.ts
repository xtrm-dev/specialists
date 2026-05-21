import { spawnSync } from 'node:child_process';
import { bold, cyan, dim, formatCostUsd, formatTokenUsageSummary, green, magenta, red, yellow } from './format-helpers.js';
import { isJobDead } from '../specialist/supervisor.js';
import type { SupervisorStatus } from '../specialist/supervisor.js';
// TODO(u4fdd.6): shared status loading now lives in src/specialist/status-load.ts for ChatStatus reuse.
import { loadStatuses } from '../specialist/status-load.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
import { resolveNodeRefWithClient } from '../specialist/node-resolve.js';
import { loadEpicReadinessSummary, syncEpicStateFromReadiness, type EpicReadinessSummary } from '../specialist/epic-readiness.js';
import { collectProcessHealth, type ProcessHealthProcess, type ProcessHealthReport } from '../specialist/process-health.js';

type JobState = SupervisorStatus['status'];

interface PsArgs {
  json: boolean;
  all: boolean;
  follow: boolean;
  includeTerminal: boolean;
  includeCleaned: boolean;
  active: boolean;
  running: boolean;
  mine: boolean;
  beadFilter?: string;
  sinceMs?: number;
  nodeId?: string;
  inspectId?: string;
  health: boolean;
}

interface JobNode {
  kind: 'job';
  id: string;
  specialist: string;
  status: JobState;
  pid?: number;
  is_dead?: boolean;
  bead_id?: string;
  bead_title?: string;
  node_id?: string;
  worktree_owner_job_id?: string;
  reused_from_job_id?: string;
  worktree_path?: string;
  branch?: string;
  epic_id?: string;
  started_at_ms: number;
  elapsed_s?: number;
  context_pct?: number;
  context_health?: SupervisorStatus['context_health'];
  metrics?: SupervisorStatus['metrics'];
  startup_payload_json?: string | null;
  payload_kb?: string;
  payload_tokens?: string;
  children: JobNode[];
}

interface WorktreeTree {
  owner_job_id: string;
  worktree_path?: string;
  branch?: string;
  children: JobNode[];
}

type EpicReadinessMap = Map<string, EpicReadinessSummary>;

interface NodeTree {
  node_id: string;
  node_name: string;
  status: string;
  member_count: number;
  newest_activity_ms: number;
  members: JobNode[];
}

interface EpicChainGroup {
  chain_id: string;
  chain_root_bead_id?: string;
  trees: WorktreeTree[];
}

interface EpicGroup {
  epic_id: string;
  readiness?: EpicReadinessSummary;
  prep_jobs: JobNode[];
  chains: EpicChainGroup[];
}

const ACTIVE_STATES: readonly JobState[] = ['starting', 'running', 'waiting'];
const TERMINAL_STATES: readonly JobState[] = ['done', 'error', 'cancelled'];
const BEAD_TITLE_CACHE = new Map<string, string>();
const STATUS_PRIORITY: Readonly<Record<JobState, number>> = {
  waiting: 3,
  running: 2,
  starting: 1,
  done: 0,
  error: 0,
  cancelled: 0,
};
const SPINNER_FRAMES = ['⣾', '⣽', '⣻', '⣺', '⣹', '⣸', '⣷', '⣶'] as const;

function loadBeadIdsForCurrentUser(): Set<string> {
  // Shell out to `bd query` rather than re-implementing assignee resolution
  // here. Returns an empty set on any failure so --mine becomes a no-op
  // filter (everything visible) rather than crashing.
  const ids = new Set<string>();
  try {
    const result = spawnSync('bd', ['query', 'assignee=me', '--json'], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5_000,
    });
    if (result.status !== 0 || !result.stdout) return ids;
    const parsed = JSON.parse(result.stdout) as Array<{ id?: string }>;
    for (const row of parsed) {
      if (row?.id) ids.add(row.id);
    }
  } catch {
    // ignore
  }
  return ids;
}

function parseSinceArg(value: string): number | undefined {
  const trimmed = value.trim();
  const match = /^(\d+)([smhd])$/.exec(trimmed);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2];
  const ms = unit === 's' ? n * 1_000
    : unit === 'm' ? n * 60_000
    : unit === 'h' ? n * 3_600_000
    : n * 86_400_000;
  return Date.now() - ms;
}

function parseArgs(argv: string[]): PsArgs {
  const allowedBooleanFlags = new Set([
    '--json', '--all', '--follow', '-f', '--include-terminal', '--include-merged',
    '--include-cleaned', '--active', '--running', '--mine', '--health',
  ]);
  const valueFlags = new Set(['--node', '--bead', '--since']);
  let nodeId: string | undefined;
  let beadFilter: string | undefined;
  let sinceMs: number | undefined;
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith('-') && !allowedBooleanFlags.has(token) && !valueFlags.has(token)) {
      const hint = token === '--ps' ? ' Did you mean `sp clean --ps`?' : '';
      throw new Error(`Unknown ps option: ${token}.${hint}`);
    }
    if (token === '--node' && argv[i + 1]) {
      nodeId = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--bead' && argv[i + 1]) {
      beadFilter = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === '--since' && argv[i + 1]) {
      sinceMs = parseSinceArg(argv[i + 1]);
      i += 1;
      continue;
    }

    if (!token.startsWith('-')) {
      positional.push(token);
    }
  }

  // --include-merged is preserved as an alias for backward compatibility;
  // --include-terminal is the canonical flag (covers merged + abandoned).
  const includeTerminal = argv.includes('--include-terminal') || argv.includes('--include-merged');

  return {
    json: argv.includes('--json'),
    all: argv.includes('--all'),
    follow: argv.includes('--follow') || argv.includes('-f'),
    includeTerminal,
    includeCleaned: argv.includes('--include-cleaned'),
    active: argv.includes('--active'),
    running: argv.includes('--running') || argv.includes('--active'),
    mine: argv.includes('--mine'),
    health: argv.includes('--health'),
    beadFilter,
    sinceMs,
    nodeId,
    inspectId: positional[0],
  };
}


function isPsCleaned(job: SupervisorStatus): boolean {
  const typed = job as SupervisorStatus & { ps_hidden_at?: number; ps_hidden_from_dashboard_at?: number };
  return Boolean(typed.ps_hidden_at ?? typed.ps_hidden_from_dashboard_at);
}

function isDefaultActionableTerminal(job: SupervisorStatus): boolean {
  return job.status === 'error' || job.status === 'cancelled';
}

function isVisibleStatus(status: JobState, all: boolean): boolean {
  if (all) return true;
  return ACTIVE_STATES.includes(status);
}

function toJobNode(job: SupervisorStatus & { is_dead?: boolean }): JobNode {
  const beadAwareStatus = job as SupervisorStatus & { bead_title?: string };

  return {
    kind: 'job',
    id: job.id,
    specialist: job.specialist,
    status: job.status,
    pid: job.pid,
    is_dead: job.is_dead,
    bead_id: job.bead_id,
    bead_title: beadAwareStatus.bead_title,
    node_id: job.node_id,
    worktree_owner_job_id: job.worktree_owner_job_id,
    reused_from_job_id: job.reused_from_job_id,
    worktree_path: job.worktree_path,
    branch: job.branch,
    epic_id: job.epic_id,
    started_at_ms: job.started_at_ms,
    elapsed_s: job.elapsed_s,
    context_pct: job.context_pct,
    context_health: job.context_health,
    metrics: job.metrics,
    startup_payload_json: job.startup_payload_json ?? null,
    children: [],
  };
}

function buildReuseForest(jobs: SupervisorStatus[]): JobNode[] {
  const nodes = new Map<string, JobNode>();
  for (const job of jobs) nodes.set(job.id, toJobNode(job));

  const roots: JobNode[] = [];
  for (const node of nodes.values()) {
    const parentId = node.reused_from_job_id;
    if (parentId && nodes.has(parentId)) {
      nodes.get(parentId)!.children.push(node);
      continue;
    }
    roots.push(node);
  }

  const sortTree = (jobNode: JobNode): void => {
    jobNode.children.sort((a, b) => a.started_at_ms - b.started_at_ms);
    for (const child of jobNode.children) sortTree(child);
  };

  roots.sort((a, b) => a.started_at_ms - b.started_at_ms);
  for (const root of roots) sortTree(root);
  return roots;
}

function getTreeUrgency(jobs: readonly SupervisorStatus[]): number {
  return jobs.reduce((highest, job) => Math.max(highest, STATUS_PRIORITY[job.status]), 0);
}

function getTreeNewestStart(jobs: readonly SupervisorStatus[]): number {
  return jobs.reduce((latest, job) => Math.max(latest, job.started_at_ms), 0);
}

function groupByTree(jobs: SupervisorStatus[]): WorktreeTree[] {
  const groups = new Map<string, SupervisorStatus[]>();

  for (const job of jobs) {
    if (job.node_id) continue;
    const ownerId = job.worktree_owner_job_id ?? job.id;
    if (!groups.has(ownerId)) groups.set(ownerId, []);
    groups.get(ownerId)!.push(job);
  }

  return groupTreeEntries([...groups.entries()]);
}

function groupTreeEntries(groupEntries: Array<[string, SupervisorStatus[]]>): WorktreeTree[] {
  const trees: WorktreeTree[] = [];

  const sortedGroups = groupEntries.sort(([ownerA, jobsA], [ownerB, jobsB]) => {
    const urgencyDelta = getTreeUrgency(jobsB) - getTreeUrgency(jobsA);
    if (urgencyDelta !== 0) return urgencyDelta;
    const startDelta = getTreeNewestStart(jobsB) - getTreeNewestStart(jobsA);
    if (startDelta !== 0) return startDelta;
    return ownerA.localeCompare(ownerB);
  });

  for (const [ownerJobId, treeJobs] of sortedGroups) {
    const representative = treeJobs.find((job) => job.id === ownerJobId) ?? treeJobs[0];

    trees.push({
      owner_job_id: ownerJobId,
      worktree_path: representative.worktree_path,
      branch: representative.branch,
      children: buildReuseForest(treeJobs),
    });
  }

  return trees;
}

function normalizeChainId(job: SupervisorStatus): string {
  if (job.chain_kind === 'chain') {
    if (job.chain_id) return job.chain_id;
    if (job.worktree_owner_job_id) return job.worktree_owner_job_id;
    return `chain:${job.id}`;
  }

  return 'prep';
}

function buildEpicGroups(jobs: SupervisorStatus[], epicReadiness: EpicReadinessMap): EpicGroup[] {
  const byEpic = new Map<string, SupervisorStatus[]>();
  for (const job of jobs) {
    if (!job.epic_id) continue;
    if (!byEpic.has(job.epic_id)) byEpic.set(job.epic_id, []);
    byEpic.get(job.epic_id)!.push(job);
  }

  const groups: EpicGroup[] = [];

  for (const [epicId, epicJobs] of byEpic.entries()) {
    const prepJobs = epicJobs
      .filter((job) => job.chain_kind !== 'chain')
      .map((job) => toJobNode(job))
      .sort((a, b) => {
        const urgencyDelta = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
        if (urgencyDelta !== 0) return urgencyDelta;
        return b.started_at_ms - a.started_at_ms;
      });

    const chainBuckets = new Map<string, SupervisorStatus[]>();
    for (const job of epicJobs) {
      if (job.chain_kind !== 'chain') continue;
      const chainId = normalizeChainId(job);
      if (!chainBuckets.has(chainId)) chainBuckets.set(chainId, []);
      chainBuckets.get(chainId)!.push(job);
    }

    const chains: EpicChainGroup[] = [...chainBuckets.entries()]
      .map(([chainId, chainJobs]) => {
        const treeBuckets = new Map<string, SupervisorStatus[]>();
        for (const chainJob of chainJobs) {
          const ownerId = chainJob.worktree_owner_job_id ?? chainJob.id;
          if (!treeBuckets.has(ownerId)) treeBuckets.set(ownerId, []);
          treeBuckets.get(ownerId)!.push(chainJob);
        }

        const chainSummary = epicReadiness.get(epicId)?.chains.find((chain) => chain.chain_id === chainId);

        return {
          chain_id: chainId,
          chain_root_bead_id: chainSummary?.chain_root_bead_id ?? chainJobs[0]?.chain_root_bead_id,
          trees: groupTreeEntries([...treeBuckets.entries()]),
        };
      })
      .sort((a, b) => a.chain_id.localeCompare(b.chain_id));

    groups.push({
      epic_id: epicId,
      readiness: epicReadiness.get(epicId),
      prep_jobs: prepJobs,
      chains,
    });
  }

  groups.sort((a, b) => {
    const aNewest = Math.max(
      ...a.prep_jobs.map((job) => job.started_at_ms),
      ...a.chains.flatMap((chain) => chain.trees.flatMap((tree) => tree.children.map((child) => child.started_at_ms))),
      0,
    );
    const bNewest = Math.max(
      ...b.prep_jobs.map((job) => job.started_at_ms),
      ...b.chains.flatMap((chain) => chain.trees.flatMap((tree) => tree.children.map((child) => child.started_at_ms))),
      0,
    );
    return bNewest - aNewest;
  });

  return groups;
}

function resolveNodeRunMap(nodeIds: readonly string[]): Map<string, { node_name: string; status: string }> {
  const nodeIdSet = new Set(nodeIds.filter((nodeId) => nodeId.length > 0));
  if (nodeIdSet.size === 0) return new Map();

  const sqliteClient = createObservabilitySqliteClient();
  if (!sqliteClient) return new Map();

  try {
    const byId = new Map<string, { node_name: string; status: string }>();
    const rows = sqliteClient.listNodeRuns();
    for (const row of rows) {
      if (!nodeIdSet.has(row.id)) continue;
      byId.set(row.id, { node_name: row.node_name, status: row.status });
    }
    return byId;
  } catch {
    return new Map();
  } finally {
    sqliteClient.close();
  }
}

function groupByNode(jobs: SupervisorStatus[]): NodeTree[] {
  const nodeGroups = new Map<string, SupervisorStatus[]>();
  for (const job of jobs) {
    if (!job.node_id) continue;
    if (!nodeGroups.has(job.node_id)) nodeGroups.set(job.node_id, []);
    nodeGroups.get(job.node_id)!.push(job);
  }

  const nodeInfoById = resolveNodeRunMap([...nodeGroups.keys()]);
  const nodeTrees: NodeTree[] = [];

  for (const [nodeId, nodeJobs] of nodeGroups.entries()) {
    const representative = nodeJobs[0];
    const nodeInfo = nodeInfoById.get(nodeId);

    const members = nodeJobs
      .map((job) => toJobNode(job))
      .sort((a, b) => {
        const urgencyDelta = STATUS_PRIORITY[b.status] - STATUS_PRIORITY[a.status];
        if (urgencyDelta !== 0) return urgencyDelta;
        return b.started_at_ms - a.started_at_ms;
      });

    nodeTrees.push({
      node_id: nodeId,
      node_name: nodeInfo?.node_name ?? representative?.specialist ?? 'node',
      status: nodeInfo?.status ?? representative?.status ?? 'unknown',
      member_count: members.length,
      newest_activity_ms: getTreeNewestStart(nodeJobs),
      members,
    });
  }

  nodeTrees.sort((a, b) => {
    const timeDelta = b.newest_activity_ms - a.newest_activity_ms;
    if (timeDelta !== 0) return timeDelta;
    return a.node_id.localeCompare(b.node_id);
  });

  return nodeTrees;
}

function statusLabel(status: JobState): string {
  if (status === 'running') return bold(green(status));
  if (status === 'waiting') return bold(magenta(status));
  if (status === 'done') return dim(status);
  if (status === 'error') return bold(red(status));
  if (status === 'cancelled') return dim(status);
  return bold(yellow(status));
}

function epicStateLabel(state: EpicReadinessSummary['readiness_state'] | undefined): string {
  if (state === 'merge_ready') return green('pass');
  if (state === 'merged') return dim('merged');
  if (state === 'failed') return red('failed');
  if (state === 'blocked') return yellow('blocked');
  if (state === 'resolving') return cyan('merge_ready');
  if (state === 'abandoned') return dim('abandoned');
  return magenta('no pass yet');
}

function withPidLiveness(statuses: SupervisorStatus[]): Array<SupervisorStatus & { is_dead: boolean }> {
  return statuses.map((job) => ({
    ...job,
    is_dead: isJobDead(job),
  }));
}

function formatElapsed(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds)) return '--';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m${String(remainder).padStart(2, '0')}s`;
}

function formatPayloadStats(payloadJson: string | null | undefined): { payload_kb: string; payload_tokens: string } {
  if (!payloadJson) return { payload_kb: '--', payload_tokens: '--' };
  try {
    const payload = JSON.parse(payloadJson) as { totals?: { bytes?: number; tokens?: number } };
    const bytes = payload.totals?.bytes;
    const tokens = payload.totals?.tokens;
    if (!Number.isFinite(bytes) || !Number.isFinite(tokens)) return { payload_kb: '--', payload_tokens: '--' };
    return {
      payload_kb: `${((bytes ?? 0) / 1024).toFixed(1)}kb`,
      payload_tokens: `${Math.round(tokens ?? 0)}t`,
    };
  } catch {
    return { payload_kb: '--', payload_tokens: '--' };
  }
}

function getBeadTitleFromBd(beadId: string): string | null {
  const result = spawnSync('bd', ['show', beadId, '--json'], {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'ignore'],
    timeout: 1500,
  });

  if (result.status !== 0 || !result.stdout) return null;

  try {
    const parsed = JSON.parse(result.stdout) as unknown;
    const payload = (Array.isArray(parsed) ? parsed[0] : parsed) as {
      title?: unknown;
      issue?: { title?: unknown };
    };

    if (typeof payload?.title === 'string' && payload.title.trim().length > 0) return payload.title.trim();
    if (typeof payload?.issue?.title === 'string' && payload.issue.title.trim().length > 0) {
      return payload.issue.title.trim();
    }
  } catch {
    return null;
  }

  return null;
}

function sanitizeBeadTitle(title: string): string {
  return title.replace(/\s+/g, ' ').trim();
}

function buildBeadTitleCache(jobs: SupervisorStatus[]): Map<string, string> {
  const titles = new Map(BEAD_TITLE_CACHE);

  for (const job of jobs) {
    const beadAwareStatus = job as SupervisorStatus & { bead_title?: string };
    const beadId = job.bead_id;
    if (!beadId || titles.has(beadId)) continue;

    const cachedTitle = beadAwareStatus.bead_title;
    if (typeof cachedTitle === 'string' && cachedTitle.trim().length > 0) {
      const title = sanitizeBeadTitle(cachedTitle);
      titles.set(beadId, title);
      BEAD_TITLE_CACHE.set(beadId, title);
      continue;
    }

    const resolvedTitle = getBeadTitleFromBd(beadId);
    if (resolvedTitle) {
      const title = sanitizeBeadTitle(resolvedTitle);
      titles.set(beadId, title);
      BEAD_TITLE_CACHE.set(beadId, title);
    }
  }

  return titles;
}

function getStatusIcon(job: JobNode): string {
  if (job.is_dead) return red('◉');
  if (job.status === 'running') return cyan('◉');
  if (job.status === 'waiting') return magenta('◐');
  if (job.status === 'starting') return yellow('◐');
  if (job.status === 'done') return green('○');
  if (job.status === 'error') return red('○');
  return dim('○');
}

function getNextAction(job: JobNode): string {
  if (job.is_dead) return 'dead';
  if (job.status === 'running' || job.status === 'starting') return 'feed';
  if (job.status === 'waiting') return 'resume';
  if (job.status === 'done') return 'result';
  if (job.status === 'error') return 'result';
  return '';
}

function formatCtxWithIndicator(contextPct: number | undefined, contextHealth: string | undefined): string {
  if (contextPct === undefined || !Number.isFinite(contextPct)) return '  --';
  const pct = `${Math.round(contextPct)}%`;
  const warn = contextHealth === 'WARN' || contextHealth === 'CRITICAL' ? '▲' : '';
  return `${pct}${warn}`.padStart(4);
}

function renderJobLine(
  job: JobNode,
  beadTitles: Map<string, string>,
  prefix: string,
  connector: string,
): string {
  const icon = getStatusIcon(job);
  const id = job.id.padEnd(8);
  const spec = job.specialist.slice(0, 13).padEnd(13);
  const status = statusLabel(job.status).padEnd(18);
  const ctx = dim(formatCtxWithIndicator(job.context_pct, job.context_health));
  const elapsedBase = formatElapsed(job.elapsed_s);
  const metricParts: string[] = [];
  if (job.metrics?.turns) metricParts.push(`${job.metrics.turns}t`);
  if (job.metrics?.tool_calls) metricParts.push(`${job.metrics.tool_calls}tc`);
  const totalTokens = job.metrics?.token_usage?.total_tokens;
  if (totalTokens) metricParts.push(`${totalTokens}tok`);
  const payloadStats = formatPayloadStats(job.startup_payload_json);
  const elapsed = metricParts.length > 0 ? dim(`${elapsedBase} ${metricParts.join('·')}`) : dim(elapsedBase);
  const beadTitle = job.bead_id ? beadTitles.get(job.bead_id) : undefined;
  const payloadKbCol = dim(payloadStats.payload_kb.padEnd(8));
  const payloadTokensCol = dim(payloadStats.payload_tokens.padEnd(8));
  const beadCol = dim((job.bead_id ? job.bead_id : '').padEnd(14));
  const action = getNextAction(job);
  const actionCol = job.is_dead ? red(action) : dim(action);
  const titleSuffix = beadTitle ? dim(` ${beadTitle.slice(0, 40)}`) : '';
  return `${prefix}${connector}${icon} ${id} ${spec} ${status} ${ctx} ${elapsed} ${payloadKbCol} ${payloadTokensCol} ${beadCol} ${actionCol}${titleSuffix}`;
}

function renderTreeNodes(
  nodes: readonly JobNode[],
  beadTitles: Map<string, string>,
  prefix: string,
  renderedJobIds: Set<string>,
): void {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    const isLast = i === nodes.length - 1;
    const connector = prefix === '' ? '  ' : isLast ? '└ ' : '├ ';
    const childPrefix = prefix === '' ? '  ' : prefix + (isLast ? '  ' : '│ ');

    if (!renderedJobIds.has(node.id)) {
      renderedJobIds.add(node.id);
      console.log(renderJobLine(node, beadTitles, prefix, connector));
    }

    if (node.children.length > 0) {
      renderTreeNodes(node.children, beadTitles, childPrefix, renderedJobIds);
    }
  }
}

function formatProcessRow(process: ProcessHealthProcess): string {
  const cwd = process.cwd ?? '--';
  const rssMb = `${(process.rssBytes / (1024 * 1024)).toFixed(1)}MB`;
  const cpu = `${process.cpuPct.toFixed(1)}%`;
  const age = `${Math.floor(process.ageSeconds / 60)}m`;
  return `  ${String(process.pid).padEnd(7)} ${process.role.padEnd(14)} ${rssMb.padEnd(8)} ${cpu.padEnd(7)} ${age.padEnd(5)} ${cwd}`;
}

function renderProcessHealthBlock(report: ProcessHealthReport, includeDetails: boolean): void {
  const percent = report.thresholdPct.toFixed(1);
  const severity = report.status === 'REFUSE' ? red('REFUSE') : report.status === 'WARN' ? yellow('WARN') : green('OK');
  console.log(bold(cyan('System health')));
  console.log(`  ${severity} rss=${(report.totalRssBytes / (1024 * 1024)).toFixed(1)}MB avail=${(report.memAvailableBytes / (1024 * 1024)).toFixed(1)}MB used=${percent}% warn=${report.warnPct}% refuse=${report.refusePct}% cpu=${report.totalCpuPct.toFixed(1)}%`);
  console.log(`  specialists=${report.specialistCount} dolt=${report.doltCount} serena-lsp=${report.serenaLspCount} orphans=${report.orphanCount}`);
  if (report.statusReasons.length > 0) console.log(`  alerts=${report.statusReasons.join('; ')}`);

  if (!includeDetails) {
    console.log('');
    return;
  }

  if (report.doltProcesses.length > 0) {
    console.log(bold('  Dolt sql-server'));
    for (const process of report.doltProcesses) console.log(formatProcessRow(process));
  }

  if (report.serenaWorkspaces.length > 0) {
    console.log(bold('  Serena LSP'));
    for (const workspace of report.serenaWorkspaces) {
      console.log(`  ${workspace.workspace} · ${workspace.count} procs · ${(workspace.rssBytes / (1024 * 1024)).toFixed(1)}MB`);
      for (const process of workspace.processes) console.log(formatProcessRow(process));
    }
  }

  if (report.specialistProcesses.length > 0) {
    console.log(bold('  Specialists'));
    for (const process of report.specialistProcesses) console.log(formatProcessRow(process));
  }

  if (report.orphanProcesses.length > 0) {
    console.log(bold('  Orphans'));
    for (const process of report.orphanProcesses) console.log(formatProcessRow(process));
  }

  console.log('');
}

function resolveEpicReadinessMap(jobs: readonly SupervisorStatus[], includeTerminal: boolean): EpicReadinessMap {
  const epicIds = new Set(jobs.map((job) => job.epic_id).filter((epicId): epicId is string => Boolean(epicId)));
  const sqlite = createObservabilitySqliteClient();
  if (!sqlite) return new Map();

  try {
    if (includeTerminal) {
      for (const epicRun of sqlite.listEpicRuns()) {
        if (epicRun.status === 'merged' || epicRun.status === 'failed' || epicRun.status === 'abandoned') {
          epicIds.add(epicRun.epic_id);
        }
      }
    }

    const readinessMap: EpicReadinessMap = new Map();
    for (const epicId of epicIds) {
      const summary = loadEpicReadinessSummary(sqlite, epicId);
      syncEpicStateFromReadiness(sqlite, summary);
      readinessMap.set(epicId, summary);
    }
    return readinessMap;
  } catch {
    return new Map();
  } finally {
    sqlite.close();
  }
}

function renderHuman(jobs: SupervisorStatus[], nodes: NodeTree[], trees: WorktreeTree[], all: boolean, includeTerminal: boolean, epicReadiness: EpicReadinessMap, health: ProcessHealthReport, includeHealthDetails: boolean): void {
  const beadTitles = buildBeadTitleCache(jobs);
  const renderedJobIds = new Set<string>();
  const epicGroups = buildEpicGroups(jobs, epicReadiness);
  const renderedEpicIds = new Set(epicGroups.map((epic) => epic.epic_id));

  renderProcessHealthBlock(health, includeHealthDetails);

  for (const epic of epicGroups) {
    const prepCount = epic.prep_jobs.length;
    const chainCount = epic.chains.length;
    const readiness = epic.readiness;
    const readinessState = readiness?.readiness_state ?? 'unresolved';
    const persistedState = readiness?.persisted_state ?? 'open';
    const prepSummary = readiness?.prep
      ? `prep ${readiness.prep.done}/${readiness.prep.total} done${readiness.prep.running > 0 ? ` ${readiness.prep.running} running` : ''}${readiness.prep.failed > 0 ? ` ${readiness.prep.failed} failed` : ''}`
      : `prep ${prepCount}`;
    const chainSummary = readiness?.chains
      ? `chains ${readiness.chains.filter((chain) => chain.state === 'pass').length}/${readiness.chains.length} pass`
      : `chains ${chainCount}`;

    const epicBanner = bold(cyan(`┏━ EPIC ${epic.epic_id} ━ ${epicStateLabel(readiness?.readiness_state)} ━ ${prepSummary} ━ ${chainSummary}`));
    console.log(epicBanner);
    console.log(`  ${dim(`derived:${readinessState}`)} · ${dim(`stored:${persistedState}`)}`);

    console.log(`  ${bold('Prep')}`);
    if (epic.prep_jobs.length === 0) {
      console.log(dim('    (none)'));
    } else {
      for (const prepJob of epic.prep_jobs) {
        if (!renderedJobIds.has(prepJob.id)) {
          renderedJobIds.add(prepJob.id);
          console.log(renderJobLine(prepJob, beadTitles, '    ', ''));
        }
      }
    }

    console.log(`  ${bold('Chains')}`);
    if (epic.chains.length === 0) {
      console.log(dim('    (none)'));
    } else {
      for (const chain of epic.chains) {
        const chainReadiness = readiness?.chains.find((entry) => entry.chain_id === chain.chain_id);
        const readinessLabel = chainReadiness ? ` · ${chainReadiness.state}` : '';
        const rootBeadSuffix = chain.chain_root_bead_id ? ` · root:${chain.chain_root_bead_id}` : '';
        console.log(`    ${bold(chain.chain_id)}${dim(rootBeadSuffix)}${dim(readinessLabel)}`);

        for (const tree of chain.trees) {
          const branch = tree.branch ?? 'master';
          console.log(`      ${dim(branch)}`);
          renderTreeNodes(tree.children, beadTitles, '      ', renderedJobIds);
        }
      }
    }

    console.log('');
  }

  if (includeTerminal) {
    for (const [epicId, readiness] of epicReadiness.entries()) {
      if (renderedEpicIds.has(epicId)) continue;

      const chainCount = readiness.chains.length;
      const epicBanner = bold(cyan(`┏━ EPIC ${epicId} ━ ${String(readiness.readiness_state).toUpperCase()} ━ prep 0 ━ chains ${chainCount}`));
      console.log(epicBanner);
      console.log(`  ${dim(`state:${readiness.persisted_state}`)} · ${epicStateLabel(readiness.readiness_state)}`);
      console.log(`  ${bold('Prep')}`);
      console.log(dim('    (none retained)'));
      console.log(`  ${bold('Chains')}`);
      if (readiness.chains.length === 0) {
        console.log(dim('    (none)'));
      } else {
        for (const chain of readiness.chains) {
          const rootBeadSuffix = chain.chain_root_bead_id ? ` · root:${chain.chain_root_bead_id}` : '';
          console.log(`    ${bold(chain.chain_id)}${dim(rootBeadSuffix)}${dim(' · no retained jobs')}`);
        }
      }
      console.log('');
    }
  }

  const legacyNodes = nodes.filter((node) => !node.members.some((member) => member.epic_id));
  const legacyTrees = trees.filter((tree) => !tree.children.some((child) => child.epic_id));

  for (const node of legacyNodes) {
    console.log(`${cyan('⬢')} ${node.node_id} · ${node.node_name} · ${statusLabel(node.status as JobState)} · ${node.member_count} members`);
    for (const member of node.members) {
      if (!renderedJobIds.has(member.id)) {
        renderedJobIds.add(member.id);
        console.log(renderJobLine(member, beadTitles, '    ', ''));
      }
    }
    console.log('');
  }

  for (const tree of legacyTrees) {
    const branch = tree.branch ?? 'master';
    const beadId = tree.children[0]?.bead_id;
    const beadSuffix = beadId ? ` · ${beadId}` : '';
    console.log(`${dim(branch)}${dim(beadSuffix)}`);

    renderTreeNodes(tree.children, beadTitles, '', renderedJobIds);
    console.log('');
  }

  if (epicGroups.length === 0 && legacyNodes.length === 0 && legacyTrees.length === 0) {
    console.log(dim('  no active jobs'));
    console.log('');
  }

  const renderedJobs = jobs.filter((job) => renderedJobIds.has(job.id));
  const runningCount = renderedJobs.filter((job) => job.status === 'running').length;
  const waitingCount = renderedJobs.filter((job) => job.status === 'waiting').length;

  console.log(dim(`${renderedJobIds.size} jobs · ${epicGroups.length} epics · ${legacyNodes.length} nodes · ${legacyTrees.length} worktrees · ${runningCount} running · ${waitingCount} waiting${all ? ' · include terminal' : ''}`));
}

function renderInspect(jobId: string): void {
  const statuses = withPidLiveness(loadStatuses());
  const epicReadiness = resolveEpicReadinessMap(statuses, false);
  const job = statuses.find((s) => s.id.startsWith(jobId));
  if (!job) {
    console.error(`Job not found: ${jobId}`);
    process.exitCode = 1;
    return;
  }

  const beadTitles = buildBeadTitleCache([job]);
  const beadTitle = job.bead_id ? beadTitles.get(job.bead_id) : undefined;
  const ctx = job.context_pct !== undefined ? `${Math.round(job.context_pct)}% ${job.context_health ?? ''}` : '--';
  const deadLabel = job.is_dead ? ` ${red('dead')}` : '';

  // Find chain via worktree_owner_job_id
  const chainJobs = job.worktree_owner_job_id
    ? statuses.filter((s) => s.worktree_owner_job_id === job.worktree_owner_job_id).sort((a, b) => a.started_at_ms - b.started_at_ms)
    : [job];
  const chainStr = chainJobs.map((j) => j.id === job.id ? bold(j.id) : dim(j.id)).join(' → ');

  console.log(`\n${job.id}  ${job.specialist}  ${getStatusIcon(toJobNode(job))} ${statusLabel(job.status)}  ${ctx}${deadLabel}`);
  if (job.epic_id) {
    const readiness = epicReadiness.get(job.epic_id);
    const readinessSuffix = readiness ? ` · ${readiness.readiness_state} (${readiness.persisted_state})` : '';
    console.log(`  epic      ${job.epic_id}${readinessSuffix}`);
  }
  console.log(`  model     ${job.model ?? '--'} ${job.backend ? `(${job.backend})` : ''}`);
  if (job.bead_id) console.log(`  bead      ${job.bead_id}${beadTitle ? ` — ${beadTitle}` : ''}`);
  if (job.worktree_path || job.branch) {
    const wt = job.worktree_path ? dim(` ${job.worktree_path}`) : '';
    console.log(`  worktree  ${job.branch ?? 'master'}${wt}`);
  }
  const chainRole = job.chain_kind === 'chain' ? 'chain' : 'prep';
  const chainIdentity = job.chain_kind === 'chain' ? (job.chain_id ?? job.worktree_owner_job_id ?? '--') : '--';
  console.log(`  role      ${chainRole}`);
  console.log(`  chain_id  ${chainIdentity}`);
  if (chainJobs.length > 1) console.log(`  chain     ${chainStr}`);
  console.log(`  elapsed   ${formatElapsed(job.elapsed_s)}${job.metrics ? ` · ${job.metrics.turns ?? 0} turns · ${job.metrics.tool_calls ?? 0} tools` : ''}`);
  const tokenUsage = job.metrics?.token_usage;
  const tokenSummaryParts = formatTokenUsageSummary(tokenUsage).filter((part) => !part.startsWith('cost='));
  if (tokenSummaryParts.length > 0) {
    console.log(`  tokens    ${tokenSummaryParts.join(' · ')}`);
  }
  const formattedCost = formatCostUsd(tokenUsage?.cost_usd);
  if (formattedCost) {
    console.log(`  cost_usd  ${formattedCost}`);
  }
  console.log(`  context   ${ctx}`);
  if (job.current_tool) console.log(`  current   ${job.current_tool}`);
  const inspectActions: string[] = [];
  if (job.status === 'running' || job.status === 'starting') inspectActions.push(`feed -f ${job.id}`);
  if (job.status === 'waiting') inspectActions.push(`resume ${job.id} "..."`);
  if (job.status === 'running') inspectActions.push(`steer ${job.id} "..."`);
  if (job.tmux_session) inspectActions.push(`attach ${job.id}`);
  if (job.status === 'done' || job.status === 'error') inspectActions.push(`result ${job.id}`);
  if (job.is_dead) inspectActions.push('clean --zombies');
  console.log(`\n  ${dim(inspectActions.join(' | '))}`);
}

function renderJson(
  jobs: Array<SupervisorStatus & { is_dead: boolean }>,
  nodes: NodeTree[],
  trees: WorktreeTree[],
  _all: boolean,
  epicReadiness: EpicReadinessMap,
  args: PsArgs,
  health: ProcessHealthReport,
): void {
  console.log(JSON.stringify({
    generated_at_ms: Date.now(),
    include_terminal: args.includeTerminal,
    counts: {
      jobs: jobs.length,
      nodes: nodes.length,
      trees: trees.length,
    },
    flat: jobs.map((job) => ({
      id: job.id,
      specialist: job.specialist,
      status: job.status,
      pid: job.pid,
      is_dead: job.is_dead,
      bead_id: job.bead_id,
      bead_title: (job as SupervisorStatus & { bead_title?: string }).bead_title,
      node_id: job.node_id,
      worktree_owner_job_id: job.worktree_owner_job_id,
      reused_from_job_id: job.reused_from_job_id,
      worktree_path: job.worktree_path,
      branch: job.branch,
      epic_id: job.epic_id,
      chain_kind: job.chain_kind,
      chain_id: job.chain_id,
      chain_root_job_id: job.chain_root_job_id,
      chain_root_bead_id: job.chain_root_bead_id,
      started_at_ms: job.started_at_ms,
      elapsed_s: job.elapsed_s,
      context_pct: job.context_pct,
      context_health: job.context_health,
      startup_payload_json: job.startup_payload_json ?? null,
      payload_kb: formatPayloadStats(job.startup_payload_json).payload_kb,
      payload_tokens: formatPayloadStats(job.startup_payload_json).payload_tokens,
    })),
    nodes,
    trees,
    epics: buildEpicGroups(jobs, epicReadiness),
    epic_readiness: Object.fromEntries([...epicReadiness.entries()].map(([epicId, summary]) => [epicId, summary])),
    process_health: health,
  }, null, 2));
}

function dedupeStatusesById(statuses: Array<SupervisorStatus & { is_dead: boolean }>): Array<SupervisorStatus & { is_dead: boolean }> {
  const byId = new Map<string, SupervisorStatus & { is_dead: boolean }>();

  for (const status of statuses) {
    const existing = byId.get(status.id);
    if (!existing) {
      byId.set(status.id, status);
      continue;
    }

    const shouldReplace = status.started_at_ms >= existing.started_at_ms;
    if (shouldReplace) byId.set(status.id, status);
  }

  return [...byId.values()].sort((a, b) => b.started_at_ms - a.started_at_ms);
}

function render(args: PsArgs): void {
  const statusesWithLiveness = dedupeStatusesById(withPidLiveness(loadStatuses()));
  const epicReadiness = resolveEpicReadinessMap(statusesWithLiveness, args.includeTerminal);

  const mineBeadIds = args.mine ? loadBeadIdsForCurrentUser() : undefined;

  const visibleStatuses = statusesWithLiveness.filter((job) => {
    const readiness = job.epic_id ? epicReadiness.get(job.epic_id) : undefined;
    const readinessState = readiness?.readiness_state;

    // Explicit filters: applied before the default visibility heuristics so
    // they win over --all and the epic-grouping fallback at the bottom.
    if (args.nodeId && job.node_id !== args.nodeId) return false;
    if (args.beadFilter && job.bead_id !== args.beadFilter) return false;
    if (args.sinceMs !== undefined && job.started_at_ms < args.sinceMs) return false;
    if (args.running && !ACTIVE_STATES.includes(job.status)) return false;
    if (mineBeadIds && (!job.bead_id || !mineBeadIds.has(job.bead_id))) return false;

    const cleaned = isPsCleaned(job);

    if (args.all) return true;
    if (cleaned && !args.includeCleaned) return false;
    if (cleaned && args.includeCleaned && TERMINAL_STATES.includes(job.status)) return true;
    if (job.is_dead) return false;
    if (ACTIVE_STATES.includes(job.status)) return true;
    if (args.active) return false;
    if (args.includeTerminal && TERMINAL_STATES.includes(job.status)) return true;
    return isDefaultActionableTerminal(job);
  });

  const nodes = groupByNode(visibleStatuses);
  const trees = groupByTree(visibleStatuses);
  const health = collectProcessHealth();

  if (args.json) {
    renderJson(visibleStatuses, nodes, trees, args.all, epicReadiness, args, health);
    return;
  }

  renderHuman(visibleStatuses, nodes, trees, args.all, args.includeTerminal, epicReadiness, health, args.health);
}

function renderBuffered(args: PsArgs): string {
  const lines: string[] = [];
  const origLog = console.log;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  console.log = (...logArgs: any[]) => lines.push(logArgs.map(String).join(' '));
  try {
    render(args);
  } finally {
    console.log = origLog;
  }
  return lines.join('\n');
}

const ANSI_ENTER_ALT_SCREEN = '\x1B[?1049h';
const ANSI_EXIT_ALT_SCREEN = '\x1B[?1049l';
const ANSI_HIDE_CURSOR = '\x1B[?25l';
const ANSI_SHOW_CURSOR = '\x1B[?25h';
const ANSI_CURSOR_HOME = '\x1B[H';
const ANSI_ERASE_DOWN = '\x1B[J';
const ANSI_ESCAPE_SEQUENCE_PATTERN = /\x1B\[[0-?]*[ -/]*[@-~]/g;

function stripAnsiEscapeSequences(text: string): string {
  return text.replace(ANSI_ESCAPE_SEQUENCE_PATTERN, '');
}

async function follow(args: PsArgs): Promise<void> {
  const isTTY = Boolean(process.stdout.isTTY);
  let lastFrame = '';
  let interval: ReturnType<typeof setInterval> | undefined;
  let cleanedUp = false;

  const write = (text: string): void => {
    process.stdout.write(text);
  };

  const enterFollowMode = (): void => {
    if (!isTTY) return;
    write(ANSI_ENTER_ALT_SCREEN);
    write(ANSI_HIDE_CURSOR);
  };

  const exitFollowMode = (): void => {
    if (!isTTY || cleanedUp) return;
    cleanedUp = true;
    write(ANSI_SHOW_CURSOR);
    write(ANSI_EXIT_ALT_SCREEN);
  };

  const drawFrame = (): void => {
    const frame = renderBuffered(args);
    if (frame === lastFrame) return;
    lastFrame = frame;

    if (!isTTY) {
      write(`${stripAnsiEscapeSequences(frame)}\n\n`);
      return;
    }

    write(`${ANSI_CURSOR_HOME}${ANSI_ERASE_DOWN}${frame}\n`);
  };

  const cleanup = (exitCode?: number): void => {
    if (interval) clearInterval(interval);
    exitFollowMode();
    if (exitCode !== undefined) process.exit(exitCode);
  };

  process.stdout.on('error', (error: NodeJS.ErrnoException) => {
    if (error.code === 'EPIPE') {
      cleanup(0);
      return;
    }
    throw error;
  });
  process.once('SIGINT', () => cleanup(130));
  process.once('SIGTERM', () => cleanup(143));
  process.once('exit', () => cleanup());

  enterFollowMode();
  drawFrame();

  await new Promise<void>(() => {
    interval = setInterval(drawFrame, 1000);
  });
}

export async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(3));
  const sqliteClient = createObservabilitySqliteClient();
  try {
    const resolvedArgs: PsArgs = {
      ...args,
      nodeId: args.nodeId && sqliteClient ? resolveNodeRefWithClient(args.nodeId, sqliteClient) : args.nodeId,
    };

    if (resolvedArgs.inspectId) {
      renderInspect(resolvedArgs.inspectId);
      return;
    }
    if (resolvedArgs.follow) {
      await follow(resolvedArgs);
      return;
    }
    render(resolvedArgs);
  } finally {
    sqliteClient?.close();
  }
}
