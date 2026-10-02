import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  getNativeSpecialistsExtensionPath,
  registerNativeSpecialists,
} from '../../../src/pi/native-specialists-registration.js';

let dir: string;
let settingsPath: string;
const BUNDLED = '/opt/global/node_modules/@jaggerxtrm/specialists/config/pi-extensions/native-specialists';

const read = () => JSON.parse(readFileSync(settingsPath, 'utf8'));
const write = (value: unknown) => writeFileSync(settingsPath, JSON.stringify(value));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'sp-pi-reg-'));
  settingsPath = join(dir, 'agent', 'settings.json');
});

describe('registerNativeSpecialists', () => {
  it('resolves the bundled extension from the source tree', () => {
    expect(getNativeSpecialistsExtensionPath()).toMatch(/config\/pi-extensions\/native-specialists$/);
  });

  it('creates settings and appends the bundled path, then is idempotent', () => {
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('added');
    expect(read().packages).toEqual([BUNDLED]);
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('present');
    expect(read().packages).toEqual([BUNDLED]);
  });

  it('keeps other settings and an existing native-specialists override', () => {
    mkdirSync(join(dir, 'agent'));
    const dev = '/home/me/dev/specialists/config/pi-extensions/native-specialists';
    write({ theme: 'dark', packages: ['npm:pi-gitnexus', dev] });
    const result = registerNativeSpecialists(BUNDLED, settingsPath);
    expect(result).toMatchObject({ status: 'present', source: dev });
    expect(read()).toEqual({ theme: 'dark', packages: ['npm:pi-gitnexus', dev] });
  });

  it('migrates a legacy entry to its sibling native-specialists checkout', () => {
    const root = join(dir, 'checkout', 'config', 'pi-extensions');
    mkdirSync(join(root, 'native-specialists'), { recursive: true });
    writeFileSync(join(root, 'native-specialists', 'index.mjs'), '');
    mkdirSync(join(dir, 'agent'));
    write({ packages: ['npm:a', join(root, 'specialist-subagents'), 'npm:b'] });
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('migrated');
    expect(read().packages).toEqual(['npm:a', join(root, 'native-specialists'), 'npm:b']);
  });

  it('migrates a legacy object entry to the bundled path when no sibling exists', () => {
    mkdirSync(join(dir, 'agent'));
    write({ packages: [{ source: '/gone/config/pi-extensions/specialist-subagents/', extensions: ['index.mjs'] }] });
    registerNativeSpecialists(BUNDLED, settingsPath);
    expect(read().packages).toEqual([{ source: BUNDLED, extensions: ['index.mjs'] }]);
  });

  it('drops legacy entries when a current entry already exists', () => {
    mkdirSync(join(dir, 'agent'));
    write({ packages: ['/x/config/pi-extensions/specialist-subagents', BUNDLED] });
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('migrated');
    expect(read().packages).toEqual([BUNDLED]);
  });

  it('never rewrites unreadable settings or a non-array packages field', () => {
    mkdirSync(join(dir, 'agent'));
    writeFileSync(settingsPath, '{ broken');
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('skipped');
    expect(readFileSync(settingsPath, 'utf8')).toBe('{ broken');
    write({ packages: 'npm:x' });
    expect(registerNativeSpecialists(BUNDLED, settingsPath).status).toBe('skipped');
    expect(read()).toEqual({ packages: 'npm:x' });
  });

  it('skips when the bundled extension cannot be found', () => {
    expect(registerNativeSpecialists(null, settingsPath).status).toBe('skipped');
  });
});
