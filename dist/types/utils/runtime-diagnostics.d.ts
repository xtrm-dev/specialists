export type RuntimeDiagnosticsSink = (line: string) => void;
/** Install the process-wide sink. `null` discards runtime diagnostics. */
export declare function setRuntimeDiagnosticsSink(next: RuntimeDiagnosticsSink | null): void;
/** Restore the CLI default (stderr). Tests use this; production code does not. */
export declare function resetRuntimeDiagnosticsSink(): void;
/** Canonical file sink location, beside the other `.specialists` runtime state. */
export declare function runtimeDiagnosticsSinkPath(root: string): string;
/**
 * A sink that appends to `path` and never throws: a diagnostics write must not abort
 * an activation, and an unwritable path must not degrade the run.
 */
export declare function createFileDiagnosticsSink(path: string): RuntimeDiagnosticsSink;
/** A runtime warning: emitted in CLI mode, redirected away from stdio in-process. */
export declare function runtimeWarn(tag: string, message: string, detail?: unknown): void;
/** A runtime debug line: emitted only under `DEBUG`, redirected in-process. */
export declare function runtimeDebug(tag: string, message: string, detail?: unknown): void;
//# sourceMappingURL=runtime-diagnostics.d.ts.map