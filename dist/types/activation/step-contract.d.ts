/**
 * StepContract compilation — PRD §15, Phase 4.
 *
 * A StepContract bounds ONE activation. It is derived, in-memory, and reproducible from
 * the resolved Issue revision plus the SpecialistDefinition; it is **not** a second
 * durable work item. The PRD says this twice (Phase 4 "do not create step issues",
 * invariant 4 "StepContract does not create a second work graph") because the tempting
 * next step — persisting these, giving them ids, letting them depend on each other —
 * rebuilds the dependency graph the Issue graph already owns, in a place nothing else
 * can see.
 *
 * Nothing here writes, persists, or registers anything. Compilation is a pure function
 * of its inputs.
 *
 * ON THE TYPES: PRD §15 gives `EvidenceRef`, `OutputRequirement`, `ScopeContract` and
 * `ValidationRequirement` as a conceptual shape with no field definitions. They are
 * narrowed here to what a Substrate work contract can actually supply today rather
 * than modelling an evidence subsystem that does not exist. When real evidence refs
 * arrive, these widen; inventing them now would produce a contract whose fields are
 * always empty and whose shape nobody trusts.
 */
/**
 * A pointer to something the activation was given as input.
 *
 * Today a work contract can only cite the issue it was dispatched against, so `kind`
 * is deliberately narrow. It is an enum rather than a free string so that widening it
 * later is a compile error at every reader.
 */
export interface EvidenceRef {
    kind: 'issue';
    ref: string;
    title?: string;
}
/** Something the activation is required to produce. */
export interface OutputRequirement {
    description: string;
    /** Response format the Specialist is configured to emit, when it declares one. */
    format?: string;
}
/**
 * What this activation is for.
 *
 * The boundary lives in the sibling `nonGoals` field, not here. PRD §15 lists `scope` and
 * `nonGoals` separately, so carrying the exclusions in both would give the contract two
 * sources of truth for the same statement and let them drift.
 */
export interface ScopeContract {
    inScope: string;
}
/** A condition the result is checked against. */
export interface ValidationRequirement {
    description: string;
}
export interface StepContract {
    /** The durable work this activation serves. Always an issue ref — never a synthetic id. */
    rootWorkRef: string;
    /** What THIS Specialist is being asked to do, narrowed to its role. */
    mandate: string;
    inputs: EvidenceRef[];
    outputs: OutputRequirement[];
    scope: ScopeContract;
    nonGoals: string[];
    constraints?: string[];
    validation?: ValidationRequirement[];
    provenance: {
        specialist: string;
        generatedAt: number;
        /** The exact Issue revision this was compiled from — the revision the ExecutionBinding pinned. */
        sourceIssueRevision?: string;
    };
}
/** The resolved-work projection the compiler consumes (see WorkItemView in workitem-store.ts). */
export interface WorkRefInput {
    ref: string;
    title: string;
    contract: unknown;
}
export interface CompileStepContractInput {
    work: WorkRefInput;
    /** The pinned revision; the compiler never reads a "latest" (§9). */
    revision: number;
    specialist: string;
    /** The Specialist's configured response format, if any. */
    responseFormat?: string;
    now?: () => number;
}
/**
 * Compile the bounded contract for one activation.
 *
 * Assumes the Issue already passed the dispatch gate, so the structured contract is
 * present and non-empty. It stays total anyway — a missing field yields an empty
 * projection rather than a throw, because a compiler that can abort an admitted
 * activation turns a documentation problem into an outage.
 */
export declare function compileStepContract(input: CompileStepContractInput): StepContract;
//# sourceMappingURL=step-contract.d.ts.map