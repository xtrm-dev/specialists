import { collectPrometheusProjection } from '../specialist/prometheus-projection.js';

interface MetricsOptions {
  format: 'prometheus';
  sinceMs?: number;
}

function parseArgs(argv: readonly string[]): MetricsOptions {
  let format: MetricsOptions['format'] = 'prometheus';
  let sinceMs: number | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--prometheus') {
      format = 'prometheus';
      continue;
    }
    if (token === '--since') {
      const value = argv[i + 1];
      if (!value) throw new Error('--since requires a value');
      sinceMs = parseSince(value);
      if (sinceMs === undefined) throw new Error(`Invalid --since value: ${value}`);
      i += 1;
      continue;
    }
    throw new Error(`Unknown metrics option: ${token}`);
  }

  return { format, sinceMs };
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
  if (options.format !== 'prometheus') throw new Error(`Unsupported metrics format: ${options.format}`);
  process.stdout.write(collectPrometheusProjection({ sinceMs: options.sinceMs }));
}
