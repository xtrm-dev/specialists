import { describe, it, expect } from 'vitest';
import { parsePorcelainStatus } from '../../../src/specialist/porcelain-parser.js';

describe('parsePorcelainStatus', () => {
  it('parses porcelain v1 paths without dropping first path character', () => {
    const stdout = [
      '?? src/pi/session.ts',
      ' M src/pi/session.ts',
      'M  src/specialist/manifest-resolver.ts',
      'A  added/file.txt',
      ' D deleted/file.txt',
      'R  "docs/old name.txt" -> "docs/new name.txt"',
      '?? "docs/notes with spaces.txt"',
      '?? .specialists/default/explorer.specialist.json',
    ].join('\n');

    expect(parsePorcelainStatus(stdout)).toEqual([
      'src/pi/session.ts',
      'src/pi/session.ts',
      'src/specialist/manifest-resolver.ts',
      'added/file.txt',
      'deleted/file.txt',
      'docs/new name.txt',
      'docs/notes with spaces.txt',
      '.specialists/default/explorer.specialist.json',
    ]);
  });
});
