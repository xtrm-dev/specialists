import * as z from 'zod';
export declare const substrateIssueSchema: z.ZodObject<{
    op: z.ZodEnum<["resolve", "get", "create", "update_contract", "project_resolve", "project_create", "link_checkout", "list_links"]>;
    ref: z.ZodOptional<z.ZodString>;
    issue_id: z.ZodOptional<z.ZodString>;
    contract: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    title: z.ZodOptional<z.ZodString>;
    project_id: z.ZodOptional<z.ZodString>;
    prefix: z.ZodOptional<z.ZodString>;
    name: z.ZodOptional<z.ZodString>;
    git_root: z.ZodOptional<z.ZodString>;
    idempotency_key: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    op: "create" | "get" | "resolve" | "update_contract" | "project_resolve" | "project_create" | "link_checkout" | "list_links";
    name?: string | undefined;
    issue_id?: string | undefined;
    contract?: Record<string, unknown> | undefined;
    title?: string | undefined;
    idempotency_key?: string | undefined;
    ref?: string | undefined;
    prefix?: string | undefined;
    project_id?: string | undefined;
    git_root?: string | undefined;
}, {
    op: "create" | "get" | "resolve" | "update_contract" | "project_resolve" | "project_create" | "link_checkout" | "list_links";
    name?: string | undefined;
    issue_id?: string | undefined;
    contract?: Record<string, unknown> | undefined;
    title?: string | undefined;
    idempotency_key?: string | undefined;
    ref?: string | undefined;
    prefix?: string | undefined;
    project_id?: string | undefined;
    git_root?: string | undefined;
}>;
interface IssueServiceLike {
    resolveRef(ref: string): unknown;
    getIssue(id: string): unknown;
    createIssue(input: unknown, opts?: {
        idempotencyKey?: string;
    }): unknown;
    updateContract(id: string, contract: unknown): unknown;
    resolveProject(input: {
        explicit?: string;
    }): unknown;
    createProject(input: {
        prefix: string;
        name: string;
    }): unknown;
    linkCheckout(gitRoot: string, projectId?: string): unknown;
    listLinks(): readonly unknown[];
}
export declare function createSubstrateIssueTool(getIssues?: () => IssueServiceLike | null): {
    name: string;
    description: string;
    execute(raw: unknown): Promise<unknown>;
};
export {};
//# sourceMappingURL=issue.tool.d.ts.map