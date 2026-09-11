import { describe, it, expect } from 'vitest';
import { compileStepContract } from '../../../src/activation/step-contract.js';

const WORK = {
  ref: 'XTRM-1',
  title: 'Investigate the flake',
  contract: {
    problem: 'The suite flakes under load.',
    success: 'The flake is explained.',
    scope: ['Reproduce and diagnose. Do not fix.'],
    nonGoals: ['Does not change CI config', 'Does not fix the flake'],
    constraints: ['Read-only.', 'No network.'],
    validation: [{ check: 'A written root cause' }, { check: 'A reproduction command' }],
    output: [{ artifact: 'A findings note.' }],
  },
};

describe('compileStepContract', () => {
  const contract = compileStepContract({
    work: WORK,
    revision: 7,
    specialist: 'debugger',
    responseFormat: 'markdown',
    now: () => 1_700_000_000_000,
  });

  it('roots the contract in the Issue, never a synthetic id', () => {
    expect(contract.rootWorkRef).toBe('XTRM-1');
  });

  it('narrows the mandate to SUCCESS bounded by SCOPE', () => {
    expect(contract.mandate).toContain('The flake is explained.');
    expect(contract.mandate).toContain('Reproduce and diagnose. Do not fix.');
    expect(contract.mandate).not.toContain('The suite flakes under load.');
  });

  it('carries the Issue as evidence input', () => {
    expect(contract.inputs).toEqual([{ kind: 'issue', ref: 'XTRM-1', title: 'Investigate the flake' }]);
  });

  it('takes outputs from OUTPUT and the format from the Specialist', () => {
    expect(contract.outputs).toEqual([{ description: 'A findings note.', format: 'markdown' }]);
  });

  it('keeps the boundary in nonGoals only', () => {
    expect(contract.scope).toEqual({ inScope: 'Reproduce and diagnose. Do not fix.' });
    expect(contract.nonGoals).toEqual(['Does not change CI config', 'Does not fix the flake']);
  });

  it('records constraints and validation requirements', () => {
    expect(contract.constraints).toEqual(['Read-only.', 'No network.']);
    expect(contract.validation).toEqual([
      { description: 'A written root cause' },
      { description: 'A reproduction command' },
    ]);
  });

  it('records provenance including the pinned Issue revision', () => {
    expect(contract.provenance).toEqual({
      specialist: 'debugger',
      generatedAt: 1_700_000_000_000,
      sourceIssueRevision: '7',
    });
  });

  it('is reproducible — the same inputs compile to the same contract', () => {
    const again = compileStepContract({
      work: WORK,
      revision: 7,
      specialist: 'debugger',
      responseFormat: 'markdown',
      now: () => 1_700_000_000_000,
    });
    expect(again).toEqual(contract);
  });

  it('stays total on a missing contract rather than aborting an admitted activation', () => {
    const thin = compileStepContract({
      work: { ref: 'XTRM-2', title: 'thin', contract: {} },
      revision: 1,
      specialist: 'researcher',
      now: () => 1,
    });

    expect(thin.rootWorkRef).toBe('XTRM-2');
    expect(thin.mandate).toBe('');
    expect(thin.nonGoals).toEqual([]);
    expect(thin.constraints).toBeUndefined();
    expect(thin.validation).toBeUndefined();
    expect(thin.provenance.sourceIssueRevision).toBe('1');
  });

  it('omits the format when the Specialist declares none', () => {
    const plain = compileStepContract({ work: WORK, revision: 7, specialist: 'researcher', now: () => 1 });
    expect(plain.outputs).toEqual([{ description: 'A findings note.' }]);
  });
});
