import { type JobMetricsRecord, type ObservabilitySqliteClient } from './observability-sqlite.js';
import type { ForensicEvent } from './forensic-events.js';
import type { SupervisorStatus } from './supervisor.js';
export interface PrometheusProjectionOptions {
    repo?: string;
    sinceMs?: number;
    nowMs?: number;
}
export interface PrometheusProjectionInput {
    statuses: SupervisorStatus[];
    jobMetrics: JobMetricsRecord[];
    repo: string;
    nowMs?: number;
    forensicEvents?: ForensicEvent[];
}
export declare function collectPrometheusProjection(options?: PrometheusProjectionOptions): string;
export declare function collectPrometheusProjectionFromClient(client: Pick<ObservabilitySqliteClient, 'listStatuses' | 'listJobMetrics'>, options?: PrometheusProjectionOptions): string;
export declare function renderPrometheusProjection(input: PrometheusProjectionInput): string;
export declare function validatePrometheusProjectionText(text: string): {
    ok: true;
} | {
    ok: false;
    errors: string[];
};
//# sourceMappingURL=prometheus-projection.d.ts.map