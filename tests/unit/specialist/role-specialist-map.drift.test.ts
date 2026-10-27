import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

/**
 * Drift guard for the role-to-specialist map (SPECIALISTS-4343): the generated
 * map must match the specialist catalog — every named specialist needs its
 * definition file, and absent roles (deploy-watcher, production-monitor)
 * must never appear.
 */
const REPO = join(import.meta.dirname, '..', '..', '..');
const CANONICAL = join(REPO, 'config', 'catalog', 'role-specialist-map.json');
const RUNTIME_JSON = join(REPO, 'plugins', 'specialists', 'scripts', 'role-specialist-map.generated.json');
const RUNTIME_TS = join(REPO, 'plugins', 'specialists', 'hooks', 'role-specialist-map.generated.ts');
const GENERATOR = join(REPO, 'scripts', 'generate-role-specialist-map.mjs');

function catalogNames(): string[] {
  return readdirSync(join(REPO, 'config', 'specialists'))
    .filter((f) => f.endsWith('.specialist.json'))
    .map((f) => f.replace(/\.specialist\.json$/, ''));
}

function nonTemplateNames(): string[] {
  return catalogNames().filter((name) => {
    try {
      const parsed = JSON.parse(readFileSync(join(REPO, 'config', 'specialists', `${name}.specialist.json`), 'utf8'));
      return parsed?.specialist?.metadata?.category !== 'template';
    } catch {
      return false;
    }
  });
}

describe('role-specialist map drift', () => {
  it('names only specialists whose definition file exists', () => {
    const map = JSON.parse(readFileSync(CANONICAL, 'utf8')) as { roles: Record<string, string[]> };
    const files = new Set(catalogNames());
    for (const [role, names] of Object.entries(map.roles)) {
      expect(names.length, `role ${role} is empty`).toBeGreaterThan(0);
      for (const name of names) {
        expect(files.has(name), `${role} -> ${name} has no definition file`).toBe(true);
      }
    }
  });

  it('names no absent role', () => {
    const body = readFileSync(CANONICAL, 'utf8');
    for (const absent of ['deploy-watcher', 'production-monitor']) {
      expect(body, `absent role leaked into the map: ${absent}`).not.toContain(absent);
    }
  });

  it('maps pr-reviewer to the review role (SPECIALISTS-4382)', () => {
    // Catalog coverage above only proves pr-reviewer appears *somewhere*; the
    // generator's CANDIDATES table must keep it under the review role.
    const map = JSON.parse(readFileSync(CANONICAL, 'utf8')) as { roles: Record<string, string[]> };
    expect(map.roles.review, 'review role is missing from the map').toBeDefined();
    expect(map.roles.review).toContain('pr-reviewer');
  });

  it('covers every dispatchable catalog specialist', () => {
    const map = JSON.parse(readFileSync(CANONICAL, 'utf8')) as { roles: Record<string, string[]> };
    const covered = new Set(Object.values(map.roles).flat());
    for (const name of nonTemplateNames()) {
      expect(covered.has(name), `dispatchable specialist missing from the map: ${name}`).toBe(true);
    }
  });

  it('keeps the plugin runtime copies in sync with the canonical map', () => {
    expect(existsSync(RUNTIME_JSON), 'missing runtime JSON copy for session-start.mjs').toBe(true);
    expect(existsSync(RUNTIME_TS), 'missing runtime TS module for register.tsx').toBe(true);
    expect(readFileSync(RUNTIME_JSON, 'utf8')).toBe(readFileSync(CANONICAL, 'utf8'));
  });

  it('regenerates cleanly (node scripts/generate-role-specialist-map.mjs --check)', () => {
    const run = spawnSync('node', [GENERATOR, '--check'], { encoding: 'utf-8' });
    expect(run.stderr, 'generator reported drift').toBe('');
    expect(run.status).toBe(0);
  });
});
