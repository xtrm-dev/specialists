export interface AppendBeadNoteOptions {
    timeoutMs?: number;
}
export declare function appendBeadNote(beadId: string, text: string, opts?: AppendBeadNoteOptions): Promise<{
    ok: boolean;
    error?: string;
}>;
//# sourceMappingURL=bead-notes.d.ts.map