import type { LeaseProcessProbe } from '../activation/workspace-lease.js';
export declare const LEASE_USAGE: string;
export interface LeaseCliIo {
    cwd: string;
    out: (text: string) => void;
    err: (text: string) => void;
    probe?: LeaseProcessProbe;
    decidedBy?: string;
}
export declare function runLeaseCommand(argv: string[], io: LeaseCliIo): number;
export declare function run(): void;
//# sourceMappingURL=lease.d.ts.map