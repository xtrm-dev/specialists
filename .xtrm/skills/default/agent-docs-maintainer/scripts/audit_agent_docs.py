#!/usr/bin/env python3
"""Audit CLAUDE.md / AGENTS.md for agent-docs-maintainer."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

DOC_NAMES = ("CLAUDE.md", "AGENTS.md")
MANAGED_MARKERS = {
    "xtrm": ("<!-- xtrm:start -->", "<!-- xtrm:end -->"),
    "gitnexus": ("<!-- gitnexus:start -->", "<!-- gitnexus:end -->"),
    "beads": ("<!-- BEGIN BEADS INTEGRATION -->", None),
}
COMMAND_RE = re.compile(
    r"(^|\s)(bd|bv|xt|sp|specialists|gitnexus|npm|pnpm|uv|pytest|ruff|mypy|git|gh|docker|docker\s+compose|alembic)\s+[\w./:-]",
    re.MULTILINE,
)
STALE_TERMS = (
    "Jaggers Agent Tools",
    "jaggers-agent-tools",
    "YFinance Analytics",
    "YFinance",
    "Clavix",
)
BLOAT_HEADINGS = (
    "Command Reference",
    "Quick Reference",
    "Common Query Patterns",
    "Docker Operations",
    "Alembic Migrations",
    "Testing",
    "Best Practices",
)


def count_code_fences(lines: list[str]) -> int:
    return sum(1 for line in lines if line.strip().startswith("```")) // 2


def heading_ranges(lines: list[str]) -> list[dict[str, Any]]:
    headings = [(index + 1, line.strip()) for index, line in enumerate(lines) if line.startswith("#")]
    ranges = []
    for idx, (line_no, title) in enumerate(headings):
        next_line = headings[idx + 1][0] if idx + 1 < len(headings) else len(lines) + 1
        ranges.append({"line": line_no, "end_line": next_line - 1, "title": title})
    return ranges


def managed_blocks(text: str) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for name, (start, end) in MANAGED_MARKERS.items():
        starts = [match.start() for match in re.finditer(re.escape(start), text)]
        ends = [match.start() for match in re.finditer(re.escape(end), text)] if end else []
        result[name] = {
            "start_count": len(starts),
            "end_count": len(ends) if end else None,
            "duplicated": len(starts) > 1 or (end is not None and len(ends) > 1),
        }
    return result


def detect_service_context(repo: Path) -> dict[str, Any]:
    registry = repo / ".claude" / "service-registry.json"
    skill_dirs = [repo / ".xtrm" / "skills" / "default", repo / ".claude" / "skills"]
    service_skills = []
    for skill_dir in skill_dirs:
        if not skill_dir.exists():
            continue
        service_skills.extend(
            child.name
            for child in skill_dir.iterdir()
            if child.is_dir() and "service" in child.name
        )
    return {
        "service_registry": registry.exists(),
        "service_skill_names": sorted(set(service_skills)),
    }


def recommend(metrics: dict[str, Any]) -> list[str]:
    recommendations = []
    if metrics["lines"] > 500:
        recommendations.append("rewrite: above 500-line soft maximum")
    elif metrics["lines"] > 300:
        recommendations.append("trim: above preferred 300-line target")
    if metrics["command_refs"] > 60:
        recommendations.append("replace CLI manual dumps with --help and skill pointers")
    elif metrics["command_refs"] > 20:
        recommendations.append("trim command references to session-critical commands only")
    if metrics["code_fences"] > 20:
        recommendations.append("move code examples/runbooks out of always-loaded agent doc")
    if any(block["duplicated"] for block in metrics["managed_blocks"].values()):
        recommendations.append("deduplicate managed xtrm/GitNexus/beads blocks")
    if metrics["stale_terms"]:
        recommendations.append("remove or rename stale project terms")
    if metrics["bloat_headings"]:
        recommendations.append("collapse bloat-prone sections into concise pointers")
    if not recommendations:
        recommendations.append("ok: no major bloat signals")
    return recommendations


def audit_doc(path: Path, repo: Path) -> dict[str, Any]:
    text = path.read_text(errors="replace")
    lines = text.splitlines()
    metrics: dict[str, Any] = {
        "path": str(path),
        "exists": True,
        "lines": len(lines),
        "chars": len(text),
        "code_fences": count_code_fences(lines),
        "table_lines": sum(1 for line in lines if line.strip().startswith("|")),
        "command_refs": len(COMMAND_RE.findall(text)),
        "managed_blocks": managed_blocks(text),
        "stale_terms": [term for term in STALE_TERMS if term.lower() in text.lower()],
        "bloat_headings": [heading for heading in BLOAT_HEADINGS if heading.lower() in text.lower()],
        "top_headings": heading_ranges(lines)[:25],
        "service_context": detect_service_context(repo),
    }
    metrics["recommendations"] = recommend(metrics)
    return metrics


def audit_repo(repo: Path) -> dict[str, Any]:
    repo = repo.expanduser().resolve()
    docs: dict[str, Any] = {}
    for name in DOC_NAMES:
        path = repo / name
        if path.exists():
            docs[name] = audit_doc(path, repo)
        else:
            docs[name] = {"path": str(path), "exists": False, "recommendations": ["missing"]}
    return {"repo": str(repo), "docs": docs}


def render_markdown(results: list[dict[str, Any]]) -> str:
    chunks = ["# Agent docs audit", ""]
    for repo_result in results:
        chunks.append(f"## {repo_result['repo']}")
        for name, doc in repo_result["docs"].items():
            if not doc["exists"]:
                chunks.append(f"- **{name}**: missing")
                continue
            recs = "; ".join(doc["recommendations"])
            stale = ", ".join(doc["stale_terms"]) or "-"
            blocks = ", ".join(
                block_name for block_name, block in doc["managed_blocks"].items() if block["duplicated"]
            ) or "-"
            service = doc["service_context"]
            service_hint = "yes" if service["service_registry"] or service["service_skill_names"] else "no"
            chunks.append(
                f"- **{name}**: {doc['lines']} lines, {doc['command_refs']} command refs, "
                f"{doc['code_fences']} code fences, service_context={service_hint}"
            )
            chunks.append(f"  - recommendations: {recs}")
            chunks.append(f"  - duplicated managed blocks: {blocks}")
            chunks.append(f"  - stale terms: {stale}")
        chunks.append("")
    return "\n".join(chunks).rstrip() + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit CLAUDE.md / AGENTS.md for compactness and staleness.")
    parser.add_argument("repos", nargs="*", default=["."], help="Repository paths to audit")
    parser.add_argument("--format", choices=("json", "md"), default="json")
    args = parser.parse_args()

    results = [audit_repo(Path(repo)) for repo in args.repos]
    if args.format == "json":
        print(json.dumps(results, indent=2))
    else:
        print(render_markdown(results), end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
