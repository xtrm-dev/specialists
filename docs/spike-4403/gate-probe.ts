// SPECIALISTS-4403 probe: can a native activation name a pi-claude-bridge model?
//
// Run from the repo root with a scratch HOME:
//   HOME=/tmp/spike-probe/home ANTHROPIC_API_KEY=<dummy> bun docs/spike-4403/gate-probe.ts
//
// ANTHROPIC_API_KEY only configures the control provider; the gate performs no network call.
// PI_NPM_GLOBAL_DIR may be required under bun so the SDK package resolves.
import { loadPiSdk } from '../../src/activation/pi-sdk.ts';
import { createGateModelRuntime, validateModelAvailable } from '../../src/activation/model-gate.ts';

const sdk = await loadPiSdk();
const runtime = await createGateModelRuntime(sdk);
for (const pattern of ['claude-bridge/claude-opus-5-5', 'anthropic/claude-sonnet-4-5']) {
  try {
    const result = await validateModelAvailable(sdk, runtime, pattern);
    console.log(JSON.stringify({
      pattern,
      ok: result.ok,
      reason: result.reason,
      provider: result.provider,
      diagnostics: result.diagnostics.map((d) => d.code),
    }));
  } catch (error) {
    console.log(JSON.stringify({ pattern, threw: String(error) }));
  }
}
