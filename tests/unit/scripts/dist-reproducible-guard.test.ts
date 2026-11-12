import { describe, expect, it } from 'vitest';

import {
  changedDistPaths,
  evaluateBunSelection,
  mismatchMessage,
  parseArgs,
  parseBunVersion,
  wrongBunMessage,
} from '../../../scripts/check-dist-reproducible.mjs';

describe('dist reproducibility guard (SPECIALISTS-4445)', () => {
  describe('parseBunVersion', () => {
    it('reads a bare version', () => {
      expect(parseBunVersion('1.4.2')).toBe('1.4.2');
    });

    it('reads a version out of build metadata', () => {
      expect(parseBunVersion('1.4.2+0d1f8b6e4')).toBe('1.4.2');
    });

    it('strips surrounding whitespace from a pin file', () => {
      expect(parseBunVersion('1.4.2\n')).toBe('1.4.2');
    });

    it('returns undefined for noise instead of guessing', () => {
      expect(parseBunVersion('bun version unknown')).toBeUndefined();
      expect(parseBunVersion('')).toBeUndefined();
      expect(parseBunVersion(undefined)).toBeUndefined();
    });
  });

  describe('evaluateBunSelection', () => {
    it('accepts the running bun when it matches the pin', () => {
      expect(evaluateBunSelection({ pinned: '1.4.2', running: '1.4.2' }))
        .toEqual({ ok: true, useBinary: 'bun', errors: [] });
    });

    it('refuses the running bun when it differs from the pin', () => {
      // The exact real-world shape: the operator's global bun is 1.4.0, .bun-version pins 1.4.2.
      const result = evaluateBunSelection({ pinned: '1.4.2', running: '1.4.0' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('the bun on PATH is 1.4.0');
      expect(result.errors.join(' ')).toContain('pins 1.4.2');
      // It must not silently fall back to the wrong bun: no binary may be handed to the build.
      expect(result.useBinary).toBeUndefined();
    });

    it('prefers an explicitly pinned binary over whatever is on PATH', () => {
      const result = evaluateBunSelection({
        pinned: '1.4.2',
        running: '1.4.0',
        pinnedBinary: '/tmp/bun142/bin/bun',
        pinnedBinaryVersion: '1.4.2',
      });
      expect(result).toEqual({ ok: true, useBinary: '/tmp/bun142/bin/bun', errors: [] });
    });

    it('refuses a pinned binary that is itself the wrong version', () => {
      // Naming a binary is not a promise it is the pinned one; a stale path must not pass.
      const result = evaluateBunSelection({
        pinned: '1.4.2',
        pinnedBinary: '/usr/local/bin/bun',
        pinnedBinaryVersion: '1.4.0',
      });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('reports bun 1.4.0');
    });

    it('refuses when no bun is available at all', () => {
      const result = evaluateBunSelection({ pinned: '1.4.2' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('no bun on PATH');
    });

    it('refuses when the pin itself is missing', () => {
      const result = evaluateBunSelection({ pinned: undefined, running: '1.4.2' });
      expect(result.ok).toBe(false);
      expect(result.errors.join(' ')).toContain('.bun-version is missing');
    });
  });

  describe('changedDistPaths', () => {
    it('reads modified files and keeps the full path', () => {
      // Regression: an earlier version trimmed leading whitespace first, which shifted the
      // porcelain columns and dropped every path.
      expect(changedDistPaths(' M dist/index.js\n M dist/lib.js\n')).toEqual(['dist/index.js', 'dist/lib.js']);
    });

    it('reads added, deleted and untracked entries', () => {
      expect(changedDistPaths('A  dist/new.js\n D dist/old.js\n?? dist/types/x.d.ts\n'))
        .toEqual(['dist/new.js', 'dist/old.js', 'dist/types/x.d.ts']);
    });

    it('takes the new path of a rename', () => {
      expect(changedDistPaths('R  dist/a.js -> dist/b.js\n')).toEqual(['dist/b.js']);
    });

    it('ignores changes outside dist/', () => {
      expect(changedDistPaths(' M src/index.ts\n M dist/index.js\n')).toEqual(['dist/index.js']);
    });

    it('reports nothing for a clean tree', () => {
      expect(changedDistPaths('')).toEqual([]);
      expect(changedDistPaths('\n')).toEqual([]);
    });

    it('unquotes paths git quotes for special characters', () => {
      expect(changedDistPaths(' M "dist/a b.js"\n')).toEqual(['dist/a b.js']);
    });
  });

  describe('mismatchMessage', () => {
    const message = mismatchMessage({ pinned: '1.4.2', running: '1.4.2', files: ['dist/index.js', 'dist/lib.js'] });

    it('names the pinned version and the changed files', () => {
      expect(message).toContain('pinned bun 1.4.2');
      expect(message).toContain('dist/index.js, dist/lib.js');
    });

    it('names the actual symptom so the raw diff is not needed', () => {
      expect(message).toContain('__esm');
      expect(message).toContain('(fn, res, err) =>');
    });

    it('gives a copy-pasteable fix that does not upgrade the global bun', () => {
      expect(message).toContain('BUN_INSTALL=/tmp/bun142');
      expect(message).toContain('bun-v1.4.2');
      expect(message).toContain('PATH=/tmp/bun142/bin:$PATH');
      expect(message).toContain('--write');
      expect(message).not.toContain('bun upgrade');
    });

    it('warns that PATH — not just the outer invocation — must be pinned', () => {
      expect(message).toContain('shells out to `bun`');
    });

    it('counts the files it did not list', () => {
      const many = Array.from({ length: 12 }, (_, i) => `dist/f${i}.js`);
      expect(mismatchMessage({ pinned: '1.4.2', running: '1.4.2', files: many })).toContain('(+4 more)');
    });
  });

  describe('wrongBunMessage', () => {
    const message = wrongBunMessage({ pinned: '1.4.2', running: '1.4.0', errors: ['the bun on PATH is 1.4.0 but .bun-version pins 1.4.2'] });

    it('carries the refusal and the pinned install', () => {
      expect(message).toContain('the bun on PATH is 1.4.0');
      expect(message).toContain('BUN_INSTALL=/tmp/bun142');
      expect(message).toContain('SPECIALISTS_PINNED_BUN');
    });
  });

  describe('parseArgs', () => {
    it('defaults to check-only in the working directory', () => {
      const parsed = parseArgs([]);
      expect(parsed.write).toBe(false);
      expect(parsed.json).toBe(false);
      expect(parsed.cwd).toBe(process.cwd());
    });

    it('accepts --write and --json', () => {
      expect(parseArgs(['--write', '--json'])).toMatchObject({ write: true, json: true });
    });

    it('resolves --cwd', () => {
      expect(parseArgs(['--cwd', '/tmp']).cwd).toBe('/tmp');
    });

    it('rejects an unknown flag rather than ignoring it', () => {
      expect(() => parseArgs(['--allow-anything'])).toThrow(/unknown argument/);
    });

    it('rejects --cwd without a value', () => {
      expect(() => parseArgs(['--cwd'])).toThrow(/requires a path/);
    });
  });
});
