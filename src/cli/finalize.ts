// Finalize a waiting keep-alive specialist session after reviewer PASS.
// Accepts any chain member (executor, reviewer, debugger). Looks up the
// chain's reviewer verdict and, if PASS, closes ALL waiting keep-alive
// members of the chain.

import { finalizeJob } from '../specialist/control.js';

function parseFinalizeArgs(argv: readonly string[]): { jobId?: string } {
  const jobId = argv.find((token) => !token.startsWith('-'));
  return { jobId };
}

export async function run(): Promise<void> {
  const parsed = parseFinalizeArgs(process.argv.slice(3));
  const jobId = parsed.jobId;

  if (!jobId) {
    console.error('Usage: specialists|sp finalize <job-id>');
    process.exit(1);
  }

  try {
    await finalizeJob(jobId);
  } catch (err: any) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}
