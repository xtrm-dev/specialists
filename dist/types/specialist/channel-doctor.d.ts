export type GateStatus = 'pass' | 'fail' | 'unknown';
export interface GateResult {
    readonly id: number;
    readonly name: string;
    readonly status: GateStatus;
    readonly detail: string;
    readonly fixHint?: string;
}
export interface ChannelDoctorInputs {
    /** `/etc/claude-code/managed-settings.json` (or platform equivalent). */
    readonly managedSettingsPath: string;
    /** `~/.claude/plugins/installed_plugins.json`. */
    readonly installedPluginsPath: string;
    /** The MCP server entrypoint that declares the channel capability. */
    readonly serverSourcePath: string;
    /** Plugin name this repo ships under the marketplace, e.g. `specialists`. */
    readonly expectedPluginName: string;
    /** Marketplace this plugin ships under, e.g. `xtrm` (spec AN.2). */
    readonly expectedMarketplaceName: string;
    /** True when doctor itself is attached to an interactive terminal. */
    readonly isInteractiveTty: boolean;
}
export interface ChannelDoctorReport {
    readonly gates: readonly GateResult[];
    readonly firstClosedGate: GateResult | null;
    readonly headlessWarning: string | null;
}
/** Runs all eight gate checks against injected paths. Never writes anything. */
export declare function runChannelDoctorChecks(inputs: ChannelDoctorInputs): ChannelDoctorReport;
//# sourceMappingURL=channel-doctor.d.ts.map