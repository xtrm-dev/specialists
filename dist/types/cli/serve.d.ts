import { type IncomingMessage, type ServerResponse } from 'node:http';
interface ServeArgs {
    port: number;
    concurrency: number;
    queueTimeoutMs: number;
    shutdownGraceMs: number;
    projectDir: string;
    dbPath?: string;
    fallbackModel?: string;
    auditFailureThreshold: number;
    allowSkills: boolean;
    allowSkillsRoots: string[];
    reloadPollMs: number;
    readinessCanaryMode: 'off' | 'warn' | 'require';
    readinessRequiredPiFlags: string[];
    readinessCanarySpecialist?: string;
    readinessCanaryTimeoutMs: number;
    logLevel: 'off' | 'info' | 'debug';
}
export type ReadinessReason = 'draining' | 'degraded:audit' | 'pi_config_unreadable' | 'db_not_writable' | 'pi_binary_missing' | 'pi_flag_missing' | 'pi_smoke_failed' | 'empty_user_dir' | 'invalid_spec_in_user_dir';
export interface ReadinessState {
    shuttingDown: boolean;
    auditFailures: number[];
    dbWriteFailuresTotal: number;
}
export declare function createReadinessState(): ReadinessState;
export declare function recordAuditFailure(state: ReadinessState, now?: number): void;
export interface ReadinessCheckOptions {
    state: ReadinessState;
    projectDir: string;
    dbPath: string;
    piConfigPath?: string;
    auditFailureThreshold: number;
    now?: number;
    piCanaryMode?: 'off' | 'warn' | 'require';
    piCanaryCheck?: () => Promise<ReadinessReason | undefined> | ReadinessReason | undefined;
}
export declare function evaluateReadiness(opts: ReadinessCheckOptions): Promise<{
    ready: true;
    warning?: ReadinessReason;
} | {
    ready: false;
    reason: ReadinessReason;
}>;
export declare function checkPiHelpForFlags(flags?: string[]): ReadinessReason | undefined;
/**
 * Rebuild a response body without stack traces. Errors become `{ name, message, code? }`, plain
 * objects lose stack-bearing keys, and exotic values (Date, Buffer) are left for JSON.stringify so
 * their existing encoding does not change.
 *
 * `seen` holds the ANCESTORS of the current value and is unwound on the way out, so only a real
 * cycle is `[circular]`; a body that legitimately reuses one object (`{a: x, b: x}`) keeps both
 * copies intact.
 */
export declare function toWireValue(value: unknown, seen?: WeakSet<object>, depth?: number): unknown;
/** JSON for the wire, with stack traces removed. */
export declare function serializeForWire(body: unknown): string;
/** Internal, exported so a test can prove the sink actually goes through the sanitizer. */
export declare function sendJson(res: ServerResponse, statusCode: number, body: unknown): void;
export declare function startServe(argv?: string[]): Promise<{
    server: import("node:http").Server<typeof IncomingMessage, typeof ServerResponse>;
    args: ServeArgs;
    db: import("../specialist/observability-sqlite.js").ObservabilitySqliteClient | null;
    readinessState: ReadinessState;
}>;
export declare function run(argv?: string[]): Promise<void>;
export {};
//# sourceMappingURL=serve.d.ts.map