import * as z from 'zod';
import type { LeaseProcessProbe } from '../../activation/workspace-lease.js';
export declare const specialistLeaseReconcileSchema: z.ZodObject<{
    action: z.ZodDefault<z.ZodEnum<["list", "reconcile"]>>;
    worktree: z.ZodOptional<z.ZodString>;
    outcome: z.ZodOptional<z.ZodEnum<["safe_free", "superseded", "manual_attention_required"]>>;
    basis: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    superseded_by: z.ZodOptional<z.ZodString>;
    note: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    action: "list" | "reconcile";
    outcome?: "superseded" | "safe_free" | "manual_attention_required" | undefined;
    note?: string | undefined;
    worktree?: string | undefined;
    basis?: string[] | undefined;
    superseded_by?: string | undefined;
}, {
    outcome?: "superseded" | "safe_free" | "manual_attention_required" | undefined;
    action?: "list" | "reconcile" | undefined;
    note?: string | undefined;
    worktree?: string | undefined;
    basis?: string[] | undefined;
    superseded_by?: string | undefined;
}>;
/**
 * List and reconcile uncertain writer leases. The caller states the outcome and basis;
 * reconcile() validates and records it, and a refusal is returned as a result.
 */
export declare function createSpecialistLeaseReconcileTool(probe?: LeaseProcessProbe): {
    name: "specialist_lease_reconcile";
    description: string;
    inputSchema: z.ZodObject<{
        action: z.ZodDefault<z.ZodEnum<["list", "reconcile"]>>;
        worktree: z.ZodOptional<z.ZodString>;
        outcome: z.ZodOptional<z.ZodEnum<["safe_free", "superseded", "manual_attention_required"]>>;
        basis: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
        superseded_by: z.ZodOptional<z.ZodString>;
        note: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        action: "list" | "reconcile";
        outcome?: "superseded" | "safe_free" | "manual_attention_required" | undefined;
        note?: string | undefined;
        worktree?: string | undefined;
        basis?: string[] | undefined;
        superseded_by?: string | undefined;
    }, {
        outcome?: "superseded" | "safe_free" | "manual_attention_required" | undefined;
        action?: "list" | "reconcile" | undefined;
        note?: string | undefined;
        worktree?: string | undefined;
        basis?: string[] | undefined;
        superseded_by?: string | undefined;
    }>;
    execute(input: z.infer<typeof specialistLeaseReconcileSchema>): Promise<{
        uncertain_workspaces: import("../../activation/workspace-reconcile.js").UncertainWorkspaceProjection[];
        status?: undefined;
        error?: undefined;
        applied?: undefined;
        outcome?: undefined;
        refusal_reason?: undefined;
        record?: undefined;
    } | {
        status: "error";
        error: string;
        uncertain_workspaces?: undefined;
        applied?: undefined;
        outcome?: undefined;
        refusal_reason?: undefined;
        record?: undefined;
    } | {
        applied: boolean;
        outcome: import("../../activation/workspace-reconcile.js").ReconciliationOutcome;
        refusal_reason: import("../../activation/workspace-reconcile.js").RefusalReason | null;
        record: import("../../activation/workspace-reconcile.js").ReconciliationRecord;
        uncertain_workspaces?: undefined;
        status?: undefined;
        error?: undefined;
    }>;
};
//# sourceMappingURL=specialist_lease_reconcile.tool.d.ts.map