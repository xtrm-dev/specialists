export type PayloadComponentKind =
  | 'system_prompt'
  | 'task_template'
  | 'mandatory_rule'
  | 'skill'
  | 'pre_script_output'
  | 'memory'
  | 'bead_context';

export interface PayloadComponentMeasurement {
  kind: PayloadComponentKind;
  name: string;
  tokens: number;
  bytes: number;
}

export interface PayloadBreakdown {
  components: PayloadComponentMeasurement[];
  totals: { tokens: number; bytes: number };
}

export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.max(1, Math.ceil(text.length / 4));
}

export function measureUtf8Bytes(text: string): number {
  return Buffer.byteLength(text, 'utf8');
}

export function measurePayloadComponent(kind: PayloadComponentKind, name: string, text: string): PayloadComponentMeasurement {
  return { kind, name, tokens: estimateTokens(text), bytes: measureUtf8Bytes(text) };
}

export function summarizePayloadBreakdown(components: PayloadComponentMeasurement[]): PayloadBreakdown {
  return {
    components,
    totals: {
      tokens: components.reduce((sum, component) => sum + component.tokens, 0),
      bytes: components.reduce((sum, component) => sum + component.bytes, 0),
    },
  };
}
