import { createObservabilitySqliteClient, type ListForensicEventsFilters } from '../specialist/observability-sqlite.js';

interface ForensicOptions extends ListForensicEventsFilters {
  json: boolean;
}

function parseArgs(argv: readonly string[]): ForensicOptions {
  const options: ForensicOptions = { json: true, limit: 1000 };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--json') { options.json = true; continue; }
    if (token === '--family') {
      const value = argv[i + 1];
      if (!value) throw new Error('--family requires a value');
      options.eventFamily = value;
      i += 1;
      continue;
    }
    if (token === '--event-name') {
      const value = argv[i + 1];
      if (!value) throw new Error('--event-name requires a value');
      options.eventName = value;
      i += 1;
      continue;
    }
    if (token === '--since') {
      const value = argv[i + 1];
      if (!value) throw new Error('--since requires a value');
      options.sinceMs = parseSince(value);
      if (options.sinceMs === undefined) throw new Error(`Invalid --since value: ${value}`);
      i += 1;
      continue;
    }
    if (token === '--limit') {
      const value = argv[i + 1];
      if (!value) throw new Error('--limit requires a value');
      const parsed = Number(value);
      if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Invalid --limit value: ${value}`);
      options.limit = parsed;
      i += 1;
      continue;
    }
    if (!options.jobId && !token.startsWith('-')) {
      options.jobId = token;
      continue;
    }
    throw new Error(`Unknown forensic option: ${token}`);
  }
  return options;
}

function parseSince(value: string): number | undefined {
  if (value.includes('T') || value.includes('-')) {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return undefined;
  const n = Number(match[1]);
  const unit = match[2];
  const ms: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
  return Date.now() - n * ms[unit];
}

export async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(3));
  const client = createObservabilitySqliteClient();
  if (!client) throw new Error('Observability SQLite is unavailable; run under Bun with an initialized specialists database.');
  const rows = client.readForensicEvents(options);
  for (const row of rows) {
    if (options.json) {
      console.log(row.event_json);
      continue;
    }
    console.log(`${new Date(row.t).toISOString()} ${row.event_family}/${row.event_name} ${row.participant_role ?? 'unknown'} job=${row.job_id} seq=${row.seq}`);
  }
}
