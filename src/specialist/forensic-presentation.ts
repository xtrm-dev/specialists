import type { ForensicEvent } from './forensic-events.js';

/**
 * Canonical default LOG suppression policy.
 *
 * sp log, sp console LOG and the native Pi overlay must all use this
 * predicate so a persisted event has one inclusion rule across operator
 * surfaces. --all-events/verbose bypasses this predicate but never bypasses
 * forensic redaction.
 */
export function isForensicAgentInternal(event: ForensicEvent): boolean {
  if (event.event_family === 'turn') return true;
  if (event.event_family === 'tool') return true;
  const name = event.event_name;
  return name === 'model.token_usage.recorded'
    || name === 'model.finish_reason.recorded'
    || name.startsWith('model.meta')
    || name === 'mcp.call.started'
    || name === 'mcp.call.completed'
    || name === 'mcp.call.failed'
    || name === 'mcp.latency.observed';
}
