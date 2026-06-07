#!/usr/bin/env python3
"""
scope.py — Read service-registry.json and output a formatted service catalog.

Used by the /scope skill to provide registry data for agent reasoning before
any files are touched. The agent uses this output to map a task description
to the relevant registered service(s).
"""

import json
import os
import sys
from pathlib import Path


def find_registry() -> Path | None:
    # 1. CLAUDE_PROJECT_DIR env var (set by Claude Code hooks)
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR")
    if project_dir:
        p = Path(project_dir) / ".claude" / "skills" / "service-registry.json"
        if p.exists():
            return p

    # 2. Walk up from CWD until .git boundary
    cwd = Path.cwd()
    for parent in [cwd, *cwd.parents]:
        p = parent / ".claude" / "skills" / "service-registry.json"
        if p.exists():
            return p
        if (parent / ".git").exists():
            break

    return None


def main() -> None:
    registry_path = find_registry()

    if not registry_path:
        print("ERROR: service-registry.json not found.")
        print("Run /creating-service-skills to set up service skills first.")
        sys.exit(1)

    try:
        with open(registry_path, encoding="utf-8") as f:
            registry = json.load(f)
    except json.JSONDecodeError as e:
        print(f"ERROR: service-registry.json is malformed: {e}")
        sys.exit(1)

    services = registry.get("services", {})
    if not services:
        print("Registry is empty — no services registered.")
        sys.exit(0)

    print(f"Registry  : {registry_path}")
    print(f"Version   : {registry.get('version', 'unknown')}")
    print(f"Services  : {len(services)} registered")
    print("─" * 60)

    for service_id, info in services.items():
        territories = ", ".join(info.get("territory", [])) or "—"
        synced = info.get("last_sync", "never")
        sync_ref = info.get("last_sync_ref", "")
        freshness = synced if not sync_ref else f"{synced} @ {sync_ref[:8]}"
        print(f"\n[{service_id}]")
        print(f"  Container  : {info.get('container', 'unknown')}")
        print(f"  Territory  : {territories}")
        print(f"  Skill      : {info.get('skill_path', 'unknown')}")
        print(f"  Last sync  : {freshness}")
        print(f"  Description: {info.get('description', '—')}")

    print("\n" + "─" * 60)
    print("Map the task description to the service(s) above, then load their skills.")

    # GitNexus is the graph layer that turns territory globs into real ownership:
    # use it to confirm which service owns an execution flow before routing, and to
    # see blast radius across services. Registry globs are the fallback when absent.
    gitnexus_present = any(
        (parent / ".gitnexus").exists()
        for parent in [registry_path.parent, *registry_path.parents]
    )
    if gitnexus_present:
        print("GitNexus index detected — refine routing with the graph:")
        print('  gitnexus query "<task concept>" --repo <name>     # which flow/service owns this')
        print("  gitnexus impact <symbol> --direction upstream      # cross-service blast radius")
    else:
        print("No GitNexus index — routing by territory globs only (graph refinement unavailable).")


if __name__ == "__main__":
    main()
