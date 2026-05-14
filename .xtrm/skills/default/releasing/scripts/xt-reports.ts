#!/usr/bin/env bun

import { buildReportBundle, listXtReports } from '../../../../../cli/src/core/xt-reports.ts';

async function main() {
  const since = process.argv[2];
  const to = process.argv[3] ?? 'HEAD';
  const capArg = process.argv[4];
  const capBytes = capArg ? Number(capArg) : 50_000;

  if (!since) throw new Error('Usage: xt-reports.ts <since> [to] [capBytes]');

  const reports = listXtReports({ since, to, capBytes });
  const bundle = buildReportBundle(reports, capBytes);
  console.log(bundle.output);
}

if (import.meta.main) await main();
