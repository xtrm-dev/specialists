import * as z from 'zod';
import type { NativeActivationHost } from '../../activation/native-host.js';
import type { RuntimeEventPusher } from '../../activation/async-events.js';
import { type ObservabilitySqliteClient } from '../../specialist/observability-sqlite.js';
export declare const specialistResultSchema: z.ZodObject<{
    activation_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    activation_id: string;
}, {
    activation_id: string;
}>;
type ResultSource = 'memory' | 'observability_db';
/**
 * Read ONE settled activation's complete result. specialist_status stays the
 * fleet view; this is the drill-down, so the output is never truncated.
 *
 * Lookup order: in-memory results of this server, then the durable
 * observability.db `specialist_results` row, then host state guidance.
 */
export declare function createSpecialistResultTool(getHost?: () => NativeActivationHost | undefined, getPusher?: () => RuntimeEventPusher | undefined, openObservability?: () => ObservabilitySqliteClient | null): {
    name: "specialist_result";
    description: string;
    inputSchema: z.ZodObject<{
        activation_id: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        activation_id: string;
    }, {
        activation_id: string;
    }>;
    execute(input: z.infer<typeof specialistResultSchema>): Promise<{
        status: "error";
        error: string;
        candidates: string[];
        activation_id?: undefined;
        specialist?: undefined;
        issue_ref?: undefined;
        output?: undefined;
        validation?: undefined;
        resolved_model?: undefined;
        completed_at?: undefined;
        source?: undefined;
        state?: undefined;
        next?: undefined;
    } | {
        activation_id: string;
        specialist: string | null;
        issue_ref: string;
        status: string;
        output: {};
        validation: {
            valid: boolean;
            schema?: string;
            errors?: string[];
        };
        resolved_model: string;
        completed_at: number;
        source: ResultSource;
        error?: undefined;
        candidates?: undefined;
        state?: undefined;
        next?: undefined;
    } | {
        activation_id: string;
        specialist: string | null;
        issue_ref: string | null;
        status: import("../../specialist/status-contract.ts").SupervisorJobStatus;
        output: string;
        validation: null;
        resolved_model: string | null;
        completed_at: number | null;
        source: ResultSource;
        error?: undefined;
        candidates?: undefined;
        state?: undefined;
        next?: undefined;
    } | {
        activation_id: string;
        state: import("../../lib.ts").ActivationState;
        next: string;
        status?: undefined;
        error?: undefined;
        candidates?: undefined;
        specialist?: undefined;
        issue_ref?: undefined;
        output?: undefined;
        validation?: undefined;
        resolved_model?: undefined;
        completed_at?: undefined;
        source?: undefined;
    } | {
        status: "error";
        error: string;
        candidates?: undefined;
        activation_id?: undefined;
        specialist?: undefined;
        issue_ref?: undefined;
        output?: undefined;
        validation?: undefined;
        resolved_model?: undefined;
        completed_at?: undefined;
        source?: undefined;
        state?: undefined;
        next?: undefined;
    }>;
};
export {};
//# sourceMappingURL=specialist_result.tool.d.ts.map