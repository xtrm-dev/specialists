// tests/unit/cli/help.test.ts
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

function captureTopLevelHelp(): string {
  const entry = join(process.cwd(), 'dist', 'index.js');
  return execFileSync('bun', [entry, 'help'], { encoding: 'utf-8' });
}

describe('help CLI — run()', () => {
  it('prints usage section', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('Usage:');
    expect(combined).toContain('specialists|sp [command]');
  });

  it('teaches native Substrate work first and labels Beads as legacy compatibility', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('Native tracked work (primary)');
    expect(combined).toContain('Substrate Issue');
    expect(combined).toContain('Legacy sp job compatibility');
    expect(combined).toContain('--bead');
    expect(combined).not.toContain('bd create "Task title"');
  });

  it('distinguishes tracked vs ad-hoc work', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('Ad-hoc work');
    expect(combined).toContain('--prompt');
  });

  it('advertises --background for agent panes and marks merge commands broken', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('--background');
    expect(combined).toContain('merge [broken]');
    expect(combined).toContain('epic merge [broken]');
  });

  it('labels --context-depth and --no-beads as legacy CLI semantics', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('--context-depth');
    expect(combined).toContain('--no-beads');
    expect(combined).toContain('legacy Beads backend only');
  });

  it('lists core commands plainly', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('Core commands:');
    for (const cmd of ['init', 'list', 'config', 'run', 'serve', 'script', 'feed', 'result', 'clean', 'stop', 'report', 'status', 'doctor', 'quickstart']) {
      expect(combined, `missing command: ${cmd}`).toContain(cmd);
    }
  });

  it('includes db setup and deprecated setup/install commands', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('db setup');
    expect(combined).toContain('[deprecated] Use specialists init instead');
  });

  it('mentions xtrm worktree commands', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('xtrm worktree commands:');
    expect(combined).toContain('xt pi');
    expect(combined).toContain('xt end');
  });

  it('references quickstart and command-specific help', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('specialists quickstart');
    expect(combined).toContain('specialists run --help');
    expect(combined).toContain('specialists init --help');
  });

  it('states project-only model', () => {
    const combined = captureTopLevelHelp();
    expect(combined).toContain('project-only');
  });
});
