/**
 * Bead readiness gate for native Specialist activation — PRD Phase 3.
 *
 * `--bead` is the prompt. A Specialist dispatched against a Bead that is only a title and
 * a sentence has nothing to work from, so it invents the missing scope; that is how
 * durable work silently loses its boundaries. The seven sections are not paperwork, they
 * are the task contract, and a Bead without them is not dispatchable.
 *
 * Before this module the discipline existed only in CLAUDE.md and hooks — nothing in
 * `src/` mentioned PROBLEM, NON_GOALS or SCRUTINY. The gate moves it into the admission
 * path, where a refusal is cheap and reversible, rather than leaving it to be discovered
 * by a child that already spent a model turn guessing.
 *
 * Deliberately NOT here: the contract's *quality*. The gate proves a section exists and is
 * non-empty. Whether SCOPE is a good scope is a judgement no parser makes, and pretending
 * otherwise would trade a useful gate for a bureaucratic one.
 */
import type { BeadRecord } from './beads.js';
export { extractSections, REQUIRED_SECTIONS, extractPurposeExcerpt, PURPOSE_EXCERPT_MAX } from '../activation/contract-sections.js';
export type BeadGateResult = {
    ok: true;
} | {
    ok: false;
    reason: string;
    missing: string[];
};
export interface BeadGateOptions {
    readContractState?: (beadId: string) => string | undefined;
}
/** Read `bd state <id> contract`. Returns undefined when bd is absent or the state is unset. */
export declare function readContractState(beadId: string): string | undefined;
/**
 * Decide whether a Bead is a dispatchable task contract.
 *
 * Returns a result rather than throwing so the caller owns the refusal shape — the host
 * renders one `DispatchRejectedError` for every rejection reason, and a gate that threw its
 * own error type would give operators two.
 */
export declare function evaluateBeadReadiness(bead: BeadRecord, options?: BeadGateOptions): BeadGateResult;
//# sourceMappingURL=bead-gate.d.ts.map