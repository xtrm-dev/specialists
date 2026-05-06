import { type ChildProcess } from 'node:child_process';
import { SpecialistLoader } from './loader.js';
import type { Specialist } from './schema.js';
export type ScriptSpecialistErrorType = 'specialist_not_found' | 'specialist_load_error' | 'template_variable_missing' | 'auth' | 'quota' | 'timeout' | 'network' | 'invalid_json' | 'output_too_large' | 'internal';
export interface ScriptGenerateRequest {
    specialist: string;
    requested_specialist?: string;
    variables?: Record<string, string>;
    template?: string;
    model_override?: string;
    thinking_level?: string;
    timeout_ms?: number;
    trace?: boolean;
}
export interface ScriptGenerateSuccess {
    success: true;
    output: string;
    parsed_json?: unknown;
    meta: {
        specialist: string;
        requested_specialist?: string;
        resolved_specialist?: string;
        model: string;
        duration_ms: number;
        trace_id: string;
    };
}
export interface ScriptGenerateFailure {
    success: false;
    error: string;
    error_type: ScriptSpecialistErrorType;
    meta?: {
        specialist?: string;
        requested_specialist?: string;
        resolved_specialist?: string;
        model?: string;
        duration_ms?: number;
        trace_id?: string;
    };
}
export type ScriptGenerateResult = ScriptGenerateSuccess | ScriptGenerateFailure;
export interface TrustOptions {
    allowSkills?: boolean;
    allowSkillsRoots?: string[];
    allowLocalScripts?: boolean;
}
export declare class CompatGuardError extends Error {
    readonly field: 'execution.interactive' | 'execution.requires_worktree' | 'execution.permission_required' | 'skills.scripts' | 'skills.paths' | 'prompt.skill_inherit';
    constructor(field: 'execution.interactive' | 'execution.requires_worktree' | 'execution.permission_required' | 'skills.scripts' | 'skills.paths' | 'prompt.skill_inherit', message: string);
}
export interface SkillSource {
    path: string;
    sha256: string;
}
export interface ScriptRunnerOptions {
    loader: SpecialistLoader;
    projectDir?: string;
    fallbackModel?: string;
    observabilityDbPath?: string;
    onChild?: (child: ChildProcess) => void;
    onAuditFailure?: (error: unknown) => void;
    trust?: TrustOptions;
}
export declare function compatGuard(spec: Specialist, trust?: TrustOptions): void;
export declare function computeSkillSources(spec: Specialist): SkillSource[];
export declare function renderTaskTemplate(template: string, variables: Record<string, string>): string;
export declare function applyOutputContract(prompt: string, spec: Specialist): string;
export declare const DEFAULT_PENDING_LINE_LIMIT_BYTES: number;
export declare const DEFAULT_ASSISTANT_TEXT_LIMIT_BYTES: number;
export declare const DEFAULT_STDERR_LIMIT_BYTES: number;
export declare function resolveAssistantTextLimitBytes(spec: Specialist): number;
export declare function runScriptSpecialist(input: ScriptGenerateRequest, options: ScriptRunnerOptions): Promise<ScriptGenerateResult>;
export declare function collectModelCandidates(input: ScriptGenerateRequest, spec: Specialist, options: ScriptRunnerOptions): string[];
type AttemptFailureReason = 'assistant_text_too_large' | 'stderr_too_large' | 'malformed_line_too_large';
export declare function classifyAttempt(attempt: {
    text: string;
    stderr: string;
    exitCode: number;
    timedOut: boolean;
    outputTooLarge: boolean;
    outputTooLargeReason?: AttemptFailureReason;
}): {
    retryable: boolean;
    kind: 'success' | 'failure';
    error: string;
    errorType: ScriptSpecialistErrorType;
    text: string;
};
export declare function isRetryableModelFailure(stderr: string, text: string): boolean;
export {};
//# sourceMappingURL=script-runner.d.ts.map