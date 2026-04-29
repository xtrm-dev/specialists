import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

describe('release CLI', () => {
  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    vi.restoreAllMocks();
  });

  it('prepares release draft, bumps version, and stages files', async () => {
    const root = makeRepo();
    process.chdir(root);

    const log: string[] = [];
    const spawn = vi.fn((cmd: string, args: string[], options: any) => {
      if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') {
        return { status: 0, stdout: 'v3.8.0\n', stderr: '' };
      }
      if (cmd === 'git' && args[0] === 'add') {
        log.push(`add:${args.slice(1).join(' ')}`);
        return { status: 0, stdout: '', stderr: '' };
      }
      return { status: 0, stdout: '', stderr: '' };
    });
    const runScript = vi.fn().mockResolvedValue({
      success: true,
      output: JSON.stringify({
        unreleased_summary: 'Draft summary',
        sections: {
          added: ['Scope: single command entry point'],
          changed: [],
          fixed: [],
          removed: [],
          deprecated: [],
          security: [],
        },
      }),
    });

    const { prepareRelease } = await import('../../../src/cli/release.js');
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await prepareRelease(['--patch'], {
      cwd: () => root,
      now: () => new Date('2026-04-30T00:00:00Z'),
      spawn: spawn as any,
      exec: vi.fn((cmd: string, args: string[]) => {
        if (cmd === 'git' && args[0] === 'tag' && args[1] === '--list') return 'v3.8.0';
        throw new Error(`unexpected exec ${cmd} ${args.join(' ')}`);
      }) as any,
      readFile: readFileSync as any,
      writeFile: writeFileSync as any,
      loader: () => ({}) as any,
      runScript: runScript as any,
    });

    expect(runScript).toHaveBeenCalledWith(expect.objectContaining({ specialist: 'changelog-keeper', variables: { prev_tag: 'v3.8.0', next_tag: 'v3.8.1' } }), expect.anything());
    expect(readFileSync(join(root, 'package.json'), 'utf-8')).toContain('3.8.1');
    const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf-8');
    expect(changelog).toContain('## [v3.8.1] - 2026-04-30');
    expect(changelog).toContain('- **Scope**: single command entry point');
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('git commit -m "release: v3.8.1"'));
    expect(log).toContain('add:CHANGELOG.md package.json dist/index.js');
  });

  it('publishes tag from committed release and emits gh fallback command when unauthenticated', async () => {
    const root = makeRepo();
    process.chdir(root);
    writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'sp', version: '3.8.1' }, null, 2));
    writeFileSync(join(root, 'CHANGELOG.md'), [
      '# Changelog', '', 'All notable changes to this project will be documented in this file.', '', '---', '', '## [Unreleased]', '', '---', '', '## [v3.8.1] - 2026-04-30', '', '### Added', '- **Prepare flow: single command entry point', '', '[Unreleased]: https://example.com/compare/v3.8.1...HEAD', '[v3.8.1]: https://example.com/releases/tag/v3.8.1',
    ].join('\n'));

    const spawn = vi.fn((cmd: string, args: string[]) => {
      if (cmd === 'gh' && args[0] === 'auth' && args[1] === 'status') return { status: 1, stdout: '', stderr: 'not logged in' };
      if (cmd === 'git' && args[0] === 'log') return { status: 0, stdout: 'release: v3.8.1\n', stderr: '' };
      if (cmd === 'git' && args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'tag') return { status: 0, stdout: '', stderr: '' };
      if (cmd === 'git' && args[0] === 'push') return { status: 0, stdout: '', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    });

    const { publishRelease } = await import('../../../src/cli/release.js');
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
});
