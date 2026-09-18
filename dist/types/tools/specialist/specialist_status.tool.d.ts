import * as z from 'zod';
import type { SpecialistLoader } from '../../specialist/loader.js';
import type { CircuitBreaker } from '../../utils/circuitBreaker.js';
import { type PendingInteractionProjection } from '../../activation/transport/polling.js';
import { type UncertainWorkspaceProjection } from '../../activation/workspace-reconcile.js';
import type { NativeActivationHost } from '../../activation/native-host.js';
import { type ActivationResultView, type ActivationView, type PendingAskView } from './activation.tool.js';
import type { RuntimeEventPusher } from '../../activation/async-events.js';
export declare const specialistStatusSchema: z.ZodObject<{
    full: z.ZodOptional<z.ZodBoolean>;
}, "strip", z.ZodTypeAny, {
    full?: boolean | undefined;
}, {
    full?: boolean | undefined;
}>;
/**
 * @param getHost Native runtime, when this process hosts one. Optional so the CLI and the
 *   tests that build this tool without a Fleet keep working; PRD Phase 13 acceptance
 *   requires only that an MCP-dispatched activation reads back here IDENTICALLY to a
 *   CLI-dispatched one, which is why `activations` projects the host's own snapshots
 *   rather than a shape invented for MCP. A coordinator must not have to know which
 *   transport dispatched an activation in order to read it.
 */
export declare function createSpecialistStatusTool(loader: SpecialistLoader, circuitBreaker: CircuitBreaker, getHost?: () => NativeActivationHost | undefined, getPusher?: () => RuntimeEventPusher | undefined): {
    name: "specialist_status";
    description: string;
    inputSchema: z.ZodObject<{
        full: z.ZodOptional<z.ZodBoolean>;
    }, "strip", z.ZodTypeAny, {
        full?: boolean | undefined;
    }, {
        full?: boolean | undefined;
    }>;
    execute(input: z.infer<typeof specialistStatusSchema>): Promise<{
        loaded_count: number;
        activations: ActivationView[];
        pending_asks: PendingAskView[];
        activation_results: ActivationResultView[];
        pending_interactions: PendingInteractionProjection[];
        uncertain_workspaces: UncertainWorkspaceProjection[];
        backends_health: {
            [k: string]: "CLOSED" | "HALF_OPEN" | "OPEN";
        };
    } | {
        activations: {
            result_status?: string;
            activation_id: string;
            specialist: string;
            bead_id: string;
            state: string;
            access: "read" | "write";
            resolved_model: string;
            thinking_level?: string;
            elapsed_s: number;
            turn_count?: number;
            token_usage?: import("../../activation/types.ts").ActivationTokenUsage;
            purpose?: string;
        }[];
        pending_asks: import("./activation.tool.js").PendingAskCompactView[];
        loaded_count?: undefined;
        activation_results?: undefined;
        pending_interactions?: undefined;
        uncertain_workspaces?: undefined;
        backends_health?: undefined;
    }>;
};
//# sourceMappingURL=specialist_status.tool.d.ts.map