import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The version the SHIPPED tool catalog pins for one extension.
 *
 * Derived, not hardcoded (SPECIALISTS-32). A fixture that installs a matching extension so it
 * resolves healthy, or an assertion that names the catalog's version in a message, silently
 * decouples from the catalog the moment someone bumps the pin: the extension then resolves
 * `loaded_unhealthy`, every tool it contributes disappears from the resolved contract, and
 * the test fails for a reason that has nothing to do with what it asserts.
 *
 * Read from `config/catalog/index.json` because that is the file the resolver reads — it
 * inlines the catalogs, so the per-catalog `config/catalog/<name>.json` siblings are not
 * consulted.
 */
export function catalogVersion(catalog: string): string {
  const index = JSON.parse(readFileSync(join(process.cwd(), 'config/catalog/index.json'), 'utf8')) as {
    catalogs: Array<{ catalog: string; version: string }>;
  };
  const entry = index.catalogs.find((candidate) => candidate.catalog === catalog);
  if (!entry) throw new Error(`no catalog named '${catalog}' in config/catalog/index.json`);
  return entry.version;
}
