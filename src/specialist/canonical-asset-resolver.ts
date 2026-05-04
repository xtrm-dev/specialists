import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Resolve canonical asset dir from installed package location.
 * Handles bundled dist/ and source/ layouts.
 */
export function resolveCanonicalAssetDir(relativePath: string): string | null {
  const configPath = `config/${relativePath}`;

  let resolved = fileURLToPath(new URL(`../${configPath}`, import.meta.url));
  if (existsSync(resolved)) return resolved;

  resolved = fileURLToPath(new URL(`../../${configPath}`, import.meta.url));
  if (existsSync(resolved)) return resolved;

  return null;
}
