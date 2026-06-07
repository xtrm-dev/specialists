#!/usr/bin/env python3
"""
umbrella_generator.py — generate a per-repo "umbrella" service-skills SKILL.md
from a service-registry.json.

One umbrella per repo maps that repo's services (table + cross-service health +
navigation) and is the single entry point over the per-service skills. The skill
``name:`` is repo-qualified (``<repo>-services``) so it never collides with the
machinery ``service-skills`` skill.

generate_umbrella() is a PURE function of (registry, repo_name, existing_text):
the human-authored narrative is kept inside a ``<!-- SEMANTIC_START -->`` /
``<!-- SEMANTIC_END -->`` block which is preserved verbatim across regeneration
(same marker contract as skill_migrator.py). Everything else is derived from the
registry, so it can never drift from the registered services.
"""
from __future__ import annotations

import os
import re
import sys
from pathlib import Path
from typing import Any

# Sibling import (consolidated scripts/ dir).
sys.path.insert(0, str(Path(__file__).parent))
from bootstrap import (  # noqa: E402  # type: ignore[import-not-found]
    RootResolutionError,
    get_pack_path,
    get_project_root,
    load_registry,
)

SEMANTIC_START = "<!-- SEMANTIC_START -->"
SEMANTIC_END = "<!-- SEMANTIC_END -->"

_DEFAULT_SEMANTIC = (
    "## Cross-Service Operational Notes (Human/Agent Refined)\n\n"
    "[PENDING RESEARCH] Capture repo-wide operational knowledge that spans services: "
    "shared infra (DB/broker/cache), startup ordering, cross-service failure cascades, "
    "and the end-to-end health story. This block is preserved across regeneration — "
    "edit it freely; the service table above is regenerated from the registry."
)


def repo_skill_name(repo_name: str) -> str:
    """Deterministic, collision-safe skill name: ``<repo>-services`` (kebab, lowercased)."""
    slug = re.sub(r"[^a-z0-9]+", "-", repo_name.strip().lower()).strip("-")
    slug = slug or "repo"
    return f"{slug}-services"


def extract_semantic_block(existing: str | None) -> str:
    """Return the inner human narrative of an existing umbrella's SEMANTIC block,
    or the default placeholder when none is present."""
    if not existing:
        return _DEFAULT_SEMANTIC
    start = existing.find(SEMANTIC_START)
    end = existing.find(SEMANTIC_END)
    if start == -1 or end == -1 or end < start:
        return _DEFAULT_SEMANTIC
    inner = existing[start + len(SEMANTIC_START):end].strip("\n")
    return inner or _DEFAULT_SEMANTIC


def _services_table(services: dict[str, dict[str, Any]]) -> str:
    if not services:
        return "_No services registered yet. Run the create flow to scaffold one._"
    rows = [
        "| Service | Container | Territory | Skill | Last sync |",
        "|---|---|---|---|---|",
    ]
    for sid in sorted(services):
        info = services[sid]
        container = info.get("container", "—")
        territory = ", ".join(info.get("territory", [])) or "—"
        skill = info.get("skill_path", "—")
        synced = info.get("last_sync", "never")
        ref = info.get("last_sync_ref", "")
        freshness = synced if not ref else f"{synced} @ {ref[:8]}"
        rows.append(f"| `{sid}` | {container} | `{territory}` | [SKILL.md]({skill}) | {freshness} |")
    return "\n".join(rows)


def generate_umbrella(registry: dict[str, Any], repo_name: str, existing: str | None = None) -> str:
    """Render the umbrella SKILL.md for ``repo_name`` from ``registry``.

    Pure: identical inputs (including the existing SEMANTIC block) -> identical output.
    """
    services = registry.get("services", {})
    name = repo_skill_name(repo_name)
    semantic_inner = extract_semantic_block(existing)
    table = _services_table(services)
    count = len(services)

    return f"""---
name: {name}
description: >-
  Service map and operational umbrella for the {repo_name} repository. Lists every
  registered service ({count}), links its expert skill, and carries the cross-service
  health and navigation story. Load this first when a task spans services in {repo_name},
  then open the per-service skill it points to.
allowed-tools: Read, Glob, Bash(python3 *)
---

# {repo_name} — Services

The single entry point over **{repo_name}**'s per-service skills. The service table is
generated from `service-registry.json` and always matches the registered services;
the human cross-service narrative lives in the protected block below.

## Services

{table}

## Cross-Service Health

Navigate cross-service reach with the GitNexus graph (registry globs only tell you
*which* skill exists, not what a change **touches**):

```bash
gitnexus query "<concept>"                 # which service owns an execution flow
gitnexus impact <symbol> --direction upstream   # blast radius across services
```

Per-service runnable health checks live in each service skill's `scripts/health_probe.py`.

<!-- SEMANTIC_START -->
{semantic_inner}
<!-- SEMANTIC_END -->

## Navigation

- Per-service skills are listed in the **Services** table above — open the linked `SKILL.md`.
- To scaffold a missing service: use the `service-skills` machinery (create flow).
- Drift sync runs post-merge on master; see the `service-skills` updating flow.

---

*Generated from service-registry.json by the service-skills umbrella generator. Edit only
within the SEMANTIC block — everything else is regenerated.*
"""


def write_umbrella(umbrella_path: Path, registry: dict[str, Any], repo_name: str) -> bool:
    """Write/refresh the umbrella at ``umbrella_path``, preserving its SEMANTIC block.
    Returns True if the file content changed."""
    existing = umbrella_path.read_text(encoding="utf-8") if umbrella_path.exists() else None
    content = generate_umbrella(registry, repo_name, existing)
    if existing == content:
        return False
    umbrella_path.parent.mkdir(parents=True, exist_ok=True)
    umbrella_path.write_text(content, encoding="utf-8")
    return True


def main() -> None:
    args = sys.argv[1:]
    project_root = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_root:
        try:
            project_root = get_project_root()
        except RootResolutionError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    repo_name = args[0] if args else Path(project_root).name
    pack = get_pack_path(project_root)
    if pack is None:
        print("Error: unable to resolve pack path. Set XTRM_PACK or leave only one pack under .xtrm/skills/user/packs.", file=sys.stderr)
        sys.exit(1)
    registry = load_registry(project_root)
    umbrella_path = pack / "service-skills" / "SKILL.md"
    changed = write_umbrella(umbrella_path, registry, repo_name)
    rel = umbrella_path.relative_to(project_root) if umbrella_path.is_relative_to(Path(project_root)) else umbrella_path
    print(f"{'generated' if changed else 'unchanged'}: {rel}")
    sys.exit(0)


if __name__ == "__main__":
    main()
