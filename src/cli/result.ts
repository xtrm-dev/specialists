// src/cli/result.ts
// Print result.txt for a given job ID. Exit 1 if still running.

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Supervisor } from '../specialist/supervisor.js';
import { createObservabilitySqliteClient } from '../specialist/observability-sqlite.js';
import { parseTimelineEvent, type TimelineEvent } from '../specialist/timeline-events.js';
import { resolveNodeRefWithClient, resolveSingleActiveNodeRef, tryResolveNodeRefWithClient } from '../specialist/node-resolve.js';
import { formatTokenUsageSummary } from './format-helpers.js';

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const red = (s: string) => `\x1b[31m${s}\x1b[0m`;

interface StartupSnapshot {
  job_id?: string;
  specialist_name?: string;
  bead_id?: string;
  reused_from_job_id?: string;
  worktree_owner_job_id?: string;
  chain_id?: string;
  chain_root_job_id?: string;
  chain_root_bead_id?: string;
  worktree_path?: string;
  branch?: string;
  variables_keys?: string[];
  reviewed_job_id_present?: boolean;
  reused_worktree_awareness_present?: boolean;
  bead_context_present?: boolean;
  memory_injection?: {
    static_tokens: number;
    memory_tokens: number;
    gitnexus_tokens: number;
    total_tokens: number;
  };
  mandatory_rules_injection?: {
    sets_loaded: string[];
    rules_count: number;
    inline_rules_count: number;
    globals_disabled: boolean;
    token_estimate: number;
  };
  skills?: {
    count: number;
    activated: string[];
  };
}

interface ResultArgs {
  jobId?: string;
  nodeId?: string;
  memberKey?: string;
  positionalColonRef?: string;
  native?: boolean;
  wait: boolean;
  json: boolean;
  timeout?: number; // seconds; undefined = no timeout
}

// Identity grammar for `sp result <ref>` (XTRM-93 N2A, corrected by the
// N2A namespace fix):
// - legacy job id: no colon (e.g. 6-hex, uuid) -> jobId preserved.
// - positional colon ref (`<node-ref>:<member>`, split on the first colon) ->
//   positionalColonRef retains the raw value while nodeId/memberKey carry the
//   split pair. Identity is NEVER decided by syntax alone: run() attempts the
//   historical node/member resolution first and only falls through to native
//   when that pair demonstrably does not exist.
// - native activation: `act:<core>` where <core> is non-empty with no colon.
// - native attempt: `att:<core>:<n>` where <core> is non-empty with no colon
//   and <n> is digits, later mapped to `act:<core>` for storage lookup.
// - native shape validation lives in run(), not parseArgs: a positional ref
//   starting with `act:`/`att:` that is malformed as native but resolves as a
//   legacy pair keeps the legacy result; only a malformed native-looking ref
//   with no legacy match emits the native grammar error.
// Correction to the N2A claim: reserving every syntactically valid `act:`/`att:`
// ref as native BEFORE consulting the node resolver did NOT preserve every
// legacy ref. Before N2A, the text before the first colon was always a node ref
// resolved by PREFIX (listNodeRunsByRef matches id LIKE '<ref>%' OR node_name
// LIKE '<ref>%'), so `act:<member>` and `att:<member>` were valid legacy shapes
// whenever `act`/`att` uniquely prefixed a live node id or name (e.g. a node
// named `action-plan`). The reservation silently removed that namespace.
// Rationale: native ids deliberately contain colons (minted in src/activation/native-host.ts as
// `act:${uuid.slice(0,12)}` / `att:${activationId.slice(4)}:1`, retries only bump `:n` via
// nextAttemptId in src/activation/registry.ts); the measured store happened to hold
// no colliding node at the time, which made the defect latent rather than absent.
// Attempt existence (not just shape) is verified at lookup time in run():
// `att:<core>:<n>` resolves only if a forensic row for activation `act:<core>`
// carries exactly that attempt_id. The forensic attempt_id set is authoritative:
// every minted attempt emits forensic rows (single-attempt and retried
// activations alike show the full 1..N set), while
// specialist_jobs.attempt_no/attempt_id is only the latest pointer (a retried
// row shows attempt_no=2/attempt_id=:2 while :1 lives on in forensic alone).
// On any disagreement the forensic set wins: exact attempt_id equality, never
// a numeric 1..attempt_no range. Unverifiable attempts fail closed with an
// explicit error naming the attempt -- never another attempt's result.
// Strictness (accepted, documented): refs match byte-exact -- no trimming, no
// length cap. Shell argv carries no meaningful surrounding whitespace, and
// every whitespace variant fails closed today (a trailing space stays in the
// jobId and misses lookup; a leading space falls through to the legacy node
// split and misses node lookup), so trimming would only churn legacy failure
// modes beyond this fix's mandate. Cores are not length-capped so future id
// formats are not rejected here.
// Explicit flags: a positional colon ref combined with --node/--member keeps
// the legacy positional-wins rule (the colon branch only runs when neither
// flag was given, and jobId wins downstream) -- unchanged. `--native` forces
// the native interpretation of a positional colon ref and skips the legacy
// attempt (see run()); without it, legacy wins on collision by design.
export function isNativeActivationId(ref: string): boolean {
  return /^act:[^:]+$/.test(ref);
}

export function isNativeAttemptId(ref: string): boolean {
  return /^att:[^:]+:\d+$/.test(ref);
}

function isNativePrefixRef(ref: string): boolean {
  return ref.startsWith('act:') || ref.startsWith('att:');
}

export function resolveNativeAttemptToActivationId(attemptId: string): string {
  // Precondition: isNativeAttemptId(attemptId); the run() guard guarantees it.
  // Fail closed rather than synthesize a malformed activation id from bad input.
  if (!isNativeAttemptId(attemptId)) {
    throw new Error(`Invalid attempt id '${attemptId}': expected 'att:<id>:<n>'`);
  }
  const coreWithSuffix = attemptId.slice('att:'.length);
  const separatorIndex = coreWithSuffix.lastIndexOf(':');
  return `act:${coreWithSuffix.slice(0, separatorIndex)}`;
}

export function parseArgs(argv: string[]): ResultArgs {
  let jobId: string | undefined;
  let nodeId: string | undefined;
  let memberKey: string | undefined;
  let positionalColonRef: string | undefined;
  let native = false;
  let wait = false;
  let json = false;
  let timeout: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--wait') { wait = true; continue; }
    if (token === '--json') { json = true; continue; }
    if (token === '--native') { native = true; continue; }
    if (token === '--node' && argv[i + 1]) { nodeId = argv[++i]; continue; }
    if ((token === '--member' || token === '--member-key') && argv[i + 1]) { memberKey = argv[++i]; continue; }
    if (token === '--timeout' && argv[i + 1]) {
      const parsed = parseInt(argv[++i], 10);
      if (isNaN(parsed) || parsed <= 0) {
        console.error('Error: --timeout must be a positive integer (seconds)');
        process.exit(1);
      }
      timeout = parsed;
      continue;
    }

    if (!token.startsWith('--') && !jobId) {
      jobId = token;
      continue;
    }
  }

  if (!jobId && !(nodeId && memberKey) && !memberKey) {
    console.error('Usage: specialists|sp result <node-ref>:<member> [--native] [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result <job-id> [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result --node <node-ref> --member <member-key> [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result --member <member-key> [--wait] [--timeout <seconds>] [--json]');
    process.exit(1);
  }

  if (jobId && jobId.includes(':') && !nodeId && !memberKey) {
    // Positional colon ref: retain the raw value for run()-time resolution.
    // Keep the historical first-colon split so nodeId/memberKey are populated
    // (preserving the pre-N2A "node ref cannot be empty" / "member key cannot
    // be empty" errors). Do NOT set jobId and do NOT validate or reject
    // native-looking shapes here -- native shape validation lives in run().
    // The colon branch only runs when neither explicit flag was given, so the
    // positional-wins rule with explicit flags is unchanged.
    const separatorIndex = jobId.indexOf(':');
    positionalColonRef = jobId;
    nodeId = jobId.slice(0, separatorIndex);
    memberKey = jobId.slice(separatorIndex + 1);
    jobId = undefined;
  }

  if (nodeId !== undefined && nodeId.length === 0) {
    console.error('Error: node ref cannot be empty');
    process.exit(1);
  }

  if (memberKey !== undefined && memberKey.length === 0) {
    console.error('Error: member key cannot be empty');
    process.exit(1);
  }

  if (!jobId && !memberKey) {
    console.error('Usage: specialists|sp result <node-ref>:<member> [--native] [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result <job-id> [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result --node <node-ref> --member <member-key> [--wait] [--timeout <seconds>] [--json]\n       specialists|sp result --member <member-key> [--wait] [--timeout <seconds>] [--json]');
    process.exit(1);
  }

  return { jobId, nodeId, memberKey, positionalColonRef, native, wait, json, timeout };
}

export type TryResolveJobIdResult =
  | { kind: 'resolved'; jobId: string }
  | { kind: 'node_absent' }
  | { kind: 'member_absent' }
  | { kind: 'member_without_job_id' };

export function tryResolveJobIdFromNodeMember(
  sqliteClient: NonNullable<ReturnType<typeof createObservabilitySqliteClient>>,
  nodeId: string,
  memberKey: string,
): TryResolveJobIdResult {
  // Non-throwing variant of resolveJobIdFromNodeMember: operational DB
  // failures thrown by readNodeRun/readNodeMembers propagate to the caller
  // and must never be flattened into an absent outcome.
  const nodeRun = sqliteClient.readNodeRun(nodeId);
  if (!nodeRun) {
    return { kind: 'node_absent' };
  }

  const member = sqliteClient.readNodeMembers(nodeId).find((entry) => entry.member_id === memberKey);
  if (!member) {
    return { kind: 'member_absent' };
  }

  if (!member.job_id) {
    return { kind: 'member_without_job_id' };
  }

  return { kind: 'resolved', jobId: member.job_id };
}

export function resolveJobIdFromNodeMember(
  sqliteClient: NonNullable<ReturnType<typeof createObservabilitySqliteClient>>,
  nodeId: string,
  memberKey: string,
): string {
  const outcome = tryResolveJobIdFromNodeMember(sqliteClient, nodeId, memberKey);
  if (outcome.kind === 'resolved') return outcome.jobId;
  if (outcome.kind === 'node_absent') {
    throw new Error(`Node run not found: ${nodeId}`);
  }
  if (outcome.kind === 'member_absent') {
    throw new Error(`Member '${memberKey}' not found in node '${nodeId}'`);
  }
  throw new Error(`Member '${memberKey}' in node '${nodeId}' has no job id yet`);
}

function findMissingNativeAttemptError(
  sqliteClient: ReturnType<typeof createObservabilitySqliteClient>,
  supervisor: Supervisor,
  activationId: string,
  requestedAttemptId: string,
): string | null {
  // Returns an explicit refusal naming the attempt when it must not resolve,
  // or null when the attempt is verified (or the activation itself is
  // missing, which stays on the existing "No job found" path so a bad core
  // keeps its established message).
  const activationStatus = supervisor.readStatus(activationId);
  if (!activationStatus) return null;
  if (!sqliteClient) {
    return `Cannot verify attempt '${requestedAttemptId}' for activation '${activationId}': observability database is unavailable. Run: specialists db setup`;
  }
  let attemptIds: string[];
  try {
    // Exact durable attempt history, ordered by first forensic seq. Unlike the
    // former 10_000-row event scan this is not coupled to event volume.
    attemptIds = sqliteClient.listForensicAttemptIds(activationId);
  } catch {
    return `Cannot verify attempt '${requestedAttemptId}' for activation '${activationId}': forensic read failed.`;
  }
  if (!attemptIds.includes(requestedAttemptId)) {
    return `No such attempt '${requestedAttemptId}' for activation '${activationId}'.`;
  }
  return null;
}

function readTimelineEventsForResult(
  sqliteClient: NonNullable<ReturnType<typeof createObservabilitySqliteClient>> | null,
  jobsDir: string,
  jobId: string,
): TimelineEvent[] {
  if (sqliteClient) {
    try {
      return sqliteClient.readEvents(jobId);
    } catch {
      // fallback to file
    }
  }

  const eventsPath = join(jobsDir, jobId, 'events.jsonl');
  if (!existsSync(eventsPath)) return [];
  return readFileSync(eventsPath, 'utf-8')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseTimelineEvent(line))
    .filter((event): event is TimelineEvent => event !== null);
}

function deriveStartupSnapshot(
  status: NonNullable<ReturnType<Supervisor['readStatus']>>,
  events: TimelineEvent[],
): StartupSnapshot | null {
  const runStartEvent = events.find((event) => event.type === 'run_start');
  const startupFromEvent = runStartEvent?.type === 'run_start' ? (runStartEvent.startup_snapshot ?? null) : null;
  const memoryMeta = events.find((event) => event.type === 'meta' && !!event.memory_injection);
  const memoryInjection = memoryMeta?.type === 'meta' ? memoryMeta.memory_injection : undefined;

  const merged: StartupSnapshot = {
    ...(startupFromEvent ?? {}),
    ...(status.startup_context ?? {}),
    ...(memoryInjection ? { memory_injection: memoryInjection } : {}),
  };

  if (!merged.job_id) merged.job_id = status.id;
  if (!merged.specialist_name) merged.specialist_name = status.specialist;
  if (!merged.bead_id && status.bead_id) merged.bead_id = status.bead_id;
  if (!merged.reused_from_job_id && status.reused_from_job_id) merged.reused_from_job_id = status.reused_from_job_id;
  if (!merged.worktree_owner_job_id && status.worktree_owner_job_id) merged.worktree_owner_job_id = status.worktree_owner_job_id;
  if (!merged.chain_id && status.chain_id) merged.chain_id = status.chain_id;
  if (!merged.chain_root_job_id && status.chain_root_job_id) merged.chain_root_job_id = status.chain_root_job_id;
  if (!merged.chain_root_bead_id && status.chain_root_bead_id) merged.chain_root_bead_id = status.chain_root_bead_id;
  if (!merged.worktree_path && status.worktree_path) merged.worktree_path = status.worktree_path;
  if (!merged.branch && status.branch) merged.branch = status.branch;

  return Object.keys(merged).length > 0 ? merged : null;
}

function deriveApiError(events: TimelineEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type === 'error') return event.error_message;
    if (event.type === 'run_complete' && event.error) return event.error;
    if (event.type === 'control_signal' && event.error_message) return event.error_message;
  }
  return null;
}

function deriveTerminalReason(events: TimelineEvent[]): string | null {
  for (const event of [...events].reverse()) {
    if (event.type === 'run_complete') {
      return event.error ?? event.exit_reason ?? event.status;
    }
    if (event.type === 'control_signal') {
      return event.error_message ?? event.reason ?? event.action;
    }
    if (event.type === 'status_change') {
      return `status ${event.previous_status ?? '?'} -> ${event.status}`;
    }
  }
  return null;
}

function logHint(jobId: string): string {
  return ` Inspect with: specialists log ${jobId} --limit 200`;
}

function formatPayloadPreamble(payloadJson: string | null | undefined): string | null {
  if (!payloadJson) return null;

  try {
    const payload = JSON.parse(payloadJson) as {
      totals?: { bytes?: number; tokens?: number };
      components?: Array<{ name?: string; tokens?: number }>;
    };
    const bytes = payload.totals?.bytes;
    const tokens = payload.totals?.tokens;
    if (!Number.isFinite(bytes) || !Number.isFinite(tokens)) return null;

    const topComponents = (payload.components ?? [])
      .filter((component) => Number.isFinite(component.tokens) && (component.tokens ?? 0) > 0)
      .sort((a, b) => (b.tokens ?? 0) - (a.tokens ?? 0))
      .slice(0, 3)
      .map((component) => `${component.name ?? 'unknown'} (${((component.tokens ?? 0) / 1000).toFixed(1)}kt)`);

    return [
      `\n--- payload: ${((bytes ?? 0) / 1024).toFixed(1)} kB · ~${((tokens ?? 0) / 1000).toFixed(1)}k tokens (${payload.components?.length ?? 0} components) ---`,
      ...(topComponents.length > 0 ? [`top-3: ${topComponents.join(' · ')}`] : []),
    ].join('\n') + '\n';
  } catch {
    return null;
  }
}

function formatStartupSnapshot(snapshot: StartupSnapshot | null): string | null {
  if (!snapshot) return null;
  const lines: string[] = ['\n--- startup context ---'];
  const push = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    lines.push(`${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`);
  };

  push('job_id', snapshot.job_id);
  push('specialist_name', snapshot.specialist_name);
  push('bead_id', snapshot.bead_id);
  push('reused_from_job_id', snapshot.reused_from_job_id);
  push('worktree_owner_job_id', snapshot.worktree_owner_job_id);
  push('chain_id', snapshot.chain_id);
  push('chain_root_job_id', snapshot.chain_root_job_id);
  push('chain_root_bead_id', snapshot.chain_root_bead_id);
  push('worktree_path', snapshot.worktree_path);
  push('branch', snapshot.branch);
  push('variables_keys', snapshot.variables_keys);
  push('reviewed_job_id_present', snapshot.reviewed_job_id_present);
  push('reused_worktree_awareness_present', snapshot.reused_worktree_awareness_present);
  push('bead_context_present', snapshot.bead_context_present);

  if (snapshot.memory_injection) {
    push('memory.static_tokens', snapshot.memory_injection.static_tokens);
    push('memory.memory_tokens', snapshot.memory_injection.memory_tokens);
    push('memory.gitnexus_tokens', snapshot.memory_injection.gitnexus_tokens);
    push('memory.total_tokens', snapshot.memory_injection.total_tokens);
  }

  if (snapshot.skills) {
    push('skills.count', snapshot.skills.count);
    push('skills.activated', snapshot.skills.activated);
  }

  lines.push('---');
  return `${lines.join('\n')}\n`;
}

export async function run(): Promise<void> {
  const args = parseArgs(process.argv.slice(3));

  const emitJson = (
    status: ReturnType<Supervisor['readStatus']>,
    output: string | null,
    error: string | null,
    startupContext: StartupSnapshot | null = null,
  ): void => {
    console.log(JSON.stringify({
      job: status ? {
        id: status.id,
        specialist: status.specialist,
        status: status.status,
        model: status.model ?? null,
        backend: status.backend ?? null,
        bead_id: status.bead_id ?? null,
        metrics: status.metrics ?? null,
        startup_context: startupContext,
        error: status.error ?? null,
      } : null,
      output,
      startup_context: startupContext,
      error,
    }, null, 2));
  };

  const jobsDir = join(process.cwd(), '.specialists', 'jobs');
  const supervisor = new Supervisor({ runner: null as any, runOptions: null as any, jobsDir });
  const sqliteClient = createObservabilitySqliteClient();

  const emitHumanResult = (
    output: string,
    status: NonNullable<ReturnType<Supervisor['readStatus']>>,
    startupContext: StartupSnapshot | null,
    trailingFooter?: string,
  ): void => {
    const startupBlock = formatStartupSnapshot(startupContext);
    const payloadBlock = formatPayloadPreamble(status.startup_payload_json);
    process.stdout.write(`${startupBlock ?? ''}${payloadBlock ?? ''}${output}`);

    const tokenSummaryParts = formatTokenUsageSummary(status.metrics?.token_usage);
    if (tokenSummaryParts.length === 0) {
      if (trailingFooter) process.stderr.write(dim(trailingFooter));
      return;
    }

    const footerParts: string[] = [];
    if (tokenSummaryParts.length > 0) footerParts.push(tokenSummaryParts.join(' · '));

    process.stderr.write(dim(`\n--- metrics: ${footerParts.join(' · ')} ---\n`));
    if (trailingFooter) process.stderr.write(dim(trailingFooter));
  };

  try {
    // COLLISION POLICY (compatibility-preserving, deterministic): when BOTH a
    // legacy node/member pair AND a native identity exist for the same
    // positional string, the LEGACY node/member interpretation wins by default,
    // because that is what existed before N2A. Native access in that collision
    // is available only via the explicit `--native` flag. Identity is never
    // decided by syntax alone.
    // Resolution order for a positional colon ref (positionalColonRef set):
    // (a) explicit `--native` -> native path directly, no legacy attempt;
    // (b) otherwise attempt the legacy pair (first-colon split) through the
    //     real node/member resolver: `resolved` uses that jobId, `ambiguous`
    //     surfaces the existing ambiguity error, a thrown operational failure
    //     surfaces as-is and is never reinterpreted as native;
    // (c) on legacy `node_absent` / `member_absent` / `member_without_job_id`:
    //     valid native `act:`/`att:` identity -> native path; malformed
    //     native-looking ref -> native grammar error; otherwise re-raise the
    //     matching existing legacy error.
    let requestedAttemptId: string | undefined;
    const resolveNativePositional = (raw: string): string => {
      if (isNativeActivationId(raw)) return raw;
      if (isNativeAttemptId(raw)) {
        requestedAttemptId = raw;
        // Native attempts share their activation's storage row (`att:<core>:<n>` -> `act:<core>`).
        return resolveNativeAttemptToActivationId(raw);
      }
      if (raw.startsWith('act:')) {
        throw new Error(`invalid activation id '${raw}': expected 'act:<id>'`);
      }
      throw new Error(`invalid attempt id '${raw}': expected 'att:<id>:<n>'`);
    };
    const jobId = ((): string => {
      if (args.positionalColonRef) {
        const raw = args.positionalColonRef;
        const nodeRef = args.nodeId as string;
        const legacyMemberKey = args.memberKey as string;
        if (args.native) {
          // (a) explicit disambiguator: native path directly.
          return resolveNativePositional(raw);
        }
        // (b) legacy pair first through the real resolver. Operational DB
        // failures throw out of the try-variants and are never reinterpreted.
        if (!sqliteClient) {
          throw new Error('Observability SQLite DB is unavailable. Run: specialists db setup');
        }
        const nodeOutcome = tryResolveNodeRefWithClient(nodeRef, sqliteClient);
        if (nodeOutcome.kind === 'ambiguous') {
          // Surface the existing ambiguity error with its exact message.
          return resolveNodeRefWithClient(nodeRef, sqliteClient);
        }
        if (nodeOutcome.kind === 'resolved') {
          const resolvedId = nodeOutcome.id;
          const memberOutcome = tryResolveJobIdFromNodeMember(sqliteClient, resolvedId, legacyMemberKey);
          if (memberOutcome.kind === 'resolved') return memberOutcome.jobId;
          // (c) legacy member miss: native fallback or legacy re-raise.
          if (isNativeActivationId(raw) || isNativeAttemptId(raw)) {
            return resolveNativePositional(raw);
          }
          if (isNativePrefixRef(raw)) {
            return resolveNativePositional(raw);
          }
          if (memberOutcome.kind === 'member_absent') {
            throw new Error(`Member '${legacyMemberKey}' not found in node '${resolvedId}'`);
          }
          if (memberOutcome.kind === 'member_without_job_id') {
            throw new Error(`Member '${legacyMemberKey}' in node '${resolvedId}' has no job id yet`);
          }
          throw new Error(`Node run not found: ${resolvedId}`);
        }
        // (c) legacy node miss: native fallback or legacy re-raise.
        if (isNativeActivationId(raw) || isNativeAttemptId(raw)) {
          return resolveNativePositional(raw);
        }
        if (isNativePrefixRef(raw)) {
          return resolveNativePositional(raw);
        }
        throw new Error(`No node matching ref: ${nodeRef}`);
      }
      // Non-positional path (legacy job id or explicit --node/--member).
      // The exact native attempt the operator asked for, if any. jobId below is
      // the activation id (storage belongs to the activation); this keeps the
      // attempt string for existence validation and error messages.
      if (args.jobId && isNativeAttemptId(args.jobId)) {
        requestedAttemptId = args.jobId;
        return resolveNativeAttemptToActivationId(args.jobId);
      }
      if (args.jobId) {
        return args.jobId;
      }
      if (!sqliteClient || !args.memberKey) {
        throw new Error('Observability SQLite DB is unavailable. Run: specialists db setup');
      }

      const resolvedNodeId = args.nodeId
        ? resolveNodeRefWithClient(args.nodeId, sqliteClient)
        : resolveSingleActiveNodeRef(sqliteClient);

      return resolveJobIdFromNodeMember(sqliteClient, resolvedNodeId, args.memberKey);
    })();

    if (requestedAttemptId) {
      const attemptError = findMissingNativeAttemptError(sqliteClient, supervisor, jobId, requestedAttemptId);
      if (attemptError) {
        if (args.json) {
          emitJson(null, null, attemptError);
        } else {
          console.error(attemptError);
        }
        process.exit(1);
      }
    }

    const resultPath = join(jobsDir, jobId, 'result.txt');

    const readResultOutput = (): string | null => {
      try {
        const sqliteResult = sqliteClient?.readResult(jobId) ?? null;
        if (sqliteResult) return sqliteResult;
      } catch (error) {
        console.warn(`SQLite result read failed for job ${jobId}; falling back to result.txt`, error);
      }

      if (existsSync(resultPath)) {
        return readFileSync(resultPath, 'utf-8');
      }

      // Defensive fallback: if no result row has been persisted (e.g. older
      // job that completed before upsertResult on initial-turn-to-waiting was
      // wired, or a stopped job whose output only landed in the run_complete
      // event payload), surface the latest run_complete output so operators
      // can still inspect the last turn.
      try {
        const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
        for (let i = events.length - 1; i >= 0; i -= 1) {
          const event = events[i];
          if (event.type === 'run_complete' && typeof event.output === 'string' && event.output.length > 0) {
            return event.output;
          }
        }
      } catch {
        // ignore — fallback is best-effort
      }

      return null;
    };

  if (args.wait) {
    const startMs = Date.now();

    while (true) {
      const status = supervisor.readStatus(jobId);

      if (!status) {
        if (args.json) {
          emitJson(null, null, `No job found: ${jobId}`);
        } else {
          console.error(`No job found: ${jobId}`);
        }
        process.exit(1);
      }

      if (status.status === 'done') {
        const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
        const startupContext = deriveStartupSnapshot(status, events);
        const apiError = status.error ?? deriveApiError(events);
        const output = readResultOutput();
        if (!output) {
          const message = apiError
            ? `Job ${jobId} failed: ${apiError}.${logHint(jobId)}`
            : `Result not found for job ${jobId}.${logHint(jobId)}`;
          if (args.json) {
            emitJson(status, null, message, startupContext);
          } else {
            process.stderr.write(`${red(message)}\n`);
          }
          process.exit(1);
        }

        const enrichedStatus = apiError && !status.error ? { ...status, error: apiError } : status;

        if (args.json) {
          emitJson(enrichedStatus, output, null, startupContext);
        } else {
          emitHumanResult(output, enrichedStatus, startupContext);
        }
        return;
      }

      if (status.status === 'error') {
        const startupContext = deriveStartupSnapshot(status, readTimelineEventsForResult(sqliteClient, jobsDir, jobId));
        const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
        const reason = status.error ?? deriveApiError(events) ?? deriveTerminalReason(events) ?? 'unknown error';
        const message = `Job ${jobId} failed: ${reason}.${logHint(jobId)}`;
        if (args.json) {
          emitJson(status, null, message, startupContext);
        } else {
          process.stderr.write(`${red(`Job ${jobId} failed:`)} ${reason}\n${dim(logHint(jobId).trim())}\n`);
        }
        process.exit(1);
      }

      if (status.status === 'cancelled') {
        const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
        const startupContext = deriveStartupSnapshot(status, events);
        const reason = status.error ?? deriveTerminalReason(events) ?? 'cancelled';
        const message = `Job ${jobId} cancelled: ${reason}.${logHint(jobId)}`;
        if (args.json) {
          emitJson(status, null, message, startupContext);
        } else {
          process.stderr.write(`${red(`Job ${jobId} cancelled:`)} ${reason}\n${dim(logHint(jobId).trim())}\n`);
        }
        process.exit(1);
      }

      // Check timeout before sleeping
      if (args.timeout !== undefined) {
        const elapsedSecs = (Date.now() - startMs) / 1000;
        if (elapsedSecs >= args.timeout) {
          const timeoutMessage = `Timeout: job ${jobId} did not complete within ${args.timeout}s`;
          if (args.json) {
            const startupContext = deriveStartupSnapshot(status, readTimelineEventsForResult(sqliteClient, jobsDir, jobId));
            emitJson(status, null, timeoutMessage, startupContext);
          } else {
            process.stderr.write(`${timeoutMessage}\n`);
          }
          process.exit(1);
        }
      }

      // Still starting/running/waiting — poll at 1s intervals
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  // ── Original non-wait behavior ─────────────────────────────────────────────
  const status = supervisor.readStatus(jobId);

  if (!status) {
    if (args.json) {
      emitJson(null, null, `No job found: ${jobId}`);
    } else {
      console.error(`No job found: ${jobId}`);
    }
    process.exit(1);
  }

  if (status.status === 'running' || status.status === 'starting') {
    const startupContext = deriveStartupSnapshot(status, readTimelineEventsForResult(sqliteClient, jobsDir, jobId));
    const output = readResultOutput();
    if (!output) {
      const message = `Job ${jobId} is still ${status.status}. Use 'specialists feed --job ${jobId}' to follow.`;
      if (args.json) {
        emitJson(status, null, message, startupContext);
      } else {
        process.stderr.write(`${dim(message)}\n`);
      }
      process.exit(1);
    }

    if (args.json) {
      emitJson(status, output, null, startupContext);
    } else {
      process.stderr.write(`${dim(`Job ${jobId} is currently ${status.status}. Showing last completed output while it continues.`)}\n`);
      emitHumanResult(output, status, startupContext);
    }
    return;
  }

  if (status.status === 'waiting') {
    const startupContext = deriveStartupSnapshot(status, readTimelineEventsForResult(sqliteClient, jobsDir, jobId));
    const output = readResultOutput();
    if (!output) {
      const message = `Job ${jobId} is waiting for input. Use: specialists resume ${jobId} "..."`;
      if (args.json) {
        emitJson(status, null, message, startupContext);
      } else {
        process.stderr.write(`${dim(message)}\n`);
      }
      process.exit(1);
    }

    const waitingFooter = `\n--- Session is waiting for your input. Use: specialists resume ${jobId} "..." ---\n`;

    if (args.json) {
      emitJson(status, `${output}${waitingFooter}`, null, startupContext);
    } else {
      emitHumanResult(output, status, startupContext, waitingFooter);
    }
    return;
  }

  if (status.status === 'cancelled') {
    const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
    const startupContext = deriveStartupSnapshot(status, events);
    const reason = status.error ?? deriveTerminalReason(events) ?? 'cancelled';
    const message = `Job ${jobId} cancelled: ${reason}.${logHint(jobId)}`;
    if (args.json) {
      emitJson(status, null, message, startupContext);
    } else {
      process.stderr.write(`${red(`Job ${jobId} cancelled:`)} ${reason}
${dim(logHint(jobId).trim())}
`);
    }
    process.exit(1);
  }

  if (status.status === 'error') {
    const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
    const startupContext = deriveStartupSnapshot(status, events);
    const reason = status.error ?? deriveApiError(events) ?? deriveTerminalReason(events) ?? 'unknown error';
    const message = `Job ${jobId} failed: ${reason}.${logHint(jobId)}`;
    if (args.json) {
      emitJson(status, null, message, startupContext);
    } else {
      process.stderr.write(`${red(`Job ${jobId} failed:`)} ${reason}\n${dim(logHint(jobId).trim())}\n`);
    }
    process.exit(1);
  }
  const events = readTimelineEventsForResult(sqliteClient, jobsDir, jobId);
  const apiError = status.error ?? deriveApiError(events);
  const output = readResultOutput();
  if (!output) {
    const message = apiError ? `Job ${jobId} failed: ${apiError}.${logHint(jobId)}` : `Result not found for job ${jobId}.${logHint(jobId)}`;
    if (args.json) {
      emitJson(status, null, message);
    } else {
      process.stderr.write(`${red(message)}\n`);
    }
    process.exit(1);
  }

  const startupContext = deriveStartupSnapshot(status, events);
  const enrichedStatus = apiError && !status.error ? { ...status, error: apiError } : status;
  if (args.json) {
    emitJson(enrichedStatus, output, null, startupContext);
    return;
  }

  emitHumanResult(output, enrichedStatus, startupContext);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (args.json) {
      emitJson(null, null, message);
    } else {
      console.error(message);
    }
    process.exit(1);
  } finally {
    sqliteClient?.close();
    await supervisor.dispose();
  }
}
