// tests/unit/specialist/execution-profile-parity.test.ts
//
// SPECIALISTS-55. Native-vs-legacy parity was restored gap by gap (skills, isolation, output
// schema, pre-scripts, extensions, blocker context, reviewer diff), and SPECIALISTS-8 pinned each
// gap with its own test. Nothing compared the WHOLE envelope, so a field added to one path and not
// the other stayed invisible: the two sides returned different key sets, and only the aspects
// somebody thought to write an assertion for were ever compared.
//
// This file compiles ONE profile shape from each runtime and compares the whole record, so a field
// that exists on one side only fails by construction rather than by somebody noticing.
//
// The native side is captured from the REAL host through a recording SDK double — what it actually
// passes to `createAgentSession` and what it actually prompts the child with. The legacy side is
// recomputed with the same exported composition functions the legacy call sites use, because
// running the legacy path needs a real `pi` subprocess and this suite forbids one.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';

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

import {
  NativeActivationHost,
  contractToMarkdown,
  type ActivationForensicSink,
} from '../../../src/activation/native-host.js';
import { ASK_TOOL, ESCALATE_TOOL } from '../../../src/activation/ask-tool.js';
import { deriveSkillName, renderTaskPrompt } from '../../../src/specialist/task-prompt.js';
import { buildSystemPrompt, buildOutputContractInstruction } from '../../../src/specialist/system-prompt.js';
import { resolveOutputContractSchema } from '../../../src/specialist/runner.js';
import { resolveSkillPath } from '../../../src/specialist/project-pack-skill-resolver.js';
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
 * THE profile. Both compilers must return exactly these keys.
 *
 * This list is the structural guarantee: a field added to one runtime's assembly has to be added
 * here and produced by BOTH compilers, or the key-set assertion fails. That is what makes "a new
 * field silently drifts" impossible instead of merely unlikely.
 */
const PROFILE_KEYS = [
  'ambientDiscovery',
  'contextInputs',
  'customTools',
  'cwd',
  'extensions',
  'model',
  'outputContract',
  'scripts',
  'skillPrefix',
  'skills',
  'thinking',
  'tools',
] as const;

type ProfileKey = (typeof PROFILE_KEYS)[number];

interface ExecutionProfile {
  /** Skill NAMES the session can load. */
  skills: string[];
  /** False = ambient skills/extensions/context files are fenced. */
  ambientDiscovery: boolean;
  /** Skill names the turn-1 `/skill:` prefix names, in order. */
  skillPrefix: string[];
  /** The tool allowlist the session is given, sorted. */
  tools: string[];
  /** Tools registered by the host rather than granted by the contract, sorted. */
  customTools: string[];
  /** Extension sources the session loads, sorted. */
  extensions: string[];
  /** Declared script phases. */
  scripts: Array<{ phase: string; injectOutput: boolean }>;
  /** The rendered output-contract instruction. */
  outputContract: string;
  /** Which context blocks the turn-1 prompt carries. */
  contextInputs: string[];
  model: string | null;
  thinking: string | null;
  cwd: string;
}

/**
 * Divergences that are intended, each with its reason.
 *
 * Everything else must match. An unlisted difference is a failure, and the failure names the field
 * so the reader sees which side moved.
 */
const INTENTIONAL_DIVERGENCES: Partial<Record<ProfileKey, string>> = {
  customTools: 'native registers ask_coordinator and escalate_to_coordinator: its only interaction transport, where legacy uses the CLI job protocol',
  tools: 'the two ask tools appear in the native allowlist too, because pi applies `tools` as a hard filter over customTools as well',
  extensions: 'native injects the curated set in-process through a resource loader; legacy passes the same paths as `-e` argv, so the sources match but the carriage differs',
};

function assertProfileShape(profile: ExecutionProfile, side: string): void {
  expect(Object.keys(profile).sort(), `${side} profile keys`).toEqual([...PROFILE_KEYS].sort());
}

/** Field-by-field diff, so a failure names the field rather than dumping two objects. */
function diffProfiles(native: ExecutionProfile, legacy: ExecutionProfile): string[] {
  assertProfileShape(native, 'native');
  assertProfileShape(legacy, 'legacy');
  const differences: string[] = [];
  for (const key of PROFILE_KEYS) {
    if (INTENTIONAL_DIVERGENCES[key]) continue;
    const left = JSON.stringify(native[key]);
    const right = JSON.stringify(legacy[key]);
    if (left !== right) differences.push(`${key}\n    native: ${left}\n    legacy: ${right}`);
  }
  return differences;
}

// ---------------------------------------------------------------- fixtures

const workspaces: string[] = [];
function workspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'profile-parity-'));
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
  properties: { summary: { type: 'string' } },
  required: ['summary'],
};

const BLOCKERS = [{ ref: 'ISSUE-BLOCKER', title: 'The dependency', description: 'PROBLEM: earlier work' }];

/**
 * Every shipped specialist configures NO model - the caller's dispatch supplies it - so the sweep
 * injects one deterministically instead of excluding 24 of 24 fixtures and comparing nothing.
 */
const MODEL_OVERRIDE = 'testprov/test-model';

interface ProbeOptions {
  permission?: string;
  responseFormat?: string;
  outputType?: string;
  withSchema?: boolean;
  withSkills?: boolean;
}

function definition(root: string, opts: ProbeOptions) {
  const skillPaths = opts.withSkills ? skillDirs(root, ['gitnexus', 'engineering-quality']) : [];
  return {
    specialist: {
      metadata: { name: 'parity-probe', version: '1.0.0', description: 'd', category: 'c' },
      execution: {
        model: 'testprov/test-model',
        permission_required: opts.permission ?? 'LOW',
        response_format: opts.responseFormat ?? 'markdown',
        output_type: opts.outputType ?? 'analysis',
        bare: false,
        ...(opts.permission === 'HIGH' ? { extensions: { [PY_KERNEL]: true } } : {}),
      },
      prompt: {
        system: 'You are the parity probe.',
        task_template: 'Do: $prompt',
        ...(opts.withSchema ? { output_schema: DECLARED_SCHEMA } : {}),
      },
      skills: { paths: skillPaths, scripts: [] },
    },
  };
}

function recordingSession(): PiAgentSessionLike & { prompts: string[] } {
  const listeners: Array<(e: PiAgentSessionEvent) => void> = [];
  const session = {
    sessionId: 'pi-profile-parity',
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
  return session as unknown as PiAgentSessionLike & { prompts: string[] };
}

function sdkFor(record: { createArgs?: Record<string, unknown> }, session: PiAgentSessionLike): PiSdk {
  return {
    createAgentSession: async (options?: Record<string, unknown>) => {
      record.createArgs = options;
      // Model pi's HARD FILTER faithfully: the session exposes exactly the tools it was named.
      if (Array.isArray(options?.tools)) session.setActiveToolsByName(options.tools as string[]);
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

function forensics(): ActivationForensicSink {
  return { emit: () => {} };
}

/** Which context blocks the prompt carries — presence, not text, so wording changes do not fail it. */
/**
 * The skill names a `/skill:` prefix names, in order.
 *
 * Normalised to names on BOTH sides: the native path carries the prefix inside the rendered prompt
 * and the legacy path carries it as a rendered string, and comparing those two shapes directly
 * would report a difference that is about my compilers rather than about the runtimes.
 */
function skillNamesIn(text: string): string[] {
  return [...text.matchAll(/\/skill:([^\s]+)/g)].map((match) => match[1]!);
}

function contextInputsOf(prompt: string): string[] {
  const blocks: string[] = [];
  if (prompt.includes('## Context from completed dependencies:')) blocks.push('completedBlockers');
  if (prompt.includes('Current cwd:')) blocks.push('cwd');
  if (prompt.includes('## Mandatory Rules')) blocks.push('mandatoryRules');
  if (prompt.includes('## Reviewer Diff Context')) blocks.push('reviewerDiff');
  return blocks.sort();
}

// ---------------------------------------------------------------- native compiler (real capture)

async function compileNativeProfile(
  spec: Record<string, unknown>,
  root: string,
  specialistName: string,
  access: string,
  modelOverride?: string,
): Promise<ExecutionProfile> {
  const record: { createArgs?: Record<string, unknown> } = {};
  const session = recordingSession();
  const host = new NativeActivationHost({
    loader: { get: async () => spec } as never,
    workItems: testWorkItems({ blockers: BLOCKERS }),
    forensics: forensics(),
    loadSdk: async () => sdkFor(record, session),
    cwd: root,
  });
  const handle = await host.start({
    specialist: specialistName,
    issueRef: 'ISSUE-1',
    requestedByParticipantId: 'coordinator',
    // Every shipped specialist configures NO model: the caller's dispatch supplies it. Without an
    // override the native runtime refuses with `no_model_configured`, by design, so the sweep would
    // otherwise compare nothing.
    ...(modelOverride ? { modelOverride } : {}),
  });
  await handle.result;

  const createArgs = record.createArgs!;
  const loader = createArgs.resourceLoader as FakeResourceLoader;
  const options = loader.options as Record<string, unknown>;
  const prompt = session.prompts[0] ?? '';
  const specExecution = (spec as { specialist: { execution: Record<string, unknown> } }).specialist.execution;
  const specSkills = ((spec as { specialist: { skills?: { paths?: string[]; scripts?: Array<{ phase?: string; inject_output?: boolean }> } } })
    .specialist.skills ?? {});

  void access;
  return {
    skills: loader.getSkills().skills.map((s) => s.name).sort(),
    ambientDiscovery: !(
      options.noSkills === true
      && options.noExtensions === true
      && options.noContextFiles === true
      && options.noPromptTemplates === true
      && options.noThemes === true
    ),
    skillPrefix: skillNamesIn(prompt),
    tools: [...((createArgs.tools as string[]) ?? [])].sort(),
    customTools: ((createArgs.customTools as Array<{ name: string }>) ?? []).map((tool) => tool.name).sort(),
    extensions: [...((options.additionalExtensionPaths as string[]) ?? [])].sort(),
    scripts: (specSkills.scripts ?? []).map((script) => ({
      phase: String(script.phase ?? 'pre'),
      injectOutput: Boolean(script.inject_output),
    })),
    outputContract: buildOutputContractInstruction(
      (specExecution.response_format ?? 'text') as never,
      (specExecution.output_type ?? 'custom') as never,
      resolveOutputContractSchema(
        (specExecution.response_format ?? 'text') as never,
        (specExecution.output_type ?? 'custom') as never,
        (spec as { specialist: { prompt: { output_schema?: unknown } } }).specialist.prompt.output_schema,
      ),
    ),
    contextInputs: contextInputsOf(prompt),
    model: (specExecution.model as string | null) ?? modelOverride ?? null,
    thinking: (specExecution.thinking as string | undefined) ?? null,
    cwd: String(createArgs.cwd ?? ''),
  };
}

// ---------------------------------------------------------------- legacy compiler (same helpers)

function compileLegacyProfile(
  spec: Record<string, unknown>,
  root: string,
  specialistName: string,
  modelOverride?: string,
): ExecutionProfile {
  const specialist = (spec as { specialist: Record<string, unknown> }).specialist;
  const execution = specialist.execution as Record<string, unknown>;
  const skills = (specialist.skills ?? {}) as { paths?: string[]; scripts?: Array<{ phase?: string; inject_output?: boolean }> };
  const prompt = specialist.prompt as { system: string; task_template: string; output_schema?: unknown };

  const beadView = testWorkItems({ blockers: BLOCKERS }).view('ISSUE-1');
  const bead = { id: beadView.ref, title: beadView.title, description: contractToMarkdown(beadView.contract) };
  const rendered = renderTaskPrompt({
    specialist: specialist as never,
    cwd: root,
    beadId: bead.id,
    bead,
    completedBlockers: BLOCKERS.map((b) => ({ id: b.ref, title: b.title, description: b.description })),
    worktreeBoundary: root,
  });

  const responseFormat = (execution.response_format ?? 'text') as never;
  const outputType = (execution.output_type ?? 'custom') as never;
  const outputContractSchema = resolveOutputContractSchema(responseFormat, outputType, prompt.output_schema);
  buildSystemPrompt({
    systemPromptTemplate: prompt.system,
    templateVariables: rendered.beadTemplateVariables ?? {},
    bare: Boolean(execution.bare),
    runCwd: root,
    specialistName,
    inputIssueRef: bead.id,
    responseFormat,
    outputType,
    outputContractSchema,
    beadContextText: rendered.beadContextText ?? '',
    readBeadForMemory: () => null,
  });

  const toolContract = resolveRuntimeToolContract({
    level: (execution.permission_required as string) ?? 'READ_ONLY',
    specialistName,
    cwd: process.cwd(),
  })!;
  const curated = resolveCuratedExtensionPaths({
    permissionLevel: (execution.permission_required as string) ?? 'READ_ONLY',
    resolvedToolContract: toolContract,
  });
  const declared = resolveExecutionExtensionSelection(
    execution.extensions as Record<string, boolean | null | undefined> | undefined,
  ).extensionSources.filter((source) => !source.startsWith('npm:'));
  const { kept } = deduplicateExtensionSources(curated.dedupeAgainstDynamic, declared);

  return {
    skills: (skills.paths ?? []).map((path) => deriveSkillName(path)).sort(),
    // Legacy fences by flag rather than by a loader; the RESULT is what is compared.
    ambientDiscovery: false,
    skillPrefix: skillNamesIn(rendered.skillPrefix ?? ''),
    tools: [...toolContract.toolsList].sort(),
    customTools: [],
    extensions: [...curated.all, ...kept].sort(),
    scripts: (skills.scripts ?? []).map((script) => ({
      phase: String(script.phase ?? 'pre'),
      injectOutput: Boolean(script.inject_output),
    })),
    outputContract: buildOutputContractInstruction(responseFormat, outputType, outputContractSchema),
    contextInputs: contextInputsOf(rendered.initial_prompt ?? ''),
    model: (execution.model as string | null) ?? modelOverride ?? null,
    thinking: (execution.thinking as string | undefined) ?? null,
    cwd: root,
  };
}

// ---------------------------------------------------------------- the tests

describe('execution profile parity (SPECIALISTS-55)', () => {
  for (const tier of ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH']) {
    it(`native and legacy compile the same profile at ${tier}`, async () => {
      const root = workspace();
      const spec = definition(root, { permission: tier, withSkills: true, withSchema: true });
      const native = await compileNativeProfile(spec, root, 'parity-probe', tier);
      const legacy = compileLegacyProfile(spec, root, 'parity-probe');
      expect(diffProfiles(native, legacy)).toEqual([]);
    });
  }

  it('is sensitive: dropping a parity fix shows up as a named field difference', async () => {
    // The issue's own validation: "removing any one parity fix fails the test". Removing the
    // declared skills from the native side must produce a diff that NAMES skills, not a generic
    // inequality — a comparison that cannot say which field moved is not worth having.
    const root = workspace();
    const spec = definition(root, { permission: 'LOW', withSkills: true });
    const native = await compileNativeProfile(spec, root, 'parity-probe', 'LOW');
    const legacy = compileLegacyProfile(spec, root, 'parity-probe');

    const dropped: ExecutionProfile = { ...native, skills: [] };
    const differences = diffProfiles(dropped, legacy);
    // Reported by name, not as one opaque inequality. (Only `skills` moves here because the prefix
    // is read from the prompt, which this mutation deliberately leaves alone.)
    expect(differences).toHaveLength(1);
    expect(differences[0]).toContain('skills');
  });

  it('fails on a field that exists on one side only, which is the drift this exists to catch', async () => {
    const root = workspace();
    const spec = definition(root, { permission: 'LOW' });
    const native = await compileNativeProfile(spec, root, 'parity-probe', 'LOW');
    const legacy = compileLegacyProfile(spec, root, 'parity-probe');

    const withExtra = { ...native, somethingNew: 'added to the native path only' } as unknown as ExecutionProfile;
    expect(() => diffProfiles(withExtra, legacy)).toThrow(/profile keys/);
  });

  const shippedDir = join(process.cwd(), 'config', 'specialists');
  const shipped = readdirSync(shippedDir).filter((file) => file.endsWith('.specialist.json')).sort();

  /**
   * Specialists whose declared pre-scripts EXECUTE external commands, so dispatching them in the
   * default suite would run real tooling in a temp directory. They are compared on their declared
   * envelope only, and listed here rather than silently skipped: an unexplained exclusion is the
   * same invisibility this file exists to remove.
   */
  /**
   * Why a shipped specialist is compared on its declared envelope only.
   *
   * Derived from the spec rather than listed by name: a hand-written name list goes stale the moment
   * a specialist gains a script, and a stale exclusion is a silent hole in the sweep.
   */
  function dispatchExclusion(spec: Record<string, unknown>): string | null {
    const scripts = ((spec as { specialist: { skills?: { scripts?: unknown[] } } }).specialist.skills?.scripts ?? []);
    if (scripts.length > 0) {
      return 'declares scripts that execute external tooling; dispatching them in the default suite would run it';
    }
    return null;
  }

  it('every shipped specialist compiles to one profile shape on both paths', async () => {
    expect(shipped.length).toBeGreaterThan(0);
    // No extensions installed: the sweep must not depend on which ones this machine happens to have.
    // With a healthy gitnexus present the policy hard-denies grep/find/ls, and a specialist that
    // declares them in `capabilities.required_tools` then fails preflight — a real defect, filed
    // separately, but not something the PROFILE comparison should be measuring on one machine only.
    // Prerequisites a shipped specialist declares but a bare runner lacks: the canonical global
    // skills (~/.xtrm/skills/default/<name>) and the external commands on PATH. Provision both from
    // the specs rather than skipping the specialists, so the sweep runs identically here and on CI.
    // Fabricating TEST prerequisites is not a behaviour change - sp-serve.test.ts already puts a
    // fake `pi` on PATH the same way.
    const stubSkillsRoot = mkdtempSync(join(tmpdir(), 'profile-parity-skills-'));
    const previousPath = process.env.PATH;
    const previousGlobalDir = process.env.PI_NPM_GLOBAL_DIR;
    const emptyGlobalDir = mkdtempSync(join(tmpdir(), 'profile-parity-npm-global-'));
    process.env.PI_NPM_GLOBAL_DIR = emptyGlobalDir;

    /**
     * Give every declared skill a real directory and every declared command a stub on PATH.
     *
     * Some shipped specialists declare skills that live outside this repo - a canonical global skill
     * under `~/.xtrm/skills/default/`, or a `~/`-anchored path - which exist on a developer machine
     * and not on a bare runner. Redirecting HOME to fake them broke the `~/`-anchored ones instead,
     * so resolution happens FIRST and only a path that does not exist is materialised under a temp
     * root with the same directory name, which is what the loader derives the skill name from. The
     * spec is rewritten in place, so both compilers see the same paths.
     */
    function provision(spec: Record<string, unknown>): void {
      const specialist = (spec as { specialist: { skills?: { paths?: string[] }; capabilities?: { external_commands?: string[] } } }).specialist;
      const declared = specialist.skills?.paths;
      if (declared?.length) {
        specialist.skills!.paths = declared.map((path) => {
          const resolved = resolveSkillPath(path, { consumerRoot: process.cwd(), fileDir: shippedDir });
          if (existsSync(resolved)) return resolved;
          const name = basename(dirname(resolved));
          const materialised = join(stubSkillsRoot, name);
          mkdirSync(materialised, { recursive: true });
          writeFileSync(join(materialised, 'SKILL.md'), `---\nname: ${name}\n---\n\nbody\n`);
          return materialised;
        });
      }
      // `capabilities.external_commands` is DROPPED rather than stubbed. Whether `bd` exists on this
      // host is a property of the host, not of either runtime's composition, so it does not belong in
      // a parity comparison - and it cannot be stubbed from here either: under Bun a child process
      // receives its own PATH (`/tmp/bun-node-*`), so mutating process.env.PATH never reaches the
      // `which` that `commandExists` spawns. Verified by printing the child's PATH, not assumed.
      // Both compilers see the same stripped spec, so the comparison stays symmetric.
      if (specialist.capabilities) delete specialist.capabilities.external_commands;
    }

    try {
    const compared: string[] = [];
    const declaredOnly: string[] = [];

    for (const file of shipped) {
        const spec = JSON.parse(readFileSync(join(shippedDir, file), 'utf8')) as Record<string, unknown>;
        const name = (spec as { specialist: { metadata: { name: string } } }).specialist.metadata.name;
        const tier = ((spec as { specialist: { execution: Record<string, unknown> } }).specialist.execution.permission_required as string) ?? 'READ_ONLY';
        const root = workspace();

      provision(spec);
      // Mirror the loader's own skill resolution (loader.ts `resolveSkillsPaths`) instead of letting
      // a bare logical name resolve cwd-relative: `validateBeforeRun` hard-fails a skill path that
      // does not exist, and the shipped configs declare names like `using-specialists` that only
      // resolve through the canonical global root. Reusing the existing seam, not a new one.
        const declaredSkills = (spec as { specialist: { skills?: { paths?: string[] } } }).specialist.skills;
        if (declaredSkills?.paths?.length) {
          declaredSkills.paths = declaredSkills.paths.map((declared) =>
            resolveSkillPath(declared, { consumerRoot: process.cwd(), fileDir: shippedDir }),
          );
        }

        const excluded = dispatchExclusion(spec);
        const legacy = compileLegacyProfile(spec, root, name, MODEL_OVERRIDE);
        assertProfileShape(legacy, `legacy/${name}`);
        if (excluded) {
        // Still shape-checked above; only the dispatch half is skipped, and it is named below.
          declaredOnly.push(`${name} (${excluded})`);
          continue;
        }

        const native = await compileNativeProfile(spec, root, name, tier, MODEL_OVERRIDE);
        const differences = diffProfiles(native, legacy);
        expect(differences, `${name} profile differences:\n  ${differences.join('\n  ')}`).toEqual([]);
        compared.push(name);
    }

      // The sweep must actually sweep, and it must account for every file: a run where everything was
      // skipped would pass vacuously, and an exclusion nobody recorded is the invisibility this file
      // exists to remove.
      expect(compared.length + declaredOnly.length).toBe(shipped.length);
      expect(compared.length).toBeGreaterThan(15);
    } finally {
      if (previousGlobalDir === undefined) delete process.env.PI_NPM_GLOBAL_DIR;
      else process.env.PI_NPM_GLOBAL_DIR = previousGlobalDir;
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(emptyGlobalDir, { recursive: true, force: true });
      rmSync(stubSkillsRoot, { recursive: true, force: true });
    }
  });
});
