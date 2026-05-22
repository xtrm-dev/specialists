interface AttachTarget {
    id: string;
    status?: string;
    specialist: string;
    beadId?: string;
    terminal: boolean;
}
export declare function run(target: AttachTarget): Promise<void>;
export {};
//# sourceMappingURL=attach-tui.d.ts.map