export type PayloadComponentKind = 'system_prompt' | 'task_template' | 'mandatory_rule' | 'skill' | 'pre_script_output' | 'memory' | 'bead_context';
export interface PayloadComponentMeasurement {
    kind: PayloadComponentKind;
    name: string;
    tokens: number;
    bytes: number;
}
export interface PayloadBreakdown {
    components: PayloadComponentMeasurement[];
    totals: {
        tokens: number;
        bytes: number;
    };
}
export declare function estimateTokens(text: string): number;
export declare function measureUtf8Bytes(text: string): number;
export declare function measurePayloadComponent(kind: PayloadComponentKind, name: string, text: string): PayloadComponentMeasurement;
export declare function summarizePayloadBreakdown(components: PayloadComponentMeasurement[]): PayloadBreakdown;
//# sourceMappingURL=payload-measure.d.ts.map