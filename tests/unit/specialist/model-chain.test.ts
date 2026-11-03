import { afterEach, describe, expect, it } from 'vitest';
import { resolveModelChain } from '../../../src/specialist/model-chain.js';
import { resetRuntimeDiagnosticsSink, setRuntimeDiagnosticsSink } from '../../../src/utils/runtime-diagnostics.js';

describe('resolveModelChain', () => {
  afterEach(() => {
    resetRuntimeDiagnosticsSink();
    delete process.env.DEBUG;
  });

  it('returns primary followed by plural fallbacks', () => {
    expect(resolveModelChain({ model: 'p', fallback_models: ['a', 'b'] })).toEqual(['p', 'a', 'b']);
  });

  it('returns primary followed by singular fallback', () => {
    expect(resolveModelChain({ model: 'p', fallback_model: 'f' })).toEqual(['p', 'f']);
  });

  it('returns primary when no fallbacks are configured', () => {
    expect(resolveModelChain({ model: 'p' })).toEqual(['p']);
  });

  it('prefers plural fallbacks over singular fallback', () => {
    const lines: string[] = [];
    setRuntimeDiagnosticsSink((line) => lines.push(line));
    process.env.DEBUG = '1';

    expect(resolveModelChain({ model: 'p', fallback_model: 'f', fallback_models: ['a', 'b'] })).toEqual(['p', 'a', 'b']);
    expect(lines.join('\n')).toContain('[model-chain] plural fallback_models wins; ignoring fallback_model=f');
  });

  it('returns empty chain when model missing and no fallback exists', () => {
    expect(resolveModelChain({ model: null })).toEqual([]);
  });

  it('dedupes while preserving order', () => {
    expect(resolveModelChain({ model: 'p', fallback_models: ['p', 'a', 'a'] })).toEqual(['p', 'a']);
  });
});
