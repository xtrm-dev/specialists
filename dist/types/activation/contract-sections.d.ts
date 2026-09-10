/** Pure parser for the seven-section Specialist work contract.
 *
 * Kept separate from the legacy Bead readiness gate so Substrate consumers can
 * validate inline contract text without importing a Beads admission path.
 */
/** The 7-section task contract, in the order an operator writes them. */
export declare const REQUIRED_SECTIONS: readonly ["PROBLEM", "SUCCESS", "SCOPE", "NON_GOALS", "CONSTRAINTS", "VALIDATION", "OUTPUT"];
export declare const SCRUTINY_LEVELS: readonly ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
/**
 * Split work-contract text into its sections, keyed by canonical heading name.
 *
 * The single parser for the 7-section contract. Legacy gates and Substrate inline creation
 * share it so they cannot disagree about the contract text.
 * Sections with an empty body are present as empty strings, so callers can tell "absent"
 * from "declared but empty".
 */
export declare function extractSections(description: string): Map<string, string>;
//# sourceMappingURL=contract-sections.d.ts.map