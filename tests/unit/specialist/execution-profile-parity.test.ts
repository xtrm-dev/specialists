// tests/unit/specialist/execution-profile-parity.test.ts
//
// SPECIALISTS-55 (one execution profile shape, compared field by field) and XTRM-84 (the
// decision on what "compared field" means, how far the field list is CHECKED against the contract
// (a reviewed copy, not a live read — see CONTRACT_CONSTRAINTS_QUOTE_AT_REV2), and
// how reviewer evidence and admission are handled).
//
// Native-vs-legacy parity was restored gap by gap (skills, isolation, output schema,
// pre-scripts, extensions, blocker context, reviewer diff), and SPECIALISTS-8 pinned each
// gap with its own test. Nothing compared the WHOLE envelope, so a field added to one path
// and not the other stayed invisible: the two sides returned different key sets, and only
// the aspects somebody thought to write an assertion for were ever compared.
//
// This file compiles ONE profile shape from each runtime and compares the whole record.
//
// ---------------------------------------------------------------------------------------
// What the harness reads, per key. The point of this table is that the two sides read
// DIFFERENT sources, so a runtime change moves exactly one of them (XTRM-84 section 5: a
// key computed by the same expression from the same spec on both sides cannot detect drift).
//
//   key                     native reads                              legacy reads
//   ----------------------  ----------------------------------------  -------------------------------
//   skills                  the resource loader's resolved skills      deriveSkillName(spec paths)
//   skillPrefix             the turn-1 prompt the host sent           the renderer's skillPrefix
//   resources               the loader options the host constructed   the argv fragments start() passes
//   tools                   the createAgentSession hard filter        resolveRuntimeToolContract(...)
//   customTools             the tools the host registered            the legacy path registers none
//   declaredRequiredTools   spec.capabilities.required_tools         spec.capabilities.required_tools
//   extensions              loader additionalExtensionPaths          curated + deduped -e sources
//   scripts                 spec.skills.scripts                      spec.skills.scripts
//   outputContractSchema    the system prompt the host created       buildSystemPrompt(...).text
//   contextInputs           the turn-1 prompt the host sent           the renderer's initial_prompt
//   model / thinking        the model/thinking the SDK was given      the values the argv carries
//   builtinToolsFenced      `noTools: 'builtin'` on the session        `--tools` / the policy gate
//   reviewerEvidence        the reviewer hook's output in the prompt the same hook's output
//   cwd                     the workspace the session was created in  the run cwd
//
// `declaredRequiredTools` and `scripts` are INPUT parity by construction: both runtimes
// consume the same spec field. They are compared anyway because the contract names them, and
// because a compiler that stopped reading the field would move.
//
// RESIDUALS, stated rather than hidden. Two reviewers audited this file; both are real.
//
// 1. The legacy side is a RECONSTRUCTION from the same production helpers the legacy call site
//    uses (resolveExecutionExtensionSelection, resolveRuntimeToolContract,
//    resolveCuratedExtensionPaths, deduplicateExtensionSources, sessionResourceFenceArgv,
//    renderTaskPrompt, buildSystemPrompt, createReviewerDiffAppendHook) rather than a captured
//    argv, because running the legacy path needs a real `pi` subprocess and this suite forbids
//    one. A helper the legacy call site stops calling is therefore not caught here; it is caught
//    by the argv assertions in tests/unit/pi/session.test.ts.
// 2. The legacy compiler does not model the runner's two OVERRIDE seams: `runner.ts:1101` passes
//    `options.autonomyLevel ?? execution.permission_required` (which may be undefined, and then
//    there is no contract at all) and `runner.ts:1103` passes
//    `options.specialistPermissions ?? spec.specialist.permissions`. The harness passes the spec
//    field only. Neither override has a native counterpart, so they are not parity dimensions —
//    but a regression in the runner's own override plumbing is invisible to this file.
// 3. Cross-runtime equality cannot see a change made to BOTH sides. Where a dimension has a cheap
//    absolute value, the test below pins it (`resources`, `outputContractSchema`, `skills`,
//    `contextInputs`, ...); the rest rely on the two sides being independently sourced.
// ---------------------------------------------------------------------------------------
import { describe, it, expect, vi, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  isNonLocalExtensionSource,
  type ActivationForensicSink,
} from '../../../src/activation/native-host.js';
import { ASK_TOOL, ESCALATE_TOOL } from '../../../src/activation/ask-tool.js';
import { GUARDED_TOOL_NAMES } from '../../../src/activation/guarded-tools.js';

/**
 * Every `createAgentSession` option the native host sets, mapped to the profile key(s) that
 * carry it. The parity sweep asserts the host sets nothing that is absent from this map.
 */
const SESSION_OPTION_TO_PROFILE_KEY: Record<string, readonly string[]> = {
  resourceLoader: ['skills', 'resources', 'extensions'],
  model: ['model'],
  customTools: ['customTools'],
  tools: ['tools'],
  systemPrompt: ['outputContractSchema'],
  cwd: ['cwd'],
  thinkingLevel: ['thinking'],
  noTools: ['builtinToolsFenced'],
};
import { deriveSkillName, renderTaskPrompt } from '../../../src/specialist/task-prompt.js';
import { buildSystemPrompt } from '../../../src/specialist/system-prompt.js';
import { resolveOutputContractSchema, createReviewerDiffAppendHook } from '../../../src/specialist/runner.js';
import { resolveSkillPath } from '../../../src/specialist/project-pack-skill-resolver.js';
import {
  deduplicateExtensionSources,
  parseSessionResourceFence,
  resolveCuratedExtensionPaths,
  resolveExecutionExtensionSelection,
  resolveRuntimeToolContract,
  sessionResourceFenceArgv,
} from '../../../src/pi/session.js';
import type { PiAgentSessionEvent, PiAgentSessionLike, PiSdk } from '../../../src/activation/pi-sdk.js';
import type { JsonSchema } from '../../../src/specialist/system-prompt.js';
import { FAKE_AGENT_DIR, FakeResourceLoader } from '../../utils/pi-resource-loader-double.js';
import { testWorkItems } from '../../utils/test-work-items.js';

// ------------------------------------------------------------------ the contract block

/**
 * The SPECIALISTS-55 contract, quoted VERBATIM from the issue's `## constraints` section.
 *
 * PROVENANCE: SPECIALISTS-55, revision 2. Recorded because this is a COPY, not a live read, and a
 * copy needs a revision to be attributable. If the contract text moves, `sb issue show SPECIALISTS-55`
 * will show a different revision against this one, and the reviewer can see that the quote below
 * predates it — which is the most a copy can honestly offer.
 *
 * NOT A MECHANICAL TIE, and it must not be described as one. Nothing here reads the contract. An
 * earlier version of this file shelled out to `sb issue show` and swallowed EVERY failure — no CLI,
 * wrong board, issue not found — so on CI it asserted nothing while looking authoritative; that guard
 * was deleted rather than repaired. Coordinated drift (edit the quote, the dimension map and both
 * compilers together) still passes. Only the DECLARED tie is machine-checked.
 *
 * XTRM-84 decision 4a: the compared-field list must be DERIVED FROM the contract rather than from a
 * constant somebody typed next to the code — symmetry between the two compilers cannot see a
 * dimension BOTH sides silently omit, which is exactly how `resources` went missing.
 *
 * The issue text is the only statement of the contract that exists, and it lives in the Substrate
 * store, which a unit test cannot read. So it is quoted here, byte for byte, INCLUDING the
 * markdown bullet, so a reader can diff these lines against `sb issue show SPECIALISTS-55` and
 * see that nothing was paraphrased to fit the implementation. That auditability is the entire
 * value of quoting rather than summarising: a summary is a second contract, and a second
 * contract is exactly how the original defect happened.
 *
 * HOW THIS QUOTE IS VERIFIED: by review, against `sb issue show SPECIALISTS-55` (or the Substrate
 * store's equivalent). There is deliberately no automated check. An earlier version shelled out to
 * `sb` and swallowed EVERY failure — no CLI, wrong board, issue not found — so on CI it asserted
 * nothing while looking like a mechanical tie. A guard that fails open is worse than an honest
 * "verified by review": it manufactures the assurance this whole mechanism exists to provide.
 * The quote is kept byte-for-byte, INCLUDING the markdown bullet, so the review is a diff and not
 * a judgement call.
 */
const CONTRACT_CONSTRAINTS_QUOTE_AT_REV2 = [
  '- Compared fields: skills, tools, extensions, scripts, output contract, resources, context inputs, model/thinking, reviewer evidence',
  '- Allowlisted differences only: process topology, lifetime semantics, workspace strategy, interaction transport; each allowlist entry carries a reason',
];

/** `output contract` -> `outputContract`, `model/thinking` -> `modelThinking`, ... */
function toDimensionName(field: string): string {
  const [first, ...rest] = field.trim().split(/[\s/]+/);
  return [first, ...rest.map((part) => part.charAt(0).toUpperCase() + part.slice(1))].join('');
}

/** The dimensions the contract's compared-fields constraint names. */
function contractDimensions(): string[] {
  const line = CONTRACT_CONSTRAINTS_QUOTE_AT_REV2.find((entry) => entry.includes('Compared fields:'));
  const list = (line ?? '').replace(/^-\s*Compared fields:\s*/, '').trim();
  // Trailing punctuation is stripped so the quote can stay verbatim even if the contract gains it.
  return list.replace(/[.;]\s*$/, '').split(',').map((entry) => toDimensionName(entry)).sort();
}

/** The divergence categories the contract PERMITS. A divergence outside this set is not allowed. */
function contractDivergenceCategories(): string[] {
  const line = CONTRACT_CONSTRAINTS_QUOTE_AT_REV2.find((entry) => entry.includes('Allowlisted differences only:'));
  const list = (line ?? '').replace(/^-\s*Allowlisted differences only:\s*/, '');
  return list.split(';')[0]!.split(',').map((entry) => entry.trim()).filter(Boolean).sort();
}

/**
 * The contract, as the comparison dimensions it names, each mapped to the profile keys that
 * carry it. `satisfies` makes a key that is not a profile field a compile error.
 */
const CONTRACT_DIMENSIONS = {
  skills: ['skills', 'skillPrefix'],
  tools: ['tools', 'customTools', 'declaredRequiredTools', 'builtinToolsFenced'],
  extensions: ['extensions'],
  scripts: ['scripts'],
  outputContract: ['outputContractSchema'],
  resources: ['resources'],
  contextInputs: ['contextInputs'],
  modelThinking: ['model', 'thinking'],  reviewerEvidence: ['reviewerEvidence'],
} as const;

/**
 * Dimensions the harness compares that the contract does NOT name.
 *
 * XTRM-84 question 4: the contract's field list is a MINIMUM SET, not a closed one. A
 * comparison the harness adds beyond the contract is a DECISION, so it is declared here
 * rather than appearing as an unnamed extra key.
 */
const BEYOND_CONTRACT_DIMENSIONS = {
  workspace: ['cwd'],
} as const;

interface ExecutionProfile {
  /** Skill NAMES the session can load. */
  skills: string[];
  /** Skill names the turn-1 `/skill:` prefix names, in order. */
  skillPrefix: string[];
  /**
   * Which of the five Pi discovery fences the runtime disables. XTRM-84 decision A: the
   * contract's `resources` is this, not the collapsed `ambientDiscovery` boolean that stood
   * here before — see `ResourceFence`.
   */
  resources: ResourceFence;
  /** The tool allowlist the session is given, sorted. */
  tools: string[];
  /** Tools registered by the host rather than granted by the contract, sorted. */
  customTools: string[];
  /** `capabilities.required_tools` as declared. */
  declaredRequiredTools: string[];
  /** Extension sources the session loads, sorted. */
  extensions: string[];
  /** Declared script phases. */
  scripts: Array<{ phase: string; injectOutput: boolean }>;
  /** The output-contract block, read back out of the system prompt the runtime produced. */
  outputContractSchema: string;
  /** Which context blocks the turn-1 prompt carries. */
  contextInputs: string[];
  model: string | null;
  thinking: string | null;
  /** True when the runtime admits only the contract's tools, never pi's builtin defaults. */
  builtinToolsFenced: boolean;
  /** The reviewer role's execution-only diff block, read back out of the turn-1 prompt. */
  reviewerEvidence: string | null;
  cwd: string;
}

interface ResourceFence {
  noSkills: boolean;
  noExtensions: boolean;
  noContextFiles: boolean;
  noPromptTemplates: boolean;
  noThemes: boolean;
}

type ProfileKey = keyof ExecutionProfile;
type ContractMappedKey = (typeof CONTRACT_DIMENSIONS)[keyof typeof CONTRACT_DIMENSIONS][number];
type BeyondContractMappedKey = (typeof BEYOND_CONTRACT_DIMENSIONS)[keyof typeof BEYOND_CONTRACT_DIMENSIONS][number];
type MappedKey = ContractMappedKey | BeyondContractMappedKey;
type UnmappedProfileKeys = Exclude<ProfileKey, MappedKey>;

/**
 * Compile-time coverage assertion.
 *
 * Adding a field to `ExecutionProfile` without mapping it to a contract dimension (or to a
 * declared beyond-contract dimension) fails to compile HERE, and the error text names the
 * field under `UNMAPPED_PROFILE_KEYS`. This is the detector XTRM-84 4a asks for: symmetry
 * between the two compilers cannot see a key that BOTH sides silently omit.
 */
const _everyProfileKeyIsMapped: UnmappedProfileKeys extends never
  ? true
  : { UNMAPPED_PROFILE_KEYS: UnmappedProfileKeys } = true;
void _everyProfileKeyIsMapped;

/** Every profile key, derived from the dimension map rather than typed out again. */
const PROFILE_KEYS: ProfileKey[] = Array.from(new Set<string>([
  ...(Object.values(CONTRACT_DIMENSIONS) as unknown as string[][]).flat(),
  ...(Object.values(BEYOND_CONTRACT_DIMENSIONS) as unknown as string[][]).flat(),
])) as ProfileKey[];

/** Contract dimension -> the profile keys that carry it. `undefined` means unmapped. */
function dimensionOf(key: ProfileKey): string | undefined {
  for (const [dimension, keys] of Object.entries(CONTRACT_DIMENSIONS)) {
    if ((keys as readonly string[]).includes(key)) return dimension;
  }
  for (const [dimension, keys] of Object.entries(BEYOND_CONTRACT_DIMENSIONS)) {
    if ((keys as readonly string[]).includes(key)) return dimension;
  }
  return undefined;
}

// ------------------------------------------------------- intended, CHECKED divergences

/** The four categories the contract permits an intended difference to belong to. */
type DivergenceCategory =
  | 'process topology'
  | 'lifetime semantics'
  | 'workspace strategy'
  | 'interaction transport';

interface NamedDivergence {
  category: DivergenceCategory;
  reason: string;
  /**
   * True when the two sides are the SHAPE this divergence claims.
   *
   * Receives the WHOLE profiles, not the single field, because the shape of one field is
   * defined in terms of another (`customTools` is the guarded subset of `tools`).
   *
   * Not a skip. The previous version `continue`d past an allowlisted field, so `tools` and
   * `extensions` were never compared at all and a real divergence in them (SPECIALISTS-57:
   * the native path dropping the definition's extension exclusions) survived a green run.
   */
  holds: (native: ExecutionProfile, legacy: ExecutionProfile) => boolean;
}

function sortedEqual(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify([...left].sort()) === JSON.stringify([...right].sort());
}

const ASK_TOOLS = [ASK_TOOL, ESCALATE_TOOL];

const INTENTIONAL_DIVERGENCES: Partial<Record<ProfileKey, NamedDivergence>> = {
  customTools: {
    category: 'workspace strategy',
    reason: 'native RECONSTRUCTS the reconstructible mutating builtins as custom tools so every mutating call consults the workspace lease (guarded-tools.ts); legacy forwards the same names as plain builtins and gates them in the CLI',
    // Checked shape, not a skip: native registers exactly the two ask tools plus one guarded
    // replacement per reconstructible mutating tool its OWN allowlist carries, and legacy
    // registers none. A guard that stopped reconstructing `bash` fails here.
    holds: (native, legacy) => sortedEqual(
      native.customTools,
      [...ASK_TOOLS, ...GUARDED_TOOL_NAMES.filter((name) => native.tools.includes(name))],
    ) && legacy.customTools.length === 0,
  },
  tools: {
    category: 'interaction transport',
    reason: 'the two ask tools appear in the native allowlist too, because pi applies `tools` as a hard filter over customTools as well; everything else must be identical',
    holds: (native, legacy) =>
      ASK_TOOLS.every((tool) => native.tools.includes(tool))
      && sortedEqual(native.tools.filter((tool) => !ASK_TOOLS.includes(tool)), legacy.tools),
  },
  extensions: {
    category: 'process topology',
    reason: 'the in-process resource loader takes filesystem paths only; the legacy CLI also forwards npm:/git:/http: specs for pi itself to resolve',
    holds: (native, legacy) => sortedEqual(
      native.extensions,
      legacy.extensions.filter((source) => !isNonLocalExtensionSource(source)),
    ),
  },
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
    const divergence = INTENTIONAL_DIVERGENCES[key];
    if (divergence) {
      if (!divergence.holds(native, legacy)) {
        differences.push(
          `${key} (declared divergence is "${divergence.category}" — ${divergence.reason})\n`
          + `    native: ${JSON.stringify(native[key])}\n    legacy: ${JSON.stringify(legacy[key])}`,
        );
      }
      continue;
    }
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

/** A workspace with a real uncommitted diff, so the reviewer hook has patch context. */
function workspaceWithDiff(): string {
  const root = workspace();
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  };
  writeFileSync(join(root, 'target.txt'), 'before\n');
  git('init', '--quiet');
  git('-c', 'user.email=parity@test', '-c', 'user.name=parity', 'add', 'target.txt');
  git('-c', 'user.email=parity@test', '-c', 'user.name=parity', 'commit', '--quiet', '-m', 'base');
  writeFileSync(join(root, 'target.txt'), 'after\n');
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
  name?: string;
  permission?: string;
  responseFormat?: string;
  outputType?: string;
  withSchema?: boolean;
  withSkills?: boolean;
  withScript?: boolean;
  requiredTools?: string[];
  gitnexus?: false;
}

function definition(root: string, opts: ProbeOptions) {
  const skillPaths = opts.withSkills ? skillDirs(root, ['gitnexus', 'engineering-quality']) : [];
  const execution: Record<string, unknown> = {
    model: 'testprov/test-model',
    permission_required: opts.permission ?? 'LOW',
    response_format: opts.responseFormat ?? 'markdown',
    output_type: opts.outputType ?? 'analysis',
    bare: false,
    ...(opts.permission === 'HIGH' || opts.gitnexus === false
      ? { extensions: { ...(opts.permission === 'HIGH' ? { [PY_KERNEL]: true } : {}), ...(opts.gitnexus === false ? { gitnexus: false } : {}) } }
      : {}),
  };
  return {
    specialist: {
      metadata: { name: opts.name ?? 'parity-probe', version: '1.0.0', description: 'd', category: 'c' },
      execution,
      prompt: {
        system: 'You are the parity probe.',
        task_template: 'Do: $prompt',
        ...(opts.withSchema ? { output_schema: DECLARED_SCHEMA } : {}),
      },
      skills: {
        paths: skillPaths,
        // A shell-builtin no-op, not real tooling. The shipped sweep refuses to DISPATCH specialists
        // whose scripts run real tooling (dispatchExclusion below); `true` exists only so this
        // dimension is not compared as `[]` against `[]`, which is how it was dead before.
        scripts: opts.withScript ? [{ run: 'true', phase: 'pre', inject_output: false }] : [],
      },
      ...(opts.requiredTools ? { capabilities: { required_tools: opts.requiredTools } } : {}),
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

/** The skill names a `/skill:` prefix names, in order. */
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

/**
 * The output-contract block, read back out of the system prompt the runtime produced.
 *
 * `buildSystemPrompt` appends it last, so "from the heading to the end" is exact. Reading it
 * back is the difference between a comparison that can detect the regression the header of
 * this file names (the native path once hardcoded an undefined output schema) and one that
 * recomputes the schema from the same spec on both sides and therefore cannot.
 */
function outputContractOf(systemPrompt: string): string {
  const at = systemPrompt.indexOf('## Output Contract');
  return at === -1 ? '' : systemPrompt.slice(at);
}

const REVIEWER_BLOCK_START = '## Reviewer Diff Context';
function reviewerEvidenceOf(prompt: string): string | null {
  const at = prompt.indexOf(REVIEWER_BLOCK_START);
  return at === -1 ? null : prompt.slice(at);
}

// ---------------------------------------------------------------- native compiler (real capture)

async function compileNativeProfile(
  spec: Record<string, unknown>,
  root: string,
  specialistName: string,
  modelOverride?: string,
): Promise<{ profile: ExecutionProfile; sessionOptions: Record<string, unknown> }> {
  const record: { createArgs?: Record<string, unknown> } = {};
  const session = recordingSession();
  const host = new NativeActivationHost({
    loader: { get: async () => spec } as never,
    workItems: testWorkItems({ blockers: BLOCKERS }),
    forensics: forensics(),
    loadSdk: async () => sdkFor(record, session),
    cwd: root,
    // XTRM-84 4c: COMPOSITION is measured here; ADMISSION is not. The default is the real
    // `validateBeforeRun`, and it is replaced ONLY in this harness — never in production —
    // because a validator whose verdict depends on which binaries the host has on PATH is a
    // property of the host, not of either runtime's composition. The alternative used before
    // was to delete `capabilities.external_commands` from the shipped definition, which meant
    // the sweep compared a definition no user has.
    admission: () => {},
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
  const specCapabilities = ((spec as { specialist: { capabilities?: { required_tools?: string[] } } })
    .specialist.capabilities ?? {});
  const specSkills = ((spec as { specialist: { skills?: { paths?: string[]; scripts?: Array<{ phase?: string; inject_output?: boolean }> } } })
    .specialist.skills ?? {});
  const systemPrompt = String(createArgs.systemPrompt ?? '');
  const model = createArgs.model as { id?: string; provider?: string } | undefined;

  return {
    sessionOptions: createArgs,
    profile: {
      skills: loader.getSkills().skills.map((s) => s.name).sort(),
      skillPrefix: skillNamesIn(prompt),
      // Read from the loader the host CONSTRUCTED, so removing a fence at the construction site
      // moves this value (XTRM-84 decision A).
      resources: {
        noSkills: options.noSkills === true,
        noExtensions: options.noExtensions === true,
        noContextFiles: options.noContextFiles === true,
        noPromptTemplates: options.noPromptTemplates === true,
        noThemes: options.noThemes === true,
      },
      tools: [...((createArgs.tools as string[]) ?? [])].sort(),
      customTools: ((createArgs.customTools as Array<{ name: string }>) ?? []).map((tool) => tool.name).sort(),
      declaredRequiredTools: [...(specCapabilities.required_tools ?? [])].sort(),
      extensions: [...((options.additionalExtensionPaths as string[]) ?? [])].sort(),
      // `spec` is `{ specialist: {...} }`, so the earlier `spec.skills` was always undefined and
      // this dimension compared `[]` to `[]` in every executed case. The fixture below declares a
      // script so the dimension carries signal. (A real type error, invisible because the repo's
      // `lint` is `tsc --noEmit`, which includes only `src/**`.)
      scripts: (specSkills.scripts ?? []).map((script) => ({
        phase: String(script.phase ?? 'pre'),
        injectOutput: Boolean(script.inject_output),
      })),
      // Read back out of the prompt the host created, never recomputed from the spec.
      outputContractSchema: outputContractOf(systemPrompt),
      contextInputs: contextInputsOf(prompt),
      model: model ? `${model.provider ?? '?'}/${model.id ?? '?'}` : null,
      thinking: ((createArgs.thinkingLevel as string | undefined) ?? null),
      // Fail-closed: the native path always refuses pi's builtin defaults and admits only the
      // contract's tools (noTools: 'builtin', native-host.ts). The legacy path reaches the same
      // guarantee by a different mechanism — `--tools` as a hard filter when nothing is
      // exposed, `--no-builtin-tools` plus the policy gate when extension sources are.
      builtinToolsFenced: createArgs.noTools === 'builtin',
      reviewerEvidence: reviewerEvidenceOf(prompt),
      cwd: String(createArgs.cwd ?? ''),
    },
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
  const prompt = specialist.prompt as { system: string; task_template: string; output_schema?: JsonSchema };
  const capabilities = (specialist.capabilities ?? {}) as { required_tools?: string[] };

  const beadView = testWorkItems({ blockers: BLOCKERS }).view('ISSUE-1');
  const bead = { id: beadView.ref, title: beadView.title, description: contractToMarkdown(beadView.contract) };
  const rendered = renderTaskPrompt({
    specialist: specialist as never,
    cwd: root,
    beadId: bead.id,
    bead,
    completedBlockers: BLOCKERS.map((b) => ({ id: b.ref, title: b.title, description: b.description })),
    worktreeBoundary: root,
    // The legacy runner installs this hook for the reviewer role (runner.ts:1150) and nothing
    // else. Omitting it here is what made XTRM-84 4b's "reviewer evidence" comparison a dead
    // branch: the fixture was not a reviewer AND the hook was missing, so both sides were
    // empty and the diff passed vacuously. Same factory, so the shapes cannot drift.
    appendExecutionContext: specialistName === 'reviewer' ? createReviewerDiffAppendHook(() => {}) : undefined,
  });

  const responseFormat = (execution.response_format ?? 'text') as never;
  const outputType = (execution.output_type ?? 'custom') as never;
  const outputContractSchema = resolveOutputContractSchema(responseFormat, outputType, prompt.output_schema as JsonSchema | undefined);
  const systemPrompt = buildSystemPrompt({
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

  // The SAME inputs the legacy call site passes (runner.ts:1076-1084) and the same inputs the
  // native host now passes, extension exclusions included. Before SPECIALISTS-57 this call
  // omitted them on BOTH sides of the harness, which is why the harness could not see that the
  // native host omitted them too.
  const extensionSelection = resolveExecutionExtensionSelection(
    execution.extensions as Record<string, boolean | null | undefined> | undefined,
  );
  const toolContract = resolveRuntimeToolContract({
    level: (execution.permission_required as string) ?? 'READ_ONLY',
    specialistName,
    // Both inputs the legacy runner passes (runner.ts:1071-1084). `specialistPermissions` was
    // missing here, which the old whole-field `tools` skip hid: obligations-scanner declares
    // `permissions.READ_ONLY.denied_natives_mode: soft`, so without it the harness applied the
    // catalog's HARD default and compared a legacy contract the legacy runtime never builds.
    specialistPermissions: (specialist.permissions ?? undefined) as never,
    excludeExtensions: extensionSelection.excludeExtensions,
    extensionSources: extensionSelection.extensionSources,
    cwd: process.cwd(),
  })!;
  const curated = resolveCuratedExtensionPaths({
    permissionLevel: (execution.permission_required as string) ?? 'READ_ONLY',
    resolvedToolContract: toolContract,
  });
  const { kept } = deduplicateExtensionSources(curated.dedupeAgainstDynamic, extensionSelection.extensionSources);

  return {
    skills: (skills.paths ?? []).map((path) => deriveSkillName(path)).sort(),
    skillPrefix: skillNamesIn(rendered.skillPrefix ?? ''),
    // The argv fragments `start()` really passes, parsed by the shared inverse (XTRM-84 A).
    resources: parseSessionResourceFence([
      ...sessionResourceFenceArgv().head,
      ...sessionResourceFenceArgv().tail,
    ]),
    tools: [...toolContract.toolsList].sort(),
    customTools: [],
    declaredRequiredTools: [...(capabilities.required_tools ?? [])].sort(),
    extensions: [...curated.all, ...kept].sort(),
    scripts: (skills.scripts ?? []).map((script) => ({
      phase: String(script.phase ?? 'pre'),
      injectOutput: Boolean(script.inject_output),
    })),
    outputContractSchema: outputContractOf(systemPrompt.text),
    contextInputs: contextInputsOf(rendered.initial_prompt ?? ''),
    model: (execution.model as string | null) ?? modelOverride ?? null,
      // The specs declare `thinking_level` (schema.ts:45), and the legacy runner passes exactly
      // that to the session (runner.ts:1373 `thinkingLevel: execution.thinking_level`). Reading
      // `execution.thinking` here — a field the schema does not have — made this key a constant
      // null on the legacy side and hid chain-coordinator's real `thinking_level: low`.
      thinking: (execution.thinking_level as string | undefined) ?? null,
    // session.ts:1076: `--tools` whenever the contract has a flag and no extension source is
    // exposed; the policy gate's `--no-builtin-tools` otherwise (applyExtensionToolPolicyGate).
    // Either way pi's builtin defaults are not admitted, which is what native's `noTools` sets.
    builtinToolsFenced: toolContract.exposedExtensionSources.length > 0 || Boolean(toolContract.toolsFlag),
    reviewerEvidence: reviewerEvidenceOf(rendered.initial_prompt ?? ''),
    cwd: root,
  };
}

// ---------------------------------------------------------------- the tests

describe('execution profile parity (SPECIALISTS-55, decisions recorded in XTRM-84)', () => {
  it('checks the mapped dimensions against the quoted contract line, so a required dimension cannot be dropped from the map', () => {
    // XTRM-84 4a. The map is only as good as its provenance: assert that the QUOTED contract line's
    // dimensions are exactly the mapped ones. This catches the map drifting from the quote; it does
    // NOT catch the quote drifting from the issue (see the provenance note above).
    // own sentence names exactly the dimensions the map implements. A dimension the contract
    // requires and the map lacks is a failure here, and so is a map entry the contract does not
    // name (which must be declared in BEYOND_CONTRACT_DIMENSIONS instead).
    expect(Object.keys(CONTRACT_DIMENSIONS).sort()).toEqual(contractDimensions());
  });

  it('maps every compared key to a dimension, and every dimension to at least one key', () => {
    for (const key of PROFILE_KEYS) {
      expect(dimensionOf(key), `profile key ${key} has no contract dimension`).toBeDefined();
    }
    for (const dimension of [...Object.keys(CONTRACT_DIMENSIONS), ...Object.keys(BEYOND_CONTRACT_DIMENSIONS)]) {
      expect(PROFILE_KEYS.some((key) => dimensionOf(key) === dimension), `dimension ${dimension} has no key`).toBe(true);
    }
    // `resources` specifically: XTRM-84 decision A kept it in the contract rather than striking
    // it, so it must be a real compared key and not a declared exclusion.
    expect(PROFILE_KEYS).toContain('resources');
  });

  it('records a category and a reason for every declared divergence, from the contract\'s permitted set', () => {
    // The permitted categories are READ FROM THE CONTRACT, not typed here. The old harness allowed
    // whole FIELD NAMES with no category at all, so nothing mapped "the four permitted categories"
    // to the three fields it skipped — and two of those skipped fields turned out to hide a real
    // divergence (SPECIALISTS-57).
    const permitted = contractDivergenceCategories();
    expect(permitted).toEqual(['interaction transport', 'lifetime semantics', 'process topology', 'workspace strategy']);
    for (const [key, divergence] of Object.entries(INTENTIONAL_DIVERGENCES)) {
      expect(permitted, `${key} divergence category`).toContain(divergence!.category);
      expect(divergence!.reason.length, `${key} divergence reason`).toBeGreaterThan(20);
      expect(PROFILE_KEYS).toContain(key);
    }
  });

  it('pins the DECLARED extension sources absolutely, so dropping them on both sides still fails', async () => {
    // The both-sided hole, measured: forcing BOTH compilers to return `extensions: []` left the
    // entire file green. The curated set cannot be pinned exactly (resolveCuratedExtensionPaths
    // checks what exists on THIS machine), but the DECLARED sources can — and they are the part
    // SPECIALISTS-57 was about, where a definition that turns an extension off must be honoured.
    const root = workspace();
    const spec = definition(root, { permission: 'HIGH', withSkills: true });
    const { profile } = await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
    expect(profile.extensions, 'a declared, enabled local extension source must reach the session').toContain(PY_KERNEL);
    // And it survives on the legacy side too, which is the comparison itself.
    expect(compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE).extensions).toContain(PY_KERNEL);
  });

  it('accounts for every option the host passes to createAgentSession', async () => {
    // The mechanical half of 4a: this is not a list of contract fields, it is what the host
    // ACTUALLY passes. Every option is mapped to the profile key(s) that carry it, so a session
    // knob the host starts setting fails here until somebody decides which dimension covers it —
    // neither the knob nor the decision can arrive by accident.
    const root = workspace();
    const { sessionOptions } = await compileNativeProfile(
      definition(root, { withSkills: true }), root, 'parity-probe', MODEL_OVERRIDE,
    );
    const unaccounted = Object.keys(sessionOptions).filter((key) => SESSION_OPTION_TO_PROFILE_KEY[key] === undefined);
    expect(unaccounted, 'createAgentSession options with no parity representation').toEqual([]);
    for (const keys of Object.values(SESSION_OPTION_TO_PROFILE_KEY)) {
      for (const key of keys) expect(PROFILE_KEYS, `${key} is mapped but not compared`).toContain(key);
    }
  });

  it('pins ABSOLUTE expectations for the cheap dimensions, so a change made to both sides still fails', async () => {
    // Cross-runtime comparison is blind to a change made to BOTH sides — which is exactly what a
    // hardcoded literal fence is, and why the old `ambientDiscovery: false` could not have caught
    // a legacy regression. Where a dimension has a cheap absolute value, pin it: equality alone
    // proves the two agree, not that either is right.
    const root = workspace();
    const spec = definition(root, { permission: 'LOW', withSkills: true, withSchema: true, withScript: true });
    const { profile } = await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);

    // resources: every fence DISABLED, not merely "the same on both sides".
    expect(profile.resources).toEqual({
      noSkills: true, noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    });
    // The declared skill names survive to the session, in spec order.
    // `skills` is a sorted SET in the profile; `skillPrefix` is the order the prefix names them.
    expect([...profile.skills].sort()).toEqual(['engineering-quality', 'gitnexus']);
    expect(profile.skillPrefix).toEqual(['gitnexus', 'engineering-quality']);
    // The tier's own natives are granted, and pi's builtin defaults are not admitted.
    expect(profile.tools).toEqual(expect.arrayContaining(['read', 'bash']));
    expect(profile.builtinToolsFenced).toBe(true);
    // The output contract is the DECLARED schema, read out of the produced system prompt.
    expect(profile.outputContractSchema).toContain('"required"');
    expect(profile.outputContractSchema).toContain('"summary"');
    // Context blocks the turn-1 prompt carries, EXACTLY: a fixture cwd has no MANDATORY_RULES,
    // and the reviewer block is asserted in its own test where the role and the diff exist.
    expect(profile.contextInputs).toEqual(['completedBlockers', 'cwd']);
    // Input parity: the values both runtimes must read from the spec.
    expect(profile.declaredRequiredTools).toEqual([]);
    expect(profile.scripts).toEqual([{ phase: 'pre', injectOutput: false }]);
    expect(profile.model).toBe(MODEL_OVERRIDE);
    expect(profile.thinking).toBeNull();
    expect(profile.cwd).toBe(root);
    // `customTools` was NOT pinned, and a native specialist proved why that mattered: with BOTH
    // compilers forced to return `extensions: []` the whole file still passed, so a change made
    // identically to both sides was invisible on exactly the dimensions this test exists to guard.
    // The expected set is derived from the CONTRACT, not from `native.tools` — deriving it from
    // the profile being tested is what makes a `holds()` predicate self-referential.
    expect(profile.customTools).toEqual([ASK_TOOL, 'bash', ESCALATE_TOOL]);
    // And the legacy side agrees on every one of them, which is the comparison itself.
    expect(diffProfiles(profile, compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE))).toEqual([]);
  });

  for (const tier of ['READ_ONLY', 'LOW', 'MEDIUM', 'HIGH']) {
    it(`native and legacy compile the same profile at ${tier}`, async () => {
      const root = workspace();
      const spec = definition(root, { permission: tier, withSkills: true, withSchema: true });
      const native = await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
      const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
      expect(diffProfiles(native.profile, legacy)).toEqual([]);
    });
  }

  it('compares the resource fence on both sides, so dropping a fence flag is a failure', async () => {
    // XTRM-84 decision A, the trap the decision was about. The legacy fence is read from the argv
    // fragments `start()` passes, so a dropped `--no-context-files` moves the legacy side and the
    // comparison fails. A hardcoded `false` could not do that.
    const root = workspace();
    const spec = definition(root, { permission: 'LOW' });
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
    expect(native.resources).toEqual({
      noSkills: true, noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true,
    });
    expect(legacy.resources).toEqual(native.resources);

    const unfenced: ExecutionProfile = { ...legacy, resources: { ...legacy.resources, noContextFiles: false } };
    expect(diffProfiles(native, unfenced).join('\n')).toContain('resources');
  });

  it('compares the output contract read back from the prompt, so a dropped schema is a failure', async () => {
    const root = workspace();
    const spec = definition(root, { permission: 'LOW', withSchema: true });
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
    expect(native.outputContractSchema).toContain('"summary"');
    expect(legacy.outputContractSchema).toBe(native.outputContractSchema);

    // The regression SPECIALISTS-5 fixed: the native path hardcoded an undefined schema. This is
    // what that looked like on the profile.
    const withoutSchema: ExecutionProfile = { ...native, outputContractSchema: outputContractOf('') };
    expect(diffProfiles(withoutSchema, legacy).join('\n')).toContain('outputContractSchema');
  });

  it('gives the reviewer role its diff context on BOTH paths, and fails when either loses it', async () => {
    // XTRM-84 4b. Before this the branch was dead: the fixture was not a reviewer, and the
    // legacy compiler never installed the hook the legacy runner installs, so both sides were
    // empty and a deleted hook passed. Both sides are now asserted POSITIVELY — a comparison
    // that only checks the two sides agree cannot see both sides silently omitting a block.
    const root = workspaceWithDiff();
    const spec = definition(root, { name: 'reviewer', permission: 'MEDIUM' });
    const native = (await compileNativeProfile(spec, root, 'reviewer', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'reviewer', MODEL_OVERRIDE);

    for (const [side, profile] of [['native', native], ['legacy', legacy]] as const) {
      expect(profile.reviewerEvidence, `${side} reviewer evidence`).toContain(REVIEWER_BLOCK_START);
      expect(profile.reviewerEvidence).toContain('target.txt');
      expect(profile.contextInputs, `${side} reviewer context block`).toContain('reviewerDiff');
    }
    expect(diffProfiles(native, legacy)).toEqual([]);

    const noEvidence: ExecutionProfile = { ...native, reviewerEvidence: null };
    expect(diffProfiles(noEvidence, legacy).join('\n')).toContain('reviewerEvidence');
  });

  it('says nothing about reviewer evidence for a role that is not the reviewer', async () => {
    const root = workspaceWithDiff();
    const spec = definition(root, { name: 'parity-probe', permission: 'LOW' });
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
    expect(native.reviewerEvidence).toBeNull();
    expect(legacy.reviewerEvidence).toBeNull();
  });

  it('is sensitive: dropping a parity fix shows up as a named field difference', async () => {
    // The issue's own validation: "removing any one parity fix fails the test". Removing the
    // declared skills from the native side must produce a diff that NAMES skills, not a generic
    // inequality — a comparison that cannot say which field moved is not worth having.
    const root = workspace();
    const spec = definition(root, { permission: 'LOW', withSkills: true });
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);

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
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);

    const withExtra = { ...native, somethingNew: 'added to the native path only' } as unknown as ExecutionProfile;
    expect(() => diffProfiles(withExtra, legacy)).toThrow(/profile keys/);
  });

  it('compiles the same tool set for a definition that turns an extension off', async () => {
    // SPECIALISTS-57's shape. What this file can prove is PARITY: both runtimes resolve the same
    // contract from the same definition. It deliberately does NOT assert that grep/find/ls are
    // present, because whether the catalog's hard deny is active depends on whether gitnexus
    // resolves on THIS machine — an assertion that passes on a bare runner is not a regression
    // test. The deterministic guards for the defect live elsewhere, by design:
    //   - `specialist-capability-policy.test.ts` forces BOTH extension-health values and fails if a
    //     shipped definition declares a tool its own contract denies;
    //   - the source-level lint there fails if any `resolveRuntimeToolContract` call site drops
    //     `excludeExtensions`, which is what made the native path resolve a different contract.
    const root = workspace();
    const spec = definition(root, { permission: 'LOW', gitnexus: false, requiredTools: ['read', 'grep', 'find', 'ls'] });
    const native = (await compileNativeProfile(spec, root, 'parity-probe', MODEL_OVERRIDE)).profile;
    const legacy = compileLegacyProfile(spec, root, 'parity-probe', MODEL_OVERRIDE);
    expect(diffProfiles(native, legacy)).toEqual([]);
    // And the declared tools the definition asked for ARE the declared set, whatever the host: the
    // profile reports what was DECLARED, which is host-independent.
    expect(native.declaredRequiredTools).toEqual(['find', 'grep', 'ls', 'read']);
  });

  const shippedDir = join(process.cwd(), 'config', 'specialists');
  const shipped = readdirSync(shippedDir).filter((file) => file.endsWith('.specialist.json')).sort();

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

    const compared: string[] = [];
    const declaredOnly: string[] = [];

    for (const file of shipped) {
      const spec = JSON.parse(readFileSync(join(shippedDir, file), 'utf8')) as Record<string, unknown>;
      const name = (spec as { specialist: { metadata: { name: string } } }).specialist.metadata.name;
      const root = workspace();

      // The definition is NOT rewritten to get past admission (XTRM-84 4c): admission is a
      // separate, injectable step and the harness replaces it, so what is compiled here is the
      // definition a user actually dispatches. Skill paths are resolved the same way the loader
      // resolves them, but only so both runtimes see the same paths — nothing is materialised.
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

      const native = (await compileNativeProfile(spec, root, name, MODEL_OVERRIDE)).profile;
      const differences = diffProfiles(native, legacy);
      expect(differences, `${name} profile differences:\n  ${differences.join('\n  ')}`).toEqual([]);
      compared.push(name);
    }

    // The sweep must actually sweep, and it must account for every file: a run where everything was
    // skipped would pass vacuously, and an exclusion nobody recorded is the invisibility this file
    // exists to remove.
    expect(compared.length + declaredOnly.length).toBe(shipped.length);
    expect(compared.length).toBeGreaterThan(15);
  });
});
