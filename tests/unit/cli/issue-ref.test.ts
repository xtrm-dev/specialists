// Phase 2c: --issue-ref primary spelling with --bead/--bead-id as permanent aliases.
import { describe, expect, it, vi, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { resolveIssueRef } from '../../../src/cli/issue-ref.js';
import { parseRenderArgs } from '../../../src/cli/render-task.js';

const SURFACE_FILES = [
  'src/cli/run.ts',
  'src/cli/log.ts',
  'src/cli/ps.ts',
  'src/cli/chat.ts',
  'src/cli/end.ts',
  'src/cli/node.ts',
  'src/cli/render-task.ts',
  'src/cli/render-bead.ts',
] as const;

function src(name: string): string {
  return readFileSync(join(process.cwd(), name), 'utf-8');
}

function captureIndexHelp(args: string[]): string {
  const entry = join(process.cwd(), 'dist', 'index.js');
  return execFileSync('bun', [entry, ...args], { encoding: 'utf-8' });
}

describe('resolveIssueRef — one resolution path', () => {
  it('resolves --issue-ref and --bead to the same value', () => {
    expect(resolveIssueRef({ issueRef: 'X-1' })).toBe('X-1');
    expect(resolveIssueRef({ bead: 'X-1' })).toBe('X-1');
    expect(resolveIssueRef({ beadId: 'X-1' })).toBe('X-1');
    expect(resolveIssueRef({ issueRef: 'X-1', bead: 'X-1', beadId: 'X-1' })).toBe('X-1');
  });

  it('returns undefined when no flag is given', () => {
    expect(resolveIssueRef({})).toBeUndefined();
  });

  it('fails closed on conflicting distinct values', () => {
    expect(() => resolveIssueRef({ issueRef: 'A-1', bead: 'B-2' })).toThrow(/Conflicting --issue-ref/);
    expect(() => resolveIssueRef({ bead: 'A-1', beadId: 'B-2' })).toThrow(/Conflicting/);
    expect(() => resolveIssueRef({ issueRef: 'A-1', beadId: 'B-2' })).toThrow(/Conflicting/);
  });
});

describe('render-task parser — flag equivalence + conflict', () => {
  it('--issue-ref and --bead resolve identically', () => {
    const a = parseRenderArgs(['--issue-ref', 'unitAI-1']);
    const b = parseRenderArgs(['--bead', 'unitAI-1']);
    const c = parseRenderArgs(['--bead-id', 'unitAI-1']);
    expect(a.beadId).toBe('unitAI-1');
    expect(b.beadId).toBe('unitAI-1');
    expect(c.beadId).toBe('unitAI-1');
  });

  it('conflicting flags fail closed via usage', () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit:1');
    }) as never);
    const write = vi.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
    try {
      expect(() => parseRenderArgs(['--issue-ref', 'A-1', '--bead', 'B-2'])).toThrow('exit:1');
    } finally {
      exit.mockRestore();
      write.mockRestore();
    }
  });
});

describe('each CLI surface wires --issue-ref to the same input', () => {
  it.each(SURFACE_FILES)('%s parses --issue-ref and resolves via the shared helper', (file) => {
    const text = src(file);
    expect(text, `${file} missing --issue-ref`).toContain('--issue-ref');
    // render-bead delegates to parseRenderArgs; all others call the helper directly.
    if (file === 'src/cli/render-bead.ts') {
      expect(text).toContain('parseRenderArgs');
    } else {
      expect(text, `${file} must use one resolution path`).toContain('resolveIssueRef');
    }
  });

  it('keeps --bead working in every surface', () => {
    for (const file of SURFACE_FILES) {
      const text = src(file);
      // render-bead inherits --bead via parseRenderArgs; check the shared parser instead.
      if (file === 'src/cli/render-bead.ts') continue;
      expect(text, `${file} dropped --bead`).toContain('--bead');
    }
    expect(src('src/cli/render-task.ts')).toContain('--bead');
  });
});

describe('help text pins --issue-ref as primary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('top-level help names --issue-ref primary and --bead as alias', async () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      output.push(String(msg ?? ''));
    });
    const { run } = await import('../../../src/cli/help.js');
    await run();
    const combined = output.join('\n');
    expect(combined).toContain('--issue-ref');
    expect(combined).toContain('--bead');
    expect(combined).toMatch(/primary|compatibility alias/);
  });

  it('sp run --help documents both spellings with primary first', () => {
    const out = captureIndexHelp(['run', '--help']);
    expect(out).toContain('--issue-ref');
    expect(out).toContain('--bead');
    expect(out).toMatch(/primary|compatibility alias/);
  });

  it('quickstart and init present --issue-ref as primary', async () => {
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((msg?: unknown) => {
      output.push(String(msg ?? ''));
    });
    const { run } = await import('../../../src/cli/quickstart.js');
    await run();
    const combined = output.join('\n');
    expect(combined).toContain('--issue-ref');
    expect(combined).toContain('--bead');
    vi.restoreAllMocks();
    expect(src('src/cli/init.ts')).toContain('--issue-ref');
    expect(src('src/cli/init.ts')).toMatch(/primary|compatibility alias/);
  });
});
