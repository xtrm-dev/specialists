---
title: Tool Manifest and Permissions
scope: manifest
category: reference
version: 1.0.0
updated: 2026-05-03
synced_at: 3bd799f4
description: Manifest-driven tool catalog, permission tiers, and per-specialist permissions[TIER] override blocks.
source_of_truth_for:
  - ".specialists/catalog/*.json"
  - "src/specialist/manifest-resolver.ts"
  - "src/specialist/resolution-diagnostics.ts"
  - "src/pi/session.ts:resolvePermissionTools"
domain:
  - manifest
  - permissions
  - tools
---

# Tool Manifest and Permissions

This document is the user-facing reference for the tool resolver: how each specialist's effective `--tools` list is computed, how to declare a per-specialist override, and how the deny modes interact with extension health.

> History: this system replaces the legacy hardcoded tier→tool arrays in `src/pi/session.ts` (removed in unitAI-qujxo.2). Design lives in `docs/design/gzrx-tool-catalog.md`. Critique of the parity-window cleanup in `docs/design/gzrx-completion-critique.md`.

## What runs at session start

When a specialist is dispatched, `PiAgentSession.start()` produces a comma-joined `--tools` argument for the underlying `pi` subprocess by calling `resolvePermissionTools` with three inputs:

1. The specialist's coarse tier from `execution.permission_required` (`READ_ONLY` | `LOW` | `MEDIUM` | `HIGH`).
2. The specialist's optional `permissions[<TIER>]` override block.
3. The catalog index in `.specialists/catalog/index.json`, plus the live health probe of the `pi-gitnexus` and `pi-serena-tools` npm extensions.

The resolver is the only path. There is no env-flag fallback. There are no hardcoded tool arrays in source.

## Catalog architecture

`.specialists/catalog/index.json` declares the precedence order and inlines per-catalog tier policies:

```json
{
  "precedence_order": ["native", "gitnexus", "serena"],
  "catalogs": [
    {
      "catalog": "native",
      "package": "specialists",
      "version": "3.11.0",
      "precedence": 0,
      "source_tiers": {
        "READ_ONLY": ["read", "grep", "find", "ls"],
        "LOW":       ["read", "grep", "find", "ls", "bash"],
        "MEDIUM":    ["read", "grep", "find", "ls", "bash", "edit"],
        "HIGH":      ["read", "grep", "find", "ls", "bash", "edit", "write"]
      }
    },
    { "catalog": "gitnexus", "package": "pi-gitnexus", "...": "..." },
    { "catalog": "serena",   "package": "pi-serena-tools", "...": "..." }
  ]
}
```

Three catalog files (`native.json`, `gitnexus.json`, `serena.json`) sit alongside the index and contain richer per-tool metadata. The index is the canonical input the resolver reads at session start.

The flat tool list emitted to `pi --tools` is the union of each catalog's `source_tiers[<TIER>]` for the active tier, gated by extension health (see below).

## The four tiers

| Tier | Native | GitNexus | Serena |
|------|--------|----------|--------|
| `READ_ONLY` | read, grep, find, ls | read tools (query/context/impact/detect_changes/list_repos) | read tools (find_symbol, search_for_pattern, list_dir, find_file, …) |
| `LOW` | + bash | (same as READ_ONLY) | + execute_shell_command |
| `MEDIUM` | + edit | + rename, cypher | + write tools (replace_symbol_body, create_text_file, …) |
| `HIGH` | + write | (same as MEDIUM) | (same as MEDIUM) |

Inspect the actual resolved set for any specialist with `sp config show <name> --resolved` (see `docs/cli-reference.md`).

## Extension health gating

Three states per extension affect resolution:

| Probe state | Effect on resolved tools |
|-------------|--------------------------|
| `loaded_healthy` | Catalog tools included normally; hard-deny of natives is allowed. |
| `loaded_unhealthy` / `not_installed` / `disabled` / `unknown` | Catalog's tools are dropped from the resolved set; if a hard-deny is configured against natives, those natives are *restored* automatically and a downgrade reason is recorded. |

Restoration is the safety net: an explorer that hard-denies `grep`/`find`/`ls` will get them back as a fallback if `pi-serena-tools` becomes unhealthy mid-run. You see this in `sp config show --resolved` as `restored native fallback: ...` in `downgrade reasons`.

Probes inspect `pi-gitnexus` and `pi-serena-tools` in the global npm modules directory.

## Per-specialist override block

Most specialists need nothing special — the catalog tier defaults are correct. When a specialist's policy genuinely diverges, declare a `permissions[<TIER>]` block at the top level of the specialist JSON (sibling to `execution`, not nested inside it).

### Schema

```jsonc
{
  "specialist": {
    "execution": { "permission_required": "READ_ONLY", "...": "..." },
    "permissions": {
      "READ_ONLY": {
        "denied_natives_when_extension": ["grep", "find", "ls"],
        "denied_natives_mode": "hard"
      }
    }
  }
}
```

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `denied_natives_when_extension` | `string[]` | `[]` | Native tools to deny **only when a replacement extension is healthy**. Order doesn't matter. |
| `denied_natives_mode` | `"soft"` \| `"hard"` | `"soft"` | Whether the denial actually removes the tool (`hard`) or only emits a preference signal (`soft`). |

Only the tier matching the specialist's `execution.permission_required` is consulted. Unused tiers in the block are silently ignored.

### Soft vs hard deny

| Mode | Effect on `--tools` | When to use |
|------|---------------------|-------------|
| `soft` | Final tool list is **unchanged**; resolver emits a `preference signals` line in the resolved report. The model still receives the native tool, with a hint to prefer the extension. | Gentle nudges; rollouts you want to observe before tightening; cases where the replacement might not always cover the native's edge cases. |
| `hard` | Native tool is removed from `--tools` entirely (when the replacement extension is healthy). Falls back to native automatically if the replacement degrades. | Strong opinions where the native tool is genuinely worse and the replacement is reliable. |

Soft is the default — bias toward observability before enforcement.

### Canonical example: explorer

`config/specialists/explorer.specialist.json` is currently the only specialist with an override block:

```json
{
  "specialist": {
    "execution": { "permission_required": "READ_ONLY" },
    "permissions": {
      "READ_ONLY": {
        "denied_natives_when_extension": ["grep", "find", "ls"],
        "denied_natives_mode": "hard"
      }
    }
  }
}
```

Why: explorer is meant to discover code through the symbol/process graph — `gitnexus_query` and serena's `search_for_pattern` / `find_symbol` / `find_file` give richer, ranked, structured results than native `grep`/`find`/`ls`. Hard-denying the natives forces explorer to use the better tools when they're available, while the health-gated restore guarantees it still works if the extensions go offline.

`read` stays soft (not in the deny list) because no extension currently provides large-file or non-code reading equivalents.

## When NOT to declare an override

- **Tier defaults are correct.** Most specialists are in this bucket.
- You're tempted to copy explorer's block into another specialist "just in case." Don't — drift is a real cost, and the file then has to track catalog changes by hand.
- You want to *add* tools beyond the tier default. The override block can only deny natives, not extend the catalog. Adjust the catalog file or change the specialist's tier instead.

## Inspecting the resolution

```bash
sp config show <name> --resolved
```

The output shows, in order:

- The full resolved JSON for the specialist
- `layer attribution`: which layer (catalog / specialist_override / runtime_health) contributed which tools
- `extension availability`: live health probe per extension
- `catalog compatibility`: schema-version check
- `denied natives`: tools removed by override
- `deny mode`: `soft` or `hard`
- `preference signals`: present when soft-deny is configured
- `downgrade reasons`: present when hard-deny had to restore natives due to unhealthy extensions
- `--tools`: the literal comma-joined string passed to `pi`

Use this command after editing a specialist's tier or override block to confirm the resolved output is what you expect — *before* dispatching a real run.

## See also

- [authoring.md](authoring.md) — full specialist JSON schema
- [cli-reference.md](cli-reference.md#specialists-config) — `sp config show --resolved` flag reference
- [specialists-catalog.md](specialists-catalog.md) — current specialist roster and their tier assignments
- [design/gzrx-tool-catalog.md](design/gzrx-tool-catalog.md) — original design document
- [design/gzrx-completion-critique.md](design/gzrx-completion-critique.md) — gap analysis that drove the qujxo.2 cleanup
