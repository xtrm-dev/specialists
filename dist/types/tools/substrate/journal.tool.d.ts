import * as z from 'zod';
export declare const substrateJournalSchema: z.ZodObject<{
    op: z.ZodEnum<["append", "get", "list", "since", "latest_checkpoint", "checkpoint"]>;
    issue_id: z.ZodOptional<z.ZodString>;
    entry_id: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<["checkpoint", "handoff", "milestone", "decision", "finding", "blocker", "compaction", "note"]>>;
    cursor: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
    summary: z.ZodOptional<z.ZodString>;
    run_id: z.ZodOptional<z.ZodString>;
    participant_id: z.ZodOptional<z.ZodString>;
    session_id: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
    summary?: string | undefined;
    participant_id?: string | undefined;
    issue_id?: string | undefined;
    session_id?: string | undefined;
    kind?: "compaction" | "decision" | "checkpoint" | "finding" | "note" | "blocker" | "handoff" | "milestone" | undefined;
    limit?: number | undefined;
    entry_id?: string | undefined;
    cursor?: number | undefined;
    run_id?: string | undefined;
}, {
    op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
    summary?: string | undefined;
    participant_id?: string | undefined;
    issue_id?: string | undefined;
    session_id?: string | undefined;
    kind?: "compaction" | "decision" | "checkpoint" | "finding" | "note" | "blocker" | "handoff" | "milestone" | undefined;
    limit?: number | undefined;
    entry_id?: string | undefined;
    cursor?: number | undefined;
    run_id?: string | undefined;
}>;
type JournalInput = z.infer<typeof substrateJournalSchema>;
export interface JournalServiceLike {
    appendEntry(issue_id: string, input: Record<string, unknown>): unknown;
    getEntry(id: string): unknown;
    listEntries(issue_id: string, opts?: {
        kind?: string;
        limit?: number;
    }): unknown[];
    since(issue_id: string, cursor: number): {
        issue_id: string;
        afterSequence: number;
        entries: unknown[];
        nextCursor: number;
    };
    latestCheckpoint(issue_id: string): unknown;
    collectMechanical(issue_id: string, input?: Record<string, unknown>): Record<string, unknown>;
}
export type GetJournal = () => JournalServiceLike | null;
export declare function createSubstrateJournalTool(getJournal: GetJournal): {
    name: "substrate_journal";
    description: string;
    inputSchema: z.ZodObject<{
        op: z.ZodEnum<["append", "get", "list", "since", "latest_checkpoint", "checkpoint"]>;
        issue_id: z.ZodOptional<z.ZodString>;
        entry_id: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<["checkpoint", "handoff", "milestone", "decision", "finding", "blocker", "compaction", "note"]>>;
        cursor: z.ZodOptional<z.ZodNumber>;
        limit: z.ZodOptional<z.ZodNumber>;
        summary: z.ZodOptional<z.ZodString>;
        run_id: z.ZodOptional<z.ZodString>;
        participant_id: z.ZodOptional<z.ZodString>;
        session_id: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
        summary?: string | undefined;
        participant_id?: string | undefined;
        issue_id?: string | undefined;
        session_id?: string | undefined;
        kind?: "compaction" | "decision" | "checkpoint" | "finding" | "note" | "blocker" | "handoff" | "milestone" | undefined;
        limit?: number | undefined;
        entry_id?: string | undefined;
        cursor?: number | undefined;
        run_id?: string | undefined;
    }, {
        op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
        summary?: string | undefined;
        participant_id?: string | undefined;
        issue_id?: string | undefined;
        session_id?: string | undefined;
        kind?: "compaction" | "decision" | "checkpoint" | "finding" | "note" | "blocker" | "handoff" | "milestone" | undefined;
        limit?: number | undefined;
        entry_id?: string | undefined;
        cursor?: number | undefined;
        run_id?: string | undefined;
    }>;
    execute(input: JournalInput): Promise<{
        readonly status: "error";
        readonly error: string;
    } | {
        status: string;
        entry: unknown;
        entries?: undefined;
        count?: undefined;
        capped?: undefined;
        issue_id?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        degraded?: undefined;
        error?: undefined;
    } | {
        status: string;
        entries: unknown[];
        count: number;
        capped: boolean;
        entry?: undefined;
        issue_id?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        degraded?: undefined;
        error?: undefined;
    } | {
        status: string;
        issue_id: string;
        afterSequence: number;
        entries: unknown[];
        nextCursor: number;
        entry?: undefined;
        count?: undefined;
        capped?: undefined;
        degraded?: undefined;
        error?: undefined;
    } | {
        status: string;
        entry: unknown;
        degraded: boolean;
        entries?: undefined;
        count?: undefined;
        capped?: undefined;
        issue_id?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        error?: undefined;
    } | {
        status: string;
        error: string;
        entry?: undefined;
        entries?: undefined;
        count?: undefined;
        capped?: undefined;
        issue_id?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        degraded?: undefined;
    }>;
};
export {};
//# sourceMappingURL=journal.tool.d.ts.map