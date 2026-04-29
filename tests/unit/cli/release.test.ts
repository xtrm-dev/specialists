import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { prepareRelease, publishRelease } from '../../../src/cli/release.js';

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
