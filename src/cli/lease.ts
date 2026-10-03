// src/cli/lease.ts
// `specialists lease list|reconcile` — the operator surface for uncertain writer leases.
//
// The operator states the outcome and the basis; nothing here infers either. Refusals are
// returned by reconcile() as records, so a refusal exits non-zero with its refusalReason.

import { resolve } from 'node:path';
import {
  leaseScopeFor,
  operatorIdentity,
  projectUncertainWorkspaces,
  reconcile,
  type ProposedOutcome,
  type ReconciliationRecord,
} from '../activation/workspace-reconcile.js';
import type { LeaseProcessProbe } from '../activation/workspace-lease.js';

const OUTCOMES: readonly ProposedOutcome[] = ['safe_free', 'superseded', 'manual_attention_required'];

export const LEASE_USAGE = [
  'Usage: specialists lease list [--json]',
  '       specialists lease reconcile <worktree> --outcome <safe_free|superseded|manual_attention_required>',
  '                                  --basis <text> [--basis <text> ...] [--superseded-by <act>] [--note <text>] [--json]',
].join('\n');

export interface LeaseCliIo {
  cwd: string;
  out: (text: string) => void;
  err: (text: string) => void;
  probe?: LeaseProcessProbe;
  decidedBy?: string;
}

export function runLeaseCommand(argv: string[], io: LeaseCliIo): number {
  const [verb, ...rest] = argv;
  if (verb === 'list') return list(rest, io);
  if (verb === 'reconcile') return reconcileCommand(rest, io);
  io.err(`${verb ? `Unknown subcommand '${verb}'.\n` : ''}${LEASE_USAGE}\n`);
  return 1;
}

function list(argv: string[], io: LeaseCliIo): number {
  const json = argv.includes('--json');
  const items = projectUncertainWorkspaces(leaseScopeFor(io.cwd), io.probe);
  if (json) {
    io.out(`${JSON.stringify(items, null, 2)}\n`);
    return 0;
  }
  if (items.length === 0) {
    io.out('No uncertain workspaces.\n');
    return 0;
  }
  for (const item of items) {
    io.out([
      `${item.worktree_path ?? item.workspace_key}`,
      `  holder:    ${item.holder_activation_id ?? 'unknown'} (${item.holder_specialist ?? 'unknown'}, pid ${item.holder_pid ?? 'unknown'})`,
      `  reason:    ${item.uncertain_reason ?? 'unknown'}`,
      `  permitted: ${item.permitted_outcomes.join(', ')}`,
      `  attempts:  ${item.reconciliation_attempts}`,
      '',
    ].join('\n'));
  }
  return 0;
}

function reconcileCommand(argv: string[], io: LeaseCliIo): number {
  let json = false;
  let worktree: string | undefined;
  const basis: string[] = [];
  let outcome: string | undefined;
  let supersededBy: string | undefined;
  let note: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') json = true;
    else if (arg === '--outcome') outcome = argv[++i];
    else if (arg === '--basis') basis.push(argv[++i] ?? '');
    else if (arg === '--superseded-by') supersededBy = argv[++i];
    else if (arg === '--note') note = argv[++i];
    else if (arg.startsWith('--')) {
      io.err(`Unknown option '${arg}'.\n${LEASE_USAGE}\n`);
      return 1;
    } else worktree ??= arg;
  }
  if (!worktree || !outcome || !OUTCOMES.includes(outcome as ProposedOutcome)) {
    io.err(`<worktree> and --outcome <${OUTCOMES.join('|')}> are required.\n${LEASE_USAGE}\n`);
    return 1;
  }

  const absolute = resolve(io.cwd, worktree);
  const record = reconcile(leaseScopeFor(absolute), {
    outcome: outcome as ProposedOutcome,
    decidedBy: io.decidedBy ?? operatorIdentity(),
    basis: basis.map(entry => entry.trim()).filter(entry => entry.length > 0),
    ...(supersededBy ? { supersededBy } : {}),
    ...(note ? { note } : {}),
  }, { probe: io.probe });

  if (json) io.out(`${JSON.stringify(record, null, 2)}\n`);
  else io.out(formatRecord(record));
  if (!record.applied) {
    io.err(`refused: ${record.refusalReason ?? 'unknown'}\n`);
    return 1;
  }
  return 0;
}

function formatRecord(record: ReconciliationRecord): string {
  return [
    `${record.applied ? 'applied' : 'refused'}: ${record.outcome}${record.refusalReason ? ` (${record.refusalReason})` : ''}`,
    `  worktree:   ${record.worktreePath}`,
    `  observed:   ${record.observedState}${record.observedUncertainReason ? ` / ${record.observedUncertainReason}` : ''}`,
    `  decided by: ${record.decidedBy}`,
    `  basis:      ${record.basis.join('; ') || '(none)'}`,
    ...(record.supersededBy ? [`  superseded by: ${record.supersededBy}`] : []),
    ...(record.note ? [`  note:       ${record.note}`] : []),
    '',
  ].join('\n');
}

export function run(): void {
  const code = runLeaseCommand(process.argv.slice(3), {
    cwd: process.cwd(),
    out: text => { process.stdout.write(text); },
    err: text => { process.stderr.write(text); },
  });
  if (code !== 0) process.exit(code);
}
