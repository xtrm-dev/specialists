/** Native smoke, not Substrate dispatch. Synthetic admission/definition fixtures only.
 * Real NativeActivationHost, real Pi AgentSession, unchanged production forensic sink.
 * --offline never invokes the provider. --live requires explicit billing approval.
 * Scratch artifacts are deliberately NEVER deleted. No production source is patched.
 */
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { NativeActivationHost } from '../../src/activation/native-host.js';
import { createActivationForensicSink } from '../../src/activation/forensic-sink.js';
import { createObservabilitySqliteClientAtPath } from '../../src/specialist/observability-sqlite.js';
import { reconcileSessionUsage } from '../../src/specialist/session-metrics-contract.js';
import type { SpecialistWorkItemBoundary } from '../../src/activation/workitem-store.js';

const MODEL = 'openrouter/stealth/union-alpha';
const mode = process.argv[2];
assert(mode === '--offline' || mode === '--live', 'choose --offline or --live');
assert(process.argv[3]?.startsWith('/'), 'absolute artifact directory required');
const root = resolve(process.argv[3]);
assert(!existsSync(root), 'provide a NEW scratch directory');
mkdirSync(root, { recursive: true });
const cwd = join(root, 'workspace');
const agentDir = join(root, 'agent');
const sessionDir = join(root, 'sessions');
for (const dir of [cwd, agentDir, sessionDir]) mkdirSync(dir);
const sdkPath = process.env.SMOKE_PI_SDK ?? '/home/dawid/.nvm/versions/node/v24.15.0/lib/node_modules/@earendil-works/pi-coding-agent';
const report: any = { mode, model: MODEL, root, cwd, sessionDir, dbPath: join(root, 'observability.db'), paidSmokeRuns: 0,
  disclosure: 'Synthetic injected WorkItemBoundary and Specialist definition; NOT real Substrate dispatch. Real SDK/host/telemetry. Offline history uses synthetic assistant fixtures only; live history never does.',
  bounds: { totalMs: 600000, operationMs: 120000, cleanupMs: 10000, maxRequests: 4, maxOutputTokensPerRequest: 1024, maxContextCharactersPerRequest: 200000, providerRetries: 0 },
  billing: 'Catalog rates are advertised metadata, not proof of no billing.', checkpoints: [] };
const save = () => writeFileSync(join(root, 'report.json'), JSON.stringify(report, null, 2));
const raw = (kind: string, value: unknown) => appendFileSync(join(root, 'events.jsonl'), JSON.stringify({ kind, value }) + '\n');
async function bounded<T>(promise: Promise<T>, ms = 120000): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try { return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`deadline ${ms}ms exceeded`)), ms); })]); }
  finally { clearTimeout(timer!); }
}
function prepared(sdk: any, session: any) {
  const settings = session.settingsManager.getCompactionSettings();
  assert.equal(settings.keepRecentTokens, 20000, 'do not tune compaction defaults');
  const p = sdk.prepareCompaction(session.sessionManager.getBranch(), settings);
  assert(p && (p.messagesToSummarize.length || p.turnPrefixMessages.length), 'empty compaction preparation');
  assert.equal(p.isSplitTurn, false, 'one summarization request only');
  return { settings, messagesToSummarize: p.messagesToSummarize.length, turnPrefixMessages: p.turnPrefixMessages.length,
    firstKeptEntryId: p.firstKeptEntryId, tokensBefore: p.tokensBefore };
}
function zero(reconciliation: any) {
  assert(reconciliation?.reconciled === true, 'missing or nonzero reconciliation');
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'cost']) {
    assert.equal(reconciliation.fields?.[key]?.delta, 0, `nonzero/missing ${key} delta`);
  }
}
function compactEntry(entries: any[]) {
  const found = entries.filter(e => e.type === 'compaction');
  assert.equal(found.length, 1, 'exactly one successful compaction entry required');
  const entry = found[0];
  assert(entry.summary?.trim() && entry.usage && entry.tokensBefore > 0, 'empty/refused compaction or missing usage');
  return entry;
}
// Three separate meaningful batches, each approximately 12k Pi-estimated tokens.
// The newest two cross 20k backwards, leaving the FIRST complete turn to summarize.
const prompts = [1, 2, 3].map(batch => {
  const rows = Array.from({ length: 420 }, (_, i) => `Sample ${batch}-${i}: north station measured ${10 + i % 7} units; south station measured ${8 + i % 5} units. Both instruments were calibrated at dawn.`).join('\n');
  return `Synthetic weather study, batch ${batch}. Compare the ranges at north and south stations, explain one limitation, and retain the batch number for the next discussion. Reply in at most 80 words. Use only the supplied data.\n${rows}`;
});
const system = 'Analyze only synthetic weather observations in this conversation. No tools, external knowledge, files, or actions. Be concise.';
let session: any, host: NativeActivationHost | undefined, handle: any, db: any;
let requests = 0, promptCalls = 0, cleanupDone = false;
const watchdog = setTimeout(() => { report.error = 'global deadline exceeded'; save(); void cleanup().finally(() => process.exit(1)); }, 600000);
async function cleanup() {
  if (cleanupDone) return;
  cleanupDone = true;
  try {
    session?.abortCompaction();
    if (host && handle) await bounded(host.stop(handle.activationId, 'smoke cleanup'), 10000);
    else if (session) await bounded(session.abort(), 10000);
  } catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
  finally {
    try { session?.dispose(); db?.close(); }
    catch (error) { report.cleanupError = String(error); process.exitCode = 1; }
    if (report.cleanupError) report.success = false;
    save();
  }
}
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => {
  report.error = signal; save(); void cleanup().finally(() => process.exit(1));
});
try {
  const sdk: any = { ...await import(pathToFileURL(join(sdkPath, 'dist/index.js')).href),
    ...await import(pathToFileURL(join(sdkPath, 'dist/core/compaction/compaction.js')).href) };
  report.piVersion = JSON.parse(readFileSync(join(sdkPath, 'package.json'), 'utf8')).version;
  const runtime = await bounded(sdk.ModelRuntime.create({ allowModelNetwork: false, signal: AbortSignal.timeout(15000) }), 20000);
  const scope = await bounded(Promise.resolve(sdk.resolveModelScopeWithDiagnostics([MODEL], runtime)), 20000) as any;
  assert.equal(scope.scopedModels.length, 1);
  assert.equal(scope.diagnostics.length, 0);
  const model = scope.scopedModels[0].model;
  assert.equal(`${model.provider}/${model.id}`, MODEL);
  assert(await runtime.hasConfiguredAuth('openrouter'));
  report.resolvedModel = model;
  for (const field of ['input', 'output', 'cacheRead', 'cacheWrite']) assert(Number.isFinite(model.cost[field]) && model.cost[field] >= 0, 'unknown catalog price');
  assert(model.contextWindow >= 100000, 'insufficient context bound');
  if (mode === '--live') {
    assert.equal(process.env.SMOKE_BILLING_APPROVED, 'yes', 'operator must approve advertised-price uncertainty');
    assert(['1', '2', '3'].includes(process.env.SMOKE_RUN_NUMBER ?? ''), 'renewed budget run number required');
    report.renewedBudgetRunNumber = Number(process.env.SMOKE_RUN_NUMBER);
  }
  const settingsManager = sdk.SettingsManager.inMemory(); // unmodified Pi defaults, no shared settings
  report.compactionSettings = settingsManager.getCompactionSettings();
  report.promptCharacters = prompts.map(p => p.length);
  // Pure offline shape proof using installed Pi, independent of model usage estimates.
  const sm = sdk.SessionManager.inMemory(cwd);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  for (const text of prompts) {
    sm.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
    sm.appendMessage({ role: 'assistant', content: [{ type: 'text', text: 'Synthetic offline shape fixture.' }], api: model.api, provider: model.provider, model: model.id, usage, stopReason: 'stop', timestamp: Date.now() });
  }
  report.offlinePreparation = prepared(sdk, { sessionManager: sm, settingsManager });
  assert.throws(() => prepared(sdk, { sessionManager: sdk.SessionManager.inMemory(cwd), settingsManager }));
  assert.throws(() => compactEntry([]));
  assert.throws(() => compactEntry([{ type: 'compaction', summary: '' }]));
  assert.throws(() => zero(undefined));
  for (const key of ['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'cost']) {
    const fields = Object.fromEntries(['input', 'output', 'cacheRead', 'cacheWrite', 'total', 'cost'].map(k => [k, { delta: k === key ? 1 : 0 }]));
    assert.throws(() => zero({ reconciled: true, fields }));
  }
  report.offlineFailureChecks = 'empty/refused/missing compaction and every nonzero reconciliation field rejected';
  db = createObservabilitySqliteClientAtPath(report.dbPath);
  assert(db, 'scratch DB failed to open');
  const sink = createActivationForensicSink(db);
  const contract = { problem: 'Compare synthetic observations.', success: 'Explain ranges.', scope: ['Only supplied data.'], nonGoals: ['No files or external actions.'], constraints: ['Synthetic only.'], validation: [{ check: 'A short comparison.' }], output: [{ artifact: 'Text response.' }] };
  const view = { ref: 'SYNTHETIC-1', issueId: 'synthetic-1', revision: 1, contractHash: 'synthetic', title: 'Synthetic weather study', contract, readinessState: 'claimed', dispatchable: true, reasons: [] };
  const workItems = {
    view: () => view, check: () => ({ ...view, report: view }), epicAncestors: () => [], completedBlockers: () => [],
    bind: (input: any) => ({ ...input, id: 'synthetic-binding', issueId: view.issueId, issueRevision: 1, contractHash: view.contractHash }),
    inlineCreate: () => { throw new Error('inline creation forbidden'); }, journal: () => {},
  } as unknown as SpecialistWorkItemBoundary;
  // Transparent SDK seam supplies scratch persistence and isolation, never telemetry.
  const isolatedSdk = {
    ...sdk, getAgentDir: () => agentDir, ModelRuntime: { create: async () => runtime },
    DefaultResourceLoader: class extends sdk.DefaultResourceLoader {
      constructor(options: any) { super({ ...options, agentDir, settingsManager, noSkills: true, noExtensions: true,
        noContextFiles: true, noPromptTemplates: true, noThemes: true, additionalSkillPaths: [], additionalExtensionPaths: [],
        systemPromptOverride: () => system, appendSystemPromptOverride: () => [] }); }
    },
    createAgentSession: async (options: any) => {
      assert(!session, 'only one real session permitted; no discovery/fallback sessions');
      const result = await sdk.createAgentSession({ ...options, agentDir, modelRuntime: runtime, settingsManager,
        sessionManager: sdk.SessionManager.create(cwd, sessionDir) });
      session = result.session;
      assert(!result.modelFallbackMessage, 'model fallback forbidden');
      assert.equal(`${session.model.provider}/${session.model.id}`, MODEL);
      const loader = options.resourceLoader;
      report.isolation = { skills: loader.getSkills(), context: loader.getAgentsFiles(), extensions: loader.getExtensions().extensions.map((e: any) => e.path), systemPrompt: session.agent.state.systemPrompt };
      assert.equal(report.isolation.skills.skills.length, 0);
      assert.equal(report.isolation.context.agentsFiles.length, 0);
      assert.equal(report.isolation.extensions.length, 0);
      assert.equal(session.agent.state.systemPrompt, `${system}\nCurrent working directory: ${cwd}\n`);
      report.sessionFile = session.sessionManager.getSessionFile();
      session.subscribe((event: any) => raw('pi', event));
      const stream = session.agent.streamFunction;
      session.agent.streamFunction = (m: any, context: any, options: any) => {
        assert.equal(mode, '--live', 'offline provider access forbidden');
        assert.equal(`${m.provider}/${m.id}`, MODEL);
        assert.equal(context.tools?.length ?? 0, 0, 'model tools forbidden');
        assert(JSON.stringify(context).length < 200000, 'request context character bound exceeded');
        assert(++requests <= 4, 'provider request bound exceeded');
        report.requests = requests; report.paidSmokeRuns = 1; save();
        raw('request-bound', { request: requests, model: MODEL, maxTokens: 1024 });
        return stream(m, context, { ...options, maxTokens: Math.min(options?.maxTokens ?? 1024, 1024), maxRetries: 0, timeoutMs: 90000 });
      };
      const prompt = session.prompt.bind(session);
      session.prompt = async (text: string, options: any) => {
        // Host verifies its promised tool registry before this call; now narrow actual
        // model access to NONE, using the real public API (not a fake registry).
        session.setActiveToolsByName([]);
        assert.equal(session.getActiveToolNames().length, 0);
        assert.equal(text, prompts[promptCalls], 'unexpected/non-synthetic model prompt');
        if (mode === '--offline') throw new Error('OFFLINE_ADMISSION_VERIFIED_NO_PROVIDER_CALL');
        promptCalls++;
        await bounded(prompt(text, options));
        const last = [...session.messages].reverse().find((message: any) => message.role === 'assistant');
        assert(last && last.stopReason === 'stop', 'assistant failure/refusal/truncation; stop before compaction');
        assert(last.content.some((part: any) => part.type === 'text' && part.text?.trim()), 'missing assistant output');
        if (promptCalls === 3) {
          report.preCompaction = { stats: session.getSessionStats(), native: host!.list()[0], db: db.readStatus(handle.activationId) };
          const before = reconcileSessionUsage(host!.list()[0].tokenUsage, report.preCompaction.stats);
          report.preCompaction.reconciliation = before;
          report.preCompaction.dbReconciliation = reconcileSessionUsage(report.preCompaction.db?.metrics?.token_usage, report.preCompaction.stats);
          save(); zero(before); zero(report.preCompaction.dbReconciliation);
          report.livePreparation = prepared(sdk, session); save();
          report.compactionResult = await bounded(session.compact('Summarize the synthetic weather comparison and retained batch identifiers. Be concise.'));
          report.compactionEntry = compactEntry(session.sessionManager.getEntries()); save();
        }
      };
      save(); return result;
    },
  };
  host = new NativeActivationHost({ cwd, env: {}, workItems, loadSdk: async () => isolatedSdk,
    piVersion: report.piVersion, forensics: { emit: e => { raw('host', e); sink.emit(e); }, sessionEvent: e => { raw('host-session', e); sink.sessionEvent!(e); } },
    loader: { get: async () => ({ specialist: {
      metadata: { name: 'synthetic-weather', version: '1.0.0', description: 'Synthetic observation analysis', category: 'research' },
      execution: { model: MODEL, permission_required: 'READ_ONLY', bare: true, response_format: 'text', output_type: 'custom', extensions: { gitnexus: false } },
      mandatory_rules: { disable_default_globals: true, template_sets: [], inline_rules: [] },
      prompt: { system, task_template: prompts[0] }, skills: { paths: [] },
    } }) } as never,
  });
  handle = await bounded(host.start({ specialist: 'synthetic-weather', issueRef: 'SYNTHETIC-1', requestedByParticipantId: 'synthetic-coordinator', modelOverride: MODEL }));
  for (let turn = 0; turn < (mode === '--live' ? 3 : 1); turn++) {
    if (turn > 0) handle = await bounded(host.resume(handle.activationId, prompts[turn]));
    const result = await bounded(handle.result);
    const stats = session.getSessionStats();
    const native = host.list()[0];
    const status = db.readStatus(handle.activationId);
    assert(status, 'production forensic sink did not persist status');
    const checkpoint = { turn: turn + 1, result, stats, native, db: status,
      nativeReconciliation: reconcileSessionUsage(native.tokenUsage, stats), dbReconciliation: status?.metrics?.reconciliation };
    report.checkpoints.push(checkpoint); save();
    if (mode === '--offline') {
      assert.equal((result as any).status, 'failed');
      assert(JSON.stringify(result).includes('OFFLINE_ADMISSION_VERIFIED_NO_PROVIDER_CALL'));
      assert.equal(requests, 0); report.offlineNativeSetup = 'real host/session/DB admission reached; prompt deliberately refused before provider';
    } else {
      assert.equal((result as any).status, 'completed'); assert.equal((result as any).validation.valid, true);
      assert.equal((result as any).resolvedModel, MODEL); assert.equal((result as any).fallbackUsed, false);
      zero(checkpoint.nativeReconciliation); zero(checkpoint.dbReconciliation);
    }
  }
  if (mode === '--live') {
    report.compactionEntry = compactEntry(session.sessionManager.getEntries());
    report.sessionStats = session.getSessionStats();
    report.perMessageUsage = session.sessionManager.getEntries().filter((e: any) => e.message?.usage || e.usage).map((e: any) => ({ id: e.id, type: e.type, role: e.message?.role, model: e.message?.model, provider: e.message?.provider, usage: e.message?.usage ?? e.usage }));
    assert(report.perMessageUsage.length >= 4);
    assert(existsSync(report.sessionFile), 'session file not persisted');
    report.nativeAndDbZeroWithSuccessfulCompaction = true;
  }
  if (mode === '--offline' && process.env.SMOKE_OFFLINE_FAILURE) {
    // Exercise actual CLI exit status without paid requests, using the live validators.
    switch (process.env.SMOKE_OFFLINE_FAILURE) {
      case 'empty': prepared(sdk, { sessionManager: sdk.SessionManager.inMemory(cwd), settingsManager }); break;
      case 'refused': compactEntry([]); break;
      case 'delta': zero({ reconciled: false, fields: { input: { delta: 1 } } }); break;
      default: throw new Error('unknown offline negative case');
    }
  }
  report.success = true;
} catch (error) { report.success = false; report.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  if (session) {
    report.finalEntries = session.sessionManager.getEntries();
    report.finalStats = session.getSessionStats();
    report.perMessageUsage = report.finalEntries.filter((e: any) => e.message?.usage || e.usage).map((e: any) => ({ id: e.id, type: e.type, role: e.message?.role, model: e.message?.model, provider: e.message?.provider, usage: e.message?.usage ?? e.usage }));
    report.sessionFile = session.sessionManager.getSessionFile();
  }
  if (db && handle) {
    report.timeline = db.readEvents(handle.activationId);
    report.forensicEvents = db.readForensicEventsForActivations([handle.activationId]);
    if (report.forensicEvents.length === 0) { report.success = false; report.error = 'no durable forensic rows'; process.exitCode = 1; }
  }
  save(); await cleanup(); clearTimeout(watchdog);
  console.log(JSON.stringify({ success: report.success, error: report.error, report: join(root, 'report.json'), paidSmokeRuns: report.paidSmokeRuns }));
}
