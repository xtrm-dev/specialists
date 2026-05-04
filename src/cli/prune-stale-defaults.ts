import { resolve } from 'node:path';
import { detectDriftForRepo, pruneStaleDefaults } from '../specialist/drift-detector.js';

function parseArgs(argv: readonly string[]): { dryRun: boolean; root: string; help: boolean } {
  let dryRun = false;
  let root = process.cwd();
  let help = false;
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (token === '--root') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--root requires a value');
      root = resolve(value);
      i += 1;
      continue;
    }
    if (token === '--help' || token === '-h') {
      help = true;
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return { dryRun, root, help };
}

function printHelp(): void {
  console.log('Usage: sp prune-stale-defaults [--dry-run] [--root <path>]');
  console.log('  --dry-run  List stale default snapshots without pruning');
  console.log('  --root     Repo root to scan');
}

export async function run(argv: readonly string[] = process.argv.slice(3)): Promise<void> {
  const { dryRun, root, help } = parseArgs(argv);
  if (help) {
    printHelp();
    return;
  }
  const findings = detectDriftForRepo(root).filter(f => f.scope === 'default' && f.bytes_equal === true);
  if (findings.length === 0) {
    console.log('No stale default snapshots found.');
    return;
  }
  console.log(dryRun ? 'Dry run: stale default snapshots' : 'Pruning stale default snapshots');
  for (const finding of findings) {
    console.log(`- ${finding.path}`);
  }
  if (dryRun) return;
  pruneStaleDefaults(root, false);
  console.log(`Pruned ${findings.length} stale default snapshot${findings.length === 1 ? '' : 's'}.`);
}
