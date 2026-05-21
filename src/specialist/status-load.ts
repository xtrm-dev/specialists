import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createObservabilitySqliteClient } from './observability-sqlite.js';
import { resolveJobsDir } from './job-root.js';
import type { SupervisorStatus } from './supervisor.js';
import type { TimelineEventTool } from './timeline-events.js';
import { parseTimelineEvent } from './timeline-events.js';

function readStatusesFromFiles(jobsDir: string): SupervisorStatus[] {
  if (!existsSync(jobsDir)) return [];

  const statuses: SupervisorStatus[] = [];
  for (const entry of readdirSync(jobsDir)) {
    const statusPath = join(jobsDir, entry, 'status.json');
    if (!existsSync(statusPath)) continue;
    try {
      statuses.push(JSON.parse(readFileSync(statusPath, 'utf-8')) as SupervisorStatus);
    } catch {
      // ignore malformed status files
    }
  }

  return statuses.sort((a, b) => b.started_at_ms - a.started_at_ms);
}

function readLastToolEventFromFile(jobsDir: string, jobId: string): TimelineEventTool | undefined {
  const eventsPath = join(jobsDir, jobId, 'events.jsonl');
  if (!existsSync(eventsPath)) return undefined;

  try {
    const lines = readFileSync(eventsPath, 'utf-8').split('\n');
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const line = lines[index]?.trim();
      if (!line) continue;
      const parsed = parseTimelineEvent(line);
      if (!parsed || parsed.type !== 'tool') continue;
      return parsed;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function resolveDerivedCurrentTool(
  status: SupervisorStatus,
  jobsDir: string,
  sqliteClient: ReturnType<typeof createObservabilitySqliteClient>,
): string | undefined {
  let lastToolEvent: TimelineEventTool | undefined;

  try {
    lastToolEvent = sqliteClient?.readLatestToolEvent(status.id) ?? undefined;
  } catch {
    lastToolEvent = undefined;
  }

  if (!lastToolEvent) {
    lastToolEvent = readLastToolEventFromFile(jobsDir, status.id);
  }

  if (!lastToolEvent) return status.current_tool;
  if (lastToolEvent.phase === 'start') return lastToolEvent.tool;
  return undefined;
}

function enrichStatusesWithDerivedCurrentTool(
  statuses: SupervisorStatus[],
  jobsDir: string,
  sqliteClient: ReturnType<typeof createObservabilitySqliteClient>,
): SupervisorStatus[] {
  return statuses.map((status) => ({
    ...status,
    current_tool: resolveDerivedCurrentTool(status, jobsDir, sqliteClient),
  }));
}

export function loadStatuses(): SupervisorStatus[] {
  const sqliteClient = createObservabilitySqliteClient();
  const jobsDir = resolveJobsDir();
  const fileStatuses = readStatusesFromFiles(jobsDir);

  try {
    const sqliteStatuses = sqliteClient?.listStatuses() ?? [];
    if (sqliteStatuses.length === 0) {
      return enrichStatusesWithDerivedCurrentTool(fileStatuses, jobsDir, sqliteClient)
        .sort((a, b) => b.started_at_ms - a.started_at_ms);
    }

    const merged = new Map<string, SupervisorStatus>();
    for (const status of fileStatuses) merged.set(status.id, status);
    for (const status of sqliteStatuses) {
      const current = merged.get(status.id);
      if (!current || status.started_at_ms >= current.started_at_ms) {
        merged.set(status.id, status);
      }
    }

    return enrichStatusesWithDerivedCurrentTool([...merged.values()], jobsDir, sqliteClient)
      .sort((a, b) => b.started_at_ms - a.started_at_ms);
  } catch {
    return enrichStatusesWithDerivedCurrentTool(fileStatuses, jobsDir, sqliteClient)
      .sort((a, b) => b.started_at_ms - a.started_at_ms);
  } finally {
    sqliteClient?.close();
  }
}
