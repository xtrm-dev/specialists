/** Pure parser for the seven-section Specialist work contract.
 *
 * Kept separate from the legacy Bead readiness gate so Substrate consumers can
 * validate inline contract text without importing a Beads admission path.
 */

/** The 7-section task contract, in the order an operator writes them. */
export const REQUIRED_SECTIONS = [
  'PROBLEM',
  'SUCCESS',
  'SCOPE',
  'NON_GOALS',
  'CONSTRAINTS',
  'VALIDATION',
  'OUTPUT',
] as const;

export const SCRUTINY_LEVELS = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;

/** Every heading this parser recognises as terminating the previous section. */
const ALL_HEADINGS = new Set<string>([...REQUIRED_SECTIONS, 'SCRUTINY']);

/** A recognised heading, plus any body text that shared its line. */
type Heading = { readonly name: string; readonly inlineBody?: string };

/**
 * Normalise one line to a canonical heading, or undefined when it is not a heading.
 *
 * Two forms are accepted, because operators and models both write contracts and they do
 * not write them the same way:
 *
 *   PROBLEM              a bare word on its own line, optionally decorated with markdown
 *   the thing is broken  heading marks, bold, or a trailing colon
 *
 *   PROBLEM: the thing is broken     the section name, a colon, and the body on one line
 *
 * The second form used to be rejected, and rejected in the worst possible way: the whole
 * line normalised to `PROBLEM:_THE_THING_IS_BROKEN`, matched nothing, so `extractSections`
 * returned an empty map and the gate reported every section missing from a description
 * that plainly contained all of them (unitAI-rrdnt.54). Anyone writing
 * `bd create --description="PROBLEM: ...\nSUCCESS: ..."` hit it, and the refusal pointed
 * away from the cause.
 *
 * A section name inside prose is still not a heading: the name must START the line and the
 * colon must follow it immediately. `see OUTPUT: below` heads nothing.
 */
function headingOf(line: string): Heading | undefined {
  const bare = line.trim().replace(/^#+\s*/, '').replace(/\*/g, '').trim();

  const canonical = (text: string): string => text.toUpperCase().replace(/[\s-]+/g, '_');

  const whole = canonical(bare.replace(/:$/, '').trim());
  if (ALL_HEADINGS.has(whole)) return { name: whole };

  const split = bare.match(/^([A-Za-z][A-Za-z _-]*?)\s*:\s*(.*)$/);
  if (!split) return undefined;
  const name = canonical(split[1].trim());
  if (!ALL_HEADINGS.has(name)) return undefined;
  // The text after the colon is this section's first body line. Discarding it would turn
  // "missing" into "declared but empty" — a distinction this parser deliberately keeps.
  const inlineBody = split[2].trim();
  return inlineBody ? { name, inlineBody } : { name };
}

/**
 * Split work-contract text into its sections, keyed by canonical heading name.
 *
 * The single parser for the 7-section contract. Legacy gates and Substrate inline creation
 * share it so they cannot disagree about the contract text.
 * Sections with an empty body are present as empty strings, so callers can tell "absent"
 * from "declared but empty".
 */
/** Extract the declared SCRUTINY level, if any. */
export function scrutinyLevel(description: string): string | undefined {
  const match = description.match(/SCRUTINY\b[^\n]*\n?\s*\**\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i)
    ?? description.match(/SCRUTINY\b\s*[:\-—]?\s*(LOW|MEDIUM|HIGH|CRITICAL)\b/i);
  return match?.[1]?.toUpperCase();
}

export type ContractTextValidation =
  | { ok: true }
  | { ok: false; reason: string; missing: string[] };

/**
 * Validate raw contract TEXT against the 7-section + SCRUTINY shape.
 *
 * The single gate definition for inline contracts: the host boundary
 * (authoritative, throws) and the dispatch adapters (refusal shape, returns)
 * share it, so admission and the pre-check cannot disagree. Pure: no board
 * access, no subprocess, safe to run before anything is created.
 */
export function validateContractText(contract: string): ContractTextValidation {
  const sections = extractSections(contract ?? '');
  const missing = [...REQUIRED_SECTIONS.filter((section) => !sections.get(section))];
  if (missing.length > 0) {
    return {
      ok: false,
      reason: 'inline contract is not a usable task contract: required sections are missing or empty',
      missing,
    };
  }
  if (!scrutinyLevel(contract)) {
    return {
      ok: false,
      reason: `inline contract declares no SCRUTINY level (expected one of ${SCRUTINY_LEVELS.join(', ')})`,
      missing: ['SCRUTINY'],
    };
  }
  return { ok: true };
}

export function extractSections(description: string): Map<string, string> {
  const sections = new Map<string, string>();
  let current: string | undefined;
  let body: string[] = [];

  const flush = () => {
    if (current) sections.set(current, body.join('\n').trim());
  };

  for (const line of description.split('\n')) {
    const heading = headingOf(line);
    if (heading) {
      flush();
      current = heading.name;
      body = heading.inlineBody ? [heading.inlineBody] : [];
      continue;
    }
    if (current) body.push(line);
  }
  flush();

  return sections;
}
