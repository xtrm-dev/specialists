import * as z from 'zod';
import type { NativeActivationHost } from '../../activation/native-host.js';
import { type ObservabilitySqliteClient } from '../../specialist/observability-sqlite.js';
import type { TimelineEvent } from '../../specialist/timeline-events.js';
export declare const FEED_DEFAULT_LIMIT = 40;
export declare const FEED_MAX_LIMIT = 200;
/** One feed line never exceeds this, whatever a tool argument or text block held. */
export declare const FEED_LINE_MAX = 200;
export declare const specialistFeedSchema: z.ZodObject<{
    activation_id: z.ZodString;
    view: z.ZodOptional<z.ZodEnum<["terminal", "forensic"]>>;
    since_seq: z.ZodOptional<z.ZodNumber>;
    limit: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    activation_id: string;
    view?: "terminal" | "forensic" | undefined;
    limit?: number | undefined;
    since_seq?: number | undefined;
}, {
    activation_id: string;
    view?: "terminal" | "forensic" | undefined;
    limit?: number | undefined;
    since_seq?: number | undefined;
}>;
type FeedInput = z.infer<typeof specialistFeedSchema>;
/**
 * One terminal-view line for an event, or null for an event the terminal view hides.
 *
 * Hidden on purpose, as `sp feed` hides them: message/turn boundaries, per-message token
 * and finish-reason records, tool `update` phases and settlement bookkeeping. They are
 * all present in the forensic view.
 */
export declare function feedLine(event: TimelineEvent): string | null;
/**
 * An activation's event feed — the `sp feed` view for a coordinator.
 *
 * Reads the durable observability.db timeline the forensic sink writes for every native
 * activation, so it answers for a running activation, a settled one and one from an earlier
 * session alike. Bounded: the newest `limit` events, each line capped at FEED_LINE_MAX.
 * `last_seq` is the cursor for the next call.
 */
export declare function createSpecialistFeedTool(getHost?: () => NativeActivationHost | undefined, openObservability?: () => ObservabilitySqliteClient | null): {
    name: "specialist_feed";
    description: string;
    inputSchema: z.ZodObject<{
        activation_id: z.ZodString;
        view: z.ZodOptional<z.ZodEnum<["terminal", "forensic"]>>;
        since_seq: z.ZodOptional<z.ZodNumber>;
        limit: z.ZodOptional<z.ZodNumber>;
    }, "strip", z.ZodTypeAny, {
        activation_id: string;
        view?: "terminal" | "forensic" | undefined;
        limit?: number | undefined;
        since_seq?: number | undefined;
    }, {
        activation_id: string;
        view?: "terminal" | "forensic" | undefined;
        limit?: number | undefined;
        since_seq?: number | undefined;
    }>;
    execute(input: FeedInput): Promise<{
        status: "error";
        error: string;
        candidates?: undefined;
        activation_id?: undefined;
        view?: undefined;
        events?: undefined;
        last_seq?: undefined;
        total?: undefined;
        truncated?: undefined;
    } | {
        status: "error";
        error: string;
        candidates: string[];
        activation_id?: undefined;
        view?: undefined;
        events?: undefined;
        last_seq?: undefined;
        total?: undefined;
        truncated?: undefined;
    } | {
        activation_id: string;
        view: "forensic";
        events: string[];
        last_seq: number;
        total: number;
        truncated: boolean;
        status?: undefined;
        error?: undefined;
        candidates?: undefined;
    } | {
        activation_id: string;
        view: "terminal";
        events: string[];
        last_seq: number;
        total: number;
        truncated: boolean;
        status?: undefined;
        error?: undefined;
        candidates?: undefined;
    }>;
};
export {};
//# sourceMappingURL=specialist_feed.tool.d.ts.map