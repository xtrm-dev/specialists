#!/usr/bin/env python3
"""
Cataloger — SessionStart hook for the service-skills system.

Reads the service registry (resolved via bootstrap — under .xtrm packs, with a
legacy Claude-view fallback) and prints a lightweight XML service catalog block
(~150 tokens) to stdout. The SessionStart hook injects this as additional
context so Claude knows which expert personas are available without loading full
skill bodies (Progressive Disclosure).

Configured in .claude/settings.json (the command path is the Claude-Code VIEW —
$CLAUDE_PROJECT_DIR/.claude/skills resolves through the active symlink to the
machinery skill):
  "SessionStart": [{"hooks": [{"type": "command",
    "command": "python3 \\"$CLAUDE_PROJECT_DIR/.claude/skills/service-skills/scripts/cataloger.py\\""}]}]

Output format (per-service Path resolves under .xtrm packs, not .claude/skills):
  <project_service_catalog>
  Available expert personas:
  - db-expert: SQL & schema expert (Path: .xtrm/skills/user/packs/<pack>/db-expert/SKILL.md)
  </project_service_catalog>
  <instruction>To activate an expert, read its SKILL.md from the provided path.</instruction>
"""

import sys
from pathlib import Path

# bootstrap.py is a sibling in this consolidated scripts/ dir (no cross-skill hop).
sys.path.insert(0, str(Path(__file__).parent))

from bootstrap import RootResolutionError, get_service_skill_path_str, list_services  # noqa: E402


def generate_catalog() -> str:
    """
    Generate the service catalog XML block.

    Returns empty string if no services are registered or project root
    cannot be determined (fails gracefully — never breaks session start).
    """
    try:
        services = list_services()
    except (RootResolutionError, Exception):
        return ""

    if not services:
        return ""

    lines = [
        "<project_service_catalog>",
        "Available expert personas:",
    ]

    for service_id, data in sorted(services.items()):
        description = data.get("description", data.get("name", service_id))
        # Registry skill_path is the SSOT; fallback resolves under .xtrm.
        try:
            skill_path = data.get("skill_path") or get_service_skill_path_str(service_id)
        except RootResolutionError:
            skill_path = data.get("skill_path", f"{service_id}/SKILL.md")
        lines.append(f"- {service_id}: {description} (Path: {skill_path})")

    lines.append("</project_service_catalog>")
    lines.append(
        "<instruction>To activate an expert, read its SKILL.md from the provided path.</instruction>"
    )

    return "\n".join(lines)


def main() -> None:
    """Print catalog to stdout — injected as SessionStart additional context."""
    catalog = generate_catalog()
    if catalog:
        print(catalog)
    # Silent if no services registered — don't break session start


if __name__ == "__main__":
    main()
