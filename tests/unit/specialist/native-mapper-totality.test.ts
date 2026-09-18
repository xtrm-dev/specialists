import { Database } from 'bun:sqlite';
import { mkdirSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSourceFile, flattenDiagnosticMessageText, getLeadingCommentRanges, getTrailingCommentRanges, ScriptTarget, SyntaxKind, type DiagnosticWithLocation, type Node } from 'typescript';
import { createActivationForensicSink } from '../../../src/activation/forensic-sink.js';
import {
  mapNativeLifecycleEvent,
  NATIVE_LIFECYCLE_OBSERVABILITY_GAPS,
  NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED,
  NATIVE_SESSION_OBSERVABILITY_GAPS,
} from '../../../src/specialist/native-activation-observability.js';
import { createObservabilitySqliteClientAtPath } from '../../../src/specialist/observability-sqlite.js';

/**
 * SPECIALISTS-101 totality guard, comment-stripping and glob repair (SPECIALISTS-111).
 *
 * Every event name the native host can emit IN ONE OF THE RECOGNISED LITERAL FORMS
 * must have an EXPLICIT disposition: either (a) handled by an explicit mapper arm
 * (mapNativeLifecycleEvent returns non-null), or (b) listed in an explicit registry
 * of deliberately-unpersisted names with a non-empty written reason. A name in
 * neither FAILS the test.
 *
 * How the inventory is pinned to the sources: the `inventory matches emit sites`
 * test scans every `*.ts` file under `src/activation/` (derived by directory walk,
 * NOT a hard-coded file list) AFTER removing parser-derived line/block comment
 * ranges using the installed TypeScript parser (no new dependency), and
 * recognises two literal shapes plus an explicit dynamic list:
 *   - call form: `emit('name', ...)` (any receiver, either quote style);
 *   - object form: `forensics.emit({ ..., name: 'name', ... })` — EVERY literal
 *     counts, including names never seen before;
 *   - dynamic form: ternary/computed emits (e.g. `emit(kind ? 'a' : 'b')`), each
 *     name enumerated explicitly in the test and probed over the stripped corpus
 *     as an exact quoted token, NOT verified as an emit argument.
 * A newly emitted literal name with no inventory entry fails the `missing`
 * assertion; a literal inventory entry with no remaining recognised source match
 * fails the `stale` assertion. Comments are removed; parse errors fail closed with
 * the file named. A comment alone cannot supply an emit match.
 *
 * WHAT THIS GUARD STILL CANNOT PROVE (read before citing it):
 *   - It cannot prove the producer RUNS. It enumerates source text, never executes
 *     a producer; a name with an emit site and a mapper arm may still never fire
 *     at runtime. The enforcing execution-backed canonical oracle
 *     (tests/unit/specialist/supervisor-canonical-oracle.test.ts, using
 *     supervisor-canonical-proof.ts) checks the manifest's obligations, including
 *     mapper/writer persistence; it is manifest-driven
 *     (SUPERVISOR_CANONICAL_INVENTORY), not producer-enumerating, and a synthetic
 *     sink emit there does not establish that a production producer runs.
 *   - It cannot see a name that appears ONLY inside a computed expression outside
 *     the enumerated dynamic list (e.g. a new ternary pair). New emits must use a
 *     literal call-form or object-form name to be enumerated.
 *   - Dynamic exact-token probes can be satisfied by an unrelated string after
 *     the actual dynamic emit disappears. They do not establish an emit site.
 *   - This is bounded text matching, not an AST walk: unrelated `name: 'literal'`
 *     properties or emit-shaped strings/templates can cause false matches (new
 *     names fail `missing`; inventoried names can mask deletion). String, regex
 *     and template literal contents remain text, not semantically resolved code.
 *   - Parser traversal is ONLY for comment trivia, not emit detection, scope or
 *     reachability. It rejects invalid TS instead of guessing regex vs division.
 *
 * Runtime safety is unchanged: the mapper's `default: return null` still drops unknown
 * names without crashing the writer. This guard is a TEST-time obligation, not a runtime throw.
 */

// Independent enumeration of every name that can reach ActivationForensicSink.emit.
// Sources: native-host.ts emit('...') (30) + direct forensics.emit names (3 new:
// activation_disposed, lease_uncertain, tool_blocked) + workspace-reconcile
// lease_reconciled/lease_uncertain + settlement-publication.ts (10) + the dynamic
// ternary pair (escalation_raised/clarification_requested + resolved pair).
// Hooks emits (pre_render/post_render/pre_execute/post_execute) are a different vocabulary
// (src/specialist/hooks.ts) and never reach the forensic sink — excluded by design.
export const NATIVE_EMIT_INVENTORY = Object.freeze([
  'activation_admitted',
  'activation_completed',
  'activation_disposed',
  'activation_failed',
  'activation_rejected',
  'activation_requested',
  'activation_resumed',
  'activation_retried',
  'activation_steered',
  'activation_settled',
  'activation_started',
  'activation_starting',
  'clarification_answered',
  'clarification_requested',
  'compaction_completed',
  'compaction_started',
  'escalation_raised',
  'escalation_resolved',
  'extension_discovery_sessions',
  'extension_tools_discovered',
  'extension_tools_refused',
  'lease_acquired',
  'lease_denied',
  'lease_reconciled',
  'lease_release_failed',
  'lease_released',
  'lease_uncertain',
  'mandatory_rules_injection',
  'model_fallback',
  'output_validation_failed',
  'output_validation_passed',
  'output_validation_started',
  'retry_completed',
  'retry_started',
  // SPECIALISTS-120 settlement capture: the snapshot and its failure each get their own name,
  // so a missing snapshot is a durable finding rather than a silently absent row.
  'session_stats_captured',
  'session_stats_failed',
  'settlement_artifact_attached',
  'settlement_degraded',
  'settlement_receipt_allocated',
  'settlement_republish_deferred',
  'settlement_republish_error',
  'settlement_republish_reconciled',
  'settlement_republish_refused',
  'settlement_result_published',
  'settlement_store_failed',
  'settlement_stored',
  'stale_warning',
  'step_contract_compiled',
  'tool_blocked',
  'tool_contract_unsatisfied_on_fallback',
  'turn_completed',
  'turn_started',
] as const);

export const SETTLEMENT_NAMES = Object.freeze([
  'settlement_stored',
  'settlement_receipt_allocated',
  'settlement_artifact_attached',
  'settlement_result_published',
  'settlement_republish_deferred',
  'settlement_republish_error',
  'settlement_republish_reconciled',
  'settlement_republish_refused',
  'settlement_degraded',
  'settlement_store_failed',
] as const);

const CONTEXT = { startedAtMs: Date.now() };
const base = (name: string, payload?: Record<string, unknown>) => ({
  activationId: 'act:totality',
  specialist: 'researcher',
  beadId: 'bd-totality',
  name,
  payload,
});

function isMapped(name: string): boolean {
  return mapNativeLifecycleEvent(base(name), CONTEXT, 1000) !== null;
}

/** Parser-derived trivia only: emit detection below remains bounded text matching. */
function stripTypeScriptComments(text: string, file = '<source>'): string {
  const source = createSourceFile(file, text, ScriptTarget.Latest);
  // TypeScript exposes these at runtime but omits them from the public SourceFile type.
  const { parseDiagnostics } = source as typeof source & { parseDiagnostics: readonly DiagnosticWithLocation[] };
  if (!Array.isArray(parseDiagnostics) || parseDiagnostics.length > 0) {
    throw new Error(`${file}: cannot scan unparsable TypeScript: ${parseDiagnostics?.map(
      (diagnostic) => flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
    ).join('; ') ?? 'parse diagnostics unavailable'}`);
  }
  const ranges = new Map<number, number>();
  const collect = (node: Node): void => {
    if (node.kind <= SyntaxKind.LastToken) {
      // Token boundaries include EOF trivia; never probe within strings or regexes.
      for (const range of [
        ...getLeadingCommentRanges(text, node.pos) ?? [],
        ...getTrailingCommentRanges(text, node.end) ?? [],
      ]) ranges.set(range.pos, range.end);
    } else {
      for (const child of node.getChildren(source)) collect(child);
    }
  };
  collect(source);
  let out = '';
  let end = 0;
  for (const [start, next] of [...ranges].sort(([a], [b]) => a - b)) {
    // Preserve separation and line breaks: comments must not fuse two tokens.
    out += text.slice(end, start) + text.slice(start, next).replace(/[^\r\n]/g, ' ');
    end = next;
  }
  return out + text.slice(end);
}

describe('source comment stripping (SPECIALISTS-111 regression)', () => {
  it.each([
    ['EOF line comment', `emit('real'); // emit('ghost')`],
    ['EOF block comment', `emit('real'); /* emit('ghost') */`],
    ['leading comments', `// emit('ghost')\n/* emit('ghost') */ emit('real');`],
    ['template interpolation comments', "const s = `${/* emit('ghost') */ 1}`; emit('real');"],
  ])('removes %s', (_label, source) => {
    const stripped = stripTypeScriptComments(source);
    expect(stripped).not.toContain('ghost');
    expect(stripped).toContain("emit('real')");
  });

  it('preserves token separation and newlines', () => {
    expect(stripTypeScriptComments('const/* gap */name = 1; /*\n gap\n*/'))
      .toBe('const         name = 1;   \n    \n  ');
  });

  it('fails closed on parse errors with the source file named', () => {
    expect(() => stripTypeScriptComments("const re = /unterminated; emit('ghost');", 'broken.ts'))
      .toThrow(/broken\.ts: cannot scan unparsable TypeScript/);
  });

  it.each([
    ['double quote / line comment', `const re = /a"b/; const s = "resync"; // emit('ghost')\nemit('real');`],
    ['double quote / block comment', `const re = /a"b/; const s = "resync"; /* emit('ghost') */\nemit('real');`],
    ['single quote / line comment', `const re = /a'b/; const s = 'resync'; // emit('ghost')\nemit('real');`],
    ['single quote / block comment', `const re = /a'b/; const s = 'resync'; /* emit('ghost') */\nemit('real');`],
    ['escaped quote', String.raw`const re = /a\"b/; const s = "resync"; /* emit('ghost') */ emit('real');`],
    ['backtick', 'const re = /a`b/; const s = `resync`; /* emit(\'ghost\') */ emit(\'real\');'],
    ['line delimiter in regex class', `const re = /[//]/; emit('real'); // emit('ghost')`],
    ['block delimiter in regex class', `const re = /[/*]/; emit('real'); // emit('ghost')`],
  ])('removes comment ghosts after regex literals: %s', (_label, source) => {
    // Exercise the actual helper used by the corpus scan, not a copied scanner.
    const stripped = stripTypeScriptComments(source);
    expect(stripped).not.toContain('ghost');
    expect(stripped).toContain("emit('real')");
  });

  it.each([
    ['ordinary strings and URL', `const s = 'ordinary'; const url = "https://example.test/a";`],
    ['escaped quotes', String.raw`const s = 'it\'s // text'; const t = "a\"b /* text */";`],
    ['escaped slash regex', String.raw`const re = /a\/b/g;`],
    ['slash in regex class', `const re = /[/]/;`],
    ['division', `const n = total / 2;`],
    ['division then string', `const n = total / 2; const s = "ordinary";`],
    ['chained division', `const n = total / width / height;`],
    ['ordinary template', 'const s = `https://example.test/`;'],
  ])('preserves live emits and removes comment ghosts after %s', (_label, prefix) => {
    const source = `${prefix} /* emit('block_ghost') */ emit('real'); // emit('line_ghost')\n`;
    const stripped = stripTypeScriptComments(source);
    expect(stripped).toContain(prefix);
    expect(stripped).toContain("emit('real')");
    expect(stripped).not.toContain('block_ghost');
    expect(stripped).not.toContain('line_ghost');
  });
});

/** Every TypeScript source under a directory, sorted, so a new file cannot escape the scan. */
function listTypeScriptSources(dir: string): string[] {
  const out: string[] = [];
  const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listTypeScriptSources(full));
    else if (entry.isFile() && entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

function deliberatelyUnpersistedReason(name: string): string | undefined {
  const lifecycle = (NATIVE_LIFECYCLE_OBSERVABILITY_GAPS as unknown as Record<string, string> | undefined)?.[name];
  if (typeof lifecycle === 'string' && lifecycle.trim().length > 0) return lifecycle;
  // Undefined on pre-fix trees (fail-first run): treated as absent, so the totality test
  // names the missing events instead of crashing on the import.
  const deliberate = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined)?.[name];
  if (typeof deliberate === 'string' && deliberate.trim().length > 0) return deliberate;
  const session = (NATIVE_SESSION_OBSERVABILITY_GAPS as unknown as Record<string, string> | undefined)?.[name];
  if (typeof session === 'string' && session.trim().length > 0) return session;
  return undefined;
}

describe('native mapper totality (SPECIALISTS-101)', () => {
  it('inventory matches the emit sites (a new emit without an inventory update fails here)', () => {
    // Derived file set: every TypeScript source under src/activation/, so an emit
    // added in a new activation file is scanned too (the previous hard-coded
    // three-file list let any other file escape entirely).
    const activationDir = fileURLToPath(new URL('../../../src/activation/', import.meta.url));
    const sources = listTypeScriptSources(activationDir);
    // The glob must not silently lose the three files this guard was built on.
    for (const required of ['native-host.ts', 'settlement-publication.ts', 'workspace-reconcile.ts']) {
      expect(
        sources.some((file) => file.endsWith(`/${required}`)),
        `scanned file set lost ${required}`,
      ).toBe(true);
    }
    // Comments are stripped BEFORE scanning: an emit that survives only inside a
    // comment is invisible here, so commenting out a real producer's only site
    // fails `stale` instead of staying green.
    const stripped = sources.map((file) => stripTypeScriptComments(readFileSync(file, 'utf-8'), file));
    const corpus = stripped.join('\n');
    const found = new Set<string>();
    for (const text of stripped) {
      // Call form: emit('name', ...) with any receiver, either quote style.
      for (const match of text.matchAll(/emit\(\s*['"]([^'"]+)['"]/g)) found.add(match[1]!);
      // Object form: forensics.emit({ ..., name: 'name', ... }). EVERY literal
      // counts — filtering to already-inventoried names here is what let a
      // brand-new object-form name slip past unseen (SPECIALISTS-111).
      for (const match of text.matchAll(/name:\s*['"]([^'"]+)['"]/g)) found.add(match[1]!);
    }
    // Dynamic form: ternary/computed emits match neither shape above, so each name
    // is enumerated explicitly and probed over the whole stripped corpus.
    // workspace-reconcile emits via `name: applied ? 'lease_reconciled' : 'lease_uncertain'`.
    for (const dynamic of [
      'escalation_raised',
      'escalation_resolved',
      'clarification_requested',
      'clarification_answered',
      'lease_reconciled',
    ]) {
      if (corpus.includes(`'${dynamic}'`) || corpus.includes(`"${dynamic}"`)) found.add(dynamic);
    }

    const inventory = new Set<string>(NATIVE_EMIT_INVENTORY as readonly string[]);
    const missing = [...found].filter((name) => !inventory.has(name)).sort();
    const stale = [...inventory].filter((name) => !found.has(name)).sort();
    expect(
      missing,
      `emit sites without inventory entry (add each with an explicit disposition): ${missing.join(', ')}`,
    ).toEqual([]);
    expect(
      stale,
      `inventory entries with no emit site (remove or justify): ${stale.join(', ')}`,
    ).toEqual([]);
  });

  it('every emitted name has an explicit disposition: a mapper arm or a reasoned registry entry', () => {
    const failures: string[] = [];
    for (const name of NATIVE_EMIT_INVENTORY) {
      if (isMapped(name)) continue;
      const reason = deliberatelyUnpersistedReason(name);
      if (reason !== undefined) continue;
      failures.push(name);
    }
    expect(
      failures,
      `emitted names with NO disposition (neither a mapper arm nor a deliberately-unpersisted reason): ${failures.join(', ')}. ` +
        `Add a case arm in mapNativeLifecycleEvent or a reasoned entry in NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED.`,
    ).toEqual([]);
  });

  it('every deliberately-unpersisted entry carries a non-empty written reason', () => {
    const registry = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined) ?? {};
    expect(Object.keys(registry).length > 0, 'deliberately-unpersisted registry is missing').toBe(true);
    for (const [name, reason] of Object.entries(registry)) {
      expect(typeof reason === 'string' && reason.trim().length > 0, `${name} has an empty reason`).toBe(true);
    }
  });

  it('no previously-mapped name loses its arm', () => {
    // Arms that existed before SPECIALISTS-101 (lifecycle mapper only).
    for (const name of [
      'activation_started',
      'activation_settled',
      'activation_completed',
      'lease_acquired',
      'lease_denied',
      'lease_uncertain',
      'tool_blocked',
      'activation_failed',
      'activation_rejected',
    ]) {
      expect(isMapped(name), `previously-mapped ${name} lost its arm`).toBe(true);
    }
  });

  it('extension signals stay deliberately unpersisted and acquire no new surface', () => {
    for (const name of [
      'extension_discovery_sessions',
      'extension_tools_discovered',
      'extension_tools_refused',
    ]) {
      expect(isMapped(name), `${name} must NOT acquire a mapper arm`).toBe(false);
      const reason = (NATIVE_LIFECYCLE_DELIBERATELY_UNPERSISTED as unknown as Record<string, string> | undefined)?.[name];
      expect(typeof reason === 'string' && reason.trim().length > 0, `${name} needs a written reason`).toBe(true);
      expect(reason, `${name} reason must state the emit site exists`).toMatch(/emit site/i);
      expect(reason, `${name} reason must state no surface exists`).toMatch(/no .* surface exists/i);
      expect(reason, `${name} reason must state deferral`).toMatch(/defer/i);
    }
  });

  it('model_fallback maps onto the existing shared model_change event (no invented fallback_step)', () => {
    const mapped = mapNativeLifecycleEvent(
      base('model_fallback', { from_model: 'prov/a', to_model: 'prov/b' }),
      CONTEXT,
      1000,
    );
    expect(mapped).not.toBeNull();
    expect(mapped).toMatchObject({ type: 'model_change', action: 'cycle_model', model: 'prov/b', previous_model: 'prov/a' });
  });
});

describe('settlement and fallback durability (SPECIALISTS-101)', () => {
  let tempRoot: string;
  let dbPath: string;
  let client: ReturnType<typeof createObservabilitySqliteClientAtPath> | null;
  let raw: Database | null;
  const scratchRoot = join(import.meta.dirname, '..', '..', '.phase7-test-scratch');

  beforeEach(() => {
    tempRoot = join(scratchRoot, `mapper-totality-${crypto.randomUUID()}`);
    mkdirSync(tempRoot, { recursive: true });
    dbPath = join(tempRoot, 'observability.db');
    client = null;
    raw = null;
  });

  afterEach(() => {
    try { client?.close(); } catch { /* ignore */ }
    try { raw?.close(); } catch { /* ignore */ }
    rmSync(tempRoot, { recursive: true, force: true });
  });

  it.each(SETTLEMENT_NAMES as unknown as string[])(
    'emitting %s produces a durable forensic row whose event_name equals the emitted name',
    (name) => {
      client = createObservabilitySqliteClientAtPath(dbPath);
      const sink = createActivationForensicSink(client!);
      const activationId = `act:settle-${name.replace(/[^a-z]/g, '')}`;
      sink.emit({
        activationId,
        attemptId: 'att:settle:1',
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-settle',
        name,
        payload: { note: 'totality probe', ref: 'ref-1', receipt: 'wr-1', entry: 'jent-1' },
      });
      client!.close();
      client = null;
      raw = new Database(dbPath);
      const rows = raw.query(
        'SELECT event_name FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
      ).all(activationId) as Array<{ event_name: string }>;
      expect(
        rows.map((row) => row.event_name),
        `no durable row for ${name} (mapper returned null or writer dropped it)`,
      ).toContain(name);
    },
  );

  it('model_fallback produces a durable row via the shared model_change carrier', () => {
    client = createObservabilitySqliteClientAtPath(dbPath);
    const sink = createActivationForensicSink(client!);
    const activationId = 'act:fallback-probe';
    sink.emit({
      activationId,
      attemptId: 'att:fallback:1',
      participantId: 'specialist::researcher',
      specialist: 'researcher',
      beadId: 'bd-fallback',
      name: 'model_fallback',
      payload: { from_model: 'prov/a', to_model: 'prov/b', error_class: 'rate_limit', terminal: false },
    });
    client!.close();
    client = null;
    raw = new Database(dbPath);
    const rows = raw.query(
      'SELECT event_name FROM specialist_forensic_events WHERE job_id = ? ORDER BY seq',
    ).all(activationId) as Array<{ event_name: string }>;
    // Carrier decision: the existing shared `model_change` event, whose forensic name is model.changed.
    expect(rows.map((row) => row.event_name)).toContain('model.changed');
  });

  it('extension signals produce no forensic row (deliberately unpersisted, no new surface)', () => {
    client = createObservabilitySqliteClientAtPath(dbPath);
    const sink = createActivationForensicSink(client!);
    const activationId = 'act:extension-probe';
    for (const name of [
      'extension_discovery_sessions',
      'extension_tools_discovered',
      'extension_tools_refused',
    ]) {
      sink.emit({
        activationId,
        attemptId: 'att:ext:1',
        participantId: 'specialist::researcher',
        specialist: 'researcher',
        beadId: 'bd-ext',
        name,
        payload: { pinned: 'tool-a' },
      });
    }
    client!.close();
    client = null;
    raw = new Database(dbPath);
    const rows = raw.query(
      'SELECT event_name FROM specialist_forensic_events WHERE job_id = ?',
    ).all(activationId) as Array<{ event_name: string }>;
    expect(rows, 'extension signals must not create a persistence surface').toEqual([]);
  });
});
