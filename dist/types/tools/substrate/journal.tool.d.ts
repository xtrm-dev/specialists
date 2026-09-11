import * as z from 'zod';
export declare const substrateJournalSchema: z.ZodObject<{
    op: z.ZodEnum<["append", "get", "list", "since", "latest_checkpoint", "checkpoint"]>;
    issueId: z.ZodOptional<z.ZodString>;
    entryId: z.ZodOptional<z.ZodString>;
    kind: z.ZodOptional<z.ZodEnum<["checkpoint", "handoff", "milestone", "decision", "finding", "blocker", "compaction", "note"]>>;
    cursor: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
    summary: z.ZodOptional<z.ZodString>;
    runId: z.ZodOptional<z.ZodString>;
    participantId: z.ZodOptional<z.ZodString>;
    sessionId: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
    summary?: string | undefined;
    kind?: "compaction" | "decision" | "checkpoint" | "blocker" | "finding" | "note" | "handoff" | "milestone" | undefined;
    limit?: number | undefined;
    participantId?: string | undefined;
    cursor?: number | undefined;
    sessionId?: string | undefined;
    issueId?: string | undefined;
    entryId?: string | undefined;
    runId?: string | undefined;
}, {
    op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
    summary?: string | undefined;
    kind?: "compaction" | "decision" | "checkpoint" | "blocker" | "finding" | "note" | "handoff" | "milestone" | undefined;
    limit?: number | undefined;
    participantId?: string | undefined;
    cursor?: number | undefined;
    sessionId?: string | undefined;
    issueId?: string | undefined;
    entryId?: string | undefined;
    runId?: string | undefined;
}>;
type JournalInput = z.infer<typeof substrateJournalSchema>;
export interface JournalServiceLike {
    appendEntry(issueId: string, input: Record<string, unknown>): unknown;
    getEntry(id: string): unknown;
    listEntries(issueId: string, opts?: {
        kind?: string;
        limit?: number;
    }): unknown[];
    since(issueId: string, cursor: number): {
        issueId: string;
        afterSequence: number;
        entries: unknown[];
        nextCursor: number;
    };
    latestCheckpoint(issueId: string): unknown;
    collectMechanical(issueId: string, input?: Record<string, unknown>): Record<string, unknown>;
}
export type GetJournal = () => JournalServiceLike | null;
export declare function createSubstrateJournalTool(getJournal: GetJournal): {
    name: "substrate_journal";
    description: string;
    inputSchema: z.ZodObject<{
        op: z.ZodEnum<["append", "get", "list", "since", "latest_checkpoint", "checkpoint"]>;
        issueId: z.ZodOptional<z.ZodString>;
        entryId: z.ZodOptional<z.ZodString>;
        kind: z.ZodOptional<z.ZodEnum<["checkpoint", "handoff", "milestone", "decision", "finding", "blocker", "compaction", "note"]>>;
        cursor: z.ZodOptional<z.ZodNumber>;
        limit: z.ZodOptional<z.ZodNumber>;
        summary: z.ZodOptional<z.ZodString>;
        runId: z.ZodOptional<z.ZodString>;
        participantId: z.ZodOptional<z.ZodString>;
        sessionId: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
        summary?: string | undefined;
        kind?: "compaction" | "decision" | "checkpoint" | "blocker" | "finding" | "note" | "handoff" | "milestone" | undefined;
        limit?: number | undefined;
        participantId?: string | undefined;
        cursor?: number | undefined;
        sessionId?: string | undefined;
        issueId?: string | undefined;
        entryId?: string | undefined;
        runId?: string | undefined;
    }, {
        op: "append" | "list" | "checkpoint" | "get" | "since" | "latest_checkpoint";
        summary?: string | undefined;
        kind?: "compaction" | "decision" | "checkpoint" | "blocker" | "finding" | "note" | "handoff" | "milestone" | undefined;
        limit?: number | undefined;
        participantId?: string | undefined;
        cursor?: number | undefined;
        sessionId?: string | undefined;
        issueId?: string | undefined;
        entryId?: string | undefined;
        runId?: string | undefined;
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
        issueId?: undefined;
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
        issueId?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        degraded?: undefined;
        error?: undefined;
    } | {
        status: string;
        issueId: string;
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
        issueId?: undefined;
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
        issueId?: undefined;
        afterSequence?: undefined;
        nextCursor?: undefined;
        degraded?: undefined;
    }>;
};
export {};
//# sourceMappingURL=journal.tool.d.ts.map