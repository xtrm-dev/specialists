import { type ChatState } from './chat/control.js';
import type { AttachRuntimeDeps } from './attach.js';
interface AttachTarget {
    id: string;
    status?: ChatState;
    specialist: string;
    beadId?: string;
    terminal: boolean;
    fifoPath?: string;
}
export declare function run(target: AttachTarget, deps?: AttachRuntimeDeps): Promise<void>;
export {};
//# sourceMappingURL=attach-tui.d.ts.map