// `specialists render-task` — read-only task-prompt renderer for interactive roles.
//
// Consumed by xtrm-tools (`xt pi --role` / `xt claude --role`) so it can send the
// SAME initial user prompt that `sp run` builds, without reimplementing private
// renderer logic. Creates no job, worktree, RPC session, bead, note, or status row.
//
// prompt.system is deliberately NOT part of the output: the launcher owns the
// system prompt via `sp view <name> --raw`, and bead content must never be
// promoted into it.
//
// The parsing/rendering/emission below is shared verbatim with the roleless
// sibling `sp render-bead` (src/cli/render-bead.ts) — there is exactly one
// task-side assembly path, and both verbs emit the same envelope shape.
import { resolveIssueRef } from './issue-ref.js';
import { SpecialistLoader, SpecialistMissingModelError } from '../specialist/loader.js';
import { BeadsClient, type BeadRecord } from '../specialist/beads.js';
import { renderTaskPrompt } from '../specialist/task-prompt.js';
import { openWorkItemBoundary, type SpecialistWorkItemBoundary } from '../activation/workitem-store.js';
import { renderContextRefsSection } from '../activation/context-refs-section.js';
import { contractToMarkdown } from '../activation/contract-markdown.js';
import type { Specialist } from '../specialist/schema.js';

export type Surface = 'pi' | 'claude' | 'codex';

/** Flags shared by every render verb. `render-task` adds a positional specialist name. */
export interface RenderArgs {
  beadId: string;
  cwd: string;
  contextDepth: number;
  surface: Surface;
  positional: string[];
}

// Stable, machine-readable failure codes. The core consumer branches on these.
//
// `context_unresolvable` mirrors the reason native dispatch refuses the same Issue. The
// renderer exists so a launcher sends the prompt the runtime would build; when Substrate
// refuses the Issue's context, emitting a prompt without it would hide the very context the
// coordinator curated, so the render refuses with the dispatch's own reason instead.
export type ErrorCode =
  | 'usage'
  | 'specialist_not_found'
  | 'bead_not_found'
  | 'template_render_failed'
  | 'mandatory_rules_failed'
  | 'context_unresolvable';

export function fail(code: ErrorCode, message: string): never {
  process.stdout.write(`${JSON.stringify({ ok: false, error: { code, message } }, null, 2)}\n`);
  process.exit(1);
}

/** Shared flag parsing. Each verb enforces its own required-argument shape. */
export function parseRenderArgs(argv: string[]): RenderArgs {
  const positional: string[] = [];
  let issueRef = '';
  let beadAlias = '';
  let beadIdAlias = '';
  let cwd = process.cwd();
  let contextDepth = 3;
  let surface: Surface = 'pi';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--issue-ref') issueRef = argv[++i] ?? '';
    else if (arg === '--bead') beadAlias = argv[++i] ?? '';
    else if (arg === '--bead-id') beadIdAlias = argv[++i] ?? '';
    else if (arg === '--cwd') cwd = argv[++i] ?? cwd;
    else if (arg === '--context-depth') contextDepth = Number(argv[++i]);
    else if (arg === '--surface') surface = (argv[++i] ?? 'pi') as Surface;
    else if (!arg.startsWith('-')) positional.push(arg);
  }

  if (surface !== 'pi' && surface !== 'claude' && surface !== 'codex') {
    fail('usage', `--surface must be 'pi', 'claude' or 'codex' (got '${surface}')`);
  }
  if (!Number.isFinite(contextDepth) || contextDepth < 0) {
    fail('usage', `--context-depth must be a non-negative number (got '${contextDepth}')`);
  }

  let beadId = '';
  try {
    beadId = resolveIssueRef({ issueRef, bead: beadAlias, beadId: beadIdAlias }) ?? '';
  } catch (error) {
    fail('usage', error instanceof Error ? error.message : String(error));
  }

  return { beadId, cwd, contextDepth: Math.trunc(contextDepth), surface, positional };
}

/**
 * Test seam: an explicit boundary replaces the real Substrate open (which
 * needs environment + database). Production never sets this; unit tests set it
 * per test and reset afterwards so no real store is touched.
 */
let workItemsOverride: SpecialistWorkItemBoundary | undefined;

export function __setWorkItemsForTests(boundary: SpecialistWorkItemBoundary | undefined): void {
  workItemsOverride = boundary;
}

async function openBoundaryIfAvailable(): Promise<SpecialistWorkItemBoundary | null> {
  try {
    return await openWorkItemBoundary();
  } catch {
    return null;
  }
}

/**
 * Resolve the work locator for the read-only render surface.
 *
 * Order is deliberate: the legacy Beads compat reader goes first so refs
 * that already resolve keep byte-identical output (and never touch the
 * store); a Beads miss falls through to the shared Substrate work boundary
 * that dispatch uses — read-only (`view` + `completedBlockers` only, never
 * check/bind/journal, so this surface cannot claim or mutate the Issue).
 * A ref in neither store fails with the stable `bead_not_found` code naming
 * the ref.
 *
 * The resolved `contextRefs` are rendered here, from the same boundary and the
 * same renderer native dispatch uses, so a launcher and `specialist_dispatch`
 * hand a worker the SAME turn-1 context for the same Issue. Rendering them on
 * only one of the two paths made an Issue read differently depending on how it
 * was launched.
 */
async function resolveWorkForRender(
  ref: string,
  contextDepth: number,
): Promise<{
  beadId: string;
  bead: BeadRecord;
  completedBlockers: BeadRecord[];
  contextRefsSection: string;
}> {
  const beads = new BeadsClient();
  const legacy = beads.readBead(ref);
  if (legacy) {
    return {
      beadId: ref,
      bead: legacy,
      completedBlockers: contextDepth > 0 ? beads.getCompletedBlockers(ref, contextDepth) : [],
      // Legacy Beads has no revisioned contextRefs, so the section stays absent and a
      // prompt for a Beads-only ref stays byte-identical to what it rendered before.
      contextRefsSection: '',
    };
  }

  const boundary = workItemsOverride ?? await openBoundaryIfAvailable();
  if (boundary) {
    let view: ReturnType<SpecialistWorkItemBoundary['view']> | null = null;
    let blockers: ReturnType<SpecialistWorkItemBoundary['completedBlockers']> = [];
    try {
      view = boundary.view(ref);
      // The boundary serves depths 1|2 only; clamp the user-facing depth into
      // its domain instead of silently dropping blocker context at depth 3+.
      blockers = contextDepth > 0
        ? boundary.completedBlockers(ref, Math.min(contextDepth, 2))
        : [];
    } catch {
      // Not a Substrate ref (or unreadable) — fall through to the truthful failure below.
      view = null;
    }
    if (view) {
      let contextRefsSection = '';
      try {
        contextRefsSection = renderContextRefsSection(boundary.resolvedContext?.(view.ref) ?? null);
      } catch (error) {
        fail(
          'context_unresolvable',
          `contextRefs of '${view.ref}' cannot be resolved: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return {
        beadId: view.ref,
        bead: { id: view.ref, title: view.title, description: contractToMarkdown(view.contract) } as BeadRecord,
        completedBlockers: blockers.map((blocker) => ({
          id: blocker.ref,
          title: blocker.title,
          description: blocker.description,
        }) as BeadRecord),
        contextRefsSection,
      };
    }
  }

  fail('bead_not_found', `bead '${ref}' not found`);
}

/**
 * Read the bead, run the one shared task-side assembly, and emit the envelope.
 *
 * `specialistName` is null for the roleless render — the key stays present so a
 * single consumer parser covers both verbs.
 */
export async function renderAndEmit(
  specialist: Specialist['specialist'],
  specialistName: string | null,
  args: RenderArgs,
): Promise<void> {
  const resolved = await resolveWorkForRender(args.beadId, args.contextDepth);
  const beadId = resolved.beadId;
  const bead = resolved.bead;
  const completedBlockers = resolved.completedBlockers;

  let rendered;
  try {
    rendered = renderTaskPrompt({
      specialist,
      cwd: args.cwd,
      beadId,
      bead,
      completedBlockers,
      contextRefsSection: resolved.contextRefsSection,
      surface: args.surface,
      // Execution-only inputs are absent by construction: no pre-scripts are run
      // and no reviewer git diff is taken. Both are classified execution-only in
      // the unitAI-6639v.1 parity decision.
    });
  } catch (error) {
    fail('template_render_failed', `task_template render failed: ${(error as Error)?.message ?? String(error)}`);
  }

  // Fatal here, warn-and-skip in `sp run`. An interactive coordinator that lost
  // its mandatory rules would fail silently and unrecoverably otherwise.
  if (rendered.mandatoryRulesError) {
    fail('mandatory_rules_failed', rendered.mandatoryRulesError);
  }

  const components = [
    rendered.taskTemplateComponent,
    ...(rendered.beadContextOwn ? [rendered.beadContextOwn] : []),
    ...(rendered.beadContextParent ? [rendered.beadContextParent] : []),
    ...rendered.beadContextBlockers,
    // Same position as in the prompt: after the bead context, before the mandatory rules.
    ...(rendered.contextRefsComponent ? [rendered.contextRefsComponent] : []),
    ...(rendered.mandatoryRules?.sections ?? []).map((section) => ({
      kind: 'mandatory_rule' as const,
      name: section.setId,
      tokens: Math.ceil(section.block.length / 4),
      bytes: Buffer.byteLength(section.block, 'utf8'),
    })),
  ];

  process.stdout.write(`${JSON.stringify({
    ok: true,
    specialist: specialistName,
    bead_id: beadId,
    surface: args.surface,
    cwd: args.cwd,
    context_depth: args.contextDepth,
    initial_prompt: rendered.initial_prompt,
    prompt_hash: rendered.prompt_hash,
    skill_prefix: rendered.skillPrefix,
    // Bounded metadata only — never full prompt bodies (unitAI-6639v.4 constraint).
    components,
    mandatory_rules: rendered.mandatoryRules
      ? {
          sets_loaded: rendered.mandatoryRules.setsLoaded,
          rules_count: rendered.mandatoryRules.ruleCount,
          inline_rules_count: rendered.mandatoryRules.inlineRulesCount,
          globals_disabled: rendered.mandatoryRules.globalsDisabled,
          budget_limit: rendered.mandatoryRules.budgetLimit,
          candidate_tokens: rendered.mandatoryRules.candidateTokens,
          injected_tokens: rendered.mandatoryRules.injectedTokens,
          injected_section_ids: rendered.mandatoryRules.injectedSectionIds,
          evicted_section_ids: rendered.mandatoryRules.evictedSectionIds,
          payload_digest: rendered.mandatoryRules.payloadDigest,
          outcome: rendered.mandatoryRules.outcome,
        }
      : null,
    skills: specialist.skills?.paths ?? [],
  }, null, 2)}\n`);
}

/**
 * Load a specialist for the requested surface.
 *
 * Pi/Claude keep the historical runtime gate exactly as K1 pinned it:
 * `loader.get()` hard-fails on a null/empty `execution.model`. The native
 * codex surface (K3, unitAI-e67up.2; experimental until K5 promotion) resolves
 * its own effective model — `execution.surface_models.codex` wins, otherwise
 * `execution.model` — so a codex-only configuration is renderable while a
 * configuration with no usable model fails with the canonical missing-model
 * error shape. The surface is selected ONLY by this flag: a model spelling
 * such as `openai-codex/...` is provider data and never aliases the codex
 * surface.
 */
export async function loadSpecialistForSurface(name: string, surface: Surface): Promise<Specialist> {
  const loader = new SpecialistLoader();
  if (surface !== 'codex') return loader.get(name);
  const spec = await loader.getEffective(name);
  if (!spec) throw new Error(`Specialist not found: ${name}`);
  const execution = spec.specialist.execution;
  const model = execution.surface_models?.codex ?? execution.model;
  if (!model) throw new SpecialistMissingModelError(name);
  return spec;
}

const USAGE = 'Usage: specialists render-task <name> --issue-ref <id> [--cwd <path>] [--context-depth <n>] [--surface pi|claude|codex] (--bead/--bead-id are permanent compatibility aliases for --issue-ref)';

export async function run(): Promise<void> {
  const args = parseRenderArgs(process.argv.slice(3));
  const name = args.positional[0] ?? '';
  if (!name || !args.beadId) fail('usage', USAGE);

  const spec = await loadSpecialistForSurface(name, args.surface).catch((error: unknown) => {
    fail('specialist_not_found', `specialist '${name}': ${(error as Error)?.message ?? String(error)}`);
  });

  await renderAndEmit(spec.specialist, spec.specialist.metadata.name, args);
}
