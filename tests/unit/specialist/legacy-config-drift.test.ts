import { describe, it, expect } from 'vitest';
import { analyzeGlobalUserConfigDrift, buildGlobalUserConfigTemplate } from '../../../src/specialist/global-config.js';
import { legacyOnlyConfigNotes } from '../../../src/activation/native-host.js';

/** SPECIALISTS-52: legacy-only beads_* notes on native, and user.json drift reporting. */

describe('legacyOnlyConfigNotes', () => {
  it('names a non-default beads_* value and stays silent at the defaults', () => {
    expect(legacyOnlyConfigNotes({ beads_integration: 'auto', beads_write_notes: true })).toEqual([]);
    expect(legacyOnlyConfigNotes({})).toEqual([]);
    const notes = legacyOnlyConfigNotes({ beads_integration: 'never', beads_write_notes: false });
    expect(notes).toHaveLength(2);
    expect(notes.join('\n')).toMatch(/beads_write_notes=false applies to the legacy sp CLI only/);
    expect(notes.join('\n')).toMatch(/beads_integration=never applies to the legacy sp CLI only/);
  });
});

describe('analyzeGlobalUserConfigDrift', () => {
  const template = buildGlobalUserConfigTemplate(['executor', 'researcher']);
  const entry = (extensions: Record<string, unknown>) => {
    const e = structuredClone(template.executor) as unknown as Record<string, any>;
    delete e.mandatory_rules;
    e.execution.extensions = extensions;
    return e;
  };

  it('reports a short entry whose Specialist this machine cannot resolve', () => {
    // Without the schema-template fallback such an entry was invisible to doctor, which is how a
    // user.json reached a state where every write failed (SPECIALISTS-4448).
    const existing = { 'frontend-auditor': { execution: { timeout_ms: 900_000 } } };
    const report = analyzeGlobalUserConfigDrift(existing, template);
    expect(report.missingFields['frontend-auditor']).toEqual(
      expect.arrayContaining(['execution.model', 'beads_write_notes', 'skills']),
    );
    // The value the operator set is not reported as missing.
    expect(report.missingFields['frontend-auditor']).not.toContain('execution.timeout_ms');
  });

  it('never reports the reserved route block as lagging the template', () => {
    const existing = { claude_bridge: { enabled: true } };
    const report = analyzeGlobalUserConfigDrift(existing, template);
    expect(report.missingFields).toEqual({});
  });

  it('reports missing template fields, retired, inert and missing-path sources without mutating input', () => {
    const existing = {
      _doc: 'x',
      executor: entry({
        serena: false,
        gitnexus: false,
        '/dev/checkout/python-kernel': false,
        '/gone/ext': true,
        '/here/ext': true,
        'npm:pi-ast-grep': true,
      }),
    };
    const before = JSON.stringify(existing);
    const report = analyzeGlobalUserConfigDrift(existing, template, { pathExists: (p) => p === '/here/ext' });

    expect(JSON.stringify(existing)).toBe(before);
    expect(report.missingFields.executor).toEqual(['mandatory_rules']);
    expect(report.retiredExtensions).toEqual([{ specialist: 'executor', source: 'serena' }]);
    expect(report.inertExtensions).toEqual([{ specialist: 'executor', source: '/dev/checkout/python-kernel', value: false }]);
    expect(report.missingPathExtensions).toEqual([{ specialist: 'executor', source: '/gone/ext' }]);
  });

  it('does not call a false inert when it disables a source a lower layer enables', () => {
    const existing = { researcher: entry({ 'npm:pi-mcp-adapter': false }) };
    const report = analyzeGlobalUserConfigDrift(existing, template, {
      enabledBelow: (name, source) => name === 'researcher' && source === 'npm:pi-mcp-adapter',
    });
    expect(report.inertExtensions).toEqual([]);
  });

  it('reports nothing for an entry that matches the template', () => {
    const report = analyzeGlobalUserConfigDrift({ executor: structuredClone(template.executor) as unknown as Record<string, unknown> }, template);
    expect(report).toEqual({ missingFields: {}, retiredExtensions: [], inertExtensions: [], missingPathExtensions: [] });
  });
});
