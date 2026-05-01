import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { extractReleaseDraft, parseArgs, prepareRelease, publishRelease } from '../../../src/cli/release.js';

const ORIGINAL_CWD = process.cwd();

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'sp-release-'));
  mkdirSync(join(root, 'dist'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sp', version: '3.8.0' }, null, 2));
  writeFileSync(join(root, 'CHANGELOG.md'), [
    '# Changelog',
    '',
    'All notable changes to this project will be documented in this file.',
    '',
    '---',
    '',
    '## [Unreleased]',
    '',
    '---',
    '',
    '## [3.8.0] - 2026-04-26',
    '',
    '### Added',
    '- **Base**: initial release',
    '',
    '[Unreleased]: https://example.com/compare/v3.8.0...HEAD',
    '[3.8.0]: https://example.com/releases/tag/v3.8.0',
  ].join('\n'));
  writeFileSync(join(root, 'dist', 'index.js'), 'console.log("dist");\n');
  return root;
}

function createPrepareDeps(root: string, tagList: string, runScriptOutput: string) {
  const addCalls: string[] = [];
  const spawn = vi.fn((cmd: string, args: string[]) => {
    if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return { status: 0, stdout: `${tagList}\n`, stderr: '' };
    if (cmd === 'git' && args[0] === 'add') {
      addCalls.push(`add:${args.slice(1).join(' ')}`);
      return { status: 0, stdout: '', stderr: '' };
    }
    return { status: 0, stdout: '', stderr: '' };
  });
  const runScript = vi.fn().mockResolvedValue({ success: true, output: runScriptOutput });
  return { spawn, runScript, addCalls };
}

describe('release CLI', () => {
  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    vi.restoreAllMocks();
  });

  it('parses backfill args', () => {
    expect(parseArgs(['--from', 'v3.8.0', '--to', 'v3.9.0', '--insert-after', 'v3.8.0'])).toEqual({
      bump: 'patch',
      fromTag: 'v3.8.0',
      toTag: 'v3.9.0',
      insertAfter: 'v3.8.0',
    });
  });

  it('extracts release draft from markdown body with JSON tail', () => {
    const draft = extractReleaseDraft(['## [v3.9.0] - 2026-04-30', '', '### Added', '- Scope: single command entry point', '', '{"unreleased_summary":"Draft summary","sections":{"added":["Scope: single command entry point"],"changed":[],"fixed":[],"removed":[],"deprecated":[],"security":[]}}'].join('\n'));

    expect(draft).toEqual({
      unreleased_summary: 'Draft summary',
      sections: { added: ['Scope: single command entry point'], changed: [], fixed: [], removed: [], deprecated: [], security: [] },
    });
  });

  it('normalizes JSON drafts missing some section keys', () => {
    const draft = extractReleaseDraft('{"unreleased_summary":"x","sections":{"fixed":["a: b"]}}');
    expect(draft).toEqual({
      unreleased_summary: 'x',
      sections: { added: [], changed: [], fixed: ['a: b'], removed: [], deprecated: [], security: [] },
    });
  });

  it('drops non-string entries from JSON drafts', () => {
    const draft = extractReleaseDraft('{"sections":{"added":["ok",42,null,"also ok"]}}');
    expect(draft?.sections.added).toEqual(['ok', 'also ok']);
  });

  it('accepts array-shape sections (name/bullets)', () => {
    const draft = extractReleaseDraft('{"sections":[{"name":"Added","bullets":["a"]},{"name":"Fixed","bullets":["b","c"]}]}');
    expect(draft?.sections.added).toEqual(['a']);
    expect(draft?.sections.fixed).toEqual(['b', 'c']);
  });

  it('derives semver section label when --to is HEAD', async () => {
    const root = makeRepo();
    process.chdir(root);

    const deps = createPrepareDeps(
      root,
      'v3.10.0',
      JSON.stringify({ sections: [{ name: 'Fixed', bullets: ['hot patch'] }] }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await prepareRelease(['--from', 'v3.10.0', '--to', 'HEAD'], {
      cwd: () => root,
      now: () => new Date('2026-05-01T00:00:00Z'),
      spawn: deps.spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.10.0';
        if (cmd === 'git' && args[0] === 'log') return 'hash||msg||body';
        if (cmd === 'bd' && args[0] === 'query') return 'closed issues';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: deps.runScript as any,
    });

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [v3.10.1] - 2026-05-01');
    expect(changelog).not.toContain('## [HEAD]');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('release: v3.10.1'));
  });

  it('falls through to markdown when JSON has unknown shape', () => {
    const output = ['### Added', '- alpha', '', '### Fixed', '- beta', '', '{"unrelated":"shape"}'].join('\n');
    const draft = extractReleaseDraft(output);
    expect(draft?.sections.added).toEqual(['alpha']);
    expect(draft?.sections.fixed).toContain('beta');
  });

  it('rejects from-only release args', () => {
    expect(() => parseArgs(['--from', 'v1.0.0'])).toThrow('--from and --to must be used together');
  });

  it('rejects to-only release args', () => {
    expect(() => parseArgs(['--to', 'v2.0.0'])).toThrow('--from and --to must be used together');
  });

  it('rejects range args with bump flags', () => {
    expect(() => parseArgs(['--major', '--from', 'v1', '--to', 'v2'])).toThrow('--from/--to cannot be combined with --major/--minor/--patch');
  });

  it('prepares release draft, bumps version, stages files, and stays idempotent on rerun', async () => {
    const root = makeRepo();
    process.chdir(root);

    const deps = createPrepareDeps(
      root,
      'v3.8.0',
      JSON.stringify({ unreleased_summary: 'Draft summary', sections: { added: ['Scope: single command entry point'], changed: [], fixed: [], removed: [], deprecated: [], security: [] } }),
    );
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await prepareRelease(['--patch'], {
      cwd: () => root,
      now: () => new Date('2026-04-30T00:00:00Z'),
      spawn: deps.spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.8.0';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: deps.runScript as any,
    });

    await prepareRelease(['--patch'], {
      cwd: () => root,
      now: () => new Date('2026-04-30T00:00:00Z'),
      spawn: deps.spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.8.1';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: deps.runScript as any,
    });

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog.match(/## \[v3\.8\.1\]/g)).toHaveLength(1);
    expect(changelog.match(/## \[v3\.8\.2\]/g)).toHaveLength(1);
    expect(changelog).toContain('- **Scope**: single command entry point');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('git commit -m "release: v3.8.1"'));
    expect(deps.addCalls).toContain('add:CHANGELOG.md package.json dist/index.js');
    expect(deps.runScript).toHaveBeenCalledTimes(2);
  });

  it('backfills changelog sections from explicit tag range without bumping package version', async () => {
    const root = makeRepo();
    process.chdir(root);

    const deps = createPrepareDeps(
      root,
      'v3.8.0\nv3.9.0',
      JSON.stringify({ unreleased_summary: 'Draft summary', sections: { added: ['Scope: historical release'], changed: [], fixed: [], removed: [], deprecated: [], security: [] } }),
    );

    await prepareRelease(['--from', 'v3.8.0', '--to', 'v3.9.0'], {
      cwd: () => root,
      now: () => new Date('2026-04-30T00:00:00Z'),
      spawn: deps.spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.8.0\nv3.9.0';
        if (cmd === 'git' && args[0] === 'log') return 'hash||msg||body';
        if (cmd === 'bd' && args[0] === 'query') return 'closed issues';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: deps.runScript as any,
    });

    const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'));
    expect(packageJson.version).toBe('3.8.0');
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [v3.9.0] - 2026-04-30');
    expect(deps.addCalls).toContain('add:CHANGELOG.md dist/index.js');
  });

  it('inserts backfill section above named release header', async () => {
    const root = makeRepo();
    process.chdir(root);
    writeFileSync(join(root, 'CHANGELOG.md'), [
      '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', '---', '', '## [Unreleased]', '', '---', '', '## [v3.10.0] - 2026-04-30', '', '### Added', '- **New**: latest', '', '## [v3.9.0] - 2026-04-29', '', '### Added', '- **Old**: older', '', '[Unreleased]: https://example.com/compare/v3.10.0...HEAD', '[v3.10.0]: https://example.com/releases/tag/v3.10.0', '[v3.9.0]: https://example.com/releases/tag/v3.9.0',
    ].join('\n'));

    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return { status: 0, stdout: 'v3.8.0\nv3.9.0\nv3.10.0\n', stderr: '' };
      if (cmd === 'git' && args[0] === 'add') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    await prepareRelease(['--from', 'v3.8.0', '--to', 'v3.8.0', '--insert-after', 'v3.9.0'], {
      cwd: () => root,
      now: () => new Date('2026-04-30T00:00:00Z'),
      spawn: spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.8.0\nv3.9.0\nv3.10.0';
        if (cmd === 'git' && args[0] === 'log') return 'hash||msg||body';
        if (cmd === 'bd' && args[0] === 'query') return 'closed issues';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: vi.fn().mockResolvedValue({ success: true, output: JSON.stringify({ unreleased_summary: 'Draft summary', sections: { added: ['Scope: backfill'], changed: [], fixed: [], removed: [], deprecated: [], security: [] } }) }) as any,
    });

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog.indexOf('## [v3.8.0] - 2026-04-30')).toBeLessThan(changelog.indexOf('## [v3.9.0] - 2026-04-29'));
  });

  it('publishes tag from committed release and emits gh fallback command when unauthenticated', async () => {
    const root = makeRepo();
    process.chdir(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sp', version: '3.8.1' }, null, 2));
    writeFileSync(join(root, 'CHANGELOG.md'), [
      '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', '---', '', '## [Unreleased]', '', '---', '', '## [v3.8.1] - 2026-04-30', '', '### Added', '- **Scope**: single command entry point', '', '[Unreleased]: https://example.com/compare/v3.8.1...HEAD', '[v3.8.1]: https://example.com/releases/tag/v3.8.1',
    ].join('\n'));

    const spawn = vi.fn((cmd: string, args: string[], options: any) => {
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'status') return { status: 1, stdout: '', stderr: 'not logged in' };
      if (cmd === 'git' && args[0] === 'log') return { status: 0, stdout: 'release: v3.8.1\n', stderr: '' };
      if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'tag') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'push') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await publishRelease([], {
      cwd: () => root,
      spawn: spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'log') return 'release: v3.8.1';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: vi.fn() as any,
      now: () => new Date('2026-04-30T00:00:00Z'),
    });

    expect(logSpy).toHaveBeenCalledWith('gh release create v3.8.1 --notes-file -');
    expect(readFileSync(join(root, 'CHANGELOG.md'), 'utf-8')).toContain('## [Unreleased]');
  });

  it('refuses publish when stale release header sits above target', async () => {
    const root = makeRepo();
    process.chdir(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sp', version: '3.8.2' }, null, 2));
    writeFileSync(join(root, 'CHANGELOG.md'), [
      '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', '---', '', '## [Unreleased]', '', '---', '', '## [v3.8.1] - 2026-04-29', '', '### Added', '- **Old**: stale release', '', '## [v3.8.2] - 2026-04-30', '', '### Added', '- **Scope**: target release', '', '[Unreleased]: https://example.com/compare/v3.8.2...HEAD', '[v3.8.2]: https://example.com/releases/tag/v3.8.2',
    ].join('\n'));

    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'status') return { status: 1, stdout: '', stderr: 'not logged in' };
      if (cmd === 'git' && args[0] === 'log') return { status: 0, stdout: 'release: v3.8.2', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    await expect(publishRelease([], {
      cwd: () => root,
      spawn: spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'log') return 'release: v3.8.2';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: vi.fn() as any,
      now: () => new Date('2026-04-30T00:00:00Z'),
    })).rejects.toThrow('v3.8.2 as first release after [Unreleased]');
  });

  it('preserves older duplicate bullets when publish strips only current section', async () => {
    const root = makeRepo();
    process.chdir(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sp', version: '3.8.1' }, null, 2));
    writeFileSync(join(root, 'CHANGELOG.md'), [
      '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', '---', '', '## [Unreleased]', '', '---', '', '## [v3.8.1] - 2026-04-30', '', '### Added', '- **Scope**: duplicate bullet', '', '## [v3.8.0] - 2026-04-26', '', '### Added', '- **Scope**: duplicate bullet', '', '[Unreleased]: https://example.com/compare/v3.8.1...HEAD', '[v3.8.1]: https://example.com/releases/tag/v3.8.1',
    ].join('\n'));

    const spawn = vi.fn((cmd: string, args: string[], options: any) => {
      if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'log') return { status: 0, stdout: 'release: v3.8.1', stderr: '' };
      if (cmd === 'git' && args[0] === 'tag') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'push') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'status') return { status: 1, stdout: '', stderr: 'not logged in' };
      return { status: 0, stdout: '', stderr: '' };
    });

    await publishRelease([], {
      cwd: () => root,
      spawn: spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'log') return 'release: v3.8.1';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: vi.fn() as any,
      now: () => new Date('2026-04-30T00:00:00Z'),
    });

    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [v3.8.0] - 2026-04-26');
    expect(changelog.match(/duplicate bullet/g)).toHaveLength(2);
  });
});
