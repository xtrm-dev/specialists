/** The eleven specialist_* tools, in v2 registration order. */
export declare const SPECIALIST_TOOL_NAMES: readonly ["specialist_status", "specialist_result", "specialist_feed", "specialist_dispatch", "specialist_reply", "specialist_resume", "specialist_retry", "specialist_steer", "specialist_stop_activation", "specialist_list", "specialist_lease_reconcile"];
export type SpecialistToolName = (typeof SPECIALIST_TOOL_NAMES)[number];
/** The v2 server (src/mcp/v2-server.ts) and the Pi extension expose all eleven. */
export declare const V2_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[];
export declare const PI_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[];
/**
 * The v1 server (src/server.ts) predates specialist_feed and specialist_resume
 * and exposes the other nine. A new tool fails the drift test until it is
 * classified here.
 */
export declare const V1_SPECIALIST_TOOL_NAMES: readonly SpecialistToolName[];
/**
 * Runtime-neutral tool descriptions. The reconciled wording keeps every
 * normative sentence both surfaces already pinned (duty to stop, persistence
 * until stopped, activation ownership, small-work-belongs-here, no CLI
 * routing) and states the contract parts ONCE: an inline 7-section contract
 * plus a SCRUTINY level — eight required parts, not seven.
 */
export declare const SPECIALIST_TOOL_DESCRIPTIONS: Record<SpecialistToolName, string>;
/**
 * Declared MCP-only suffixes. The ONLY description text an MCP surface may
 * carry beyond the shared base.
 */
export declare const MCP_TOOL_DESCRIPTION_SUFFIXES: Partial<Record<SpecialistToolName, string>>;
/**
 * Declared Pi-only suffixes. The ONLY description text the Pi surface may
 * carry beyond the shared base — the follow-up-message delivery wording
 * instead of the Channel push, and the Pi dispatch-surface note.
 */
export declare const PI_TOOL_DESCRIPTION_SUFFIXES: Partial<Record<SpecialistToolName, string>>;
/** The exact description text a surface emits for a tool: shared base plus its declared suffix. */
export declare function specialistToolDescription(name: SpecialistToolName, runtime: 'mcp' | 'pi'): string;
/** Compact-by-default flag, shared by every verbose tool (SPECIALISTS-142). */
export declare const SPECIALIST_FULL_PARAM = "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
export declare const SPECIALIST_DISPATCH_PARAMS: {
    readonly specialist: "Specialist name, e.g. codebase-explorer";
    readonly issue_ref: string;
    readonly bead_id: string;
    readonly contract: string;
    readonly title: string;
    readonly parent_ref: string;
    readonly kind: string;
    readonly model_override: string;
    readonly thinking_override: string;
    readonly epic_context_depth: string;
    readonly full: "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
};
/**
 * The two dispatch params that name their own runtime. One definition per
 * runtime, declared here — not a fork.
 */
export declare const SPECIALIST_DISPATCH_RUNTIME_PARAMS: {
    readonly mcp: {
        readonly requested_by: "ParticipantId of the requesting coordinator. Defaults to the MCP gateway participant.";
        readonly coordinator_session_id: "MCP session id, for lineage.";
    };
    readonly pi: {
        readonly requested_by: "ParticipantId of the requesting coordinator. Defaults to the Pi extension adapter participant.";
        readonly coordinator_session_id: "Pi session id, for lineage.";
    };
};
export declare const SPECIALIST_STATUS_PARAMS: {
    readonly full: "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
    readonly wait_for_change: string;
    readonly timeout_s: string;
};
export declare const SPECIALIST_RESULT_PARAMS: {
    readonly activation_id: string;
};
export declare const SPECIALIST_FEED_PARAMS: {
    readonly activation_id: "Activation id: the full id or a unique short prefix, e.g. 'act:a2924153' or 'a2924153'.";
    readonly view: string;
    readonly since_seq: string;
};
/** The feed limit help stays in lockstep with the numeric bounds by construction. */
export declare function specialistFeedLimitDescription(defaultLimit: number, maxLimit: number): string;
export declare const SPECIALIST_REPLY_PARAMS: {
    readonly message_id: string;
    readonly body: "The answer. Returned to the Specialist as its tool result.";
};
export declare const SPECIALIST_RESUME_PARAMS: {
    readonly activation_id: "The settled or waiting activation to resume.";
    readonly prompt: "The new instruction for the resumed Specialist.";
    readonly full: "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
};
export declare const SPECIALIST_RETRY_PARAMS: {
    readonly activation_id: "The failed activation to re-run in place.";
    readonly model_override: string;
    readonly prompt: "Replacement turn prompt. Defaults to the dispatch-time render of the same Issue.";
    readonly full: "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
};
export declare const SPECIALIST_STEER_PARAMS: {
    readonly activation_id: "The running activation to redirect mid-run.";
    readonly message: string;
    readonly full: "Return the full verbose payload (pre-SPECIALISTS-142 shape). Default compact.";
};
export declare const SPECIALIST_STOP_PARAMS: {
    readonly activation_id: "Activation to stop and dispose.";
    readonly reason: "Recorded forensically with the disposal.";
};
export declare const SPECIALIST_LIST_PARAMS: {
    readonly name: "Return the full record for this one specialist instead of the compact list.";
    readonly detail: "\"compact\" (default) is one line each; \"full\" returns every field of every specialist.";
    readonly full: "Alias for detail:\"full\" (SPECIALISTS-142 one-flag vocabulary). Default compact.";
};
export declare const SPECIALIST_LEASE_PARAMS: {
    readonly action: string;
    readonly worktree: "reconcile: the worktree whose lease is uncertain.";
    readonly outcome: "reconcile: the outcome the operator asserts. Never inferred.";
    readonly basis: "reconcile: the durable evidence consulted, one entry per source. Empty is refused.";
    readonly superseded_by: "reconcile: required for 'superseded'; the activation that now owns the workspace.";
    readonly note: "reconcile: free-form note carried into the durable record.";
};
/**
 * Runtime-neutral parameter descriptions per tool, for generic iteration (the
 * drift test). The two runtime-named dispatch params live in
 * SPECIALIST_DISPATCH_RUNTIME_PARAMS instead.
 */
export declare const SPECIALIST_TOOL_PARAM_DESCRIPTIONS: Record<SpecialistToolName, Record<string, string>>;
//# sourceMappingURL=descriptions.d.ts.map