import type { ResolvedContextView } from './workitem-store.js';
/** Per-entry and whole-section byte budgets. A cut value names the revision that holds the rest. */
export declare const CONTEXT_REFS_ENTRY_MAX_BYTES = 4096;
export declare const CONTEXT_REFS_TOTAL_MAX_BYTES = 16384;
/**
 * Render the section, or '' when there is nothing to show (no section at all, so a prompt
 * without contextRefs is byte-identical to before). Budgets cover the RENDERED text: each
 * entry block (heading, fences, value, cut notice) stays within `entryMaxBytes`, and the whole
 * section (heading, preface, blocks, separators, omitted notice) within `totalMaxBytes`.
 */
export declare function renderContextRefsSection(context: ResolvedContextView | null | undefined, opts?: {
    entryMaxBytes?: number;
    totalMaxBytes?: number;
}): string;
//# sourceMappingURL=context-refs-section.d.ts.map