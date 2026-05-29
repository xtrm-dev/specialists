import { beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  appendFile: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMocks);

describe('job-file-output', () => {
  beforeEach(() => {
    fsMocks.appendFile.mockReset();
    fsMocks.writeFile.mockReset();
  });

  it('appends full-trail output when gate enabled', async () => {
    fsMocks.appendFile.mockResolvedValue(undefined);
    const original = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';

    const { writeJobFileOutput } = await import('../../../src/specialist/job-file-output.js');
    await writeJobFileOutput('/tmp/handoff.md', 'trail block', 'append');

    expect(fsMocks.appendFile).toHaveBeenCalledWith('/tmp/handoff.md', 'trail block', 'utf-8');
    expect(fsMocks.writeFile).not.toHaveBeenCalled();

    process.env.SPECIALISTS_JOB_FILE_OUTPUT = original;
  });

  it('overwrites final-only output when gate enabled', async () => {
    fsMocks.writeFile.mockResolvedValue(undefined);
    const original = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'on';

    const { writeJobFileOutput } = await import('../../../src/specialist/job-file-output.js');
    await writeJobFileOutput('/tmp/handoff.md', 'final block', 'overwrite');

    expect(fsMocks.writeFile).toHaveBeenCalledWith('/tmp/handoff.md', 'final block', 'utf-8');
    expect(fsMocks.appendFile).not.toHaveBeenCalled();

    process.env.SPECIALISTS_JOB_FILE_OUTPUT = original;
  });

  it('does nothing when gate disabled', async () => {
    const original = process.env.SPECIALISTS_JOB_FILE_OUTPUT;
    process.env.SPECIALISTS_JOB_FILE_OUTPUT = 'off';

    const { writeJobFileOutput } = await import('../../../src/specialist/job-file-output.js');
    await writeJobFileOutput('/tmp/handoff.md', 'block', 'append');

    expect(fsMocks.appendFile).not.toHaveBeenCalled();
    expect(fsMocks.writeFile).not.toHaveBeenCalled();

    process.env.SPECIALISTS_JOB_FILE_OUTPUT = original;
  });
});
