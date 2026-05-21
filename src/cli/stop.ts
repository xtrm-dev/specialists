// Send SIGTERM to the PID recorded in status.json for a given job.

import { stopJob } from '../specialist/control.js';

function parseStopArgs(argv: readonly string[]): { jobId?: string; force: boolean; closeBeadAnyway: boolean } {
  let jobId: string | undefined;
  let force = false;
  let closeBeadAnyway = false;

  for (const token of argv) {
    if (token === '--force') {
      force = true;
      continue;
    }

    if (token === '--close-bead-anyway') {
      closeBeadAnyway = true;
      continue;
    }

    if (!token.startsWith('-') && !jobId) {
      jobId = token;
      continue;
    }

    throw new Error(`Unknown option: ${token}`);
  }

  return { jobId, force, closeBeadAnyway };
}

export async function run(): Promise<void> {
  let parsed: { jobId?: string; force: boolean; closeBeadAnyway: boolean };

  try {
    parsed = parseStopArgs(process.argv.slice(3));
  } catch (err: any) {
    console.error(err.message);
    console.error('Usage: specialists|sp stop <job-id> [--force]');
    process.exit(1);
  }

  const { jobId, force, closeBeadAnyway } = parsed;
  if (!jobId) {
    console.error('Usage: specialists|sp stop <job-id> [--force]');
    process.exit(1);
  }

  try {
    await stopJob(jobId, { force, closeBeadAnyway });
  } catch (err: any) {
    console.error(err.message);
    process.exit(1);
  }
}
