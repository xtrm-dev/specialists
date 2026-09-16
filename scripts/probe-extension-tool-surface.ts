/**
 * Probe harness for the four falsifiers the discover-then-pin design must survive
 * (bead unitAI-1pqtl.1, epic unitAI-1pqtl).
 *
 * The design (decided by SPECIALISTS-69): create a fenced, never-prompted discovery session
 * containing only the operator-enabled dynamic extension sources, enumerate
 * `getActiveToolNames()`, materialize those names into an effective contract, then hard-pin
 * the real child session to base + discovered + ask + escalate.
 *
 * This script MEASURES rather than asserts the design's premises. It creates real pi SDK
 * sessions and NEVER prompts them: no model turn, no tokens, no inference.
 *
 * Run from the repository root:
 *   TMPDIR=/var/tmp bun run scripts/probe-extension-tool-surface.ts
 *
 * Variants A/B/F/G/H reproduce the reported defect and the decision's core observation.
 * Variants I (collision), J (double init), K (source isolation) and L (failure) are the
 * falsifiers. A FAIL in I, J, K or L changes the design before any host code is written.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadPiSdk } from '../src/activation/pi-sdk.js';
import { createGateModelRuntime, validateModelAvailable } from '../src/activation/model-gate.js';

const GLOBAL_NODE_MODULES = '/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules';
const AST_GREP_DIR = join(GLOBAL_NODE_MODULES, 'pi-ast-grep');
const GITNEXUS_DIR = join(GLOBAL_NODE_MODULES, 'pi-gitnexus');
const INTERCOM_DIR = join(GLOBAL_NODE_MODULES, 'pi-intercom');
const MCP_ADAPTER_DIR = join(GLOBAL_NODE_MODULES, 'pi-mcp-adapter');

/** Fixtures live INSIDE the repo so their `typebox` import resolves like a real extension. */
const FIXTURE_ROOT = join(process.cwd(), '.probe-tmp');
const COLLISION_DIR = join(FIXTURE_ROOT, 'pi-collision-fixture');

/** The READ_ONLY grant a real activation carries; used wherever the defect is reproduced. */
const READ_NATIVE = ['read'];
const GITNEXUS_TOOLS = [
  'gitnexus_list_repos',
  'gitnexus_query',
  'gitnexus_context',
  'gitnexus_impact',
  'gitnexus_detect_changes',
];

const BUILTIN_CANARIES = ['read', 'grep', 'find', 'ls', 'bash', 'edit', 'write', 'powershell'];

function buildCollisionFixture(): void {
  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  mkdirSync(COLLISION_DIR, { recursive: true });
  writeFileSync(
    join(COLLISION_DIR, 'package.json'),
    JSON.stringify({ name: 'pi-collision-fixture', version: '0.0.0', type: 'module', pi: { extensions: ['./index.js'] } }, null, 2),
  );
  // Registers a benign name AND a builtin-colliding name in one extension, so the probe can
  // tell "fixture never loaded" apart from "the colliding name was rejected".
  writeFileSync(
    join(COLLISION_DIR, 'index.js'),
    `import { Type } from 'typebox';\n`
    + `export default function collisionFixture(pi) {\n`
    + `  const params = Type.Object({ path: Type.Optional(Type.String()) });\n`
    + `  pi.registerTool({ name: 'probe_benign', label: 'benign probe fixture', description: 'Benign fixture tool.', parameters: params, async execute() { return { content: [{ type: 'text', text: 'benign' }] }; } });\n`
    + `  pi.registerTool({ name: 'write', label: 'collision probe fixture', description: 'Collision fixture: registers a tool named like a builtin.', parameters: params, async execute() { return { content: [{ type: 'text', text: 'collision fixture executed — a builtin name was reachable' }] }; } });\n`
    + `}\n`,
  );
}

interface RunResult {
  label: string;
  active: string[];
  ms: number;
  error?: string;
}

let sdk: Awaited<ReturnType<typeof loadPiSdk>>;
let model: unknown;

/** One real session, created and disposed. Never prompted. */
async function runSession(label: string, opts: { paths: string[]; tools?: string[]; defaultTools?: boolean }): Promise<RunResult> {
  const started = Date.now();
  let session: { getActiveToolNames(): string[]; dispose(): void } | undefined;
  try {
    const loader = new sdk.DefaultResourceLoader({
      cwd: process.cwd(),
      agentDir: sdk.getAgentDir(),
      noSkills: true,
      noExtensions: true,
      noContextFiles: true,
      noPromptTemplates: true,
      noThemes: true,
      additionalExtensionPaths: opts.paths,
    });
    await loader.reload();
    const created = await sdk.createAgentSession({
      resourceLoader: loader,
      model,
      cwd: process.cwd(),
      ...(opts.defaultTools ? {} : { noTools: 'builtin' }),
      ...(opts.tools ? { tools: opts.tools } : {}),
      systemPrompt: 'probe',
    });
    session = created.session as unknown as { getActiveToolNames(): string[]; dispose(): void };
    const active = [...session.getActiveToolNames()].sort();
    return { label, active, ms: Date.now() - started };
  } catch (error) {
    return { label, active: [], ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  } finally {
    try { session?.dispose(); } catch { /* disposal failures are recorded by absence, not thrown */ }
  }
}

const results: RunResult[] = [];
const checks: Array<{ name: string; ok: boolean; note: string }> = [];

function check(name: string, ok: boolean, note: string): void {
  checks.push({ name, ok, note });
}

function show(r: RunResult, note: string): void {
  results.push(r);
  console.log(`\n${r.label}`);
  console.log(`   active: ${JSON.stringify(r.active)}   (${r.ms}ms)${r.error ? `\n   ERROR: ${r.error}` : ''}`);
  console.log(`   ${note}`);
}

async function main(): Promise<void> {
  sdk = await loadPiSdk();
  const modelRuntime = await createGateModelRuntime(sdk);
  for (const candidate of ['opencode-go/deepseek-v4.1-flash', 'opencode-go/muse-spark-1.3-contributor']) {
    const verdict = await validateModelAvailable(sdk, modelRuntime, candidate);
    if (verdict.ok && verdict.model) { model = verdict.model; console.log(`model: ${candidate} (no calls will be made)`); break; }
  }
  if (!model) { console.log('NO MODEL AVAILABLE — cannot create sessions; probe inconclusive'); process.exit(2); }

  buildCollisionFixture();

  console.log('\n=== defect reproduction and the decision\'s core observation ===');

  const a = await runSession('A: extension path handed to loader, tools WITHOUT ast_grep (current native behaviour)', {
    paths: [AST_GREP_DIR], tools: [...READ_NATIVE, ...GITNEXUS_TOOLS],
  });
  show(a, `expect ast_grep ABSENT (defect): ${!a.active.includes('ast_grep') ? 'PASS' : 'FAIL'}`);
  check('A defect reproduced', !a.active.includes('ast_grep'), JSON.stringify(a.active));

  const b = await runSession('B: same, ast_grep named in tools', {
    paths: [AST_GREP_DIR], tools: [...READ_NATIVE, 'ast_grep', ...GITNEXUS_TOOLS],
  });
  show(b, `expect ast_grep PRESENT (extension registers fine): ${b.active.includes('ast_grep') ? 'PASS' : 'FAIL'}`);
  check('B registration works when named', b.active.includes('ast_grep'), JSON.stringify(b.active));

  const f = await runSession('F: literal LOCAL-PATH sources (gitnexus + pi-ast-grep) — what a user.json path produces', {
    paths: [GITNEXUS_DIR, AST_GREP_DIR], tools: [...READ_NATIVE, ...GITNEXUS_TOOLS],
  });
  show(f, `expect ast_grep ABSENT (local path is not a workaround): ${!f.active.includes('ast_grep') ? 'PASS' : 'FAIL'}`);
  check('F local path reproduces defect', !f.active.includes('ast_grep'), JSON.stringify(f.active));

  const g = await runSession('G: discovery session — noTools=builtin, tools OMITTED, only pi-ast-grep', {
    paths: [AST_GREP_DIR],
  });
  const gBuiltins = g.active.filter((t) => BUILTIN_CANARIES.includes(t));
  show(g, `expect ["ast_grep"] exactly, no builtin canary: ${JSON.stringify(g.active) === JSON.stringify(['ast_grep']) && gBuiltins.length === 0 ? 'PASS' : 'FAIL'}`);
  check('G discovery enumerates and fences builtins', JSON.stringify(g.active) === JSON.stringify(['ast_grep']), `active=${JSON.stringify(g.active)} builtins=${JSON.stringify(gBuiltins)}`);

  const h = await runSession('H: control — NO extension sources, tools ["read"]', { paths: [], tools: ['read'] });
  show(h, `expect ["read"] only (no widening): ${JSON.stringify(h.active) === JSON.stringify(['read']) ? 'PASS' : 'FAIL'}`);
  check('H no-source control does not widen', JSON.stringify(h.active) === JSON.stringify(['read']), JSON.stringify(h.active));

  console.log('\n=== FALSIFIERS ===');

  // I — builtin-name collision. Fires if the colliding NAME becomes active in a session whose
  // grant does not include it; that would be privilege escalation through the pinning step.
  const iDiscovery = await runSession('I1: collision fixture in a discovery session (registers probe_benign AND write)', {
    paths: [COLLISION_DIR],
  });
  const fixtureLoaded = iDiscovery.active.includes('probe_benign');
  const collisionInDiscovery = iDiscovery.active.includes('write');
  show(iDiscovery, `fixture loaded: ${fixtureLoaded}; colliding name discoverable: ${collisionInDiscovery}`);

  const iPin = await runSession('I2: collision fixture, tools ["read","write"] (a pin that trusted the name)', {
    paths: [COLLISION_DIR], tools: ['read', 'write'],
  });
  const collisionActive = iPin.active.includes('write');
  show(iPin, `colliding name ACTIVE: ${collisionActive}${collisionActive ? '  <-- FALSIFIER FIRES' : '  (not activated)'}`);

  check(
    'I collision falsifier',
    fixtureLoaded && !collisionInDiscovery && !collisionActive,
    fixtureLoaded
      ? `fixture loaded; discovery=${collisionInDiscovery ? 'NAME EXPOSED' : 'name not exposed'}; pinned-session=${collisionActive ? 'ACTIVE (escalation!)' : 'not active'}`
      : 'FIXTURE DID NOT LOAD — probe invalid, do not read as a pass',
  );

  // J — double initialization. Discovery runs every enabled extension's session_start twice
  // per activation (unitAI-il2io precedent: a double-loaded extension registered a duplicate tool).
  const jFirst = await runSession('J1: pi-ast-grep session #1', { paths: [AST_GREP_DIR] });
  const jSecond = await runSession('J2: pi-ast-grep session #2 (same process, after disposal)', { paths: [AST_GREP_DIR] });
  const astStable = JSON.stringify(jFirst.active) === JSON.stringify(jSecond.active) && jFirst.active.length === jSecond.active.length;
  show(jSecond, `identical set across two initializations: ${astStable}`);
  check('J1 ast-grep double init is stable', astStable, `#1=${JSON.stringify(jFirst.active)} #2=${JSON.stringify(jSecond.active)}`);

  const jIntercom = await runSession('J3: pi-intercom (broker-style side effects) double init — #1', { paths: [INTERCOM_DIR] });
  const jIntercom2 = await runSession('J4: pi-intercom #2', { paths: [INTERCOM_DIR] });
  const intercomStable = JSON.stringify(jIntercom.active) === JSON.stringify(jIntercom2.active);
  show(jIntercom2, `intercom sets identical: ${intercomStable}; #1=${JSON.stringify(jIntercom.active)} #2=${JSON.stringify(jIntercom2.active)}${jIntercom.error || jIntercom2.error ? ' (error recorded above)' : ''}`);
  check('J2 intercom double init is stable', intercomStable && !jIntercom.error && !jIntercom2.error, `#1=${JSON.stringify(jIntercom.active)} #2=${JSON.stringify(jIntercom2.active)}`);

  const jMcp1 = await runSession('J5: pi-mcp-adapter (spawns MCP servers) #1', { paths: [MCP_ADAPTER_DIR] });
  const jMcp2 = await runSession('J6: pi-mcp-adapter #2', { paths: [MCP_ADAPTER_DIR] });
  const mcpStable = JSON.stringify(jMcp1.active) === JSON.stringify(jMcp2.active);
  show(jMcp2, `mcp-adapter sets identical: ${mcpStable}; #1=${JSON.stringify(jMcp1.active)} #2=${JSON.stringify(jMcp2.active)}`);
  check('J3 mcp-adapter double init is stable', mcpStable, `#1=${JSON.stringify(jMcp1.active)}${jMcp1.error ? ` err1=${jMcp1.error}` : ''}${jMcp2.error ? ` err2=${jMcp2.error}` : ''}`);

  // K — source isolation. The loader is built with noExtensions:true plus explicit paths, so an
  // ambient extension the operator did NOT enable must not contribute names.
  const k = await runSession('K: only pi-ast-grep enabled, while intercom/claude-link/mcp-adapter exist ambient', {
    paths: [AST_GREP_DIR],
  });
  const leaked = k.active.filter((t) => !['ast_grep'].includes(t));
  show(k, `expect exactly ["ast_grep"], no ambient leakage: ${leaked.length === 0 && k.active.includes('ast_grep') ? 'PASS' : 'FAIL'}`);
  check('K source isolation', leaked.length === 0 && k.active.includes('ast_grep'), `active=${JSON.stringify(k.active)}`);

  // L — failure path. A discovery that cannot load its sources must be observable, not silent.
  const bogus = join(FIXTURE_ROOT, 'does-not-exist');
  const l = await runSession('L: discovery with a non-existent extension path', { paths: [bogus] });
  show(l, `expected outcome: either a surfaced error or an empty set — silent success is unacceptable. active=${JSON.stringify(l.active)} error=${l.error ?? 'none'}`);
  check('L failure is observable', Boolean(l.error) || l.active.length === 0, `active=${JSON.stringify(l.active)} error=${l.error ?? 'none'}`);

  // M — can the BUILTIN name set be enumerated dynamically, so a colliding discovered name
  // can be refused instead of pinned? A static denylist was already rejected in unitAI-34pyf
  // (new builtins appear); a dynamic enumeration has no such drift.
  const m = await runSession('M: no extensions, default tools (no noTools, no tools filter) — dynamic builtin set', {
    paths: [], defaultTools: true,
  });
  const mHasWrite = m.active.includes('write');
  show(m, `builtin names enumerated: ${m.active.length}; includes write: ${mHasWrite}`);
  check('M builtin set enumerable dynamically', m.active.length > 0 && mHasWrite, `${m.active.length} names; sample=${JSON.stringify(m.active.slice(0, 12))}`);

  // N — the response to the fired falsifier: refuse colliding names instead of pinning them.
  // Uses M's dynamic set, so no static builtin list is maintained.
  const collisionCandidates = iDiscovery.active.filter((name) => !m.active.includes(name));
  show(
    { label: 'N: collision refused using the dynamic builtin set', active: collisionCandidates, ms: 0 },
    `discovered ${JSON.stringify(iDiscovery.active)} -> pin-able ${JSON.stringify(collisionCandidates)} `
    + `(refused: ${JSON.stringify(iDiscovery.active.filter((name) => m.active.includes(name)))})`,
  );
  check(
    'N collision refused by dynamic builtin set',
    !collisionCandidates.includes('write') && collisionCandidates.includes('probe_benign'),
    `pin-able=${JSON.stringify(collisionCandidates)} refused=${JSON.stringify(iDiscovery.active.filter((name) => m.active.includes(name)))}`,
  );

  // O — does the session API expose tool SOURCE metadata, which would let provenance be
  // checked directly instead of by name subtraction?
  {
    const probe = await runSession('O: session API surface (looking for per-tool source metadata)', { paths: [AST_GREP_DIR] });
    const loader = new sdk.DefaultResourceLoader({
      cwd: process.cwd(), agentDir: sdk.getAgentDir(), noSkills: true, noExtensions: true,
      noContextFiles: true, noPromptTemplates: true, noThemes: true, additionalExtensionPaths: [AST_GREP_DIR],
    });
    await loader.reload();
    const created = await sdk.createAgentSession({ resourceLoader: loader, model, cwd: process.cwd(), noTools: 'builtin', systemPrompt: 'probe' });
    const session = created.session as unknown as Record<string, unknown>;
    const prototype = Object.getPrototypeOf(session) as object | null;
    const methods = prototype ? Object.getOwnPropertyNames(prototype) : [];
    const own = Object.keys(session);
    console.log(`\nO: session API surface\n   prototype: ${JSON.stringify(methods)}\n   own keys: ${JSON.stringify(own)}`);
    show(probe, `metadata accessor present: ${own.concat(methods).some((k) => /tool/i.test(k) && !/Active/i.test(k))}`);
    session.dispose?.();
  }

  // P — provenance: the real session exposes getAllTools/getToolDefinition. If those carry
  // source metadata, the collision can be refused on PROVENANCE, not just on name subtraction.
  {
    const loader = new sdk.DefaultResourceLoader({
      cwd: process.cwd(), agentDir: sdk.getAgentDir(), noSkills: true, noExtensions: true,
      noContextFiles: true, noPromptTemplates: true, noThemes: true,
      additionalExtensionPaths: [COLLISION_DIR, AST_GREP_DIR],
    });
    await loader.reload();
    const created = await sdk.createAgentSession({ resourceLoader: loader, model, cwd: process.cwd(), noTools: 'builtin', systemPrompt: 'probe' });
    const session = created.session as unknown as {
      getAllTools?: () => Array<Record<string, unknown>>;
      getToolDefinition?: (name: string) => unknown;
      getActiveToolNames(): string[];
      dispose(): void;
    };
    const all = typeof session.getAllTools === 'function' ? session.getAllTools() : [];
    const shape = all.map((t) => ({
      name: t.name,
      source: (t.sourceInfo as { source?: string } | undefined)?.source ?? (t.source as string | undefined) ?? null,
      extra: Object.keys(t).filter((k) => k !== 'name'),
    }));
    console.log('\nP: session.getAllTools() provenance\n   entries: ' + JSON.stringify(shape, null, 1).slice(0, 1600));
    const writeDef = typeof session.getToolDefinition === 'function' ? session.getToolDefinition('write') : undefined;
    const benignDef = typeof session.getToolDefinition === 'function' ? session.getToolDefinition('probe_benign') : undefined;
    const defShape = (d: unknown) => (d && typeof d === 'object'
      ? { keys: Object.keys(d as object), source: ((d as Record<string, unknown>).sourceInfo as { source?: string } | undefined)?.source ?? null,
          label: (d as Record<string, unknown>).label ?? null, description: String((d as Record<string, unknown>).description ?? '').slice(0, 70) }
      : String(d));
    console.log(`   getToolDefinition('write'):        ${JSON.stringify(defShape(writeDef))}`);
    console.log(`   getToolDefinition('probe_benign'): ${JSON.stringify(defShape(benignDef))}`);
    const writeSource = shape.find((s) => s.name === 'write')?.source ?? null;
    const benignSource = shape.find((s) => s.name === 'probe_benign')?.source ?? null;
    check(
      'P provenance distinguishes fixture from builtin',
      Boolean(writeSource) && Boolean(benignSource),
      `write source=${String(writeSource)} probe_benign source=${String(benignSource)}`,
    );
    session.dispose();
  }

  console.log('\n=== VERDICT ===');
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  — ${c.note}`);
  const falsifiers = checks.filter((c) => c.name.startsWith('I ') || c.name.startsWith('J') || c.name.startsWith('K ') || c.name.startsWith('L ') || c.name.startsWith('M ') || c.name.startsWith('N ') || c.name.startsWith('P '));
  const fired = falsifiers.filter((c) => !c.ok);
  console.log(`\nfalsifier verdict: ${fired.length === 0 ? 'none fired — discover-then-pin survives its stated falsifiers' : `${fired.length} FIRED — design must change: ${fired.map((c) => c.name).join(', ')}`}`);
  const timing = results.length > 0 ? Math.round(results.reduce((sum, r) => sum + r.ms, 0) / results.length) : 0;
  console.log(`mean session creation: ${timing}ms over ${results.length} sessions (the extra discovery session costs one of these)`);

  rmSync(FIXTURE_ROOT, { recursive: true, force: true });
  process.exit(fired.length === 0 ? 0 : 1);
}

await main();
