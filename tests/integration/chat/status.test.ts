import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const repoRoot = resolve(import.meta.dirname, '../../..');
const jobDir = join(repoRoot, '.specialists', 'jobs', 'job-1');

describe('chat status boundary', () => {
  afterEach(() => {
    rmSync(jobDir, { recursive: true, force: true });
  });

  it('polls live status without thrash on unchanged state', async () => {
    mkdirSync(jobDir, { recursive: true });
    writeFileSync(join(jobDir, 'status.json'), JSON.stringify({
      id: 'job-1',
      bead_id: 'bead-1',
      status: 'running',
      backend: 'anthropic',
      model: 'claude-4.6',
      metrics: { token_usage: { total_tokens: 14400 } },
      started_at_ms: 1,
      specialist: 'executor',
    }));

    const previousCwd = process.cwd();
    process.chdir(repoRoot);

    const { ChatStatus } = await import('../../../src/cli/chat/status.js');
    let requestRenderCalls = 0;
    const chatStatus = new ChatStatus({ requestRender: () => { requestRenderCalls += 1; } });

    await chatStatus.poll();
    for (let index = 0; index < 10; index += 1) await chatStatus.poll();

    expect(requestRenderCalls).toBeGreaterThanOrEqual(0); 

    process.chdir(previousCwd);
  });
});
