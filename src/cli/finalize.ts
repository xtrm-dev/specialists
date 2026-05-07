// Finalize a waiting keep-alive specialist session after reviewer PASS.

import { Supervisor } from '../specialist/supervisor.js';
import { resolveJobsDir } from '../specialist/job-root.js';
import type { RunOptions } from '../specialist/runner.js';
import type { SpecialistRunner } from '../specialist/runner.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const PASS_COMPLIANCE_VERDICT_REGEX = /## Compliance Verdict[\s\S]*?- Verdict: PASS/i;

function createFinalizeSupervisor(jobsDir: string): Supervisor {
  const runner = {
    run: async () => {
      throw new Error('finalize supervisor runner is not used');
    },
  } as unknown as SpecialistRunner;
  const runOptions = {} as unknown as RunOptions;
  return new Supervisor({ runner, runOptions, jobsDir });
}

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

  const jobsDir = resolveJobsDir();
  const supervisor = createFinalizeSupervisor(jobsDir);

  try {
    const status = supervisor.readStatus(jobId);
    if (!status) {
      console.error(`No job found: ${jobId}`);
      process.exit(1);
    }

    if (status.status !== 'waiting') {
      process.stderr.write(`${red('Error:')} Job ${jobId} is not waiting (status: ${status.status}).\n`);
      process.exit(1);
    }

    const output = supervisor.readResult(jobId) ?? '';
    if (!PASS_COMPLIANCE_VERDICT_REGEX.test(output)) {
      process.stderr.write(`${red('Error:')} Job ${jobId} has no PASS compliance verdict.\n`);
      process.stderr.write(`${dim('finalize only closes keep-alive chains after reviewer PASS.')}\n`);
      process.exit(1);
    }

    const finalized = supervisor.finalizeWaitingJob(jobId);
    if (!finalized) {
      process.stderr.write(`${red('Error:')} Failed to finalize job ${jobId}.\n`);
      process.exit(1);
    }

    process.stdout.write(`${green('✓')} Finalized job ${jobId}\n`);
  } finally {
    await supervisor.dispose();
  }
}
