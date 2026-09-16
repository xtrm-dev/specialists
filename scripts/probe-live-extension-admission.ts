/**
 * Live admission probe for unitAI-1pqtl: a fresh process resolves the operator's declared
 * extension sources, discovers their tools, renders the contract with the mechanism that
 * actually applies, creates a REAL session pinned to the finalized allowlist, and then
 * INVOKES a tool that only exists because an enabled extension registered it.
 *
 * No model turn is ever spent. The session is created, inspected and disposed; the
 * discovered tool is called directly through the definition the session itself exposes,
 * which is the strongest callability evidence available without prompting a model.
 *
 * Run from the repository root:
 *   TMPDIR=/var/tmp bun run scripts/probe-live-extension-admission.ts
 *
 * Expected: `ast_grep` (npm:pi-ast-grep) and `claude-link` (git:…/pi-claude-link) pinned and
 * active, the rendered line naming discover-then-pin, and the invoked tool reporting matches.
 *
 * The two `scripts/probe-*-extension-tool-surface.ts` harnesses MEASURE the design's
 * premises and falsifiers. This one is the end-to-end acceptance: it answers "does an
 * enabled extension's tool actually reach, and run inside, the session?".
 */
const REPO = process.cwd();

const { loadPiSdk } = await import(`${REPO}/src/activation/pi-sdk.js`);
const { createGateModelRuntime, validateModelAvailable } = await import(`${REPO}/src/activation/model-gate.js`);
const {
  defaultExtensionSourceResolutionEnv,
  discoverDynamicExtensionTools,
  resolveDeclaredExtensionSources,
  expectedRemoteExtensionLabels,
} = await import(`${REPO}/src/activation/native-host.js`);
const { withDiscoveredExtensionTools, formatResolvedToolContract } = await import(
  `${REPO}/src/specialist/resolved-tool-contract.js`
);
const { resolveRuntimeToolContract, resolveCuratedExtensionPaths } = await import(`${REPO}/src/pi/session.js`);
const { ASK_TOOL, ESCALATE_TOOL } = await import(`${REPO}/src/activation/ask-tool.js`);

const checks: { name: string; ok: boolean; note: string }[] = [];
const check = (name: string, ok: boolean, note: string) => {
  checks.push({ name, ok, note });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  — ${note}`);
};

/** The declaration the executor's real config carries, one source per resolution class. */
const DECLARED = ['npm:pi-ast-grep', 'git:github.com/alonw0/pi-claude-link'];
const TIER = 'READ_ONLY';

const sdk = await loadPiSdk();
const agentDir = sdk.getAgentDir();
const env = { ...defaultExtensionSourceResolutionEnv, piAgentDir: () => agentDir };

// 1. source resolution, exactly as the host does it
const split = resolveDeclaredExtensionSources(DECLARED, env);
console.log(`declared: ${JSON.stringify(DECLARED)}`);
console.log(`resolved local: ${JSON.stringify(split.local)}`);
console.log(`skipped: ${JSON.stringify(split.skipped)}`);
check(
  '1 every declaration resolves to a local directory',
  split.local.length === DECLARED.length && split.skipped.length === 0,
  `local=${split.local.length} skipped=${split.skipped.length}`,
);

// the catalog-derived base contract the host builds BEFORE discovery
const base = resolveRuntimeToolContract({
  level: TIER,
  specialistName: 'explorer',
  cwd: REPO,
  // the definition's own declared sources must reach contract resolution, or the rendered
  // contract never carries an exposed-extension-sources line at all
  extensionSources: DECLARED,
});
if (!base) {
  console.log('base contract did not resolve — probe inconclusive');
  process.exit(2);
}
console.log(`base contract: tools=${base.toolsList.length} native=${base.nativeTools.length} tier=${base.effectiveTier}`);

const modelRuntime = await createGateModelRuntime(sdk);
let model: unknown;
for (const candidate of ['opencode-go/deepseek-v4.1-flash', 'opencode-go/muse-spark-1.3-contributor']) {
  const verdict = await validateModelAvailable(sdk, modelRuntime, candidate);
  if (verdict.ok && verdict.model) {
    model = verdict.model;
    console.log(`model: ${candidate} (no calls will be made)`);
    break;
  }
}
if (!model) {
  console.log('NO MODEL AVAILABLE — cannot create sessions; probe inconclusive');
  process.exit(2);
}

// 2. discover-then-pin, with the same required safety inputs the host passes
const discovery = await discoverDynamicExtensionTools({
  sdk,
  cwd: REPO,
  agentDir,
  dynamicExtensions: split.local,
  model,
  reservedNames: [...base.nativeTools, ...base.extensionTools, ASK_TOOL, ESCALATE_TOOL],
  allowedRemoteSources: expectedRemoteExtensionLabels(DECLARED, split.skipped),
});
console.log(`discoveredRaw: ${JSON.stringify(discovery.discoveredRaw)}`);
console.log(`pinned: ${JSON.stringify(discovery.pinned)}`);
check(
  '2 each declared source contributes at least one pinned tool',
  discovery.pinned.includes('ast_grep') && discovery.pinned.includes('claude-link'),
  `pinned=${JSON.stringify(discovery.pinned)} refusedCollisions=${JSON.stringify(discovery.refusedCollisions)} refusedProvenance=${JSON.stringify(discovery.refusedProvenance)}`,
);

// 3. the rendered contract names the mechanism that actually applies on this path
const effective = withDiscoveredExtensionTools(base, discovery);
const rendered = formatResolvedToolContract(effective, 'discover-then-pin');
const sourceLines = rendered.split('\n').filter((line) => line.includes('exposed extension sources'));
for (const line of sourceLines) console.log(`rendered: ${line}`);
check(
  '3 the rendered contract names discover-then-pin, never the tool-policy gate',
  sourceLines.length > 0 && sourceLines.every((line) => line.includes('discover-then-pin')),
  sourceLines.join(' | ') || '(no exposed-extension-sources line rendered)',
);

// 4. a REAL session pinned to the finalized effective allowlist
const curated = resolveCuratedExtensionPaths({ permissionLevel: TIER, resolvedToolContract: base });
console.log(`curated extension paths: ${JSON.stringify(curated.all)}`);
const resourceLoader = new sdk.DefaultResourceLoader({
  cwd: REPO,
  agentDir,
  noSkills: true,
  additionalSkillPaths: [],
  noExtensions: true,
  // curated + dynamic, as the host loads them — dynamic alone would drop the catalog's
  // gitnexus tools and the promised-vs-active check below would fail for the wrong reason
  additionalExtensionPaths: [...curated.all, ...split.local],
  noContextFiles: true,
  noPromptTemplates: true,
  noThemes: true,
});
await resourceLoader.reload();
const created = await sdk.createAgentSession({
  resourceLoader,
  cwd: REPO,
  model,
  noTools: 'builtin',
  tools: [...effective.toolsList, ASK_TOOL, ESCALATE_TOOL],
  systemPrompt: 'probe-live-extension-admission (never prompted)',
});

try {
  const active: string[] = [...created.session.getActiveToolNames()].sort();
  console.log(`real session active tools: ${JSON.stringify(active)}`);
  const missing = [...effective.toolsList].filter((tool) => !active.includes(tool));
  check(
    '4 the real session exposes every promised tool, discovered ones included',
    missing.length === 0 && active.includes('ast_grep'),
    `missing=${JSON.stringify(missing)} ast_grep_active=${active.includes('ast_grep')}`,
  );

  // 5. invoke the discovered tool through the definition the session exposes
  const definition = created.session.getToolDefinition('ast_grep') as
    | { execute: (...args: unknown[]) => Promise<unknown> }
    | undefined;
  check(
    '5a the discovered tool has an invocable definition',
    typeof definition?.execute === 'function',
    `keys=${definition ? Object.keys(definition).join(',') : 'missing'}`,
  );
  if (definition?.execute) {
    const result = (await definition.execute(
      'probe-live-1',
      {
        command: 'run',
        kind: 'function_declaration',
        language: 'ts',
        paths: [`${REPO}/src/specialist/resolved-tool-contract.ts`],
      },
      undefined,
      undefined,
      { cwd: REPO },
    )) as { content?: { text?: string }[] };
    const text = result?.content?.map((part) => part.text ?? '').join('\n') ?? '';
    console.log(`invocation output (first 400 chars):\n${text.slice(0, 400)}`);
    const reported = text.match(/found \d+ match\w*/) ?? ['(none)'];
    check(
      '5b the discovered tool executes and returns real matches',
      /found [1-9]\d* match/.test(text),
      `matches reported: ${reported[0]}`,
    );
  }
} finally {
  try {
    created.session.dispose();
  } catch {
    /* disposal failures are recorded by absence */
  }
}

console.log('\n=== LIVE ADMISSION VERDICT ===');
const fired = checks.filter((entry) => !entry.ok);
console.log(
  fired.length === 0
    ? 'all live-admission checks pass'
    : `${fired.length} FIRED: ${fired.map((entry) => entry.name).join(', ')}`,
);
process.exit(fired.length === 0 ? 0 : 1);
