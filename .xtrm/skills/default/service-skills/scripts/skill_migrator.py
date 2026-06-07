#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

CONTRACT_PATH = Path(__file__).resolve().parents[1] / "references" / "service_skill_contract.json"
SEMANTIC_START = "<!-- SEMANTIC_START -->"
SEMANTIC_END = "<!-- SEMANTIC_END -->"
HEADING_PATTERN = r"^##\s+(.*)$"


@dataclass(frozen=True)
class HeadingSpec:
    heading: str


def load_canonical_headings(contract_path: Path = CONTRACT_PATH) -> list[str]:
    data = json.loads(contract_path.read_text(encoding="utf-8"))
    return [item["heading"] for item in data["canonical_headings"]]


def _find_heading_line(lines: list[str], heading: str) -> int | None:
    target = f"## {heading}"
    for index, line in enumerate(lines):
        if line.rstrip("\n") == target:
            return index
    return None


def _find_marker_line(lines: list[str], marker: str) -> int | None:
    for index, line in enumerate(lines):
        if line.rstrip("\n") == marker:
            return index
    return None


def _insert_block(lines: list[str], index: int, heading: str) -> None:
    block = [f"## {heading}\n", "\n"]
    lines[index:index] = block


def migrate_skill_markdown(content: str, canonical_headings: Iterable[str] | None = None) -> tuple[str, bool]:
    headings = list(canonical_headings or load_canonical_headings())
    lines = content.splitlines(keepends=True)
    original_lines = list(lines)

    semantic_start = _find_marker_line(lines, SEMANTIC_START)
    semantic_end = _find_marker_line(lines, SEMANTIC_END)

    for heading in reversed(headings):
        if _find_heading_line(lines, heading) is not None:
            continue
        next_positions = [
            pos
            for pos in (
                _find_heading_line(lines, later_heading)
                for later_heading in headings[headings.index(heading) + 1 :]
            )
            if pos is not None
        ]
        if semantic_start is not None and heading != "Semantic Deep Dive (Human/Agent Refined)":
            next_positions.append(semantic_start)
        insert_at = min(next_positions) if next_positions else len(lines)
        _insert_block(lines, insert_at, heading)

    migrated = "".join(lines)
    return migrated, migrated != "".join(original_lines)


def migrate_skill_file(skill_path: Path) -> bool:
    content = skill_path.read_text(encoding="utf-8")
    migrated, changed = migrate_skill_markdown(content)
    if changed:
        skill_path.write_text(migrated, encoding="utf-8")
    return changed


def main() -> None:
    args = sys.argv[1:]
    if len(args) != 1:
        print("Usage: skill_migrator.py <SKILL.md>")
        sys.exit(1)
    changed = migrate_skill_file(Path(args[0]))
    # Scriptable signal so callers (e.g. install/upgrade) can detect upgrades.
    print(f"migrated: {args[0]}" if changed else f"unchanged: {args[0]}")
    sys.exit(0)


if __name__ == "__main__":
    main()
