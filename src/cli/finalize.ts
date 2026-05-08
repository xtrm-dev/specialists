// Finalize a waiting keep-alive specialist session after reviewer PASS.
// Accepts any chain member (executor, reviewer, debugger). Looks up the
// chain's reviewer verdict and, if PASS, closes ALL waiting keep-alive
// members of the chain.

import { Supervisor } from '../specialist/supervisor.js';
import { resolveJobsDir } from '../specialist/job-root.js';
import type { RunOptions } from '../specialist/runner.js';
import type { SpecialistRunner } from '../specialist/runner.js';

const green = (s: string) => `\x1b[32m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

const PASS_COMPLIANCE_VERDICT_REGEX = /## Compliance Verdict[\s\S]*?- Verdict:\s*\**\s*PASS\s*\**/i;

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

function findReviewerPassInChain(supervisor: Supervisor, chainId: string): { reviewerJobId: string } | null {
  const jobIds = supervisor.listChainJobIds(chainId);
  for (const id of jobIds) {
    const status = supervisor.readStatus(id);
    if (!status || status.specialist !== 'reviewer') continue;
    const output = supervisor.readResult(id) ?? '';
    if (PASS_COMPLIANCE_VERDICT_REGEX.test(output)) {
      return { reviewerJobId: id };
    }
  }
  return null;
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

    const chainId = status.chain_id ?? status.chain_root_job_id;
    if (!chainId) {
      process.stderr.write(`${red('Error:')} Job ${jobId} has no chain identity (chain_id missing).\n`);
      process.exit(1);
    }

    const reviewerPass = findReviewerPassInChain(supervisor, chainId);
    if (!reviewerPass) {
      process.stderr.write(`${red('Error:')} No reviewer with PASS compliance verdict found in chain ${chainId}.\n`);
      process.stderr.write(`${dim('finalize only closes keep-alive chains after reviewer PASS.')}\n`);
      process.exit(1);
    }

    const chainJobIds = supervisor.listChainJobIds(chainId);
    const finalized: string[] = [];
    const skipped: Array<{ id: string; reason: string }> = [];

    for (const id of chainJobIds) {
      const memberStatus = supervisor.readStatus(id);
      if (!memberStatus) {
        skipped.push({ id, reason: 'missing' });
        continue;
      }
      if (memberStatus.status !== 'waiting') {
        skipped.push({ id, reason: memberStatus.status });
        continue;
      }
      const result = supervisor.finalizeWaitingJob(id);
      if (result) {
        finalized.push(id);
      } else {
        skipped.push({ id, reason: 'finalize-failed' });
      }
    }

    if (finalized.length === 0) {
      process.stderr.write(`${red('Error:')} No waiting keep-alive jobs to finalize in chain ${chainId}.\n`);
      process.exit(1);
    }

    process.stdout.write(`${green('✓')} Finalized chain ${chainId} (reviewer PASS: ${reviewerPass.reviewerJobId})\n`);
    for (const id of finalized) {
      process.stdout.write(`  ${green('✓')} ${id}\n`);
    }
    for (const { id, reason } of skipped) {
      process.stdout.write(`  ${dim(`· ${id} (${reason})`)}\n`);
    }
  } finally {
    await supervisor.dispose();
  }
}
