import { describe, it, expect, vi, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/** The native path must never spawn; the same guard the other activation suites use. */
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: (...args: unknown[]) => {
      throw new Error(`native activation must not spawn a subprocess; got spawn(${String(args[0])})`);
    },
  };
});

/** Deterministic curated-extension input: one entry, not a function of the machine. */
const PY_KERNEL = '/fake/pi-extensions/python-kernel';
vi.mock('../../../src/pi/python-kernel-extension.js', () => ({
  resolvePiExtensionsPythonKernelPath: () => PY_KERNEL,
}));

import { NativeActivationHost, resolveWorkspace, contractToMarkdown, type ActivationForensicSink } from '../../../src/activation/native-host.js';
import { ASK_TOOL, ESCALATE_TOOL } from '../../../src/activation/ask-tool.js';
import { deriveSkillName, renderTaskPrompt } from '../../../src/specialist/task-prompt.js';
import { buildSystemPrompt, buildOutputContractInstruction } from '../../../src/specialist/system-prompt.js';
import { buildReviewerDiffContext, buildReviewerDiffInstruction, resolveOutputContractSchema, runScript, findRequiredPreScriptFailure, formatRequiredPreScriptFailure, formatScriptOutput, validateBeforeRun } from '../../../src/specialist/runner.js';
import {
  deduplicateExtensionSources,
  resolveCuratedExtensionPaths,
  resolveExecutionExtensionSelection,
  resolveRuntimeToolContract,
} from '../../../src/pi/session.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';

/**
 * Native-vs-legacy resource assembly parity (SPECIALISTS-8).
 *
 * Four separate regressions reached HEAD because nothing owned this comparison: missing
 * declared skills, missing resource isolation, a hardcoded `outputContractSchema: undefined`,
 * and unexecuted pre-scripts. Each was found by reading two call sites side by side by hand.
 *
 * The native side is captured from the REAL host through a recording SDK double: what it
 * really passes to `createAgentSession` and what it really prompts the child with. The
 * legacy side is recomputed with the SAME exported helpers and the SAME inputs the legacy
 * call sites use — `src/specialist/runner.ts` for the task and system prompts, and
 * `src/pi/session.ts` for the extension argv — because running the legacy path needs a real
 * `pi` subprocess and the suite forbids one. No model is called anywhere in this file.
 *
 * INTENTIONAL DIVERGENCES. The two runtimes legitimately differ in the ways listed below.
 * They are named here so a future reader can tell a deliberate difference from a new bug: an
 * unlisted divergence is a failure, and `assertNoUnlistedDivergence` checks the ones that are
 * observable in the rendered prompt.
 */

/** Variables only the legacy job-reuse protocol can supply; native has no equivalent. */
const LEGACY_ONLY_JOB_REUSE_VARIABLES = ['reused_from_job_id', 'worktree_owner_job_id', 'gitnexus_summary'] as const;

/**
 * Legacy-only `--var` values have no native channel, and `fallbackPrompt` is unreachable
 * because the native host always resolves a work-item view. Both are inputs, not outputs, so
 * they cannot appear in a rendered prompt; they are recorded here rather than asserted.
 */
const LEGACY_ONLY_INPUTS = ['--var variables', 'fallbackPrompt'] as const;

function assertNoUnlistedDivergence(prompt: string, cwd: string): void {
  // `worktree_owner_job_id` and friends must be ABSENT on the native path: their presence
  // would mean a job-reuse concept leaked into a runtime that has no jobs.
  for (const name of LEGACY_ONLY_JOB_REUSE_VARIABLES) {
    expect(prompt.includes(`$${name}`), `unresolved legacy-only variable $${name} reached the prompt`).toBe(false);
  }
  // The prompt must name the directory the session runs in, and no other.
  expect(prompt).toContain(`Current cwd: ${cwd}`);
}

interface ProbeOptions {
  permission?: string;
  responseFormat?: string;
  outputType?: string;
  withSchema?: boolean;
  withSkills?: boolean;
  withPreScript?: boolean;
  specialistName?: string;
}

const workspaces: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'parity-ws-'));
  workspaces.push(root);
  return root;
}
afterEach(() => {
  while (workspaces.length > 0) rmSync(workspaces.pop() as string, { recursive: true, force: true });
});

function skillDirs(root: string, names: string[]): string[] {
  return names.map((name) => {
    const dir = join(root, 'skills', name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
    return dir;
  });
}

const DECLARED_SCHEMA = {
  type: 'object',
  properties: { summary: { type: 'string' }, confidence: { enum: ['low', 'high'] } },
  required: ['summary'],
};

const BLOCKERS = [{ ref: 'ISSUE-BLOCKER', title: 'The dependency that unblocked this', description: 'PROBLEM: earlier work' }];

function definition(root: string, opts: ProbeOptions) {
  const skillPaths = opts.withSkills ? skillDirs(root, ['gitnexus', 'engineering-quality']) : [];
  const scripts = opts.withPreScript
    ? [{ phase: 'pre', run: preScriptFile(root), inject_output: true }]
    : [];
  return {
    specialist: {
      metadata: { name: opts.specialistName ?? 'parity-probe', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: opts.permission ?? 'LOW',
        response_format: opts.responseFormat ?? 'markdown',
        output_type: opts.outputType ?? 'analysis',
        bare: false,
        ...(opts.permission === 'HIGH' ? { extensions: { 'npm:pi-mcp-adapter': true, [PY_KERNEL]: true } } : {}),
      },
      prompt: {
        system: 'You are the parity probe.',
        task_template: 'Do: $prompt\nPre: $pre_script_output',
        ...(opts.withSchema ? { output_schema: DECLARED_SCHEMA } : {}),
      },
      skills: { paths: skillPaths, scripts },
    },
  };
}

function preScriptFile(root: string): string {
  const file = join(root, 'pre-script.sh');
  writeFileSync(file, '#!/bin/sh\necho PARITY-PRE-SCRIPT-OUTPUT\n', { mode: 0o755 });
  return file;
}

function recordingSession(record: { createArgs?: Record<string, unknown> }): PiAgentSessionLike & { prompts: string[] } {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const session = {
    sessionId: 'pi-parity',
    messages: [],
    isIdle: true,
    prompts: [] as string[],
    activeTools: ['read'],
    async prompt(text: string) {
      session.prompts.push(text);
      listeners.forEach((l) => l({ type: 'agent_start' }));
      listeners.forEach((l) => l({ type: 'agent_end', willRetry: false }));
      listeners.forEach((l) => l({ type: 'agent_settled' }));
    },
    async steer() {}, async followUp() {}, async abort() {}, dispose() {},
    subscribe(l: (e: PiAgentSessionEvent) => void) { listeners.push(l); return () => {}; },
    getActiveToolNames: () => session.activeTools,
    setActiveToolsByName(names: string[]) { session.activeTools = names; },
    async waitForIdle() {},
  };
  void record;
  return session as unknown as PiAgentSessionLike & { prompts: string[] };
}

function sdkFor(record: { createArgs?: Record<string, unknown> }, session: PiAgentSessionLike): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      record.createArgs = options;
      return { session };
    },
    ModelRuntime: { create: async () => ({ hasConfiguredAuth: () => true }) },
    resolveModelScopeWithDiagnostics: () => ({
      scopedModels: [{ model: { id: 'test-model', provider: 'testprov' } }],
      diagnostics: [],
    }),
    defineTool: (d: unknown) => d,
    DefaultResourceLoader: FakeResourceLoader,
    getAgentDir: () => FAKE_AGENT_DIR,
    createEditTool: () => ({ name: 'edit', execute: async () => 'edited' }),
    createWriteTool: () => ({ name: 'write', execute: async () => 'written' }),
    createBashTool: () => ({ name: 'bash', execute: async () => 'ran' }),
    createPowerShellTool: () => ({ name: 'powershell', execute: async () => 'ran' }),
  } as unknown as PiSdk;
}

function sink(): ActivationForensicSink & { names: string[] } {
  const names: string[] = [];
  return { names, emit: (event) => { names.push(event.name); } };
}

/** Everything the native runtime actually handed the child for one definition. */
async function nativeAssembly(root: string, opts: ProbeOptions, overrides: { name?: string } = {}) {
  const record: { createArgs?: Record<string, unknown> } = {};
  const session = recordingSession(record);
  const forensics = sink();
  const host = new NativeActivationHost({
    loader: { get: async () => definition(root, opts) } as never,
    workItems: testWorkItems({ blockers: BLOCKERS }),
    forensics,
    loadSdk: async () => sdkFor(record, session),
    cwd: root,
  });
  await (await host.start({
    specialist: overrides.name ?? opts.specialistName ?? 'parity-probe',
    issueRef: 'ISSUE-1',
    requestedByParticipantId: 'coordinator',
  })).result;
  const createArgs = record.createArgs!;
  return {
    createArgs,
    loader: createArgs.resourceLoader as FakeResourceLoader,
    systemPrompt: createArgs.systemPrompt as string,
    tools: createArgs.tools as string[],
    prompt: session.prompts[0],
    sessionCwd: createArgs.cwd as string,
    forensics,
  };
}

/**
 * The legacy side, recomputed exactly as the legacy call sites derive it.
 *
 * `renderTaskPrompt` inputs mirror `src/specialist/runner.ts:1124-1146` (including the
 * pre-script block at :1093-1100 and the reviewer `appendExecutionContext` at :1137), and
 * the system prompt mirrors `:1188-1206`. The extension list mirrors
 * `src/pi/session.ts:1001-1062`.
 */
function legacyAssembly(root: string, opts: ProbeOptions, overrides: { reviewer?: boolean } = {}) {
  const spec = definition(root, opts);
  const execution = spec.specialist.execution as Record<string, unknown>;
  const scripts = (spec.specialist.skills.scripts ?? []) as Array<{ phase?: string; required?: boolean; inject_output?: boolean; run?: string }>;
  const preScripts = scripts.filter((script) => script.phase === 'pre');
  const preScriptResults = preScripts.map((script) => runScript(script.run, root));
  const requiredFailure = findRequiredPreScriptFailure(preScripts, preScriptResults);
  if (requiredFailure) throw new Error(formatRequiredPreScriptFailure(requiredFailure));
  const preScriptOutput = formatScriptOutput(preScriptResults.filter((_, index) => preScripts[index].inject_output));

  // The SAME bead body the native path renders, taken from the same fixture boundary, so
  // the comparison is about assembly and not about two hand-written descriptions.
  const beadView = testWorkItems({ blockers: BLOCKERS }).view('ISSUE-1');
  const bead = { id: beadView.ref, title: beadView.title, description: contractToMarkdown(beadView.contract) };
  const rendered = renderTaskPrompt({
    specialist: spec.specialist as never,
    cwd: root,
    beadId: bead.id,
    bead,
    completedBlockers: BLOCKERS.map((b) => ({ id: b.ref, title: b.title, description: b.description })),
    preScriptOutput,
    worktreeBoundary: root,
    ...(overrides.reviewer
      ? { appendExecutionContext: (task: string) => `${task}${buildReviewerDiffInstruction(buildReviewerDiffContext(root, {}))}` }
      : {}),
  });

  const responseFormat = execution.response_format ?? 'text';
  const outputType = execution.output_type ?? 'custom';
  const outputContractSchema = resolveOutputContractSchema(responseFormat, outputType, DECLARED_SCHEMA);
  const systemPrompt = buildSystemPrompt({
    systemPromptTemplate: spec.specialist.prompt.system,
    templateVariables: rendered.beadTemplateVariables ?? {},
    bare: false,
    runCwd: root,
    specialistName: spec.specialist.metadata.name,
    inputIssueRef: bead.id,
    responseFormat,
    outputType,
    outputContractSchema,
    beadContextText: rendered.beadContextText ?? '',
    readBeadForMemory: () => null,
  }).text;

  const toolContract = resolveRuntimeToolContract({ level: opts.permission ?? 'LOW', specialistName: spec.specialist.metadata.name, cwd: process.cwd() })!;
  const curated = resolveCuratedExtensionPaths({ permissionLevel: opts.permission ?? 'LOW', resolvedToolContract: toolContract });
  const declared = resolveExecutionExtensionSelection(
    execution.extensions as Record<string, boolean | null | undefined> | undefined,
  ).extensionSources.filter((source) => !source.startsWith('npm:'));
  const { kept } = deduplicateExtensionSources(curated.dedupeAgainstDynamic, declared);

  return {
    skillPaths: spec.specialist.skills.paths,
    initialPrompt: rendered.initial_prompt,
    skillPrefix: rendered.skillPrefix,
    systemPrompt,
    outputContractSection: buildOutputContractInstruction(responseFormat as never, outputType as never, outputContractSchema),
    toolContract,
    extensionPaths: [...curated.all, ...kept],
    mandatoryRulesBlock: rendered.mandatoryRulesBlock,
  };
}

describe('native resource assembly matches the legacy call site (SPECIALISTS-8)', () => {
  it('loads exactly the declared skills and fences ambient discovery', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, { withSkills: true });
    const legacy = legacyAssembly(root, { withSkills: true });

    expect(native.loader.options.additionalSkillPaths).toEqual(legacy.skillPaths);
    // The legacy isolation flags, at the loader level.
    expect(native.loader.options.noSkills).toBe(true);
    expect(native.loader.options.noExtensions).toBe(true);
    expect(native.loader.options.noContextFiles).toBe(true);
    expect(native.loader.options.noPromptTemplates).toBe(true);
    expect(native.loader.options.noThemes).toBe(true);
    // Exactly the declared skills are loadable — nothing ambient.
    expect(native.loader.getSkills().skills.map((s) => s.name))
      .toEqual(legacy.skillPaths.map((p) => deriveSkillName(p)));
  });

  it('opens turn 1 with a /skill: prefix naming only skills the session can load', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, { withSkills: true });
    const loadable = new Set(native.loader.getSkills().skills.map((s) => s.name));
    const commanded = [...(native.prompt ?? '').matchAll(/\/skill:([A-Za-z0-9_-]+)/g)].map((m) => m[1]);
    expect(commanded.length).toBeGreaterThan(0);
    for (const name of commanded) expect(loadable.has(name)).toBe(true);
    expect(native.prompt?.startsWith('/skill:')).toBe(true);
  });

  it('carries the same output contract section the legacy system prompt carries', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, { withSchema: true });
    const legacy = legacyAssembly(root, { withSchema: true });
    expect(legacy.outputContractSection).toContain('## Output Contract');
    expect(native.systemPrompt).toContain(legacy.outputContractSection);
  });

  it('renders the same task prompt as the legacy call site, pre-scripts included', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, { withPreScript: true });
    const legacy = legacyAssembly(root, { withPreScript: true });
    expect(legacy.initialPrompt).toContain('PARITY-PRE-SCRIPT-OUTPUT');
    expect(native.prompt).toBe(legacy.initialPrompt);
  });

  it('renders completed blockers as dependency context on both paths', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, {});
    const legacy = legacyAssembly(root, {});
    expect(legacy.initialPrompt).toContain('## Context from completed dependencies:');
    expect(native.prompt).toContain('## Context from completed dependencies:');
    expect(native.prompt).toContain('ISSUE-BLOCKER');
  });

  it('injects the same mandatory-rules block the legacy renderer injects, and emits its metadata', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, {});
    const legacy = legacyAssembly(root, {});
    expect(legacy.mandatoryRulesBlock.trim().length).toBeGreaterThan(0);
    expect(native.prompt).toContain(legacy.mandatoryRulesBlock.trim());
    expect(native.forensics.names).toContain('mandatory_rules_injection');
  });

  it('grants only the resolved tool allowlist, plus the two ask tools', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, {});
    const legacy = legacyAssembly(root, {});
    expect(native.tools).toEqual([...legacy.toolContract.toolsList, ASK_TOOL, ESCALATE_TOOL]);
    expect(native.createArgs.noTools).toBe('builtin');
  });

  it('injects the same curated extension paths, after the same de-duplication rule', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, { permission: 'HIGH' });
    const legacy = legacyAssembly(root, { permission: 'HIGH' });
    const nativePaths = native.loader.options.additionalExtensionPaths as string[];
    expect(legacy.extensionPaths).toContain(PY_KERNEL);
    for (const path of legacy.extensionPaths) expect(nativePaths).toContain(path);
    // Same-identity duplicates are collapsed, and a non-local source is never forwarded as a path.
    expect(nativePaths.filter((p) => p === PY_KERNEL)).toHaveLength(1);
    expect(nativePaths.some((p) => p.startsWith('npm:'))).toBe(false);
  });

  it('runs the session in the directory its boundary instruction names', async () => {
    const root = workspace();
    const native = await nativeAssembly(root, {});
    expect(native.sessionCwd).toBe(resolveWorkspace(root).worktreePath);
    expect(native.prompt).toContain(`Assigned worktree boundary: ${native.sessionCwd}`);
    assertNoUnlistedDivergence(native.prompt ?? '', native.sessionCwd);
  });

  it('declares the intentional divergences rather than letting them drift', () => {
    expect(LEGACY_ONLY_JOB_REUSE_VARIABLES).toEqual(['reused_from_job_id', 'worktree_owner_job_id', 'gitnexus_summary']);
    expect(LEGACY_ONLY_INPUTS).toEqual(['--var variables', 'fallbackPrompt']);
  });
});

describe('reviewer diff context parity (SPECIALISTS-8)', () => {
  it('appends the reviewer diff context on the native path too', async () => {
    const root = workspace();
    const run = (command: string) => execSync(command, { cwd: root, stdio: 'pipe' });
    run('git init -q');
    run('git config user.email t@t.t && git config user.name t');
    writeFileSync(join(root, 'reviewed.txt'), 'one\n');
    run('git add reviewed.txt && git commit -qm initial');
    writeFileSync(join(root, 'reviewed.txt'), 'one\ntwo\n');

    const native = await nativeAssembly(root, { specialistName: 'reviewer' });
    expect(native.prompt).toContain('## Reviewer Diff Context');
    expect(native.prompt).toContain('reviewed.txt');
    // The reviewer's execution-only context must land before the prompt hash, so the same
    // git state must also produce it on the legacy side.
    expect(legacyAssembly(root, { specialistName: 'reviewer' }, { reviewer: true }).initialPrompt)
      .toContain('## Reviewer Diff Context');
  });
});

describe('validation parity (SPECIALISTS-8)', () => {
  it('validateBeforeRun accepts the same fixture the parity test dispatches', () => {
    const root = workspace();
    const spec = definition(root, { withSkills: true, permission: 'HIGH' });
    const toolContract = resolveRuntimeToolContract({ level: 'HIGH', specialistName: 'parity-probe', cwd: process.cwd() });
    expect(() => validateBeforeRun(spec as never, 'HIGH', toolContract)).not.toThrow();
  });
});
