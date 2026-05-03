export type ToolTier = 'READ_ONLY' | 'LOW' | 'MEDIUM' | 'HIGH';
export type ToolCatalogName = 'native' | 'gitnexus' | 'serena';
export type ExtensionHealth = 'not_installed' | 'disabled' | 'loaded_healthy' | 'loaded_unhealthy' | 'unknown';
export type DeniedNativesMode = 'soft' | 'hard';

export interface ToolCatalog {
  catalog: ToolCatalogName;
  precedence: number;
  source_tiers: Record<ToolTier, readonly string[]>;
}

export interface ManifestPolicyTier {
  denied_natives_when_extension?: readonly string[];
  denied_natives_mode?: DeniedNativesMode;
}

export interface ManifestPolicy {
  permissions: Partial<Record<ToolTier, ManifestPolicyTier>>;
  specialists?: Record<string, ManifestPolicyTier>;
}

export interface ExtensionState {
  health: ExtensionHealth;
  enabled?: boolean;
}

export interface ResolverInput {
  tier: ToolTier;
  catalogs: readonly ToolCatalog[];
  manifestPolicy?: ManifestPolicy;
  specialistOverride?: ManifestPolicyTier;
  yamlExclusions?: {
    disabledExtensions?: readonly ToolCatalogName[];
    deniedNatives?: readonly string[];
  };
  extensionState?: Partial<Record<ToolCatalogName, ExtensionState>>;
}

export interface ToolLayerAttribution {
  layer: 'tier_policy' | 'specialist_override' | 'yaml_exclusion' | 'runtime_health' | 'catalog';
  source?: string;
  tools: readonly string[];
}

export interface ResolverResult {
  tools: string;
  toolsList: readonly string[];
  deniedNatives: readonly string[];
  deniedNativesMode: DeniedNativesMode;
  preferenceSignals: readonly string[];
  warnings: readonly string[];
  attribution: readonly ToolLayerAttribution[];
}

const HEALTHY: ExtensionHealth[] = ['loaded_healthy'];
const GITNEXUS_BASE_TIER: ToolTier = 'READ_ONLY';

function uniqueOrdered(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    ordered.push(value);
  }
  return ordered;
}

function getCatalog(catalogs: readonly ToolCatalog[], name: ToolCatalogName): ToolCatalog | undefined {
  return catalogs.find(catalog => catalog.catalog === name);
}

function mergeTierPolicy(input: ResolverInput): ManifestPolicyTier {
  const tierPolicy = input.manifestPolicy?.permissions?.[input.tier] ?? {};
  const overridePolicy = input.specialistOverride ?? {};
  const yamlDenied = input.yamlExclusions?.deniedNatives ?? [];
  return {
    denied_natives_when_extension: uniqueOrdered([
      ...(tierPolicy.denied_natives_when_extension ?? []),
      ...(overridePolicy.denied_natives_when_extension ?? []),
      ...yamlDenied,
    ]),
    denied_natives_mode: overridePolicy.denied_natives_mode ?? tierPolicy.denied_natives_mode ?? 'soft',
  };
}

function shouldIncludeExtensionTools(name: ToolCatalogName, input: ResolverInput): boolean {
  if (input.yamlExclusions?.disabledExtensions?.includes(name)) return false;
  const state = input.extensionState?.[name];
  if (!state) return true;
  if (state.enabled === false) return false;
  return state.health !== 'not_installed' && state.health !== 'disabled';
}

function getTierTools(catalogs: readonly ToolCatalog[], name: ToolCatalogName, tier: ToolTier): readonly string[] {
  const catalog = getCatalog(catalogs, name);
  return catalog?.source_tiers[tier] ?? [];
}

function canEnforceHardDeny(state: ExtensionState | undefined): boolean {
  if (!state) return true;
  return HEALTHY.includes(state.health);
}

export function resolveManifestTools(input: ResolverInput): ResolverResult {
  const policy = mergeTierPolicy(input);
  const warnings: string[] = [];
  const attribution: ToolLayerAttribution[] = [];
  const effectiveDenied = new Set(policy.denied_natives_when_extension ?? []);
  const deniedNatives: string[] = [];

  const nativeTools = getTierTools(input.catalogs, 'native', input.tier);
  const gitnexusBase = getTierTools(input.catalogs, 'gitnexus', GITNEXUS_BASE_TIER);
  const gitnexusExtras = input.tier === 'MEDIUM' || input.tier === 'HIGH'
    ? getTierTools(input.catalogs, 'gitnexus', input.tier).filter(tool => !gitnexusBase.includes(tool))
    : [];
  const serenaTools = getTierTools(input.catalogs, 'serena', input.tier);

  const healthyGitnexus = canEnforceHardDeny(input.extensionState?.gitnexus);
  const healthySerena = canEnforceHardDeny(input.extensionState?.serena);
  const hardDenyAllowed = policy.denied_natives_mode === 'hard' && healthyGitnexus && healthySerena;

  const finalNativeTools = nativeTools.filter(tool => {
    if (!effectiveDenied.has(tool)) return true;
    if (!hardDenyAllowed) return true;
    deniedNatives.push(tool);
    return false;
  });

  const toolsList = uniqueOrdered([
    ...finalNativeTools,
    ...((input.yamlExclusions?.disabledExtensions?.includes('gitnexus') ? [] : gitnexusBase)),
    ...((input.yamlExclusions?.disabledExtensions?.includes('serena') ? [] : serenaTools)),
    ...((input.yamlExclusions?.disabledExtensions?.includes('gitnexus') ? [] : gitnexusExtras)),
  ]);

  if (!shouldIncludeExtensionTools('gitnexus', input)) warnings.push('gitnexus tools excluded by extension state');
  if (!shouldIncludeExtensionTools('serena', input)) warnings.push('serena tools excluded by extension state');
  if ((input.yamlExclusions?.disabledExtensions ?? []).length > 0) {
    warnings.push(`yaml exclusions: ${(input.yamlExclusions?.disabledExtensions ?? []).join(', ')}`);
    attribution.push({ layer: 'yaml_exclusion', source: 'specialist.yaml', tools: [] });
  }

  attribution.push({ layer: 'tier_policy', source: 'manifest policy', tools: toolsList });
  if (!hardDenyAllowed && policy.denied_natives_mode === 'hard' && effectiveDenied.size > 0) {
    warnings.push('hard deny requested but extension health not healthy; native fallback restored');
    attribution.push({ layer: 'runtime_health', source: 'fallback', tools: nativeTools.filter(tool => effectiveDenied.has(tool)) });
  }

  const preferenceSignals = policy.denied_natives_mode === 'soft' && effectiveDenied.size > 0
    ? [`soft deny prefers extension tools for: ${Array.from(effectiveDenied).join(',')}`]
    : [];

  return {
    tools: toolsList.join(','),
    toolsList,
    deniedNatives,
    deniedNativesMode: policy.denied_natives_mode ?? 'soft',
    preferenceSignals,
    warnings,
    attribution,
  };
}

export const LEGACY_PERMISSION_TOOL_STRINGS: Record<ToolTier, string> = {
  READ_ONLY: 'read,grep,find,ls,gitnexus_list_repos,gitnexus_query,gitnexus_context,gitnexus_impact,gitnexus_detect_changes,serena_list_tools,find_symbol,find_referencing_symbols,read_file,get_symbols_overview,jet_brains_get_symbols_overview,jet_brains_find_symbol,jet_brains_find_referencing_symbols,jet_brains_type_hierarchy,search_for_pattern,list_dir,find_file,get_current_config,activate_project,check_onboarding_performed,initial_instructions,think_about_collected_information,think_about_task_adherence,think_about_whether_you_are_done,list_memories,read_memory',
  LOW: 'read,grep,find,ls,bash,gitnexus_list_repos,gitnexus_query,gitnexus_context,gitnexus_impact,gitnexus_detect_changes,serena_list_tools,find_symbol,find_referencing_symbols,read_file,get_symbols_overview,jet_brains_get_symbols_overview,jet_brains_find_symbol,jet_brains_find_referencing_symbols,jet_brains_type_hierarchy,search_for_pattern,list_dir,find_file,get_current_config,activate_project,check_onboarding_performed,initial_instructions,think_about_collected_information,think_about_task_adherence,think_about_whether_you_are_done,list_memories,read_memory,execute_shell_command',
  MEDIUM: 'read,grep,find,ls,bash,edit,gitnexus_list_repos,gitnexus_query,gitnexus_context,gitnexus_impact,gitnexus_detect_changes,serena_list_tools,find_symbol,find_referencing_symbols,read_file,get_symbols_overview,jet_brains_get_symbols_overview,jet_brains_find_symbol,jet_brains_find_referencing_symbols,jet_brains_type_hierarchy,search_for_pattern,list_dir,find_file,get_current_config,activate_project,check_onboarding_performed,initial_instructions,think_about_collected_information,think_about_task_adherence,think_about_whether_you_are_done,list_memories,read_memory,execute_shell_command,insert_after_symbol,replace_symbol_body,insert_before_symbol,rename_symbol,restart_language_server,create_text_file,replace_content,delete_lines,replace_lines,insert_at_line,remove_project,switch_modes,open_dashboard,onboarding,prepare_for_new_conversation,summarize_changes,write_memory,delete_memory,rename_memory,edit_memory,serena_mcp_reset,gitnexus_rename,gitnexus_cypher',
  HIGH: 'read,grep,find,ls,bash,edit,write,gitnexus_list_repos,gitnexus_query,gitnexus_context,gitnexus_impact,gitnexus_detect_changes,serena_list_tools,find_symbol,find_referencing_symbols,read_file,get_symbols_overview,jet_brains_get_symbols_overview,jet_brains_find_symbol,jet_brains_find_referencing_symbols,jet_brains_type_hierarchy,search_for_pattern,list_dir,find_file,get_current_config,activate_project,check_onboarding_performed,initial_instructions,think_about_collected_information,think_about_task_adherence,think_about_whether_you_are_done,list_memories,read_memory,execute_shell_command,insert_after_symbol,replace_symbol_body,insert_before_symbol,rename_symbol,restart_language_server,create_text_file,replace_content,delete_lines,replace_lines,insert_at_line,remove_project,switch_modes,open_dashboard,onboarding,prepare_for_new_conversation,summarize_changes,write_memory,delete_memory,rename_memory,edit_memory,serena_mcp_reset,gitnexus_rename,gitnexus_cypher',
};
