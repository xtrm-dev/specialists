#!/usr/bin/env bun

import { readFileSync, readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

type ReportRecord = {
  file: string;
  date: string;
  bytes: number;
  content: string;
};

type ReportBundle = {
  reports: ReportRecord[];
  output: string;
  capped: boolean;
  capBytes: number;
};

type ListReportsOptions = {
  since: string;
  to: string;
  rootDir?: string;
  capBytes?: number;
};

const DEFAULT_CAP_BYTES = 50_000;
const REPORT_DIR = '.xtrm/reports';

function getCommitDate(ref: string): string {
  return execFileSync('git', ['show', '-s', '--format=%cs', ref], {
    encoding: 'utf8',
  }).trim();
}

function listReportFiles(rootDir: string): string[] {
  return readdirSync(path.join(rootDir, REPORT_DIR))
    .filter((entry) => entry.endsWith('.md'))
    .sort()
    .map((entry) => path.join(REPORT_DIR, entry));
}

function isDateInRange(date: string, since: string, to: string): boolean {
  return date >= since && date <= to;
}

export function listXtReports(options: ListReportsOptions): ReportRecord[] {
  const rootDir = options.rootDir ?? process.cwd();
  const sinceDate = getCommitDate(options.since);
  const toDate = getCommitDate(options.to);

  return listReportFiles(rootDir)
    .map((relativePath) => {
      const file = path.basename(relativePath);
      const date = file.slice(0, 10);
      return { file: relativePath, date, bytes: 0, content: '' } satisfies ReportRecord;
    })
    .filter((report) => isDateInRange(report.date, sinceDate, toDate))
    .map((report) => {
      const content = readFileSync(path.join(rootDir, report.file), 'utf8');
      return {
        ...report,
        bytes: Buffer.byteLength(content, 'utf8'),
        content,
      };
    });
}

export function buildReportBundle(reports: ReportRecord[], capBytes = DEFAULT_CAP_BYTES): ReportBundle {
  const selected: ReportRecord[] = [];
  const chunks: string[] = [];
  let bytesUsed = 0;

  for (const report of [...reports].sort((left, right) => right.date.localeCompare(left.date))) {
    const block = `## ${report.file}\n\n${report.content.trim()}\n`;
    const blockBytes = Buffer.byteLength(block, 'utf8');
    if (selected.length > 0 && bytesUsed + blockBytes > capBytes) continue;
    if (selected.length === 0 && blockBytes > capBytes) {
      selected.push(report);
      chunks.push(block);
      bytesUsed += blockBytes;
      break;
    }
    selected.push(report);
    chunks.push(block);
    bytesUsed += blockBytes;
  }

  const capped = selected.length < reports.length;
  const note = capped ? `# xt reports capped at ${capBytes} bytes; oldest reports dropped\n\n` : '';

  return {
    reports: selected,
    output: `${note}${chunks.join('\n')}`.trimEnd(),
    capped,
    capBytes,
  };
}

async function main() {
  const since = process.argv[2];
  const to = process.argv[3] ?? 'HEAD';
  const capArg = process.argv[4];
  const capBytes = capArg ? Number(capArg) : DEFAULT_CAP_BYTES;

  if (!since) throw new Error('Usage: xt-reports.ts <since> [to] [capBytes]');

  const reports = listXtReports({ since, to, capBytes });
  const bundle = buildReportBundle(reports, capBytes);
  console.log(bundle.output);
}

if (import.meta.main) await main();
