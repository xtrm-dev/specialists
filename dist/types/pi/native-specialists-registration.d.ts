export type RegistrationResult = {
    status: 'added' | 'migrated' | 'present';
    settingsPath: string;
    source: string;
} | {
    status: 'skipped';
    settingsPath: string;
    reason: string;
};
export declare function getNativeSpecialistsExtensionPath(): string | null;
export declare function getPiSettingsPath(env?: NodeJS.ProcessEnv): string;
export declare function registerNativeSpecialists(bundledPath?: string | null, settingsPath?: string): RegistrationResult;
//# sourceMappingURL=native-specialists-registration.d.ts.map