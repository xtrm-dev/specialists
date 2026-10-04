// src/tools/specialist/specialist_status.tool.ts
import * as z from 'zod';
import type { SpecialistLoader } from '../../specialist/loader.js';
import type { CircuitBreaker } from '../../utils/circuitBreaker.js';
import { projectOutstandingAsks, type PendingInteractionProjection } from '../../activation/transport/polling.js';
import { leaseScopeFor, projectUncertainWorkspaces, type UncertainWorkspaceProjection } from '../../activation/workspace-reconcile.js';
import type { NativeActivationHost } from '../../activation/native-host.js';
import { toActivationCompactView, toActivationResultView, toActivationView, toPendingAskCompactView, toPendingAskView, type ActivationResultView, type ActivationView, type PendingAskView } from './activation.tool.js';
import type { RuntimeEventPusher } from '../../activation/async-events.js';

const BACKENDS = ['gemini', 'qwen', 'anthropic', 'openai'];

export const specialistStatusSchema = z.object({
  full: z.boolean().optional().describe(
    'Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.',
  ),
  wait_for_change: z.boolean().optional().describe(
    'Block until the compact Fleet projection actually changes (activation state/result, pending asks) or the timeout passes, then return the same payload as a normal call. One blocking call replaces a poll loop: ~1 call per timeout while nothing changes, and a real transition still returns within ~1s. Ignored when this server hosts no native Fleet.',
  ),
  timeout_s: z
    .number()
    .int()
    .min(1)
    .max(60)
    .optional()
    .describe('How long wait_for_change may block, in seconds (1-60, default 25). Keep it under the client tool-call timeout.'),
});

/** Fields the wait compares — the actionable set. Volatile display fields (elapsed_s, token_usage) are excluded so a running activation's turn noise does not unblock the wait. */
function fleetFingerprint(
  host: NativeActivationHost,
  results: { activationId: string; status: string }[],
): string {
  const activations = host.list().map(s => `${s.activationId}:${s.state}`).sort();
  const settled = results.map(r => `${r.activationId}:${r.status}`).sort();
  const asks = host.pendingAsks().map(a => a.message.messageId).sort();
  return JSON.stringify([activations, settled, asks]);
}

/**
 * Park on the host's fleet-change signal until the actionable fingerprint moves or the
 * deadline passes (SPECIALISTS-4218). The epoch is captured BEFORE the baseline
 * fingerprint, so a change landing between snapshot and registration is still caught
 * (level-triggered wake — see waitForFleetChange).
 */
async function waitForFleetChange(
  host: NativeActivationHost,
  getPusher: (() => RuntimeEventPusher | undefined) | undefined,
  timeoutMs: number,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  const epoch = host.fleetChangeEpoch();
  const baseline = fleetFingerprint(host, getPusher?.()?.allResults() ?? []);
  for (;;) {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return;
    const outcome = await host.waitForFleetChange(remaining, epoch);
    if (outcome === 'change' && fleetFingerprint(host, getPusher?.()?.allResults() ?? []) !== baseline) return;
    // A change that left the actionable fingerprint untouched (turn progress, usage
    // ticks) parks again for what is left of the budget.
  }
}

/**
 * @param getHost Native runtime, when this process hosts one. Optional so the CLI and the
 *   tests that build this tool without a Fleet keep working; PRD Phase 13 acceptance
 *   requires only that an MCP-dispatched activation reads back here IDENTICALLY to a
 *   CLI-dispatched one, which is why `activations` projects the host's own snapshots
 *   rather than a shape invented for MCP. A coordinator must not have to know which
 *   transport dispatched an activation in order to read it.
 */
export function createSpecialistStatusTool(
  loader: SpecialistLoader,
  circuitBreaker: CircuitBreaker,
  getHost?: () => NativeActivationHost | undefined,
  getPusher?: () => RuntimeEventPusher | undefined,
) {
  return {
    name: 'specialist_status' as const,
    description:
      'System health: backend circuit breaker states, loaded specialist count, and native in-process activations with any question they are waiting on — answer those with specialist_reply. Pass wait_for_change with timeout_s to block server-side until the fleet actually changes instead of polling.',
    inputSchema: specialistStatusSchema,
    async execute(input: z.infer<typeof specialistStatusSchema>) {
      // Compact default (SPECIALISTS-142): identity, state, cost, intent per row;
      // pending asks keep their body (the coordinator must answer). `full: true`
      // restores the pre-142 verbose shape byte-for-shape, so a coordinator or
      // script that parsed the verbose form opts back in with one flag.
      //
      // Every read below feeds ONLY the verbose payload, so it runs only there
      // (SPECIALISTS-4217). The compact default is what a coordinator polls, and
      // computing these for it rebuilt every specialist spec from all four config
      // layers and forked `git rev-parse` on each call — ~86 ms of CPU per poll that
      // the compact payload never shows.
      //
      // The native Fleet is an in-process AgentSession projection. It reads the host's own
      // `ActivationSnapshot`, so this is the same whether the activation was dispatched over
      // MCP or by the Pi extension.
      const host = getHost?.();
      // Blocking wait (SPECIALISTS-4218): park FIRST, answer SECOND, so the returned
      // payload is the post-change projection. No host means nothing to wait on and no
      // Fleet to report — fall straight through. The wait holds no database handle; the
      // timeout is clamped to the schema's 1-60s with a 25s default that sits under the
      // common 30s MCP client tool timeout.
      if (input.wait_for_change === true && host) {
        const timeoutS = Math.min(Math.max(input.timeout_s ?? 25, 1), 60);
        await waitForFleetChange(host, getPusher, timeoutS * 1000);
      }
      if (input.full === true) {
        const list = await loader.list();

        // The degraded path from the Claude transport decision: outstanding clarifications
        // must be readable WITHOUT the peer channel working. Projection only — never a
        // branch on wire_delivery, which is diagnosis. Absent state is the normal case, so a
        // repo with no interactions directory yields an empty list rather than an error.
        let pending_interactions: PendingInteractionProjection[] = [];
        try {
          pending_interactions = projectOutstandingAsks(process.cwd());
        } catch {
          pending_interactions = [];
        }

        // A workspace whose writer disappeared mid-mutation is refused to every acquirer until
        // someone reconciles it, and a refused reconciliation leaves it refused. Both states
        // are invisible without this: the lease record is under the git common dir and nothing
        // else reports it, so an operator would see a Specialist that cannot start and no
        // reason why. Reads the durable lease store only — same contract as the projection
        // above — and an empty list is the normal case.
        let uncertain_workspaces: UncertainWorkspaceProjection[] = [];
        try {
          uncertain_workspaces = projectUncertainWorkspaces(leaseScopeFor(process.cwd()));
        } catch {
          uncertain_workspaces = [];
        }

        const activations: ActivationView[] = host ? host.list().map(s => toActivationView(s)) : [];
        const pending_asks: PendingAskView[] = host ? host.pendingAsks().map(toPendingAskView) : [];
        // The read half of Phase 14. A completion notification is pushed toward a live
        // coordinator, but the push can be unroutable, held or refused and never reports
        // `delivered` on this channel at all — so the validated result must be readable
        // without one. This projects the SAME ActivationResult the push serialises, which is
        // what makes a pushed coordinator and a polling coordinator agree by construction.
        const activation_results: ActivationResultView[] =
          getPusher?.()?.allResults().map(toActivationResultView) ?? [];
        return {
          loaded_count: list.length,
          activations,
          pending_asks,
          activation_results,
          pending_interactions,
          uncertain_workspaces,
          backends_health: Object.fromEntries(BACKENDS.map(b => [b, circuitBreaker.getState(b)])),
        };
      }
      // Compact default: identity, state, cost, intent per activation; settled rows
      // carry only the result STATUS (the body is drill-down under `full`).
      // Pending asks keep the body — it is what the coordinator must answer.
      // Health/diagnostics sections (loaded_count, backends_health,
      // pending_interactions, uncertain_workspaces) are `full`-only.
      const hostResults = getPusher?.()?.allResults() ?? [];
      const statusById = new Map(hostResults.map(r => [r.activationId, r.status]));
      return {
        activations: host
          ? host.list().map(s => ({
            ...toActivationCompactView(s),
            ...(statusById.has(s.activationId) ? { result_status: statusById.get(s.activationId) } : {}),
          }))
          : [],
        pending_asks: host ? host.pendingAsks().map(toPendingAskCompactView) : [],
      };
    },
  };
}
