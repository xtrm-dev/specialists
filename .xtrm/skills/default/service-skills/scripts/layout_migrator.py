#!/usr/bin/env python3
"""
layout_migrator.py — one-time migration of a service-skills pack from the FLAT
layout to the UMBRELLA layout.

    FROM:  .xtrm/skills/user/packs/<pack>/<svc>/SKILL.md
           .xtrm/skills/user/packs/<pack>/service-registry.json
    TO:    .xtrm/skills/user/packs/<pack>/service-skills/services/<svc>/SKILL.md
           .xtrm/skills/user/packs/<pack>/service-skills/service-registry.json
           .xtrm/skills/user/packs/<pack>/service-skills/SKILL.md   (generated umbrella)

This is DISTINCT from skill_migrator.py: that edits a SKILL.md's headings; this
*moves files* and *relocates/rewrites the registry*, then generates the umbrella.

Hard-cut: after this runs, resolvers see only the new layout. Idempotent (re-run =
all-skipped, no mutation) and SAFE (never deletes a service dir before its move is
confirmed; refuses if a target already exists with divergent content).

Per-service SKILL.md content (incl. the SEMANTIC block) is moved verbatim — never
regenerated. CLI prints one line per service (``migrated:``/``skipped:``) so the
installer can summarize.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

# A legacy in-body reference: ".claude/skills/<segment>" where <segment> is a service-id
# (self-ref) or a registry 'container' name (container-named self/cross-ref). The trailing
# "/scripts/...", "/SKILL.md", or nothing (e.g. `make -C .claude/skills/<seg>`) is preserved.
_CLAUDE_SKILLS_REF = re.compile(r"\.claude/skills/([a-z0-9][a-z0-9_-]*)")

# Sibling imports (consolidated scripts/ dir).
sys.path.insert(0, str(Path(__file__).parent))
from bootstrap import (  # noqa: E402  # type: ignore[import-not-found]
    RootResolutionError,
    get_pack_path,
    get_project_root,
)
from umbrella_generator import write_umbrella  # noqa: E402  # type: ignore[import-not-found]


class MigrationRefused(Exception):
    """Raised when migrating a service would overwrite divergent target content."""


def _read(path: Path) -> str | None:
    return path.read_text(encoding="utf-8") if path.exists() else None


def _new_skill_path_str(project_root: Path, pack: Path, service_id: str) -> str:
    new_md = pack / "service-skills" / "services" / service_id / "SKILL.md"
    try:
        return str(new_md.resolve(strict=False).relative_to(project_root.resolve())).replace(os.sep, "/")
    except ValueError:
        return str(new_md).replace(os.sep, "/")


def _new_skill_dir_str(project_root: Path, pack: Path, service_id: str) -> str:
    """Project-relative POSIX path to a service's NEW skill *directory* (no /SKILL.md), used
    as the rewrite target for legacy in-body ``.claude/skills/<alias>`` references."""
    new_dir = pack / "service-skills" / "services" / service_id
    try:
        return str(new_dir.resolve(strict=False).relative_to(project_root.resolve())).replace(os.sep, "/")
    except ValueError:
        return str(new_dir).replace(os.sep, "/")


def _sync_pack_json(pack: Path) -> str | None:
    """Sync ``PACK.json`` ``skills[]`` to the post-migration filesystem (xtrm-x8b5g).

    The active-view materializer validates a pack's ``PACK.json`` ``skills[]`` against the
    filesystem: an entry is a *direct child dir of the pack that contains a SKILL.md* (dir name
    is the identity). After migration the moved per-service dirs live under
    ``service-skills/services/`` (no longer direct children) and the new ``service-skills``
    umbrella is a direct child — so a stale ``PACK.json`` lists ghost services (metadata-only) and
    omits the umbrella (filesystem-only), tripping ``PACK_METADATA_MISMATCH`` which BLOCKS the
    active-view rebuild. Recompute ``skills[]`` from the filesystem (idempotent). Returns a note,
    or None when there is no ``PACK.json`` or it is already in sync.
    """
    pack_json = pack / "PACK.json"
    if not pack_json.exists():
        return None
    try:
        data = json.loads(pack_json.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return None
    fs_skills = sorted(
        child.name for child in pack.iterdir()
        if child.is_dir() and (child / "SKILL.md").exists()
    )
    if data.get("skills") == fs_skills:
        return None
    data["skills"] = fs_skills
    try:
        pack_json.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    except OSError:
        return None
    return f"pack-json: synced PACK.json skills -> {', '.join(fs_skills) or '(none)'}"


def _rewrite_claude_refs(body: str, new_dir_for: Any) -> tuple[str, int, set[str]]:
    """Rewrite legacy ``.claude/skills/<alias>`` refs in a moved SKILL.md body to the new
    ``.xtrm/.../service-skills/services/<service-id>`` dir.

    ``new_dir_for(alias)`` returns the new dir path for a known alias, or ``None`` to leave the
    ref untouched (and report it as unmapped). The migrator MOVES SKILL.md bodies verbatim, so
    self-refs (``.claude/skills/<service-id>/scripts/...``, ``make -C .claude/skills/<container>``)
    and umbrella cross-refs are left pointing at the dead flat path unless rewritten here
    (xtrm-8ike5). Returns ``(new_body, rewritten_count, unmapped_segments)``.
    """
    unmapped: set[str] = set()
    rewrites = 0

    def _repl(m: "re.Match[str]") -> str:
        nonlocal rewrites
        alias = m.group(1)
        new_dir = new_dir_for(alias)
        if new_dir is None:
            unmapped.add(alias)
            return m.group(0)
        rewrites += 1
        return new_dir

    return _CLAUDE_SKILLS_REF.sub(_repl, body), rewrites, unmapped


def migrate_pack(project_root: Path, pack: Path, repo_name: str) -> dict[str, Any]:
    """Migrate one pack. Returns a result dict with per-service outcomes.

    Raises MigrationRefused (without partial side effects for the offending
    service) if a target exists with divergent content.
    """
    umbrella_dir = pack / "service-skills"
    services_dir = umbrella_dir / "services"
    old_registry = pack / "service-registry.json"
    new_registry = umbrella_dir / "service-registry.json"

    # Read whichever registry exists (new wins if already partially migrated).
    reg_src = new_registry if new_registry.exists() else old_registry
    if not reg_src.exists():
        return {"pack": pack.name, "status": "no-registry", "services": {}}
    registry: dict[str, Any] = json.loads(reg_src.read_text(encoding="utf-8"))
    services: dict[str, Any] = registry.get("services", {})

    # Alias map for in-body ref rewriting: every legacy ".claude/skills/<segment>" segment is
    # either a service-id (self-ref / umbrella cross-ref) or a service's registry 'container'
    # name (container-named self-ref). Map both to the service-id so the new dir resolves.
    alias_to_service: dict[str, str] = {}
    for sid, info in services.items():
        alias_to_service[sid] = sid
        container = info.get("container")
        if isinstance(container, str) and container:
            alias_to_service.setdefault(container, sid)
    _dir_cache: dict[str, str] = {}

    def _new_dir_for(alias: str) -> str | None:
        sid = alias_to_service.get(alias)
        if sid is None:
            return None
        if sid not in _dir_cache:
            _dir_cache[sid] = _new_skill_dir_str(project_root, pack, sid)
        return _dir_cache[sid]

    refs_rewritten = 0
    stale_refs: set[str] = set()

    outcomes: dict[str, str] = {}
    for service_id, info in services.items():
        old_dir = pack / service_id
        new_dir = services_dir / service_id

        if new_dir.exists():
            # Already in place. If the flat copy also lingers, it must match.
            if old_dir.exists() and old_dir.is_dir():
                if _read(old_dir / "SKILL.md") != _read(new_dir / "SKILL.md"):
                    raise MigrationRefused(
                        f"{service_id}: both {old_dir} and {new_dir} exist with divergent SKILL.md — refusing"
                    )
                shutil.rmtree(old_dir)  # safe: confirmed identical
                outcomes[service_id] = "deduped"
            else:
                outcomes[service_id] = "already-migrated"
        elif old_dir.exists() and old_dir.is_dir():
            services_dir.mkdir(parents=True, exist_ok=True)
            shutil.move(str(old_dir), str(new_dir))  # rename — atomic on same fs
            outcomes[service_id] = "migrated"
        else:
            outcomes[service_id] = "missing-source"

        info["skill_path"] = _new_skill_path_str(project_root, pack, service_id)

        # Rewrite legacy in-body ".claude/skills/<alias>/..." refs in the moved SKILL.md so
        # Data-Inspection / Diagnostic-Scripts / `make -C` blocks point at the new services/
        # path instead of the dead flat one (xtrm-8ike5). Idempotent: a re-run finds no
        # ".claude/skills" refs and is a no-op.
        moved_md = new_dir / "SKILL.md"
        if moved_md.exists():
            body = moved_md.read_text(encoding="utf-8")
            rewritten, n, unmapped = _rewrite_claude_refs(body, _new_dir_for)
            if n:
                moved_md.write_text(rewritten, encoding="utf-8")
                refs_rewritten += n
            stale_refs |= unmapped

    # Relocate the registry under the umbrella with rewritten skill_paths.
    umbrella_dir.mkdir(parents=True, exist_ok=True)
    new_registry.write_text(json.dumps(registry, indent=2) + "\n", encoding="utf-8")
    if old_registry.exists() and old_registry.resolve() != new_registry.resolve():
        old_registry.unlink()

    # Generate the umbrella (preserves any existing SEMANTIC block).
    umbrella_changed = write_umbrella(umbrella_dir / "SKILL.md", registry, repo_name)

    # Sync PACK.json AFTER the umbrella exists + services have moved, so the recomputed
    # skills[] reflects the final layout (umbrella in, ghost services out) — xtrm-x8b5g.
    pack_json_note = _sync_pack_json(pack)

    return {
        "pack": pack.name,
        "status": "ok",
        "services": outcomes,
        "umbrella_written": umbrella_changed,
        "registry": str(new_registry),
        "refs_rewritten": refs_rewritten,
        "stale_refs": sorted(stale_refs),
        "pack_json_note": pack_json_note,
    }


def demote_shadowing_registries(project_root: Path) -> list[str]:
    """Remove/flag the stale repo-root + legacy `.claude/skills` registries that
    would otherwise SHADOW the migrated umbrella registry. Symlinks (stale pointers)
    are removed; real files are left in place but reported so nothing is silently
    lost. Returns human-readable notes."""
    notes: list[str] = []
    for label, candidate in (
        ("root", project_root / "service-registry.json"),
        ("legacy", project_root / ".claude" / "skills" / "service-registry.json"),
    ):
        if candidate.is_symlink():
            candidate.unlink()
            notes.append(f"removed stale {label} registry symlink: {candidate}")
        elif candidate.exists():
            notes.append(
                f"WARNING: real {label} registry still present at {candidate} — the umbrella "
                f"registry is now canonical; review and remove this duplicate manually"
            )
    return notes


def main() -> None:
    args = sys.argv[1:]
    project_root_str = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project_root_str:
        try:
            project_root_str = get_project_root()
        except RootResolutionError as e:
            print(f"Error: {e}", file=sys.stderr)
            sys.exit(1)
    project_root = Path(project_root_str)
    repo_name = args[0] if args else project_root.name

    pack = get_pack_path(project_root_str)
    if pack is None:
        print("Error: unable to resolve pack path. Set XTRM_PACK or leave only one pack under .xtrm/skills/user/packs.", file=sys.stderr)
        sys.exit(1)

    try:
        result = migrate_pack(project_root, pack, repo_name)
    except MigrationRefused as e:
        print(f"refused: {e}", file=sys.stderr)
        sys.exit(2)

    if result["status"] == "no-registry":
        print(f"skipped: {pack.name} (no service-registry.json)")
        sys.exit(0)
    for sid, outcome in result["services"].items():
        prefix = "migrated" if outcome in ("migrated", "deduped") else "skipped"
        print(f"{prefix}: {sid} ({outcome})")
    print(f"registry: {result['registry']}")
    print(f"umbrella: {'written' if result['umbrella_written'] else 'unchanged'}")
    if result.get("pack_json_note"):
        print(result["pack_json_note"])
    if result.get("refs_rewritten"):
        print(f"refs: rewrote {result['refs_rewritten']} legacy .claude/skills path(s) in SKILL.md bodies")
    for seg in result.get("stale_refs", []):
        print(
            f"WARNING: unmapped .claude/skills/{seg} ref left as-is "
            f"(no matching service-id or registry container) — review manually",
            file=sys.stderr,
        )
    for note in demote_shadowing_registries(project_root):
        print(note)
    sys.exit(0)


if __name__ == "__main__":
    main()
