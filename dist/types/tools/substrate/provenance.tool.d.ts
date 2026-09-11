import * as z from 'zod';
/** Bound for every collection in every payload (unitAI-aiwva.8 lesson). */
export declare const MAX_PROVENANCE_ENTRIES = 50;
export declare const substrateProvenanceSchema: z.ZodObject<{
    op: z.ZodEnum<["trace", "bindings", "receipts", "find_by_commit", "find_by_pr", "artifacts", "bind_commit", "bundle"]>;
    issueId: z.ZodOptional<z.ZodString>;
    receiptId: z.ZodOptional<z.ZodString>;
    sha: z.ZodOptional<z.ZodString>;
    pr: z.ZodOptional<z.ZodString>;
    liveOnly: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    op: "trace" | "artifacts" | "bindings" | "receipts" | "find_by_commit" | "find_by_pr" | "bind_commit" | "bundle";
    pr?: string | undefined;
    sha?: string | undefined;
    issueId?: string | undefined;
    receiptId?: string | undefined;
    liveOnly?: boolean | undefined;
}, {
    op: "trace" | "artifacts" | "bindings" | "receipts" | "find_by_commit" | "find_by_pr" | "bind_commit" | "bundle";
    pr?: string | undefined;
    sha?: string | undefined;
    issueId?: string | undefined;
    receiptId?: string | undefined;
    liveOnly?: boolean | undefined;
}>;
export type SubstrateProvenanceInput = z.infer<typeof substrateProvenanceSchema>;
/**
 * Structural mirror of the ProvenanceService methods this tool calls.
 * `unknown` payloads keep this file decoupled from Substrate domain types.
 */
export interface ProvenanceServiceLike {
    trace(issueId: string): {
        bindings: unknown[];
        receipts: unknown[];
        checkpoints: unknown[];
        commits: unknown[];
        prs: unknown[];
        claims: unknown[];
        externalBindings: unknown[];
        [key: string]: unknown;
    };
    listBindings(issueId: string): unknown[];
    listReceipts(issueId: string): unknown[];
    findByCommit(sha: string): unknown[];
    findByPr(ref: string): unknown[];
    listArtifacts(receiptId: string, opts?: {
        liveOnly?: boolean;
    }): unknown[];
    bindCommit(receiptId: string, sha: string): unknown;
    generateBundle(issueId: string): {
        path: string;
    };
}
export declare function createSubstrateProvenanceTool(getProvenance: () => ProvenanceServiceLike | null): {
    name: "substrate_provenance";
    description: string;
    inputSchema: z.ZodObject<{
        op: z.ZodEnum<["trace", "bindings", "receipts", "find_by_commit", "find_by_pr", "artifacts", "bind_commit", "bundle"]>;
        issueId: z.ZodOptional<z.ZodString>;
        receiptId: z.ZodOptional<z.ZodString>;
        sha: z.ZodOptional<z.ZodString>;
        pr: z.ZodOptional<z.ZodString>;
        liveOnly: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        op: "trace" | "artifacts" | "bindings" | "receipts" | "find_by_commit" | "find_by_pr" | "bind_commit" | "bundle";
        pr?: string | undefined;
        sha?: string | undefined;
        issueId?: string | undefined;
        receiptId?: string | undefined;
        liveOnly?: boolean | undefined;
    }, {
        op: "trace" | "artifacts" | "bindings" | "receipts" | "find_by_commit" | "find_by_pr" | "bind_commit" | "bundle";
        pr?: string | undefined;
        sha?: string | undefined;
        issueId?: string | undefined;
        receiptId?: string | undefined;
        liveOnly?: boolean | undefined;
    }>;
    execute(input: SubstrateProvenanceInput): Promise<{
        bindings: unknown[];
        bindingsTotal: number;
        bindingsTruncated: boolean;
        receipts: unknown[];
        receiptsTotal: number;
        receiptsTruncated: boolean;
        commits: unknown[];
        commitsTotal: number;
        prs: unknown[];
        prsTotal: number;
        checkpoints: unknown[];
        checkpointsTotal: number;
        claims: unknown[];
        claimsTotal: number;
        externalBindings: unknown[];
        externalBindingsTotal: number;
        status: string;
        total?: undefined;
        truncated?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        bindings: unknown[];
        total: number;
        truncated: boolean;
        receipts?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        receipts: unknown[];
        total: number;
        truncated: boolean;
        bindings?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        matches: unknown[];
        total: number;
        truncated: boolean;
        bindings?: undefined;
        receipts?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        artifacts: unknown[];
        total: number;
        truncated: boolean;
        bindings?: undefined;
        receipts?: undefined;
        matches?: undefined;
        receipt?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        receipt: unknown;
        bindings?: undefined;
        total?: undefined;
        truncated?: undefined;
        receipts?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        path?: undefined;
        error?: undefined;
    } | {
        status: string;
        path: string;
        bindings?: undefined;
        total?: undefined;
        truncated?: undefined;
        receipts?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        error?: undefined;
    } | {
        status: string;
        error: string;
        bindings?: undefined;
        total?: undefined;
        truncated?: undefined;
        receipts?: undefined;
        matches?: undefined;
        artifacts?: undefined;
        receipt?: undefined;
        path?: undefined;
    }>;
};
//# sourceMappingURL=provenance.tool.d.ts.map