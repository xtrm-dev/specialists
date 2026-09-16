/**
 * Integrated probe for unitAI-1pqtl.3: declared `git:` sources resolve to pi's checkout cache.
 *
 * Real pi SDK, no model calls (sessions are created and disposed, never prompted).
 * Reports the tool names actually discovered for the source rather than assuming them.
 *
 * Run from the repository root:
 *   TMPDIR=/var/tmp bun run scripts/probe-git-extension-tool-surface.ts
 *
 * Expected (coordinator-measured before implementation):
 *   - `git:github.com/alonw0/pi-claude-link` resolves to `<agentDir>/git/github.com/alonw0/pi-claude-link`
 *   - that checkout registers exactly ONE tool: `claude-link`
 *   - no shadow refusal fires (`claude-link` is not catalog-granted, so not in the R3.1 reserved set)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadPiSdk } from '../src/activation/pi-sdk.js';
import { createGateModelRuntime, validateModelAvailable } from '../src/activation/model-gate.js';
import {
  defaultExtensionSourceResolutionEnv,
  discoverDynamicExtensionTools,
  formatSkippedExtensionSourceMessage,
  resolveDeclaredExtensionSources,
  resolveGitExtensionSource,
} from '../src/activation/native-host.js';

const GIT_SOURCE = 'git:github.com/alonw0/pi-claude-link';
const GIT_SPEC = GIT_SOURCE.slice('git:'.length);

async function main(): Promise<void> {
  const sdk = await loadPiSdk();
  const agentDir = sdk.getAgentDir();
  const cacheRoot = join(agentDir, 'git');
  const expectedCheckout = join(cacheRoot, GIT_SPEC);
  console.log(`agentDir: ${agentDir}`);
  console.log(`cache root: ${cacheRoot}`);
  console.log(`expected checkout: ${expectedCheckout}`);
  console.log(`checkout exists: ${existsSync(expectedCheckout)}`);
  console.log(`manifest exists: ${existsSync(join(expectedCheckout, 'package.json'))}`);

  const env = { ...defaultExtensionSourceResolutionEnv, piAgentDir: () => agentDir };
  const resolved = resolveGitExtensionSource(GIT_SOURCE, env);
  console.log(`resolveGitExtensionSource('${GIT_SOURCE}'): ${resolved ?? 'null (skipped)'}`);

  const split = resolveDeclaredExtensionSources(
    [GIT_SOURCE, 'git:github.com/does-not-exist/nope', 'https://example.com/ext', 'http://example.com/ext', 'ssh:example.com/ext'],
    env,
  );
  console.log(`declared split: local=${JSON.stringify(split.local)} skipped=${JSON.stringify(split.skipped)}`);
  for (const skipped of split.skipped) {
    console.log(`skip message: ${formatSkippedExtensionSourceMessage(skipped).trim()}`);
  }

  if (!resolved) {
    console.log('NO CHECKOUT — cannot run discovery; probe inconclusive (exit 2)');
    process.exit(2);
  }

  const modelRuntime = await createGateModelRuntime(sdk);
  let model: unknown;
  for (const candidate of ['opencode-go/deepseek-v4.1-flash', 'opencode-go/muse-spark-1.3-contributor']) {
    const verdict = await validateModelAvailable(sdk, modelRuntime, candidate);
    if (verdict.ok && verdict.model) { model = verdict.model; console.log(`model: ${candidate} (no calls will be made)`); break; }
  }
  if (!model) { console.log('NO MODEL AVAILABLE — cannot create sessions; probe inconclusive'); process.exit(2); }

  let discovery: Awaited<ReturnType<typeof discoverDynamicExtensionTools>> | undefined;
  try {
    discovery = await discoverDynamicExtensionTools({
      sdk,
      cwd: process.cwd(),
      agentDir,
      dynamicExtensions: [resolved],
      model,
      reservedNames: ['read', 'ask_coordinator', 'escalate_to_coordinator'],
      allowedRemoteSources: [GIT_SOURCE],
    });
  } catch (error) {
    console.log(`discovery FAILED (refusal): ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  console.log(`discoveredRaw: ${JSON.stringify(discovery.discoveredRaw)}`);
  console.log(`pinned: ${JSON.stringify(discovery.pinned)}`);
  console.log(`refusedCollisions: ${JSON.stringify(discovery.refusedCollisions)}`);
  console.log(`refusedProvenance: ${JSON.stringify(discovery.refusedProvenance)}`);

  const loader = new sdk.DefaultResourceLoader({
    cwd: process.cwd(),
    agentDir,
    noSkills: true,
    noExtensions: true,
    noContextFiles: true,
    noPromptTemplates: true,
    noThemes: true,
    additionalExtensionPaths: [resolved],
  });
  await loader.reload();
  const created = await sdk.createAgentSession({
    resourceLoader: loader,
    model,
    cwd: process.cwd(),
    noTools: 'builtin',
    tools: ['read', ...discovery.pinned],
    systemPrompt: 'probe-git-checkout (never prompted)',
  });
  try {
    const active = [...created.session.getActiveToolNames()].sort();
    console.log(`pinned session active tools: ${JSON.stringify(active)}`);
    const ok = discovery.pinned.includes('claude-link') && active.includes('claude-link');
    console.log(ok ? 'PASS: git checkout resolves and claude-link is active' : 'FAIL: expected claude-link in pinned+active');
    process.exit(ok ? 0 : 1);
  } finally {
    try { created.session.dispose(); } catch { /* disposal failures are recorded by absence */ }
  }
}

await main();
