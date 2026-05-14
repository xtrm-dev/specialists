#!/usr/bin/env python3
"""
Bootstrap module for Service Skill Trinity.

Provides root-discovery and registry CRUD operations shared across all
service-skill workflow scripts. All scripts in the trinity import from here.

Registry resolution order:
  1) $SERVICE_REGISTRY_PATH override
  2) <root>/service-registry.json
  3) <root>/.claude/skills/service-registry.json
  4) <root>/.xtrm/skills/user/packs/*/service-registry.json

For pack glob, first hit wins after disambiguation:
- If active pack discoverable, matching pack registry preferred
- Else lexicographically first registry used with stderr warning

Skills location: .xtrm/skills/user/packs/<pack>/<service-id>/
"""

import json
import os
import re
import subprocess  # nosec B404
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SERVICE_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-_]{0,63}$")
PACKS_ROOT_SUFFIX = Path(".xtrm") / "skills" / "user" / "packs"


class BootstrapError(Exception):
    pass


class RootResolutionError(BootstrapError):
    pass


class RegistryError(BootstrapError):
    pass


def get_project_root() -> str:
    try:
        result = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True, check=True, timeout=5)  # nosec B603 B607
        root = result.stdout.strip()
        if not root:
            raise RootResolutionError("Git returned empty path")
        if not os.path.isdir(root):
            raise RootResolutionError(f"Resolved path is not a directory: {root}")
        return root
    except subprocess.CalledProcessError as e:
        raise RootResolutionError(f"Git root resolution failed: {e.stderr.strip() if e.stderr else str(e)}") from e
    except subprocess.TimeoutExpired as e:
        raise RootResolutionError("Git command timed out") from e
    except FileNotFoundError as e:
        raise RootResolutionError("Git not found in PATH") from e


def get_skills_root(project_root: str | None = None) -> Path:
    if project_root is None:
        project_root = get_project_root()
    return Path(project_root) / ".claude" / "skills"


def _packs_root(project_root: str | None = None) -> Path:
    if project_root is None:
        project_root = get_project_root()
    return Path(project_root) / PACKS_ROOT_SUFFIX


def _ensure_within_root(candidate: Path, root: Path, label: str) -> Path:
    resolved_root = root.resolve()
    resolved_candidate = candidate.resolve(strict=False)
    if resolved_root not in resolved_candidate.parents and resolved_candidate != resolved_root:
        raise RootResolutionError(f"{label} must stay within {resolved_root}")
    return resolved_candidate


def get_pack_path(project_root: str | None = None) -> Path | None:
    if project_root is None:
        env_root = os.environ.get("CLAUDE_PROJECT_DIR")
        project_root = env_root or get_project_root()

    root = Path(project_root)
    packs_root = _packs_root(project_root)
    env_pack = os.environ.get("XTRM_PACK")

    if env_pack:
        pack_path = Path(env_pack)
        if not pack_path.is_absolute():
            pack_path = packs_root / env_pack
        return _ensure_within_root(pack_path, packs_root, "XTRM_PACK path")

    if not packs_root.exists():
        return None

    pack_dirs = [path for path in packs_root.iterdir() if path.is_dir()]
    if len(pack_dirs) == 1:
        return pack_dirs[0].resolve()

    return None


def _select_pack_registry(pack_registries: list[Path], project_root: str) -> Path:
    active_pack = get_pack_path(project_root)
    if active_pack is not None:
        active_candidate = active_pack / "service-registry.json"
        if active_candidate in pack_registries:
            return active_candidate

    chosen = sorted(pack_registries)[0]
    if len(pack_registries) > 1:
        candidates = ", ".join(str(p) for p in sorted(pack_registries))
        print(
            f"Warning: multiple pack registries found, using {chosen}. Candidates: {candidates}",
            file=sys.stderr,
        )
    return chosen


def get_registry_path(project_root: str | None = None) -> Path:
    env_registry = os.environ.get("SERVICE_REGISTRY_PATH")
    if env_registry:
        return Path(env_registry)

    if project_root is None:
        env_root = os.environ.get("CLAUDE_PROJECT_DIR")
        project_root = env_root or get_project_root()

    root = Path(project_root)
    preferred = root / "service-registry.json"
    if preferred.exists():
        return preferred

    legacy = root / ".claude" / "skills" / "service-registry.json"
    if legacy.exists():
        return legacy

    pack_registries = sorted(root.glob(".xtrm/skills/user/packs/*/service-registry.json"))
    if pack_registries:
        return _select_pack_registry(pack_registries, project_root)

    return preferred


def load_registry(project_root: str | None = None) -> dict[str, Any]:
    registry_path = get_registry_path(project_root)
    if not registry_path.exists():
        return {"version": "1.0", "services": {}}
    try:
        with open(registry_path, encoding="utf-8") as f:
            return json.load(f)
    except json.JSONDecodeError as e:
        raise RegistryError(f"Invalid JSON in registry: {e}") from e
    except OSError as e:
        raise RegistryError(f"Cannot read registry: {e}") from e


def save_registry(data: dict[str, Any], project_root: str | None = None) -> None:
    registry_path = get_registry_path(project_root)
    registry_path.parent.mkdir(parents=True, exist_ok=True)
    try:
        with open(registry_path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2)
    except OSError as e:
        raise RegistryError(f"Cannot write registry: {e}") from e


def register_service(
    service_id: str,
    name: str,
    territory: list[str],
    skill_path: str,
    description: str = "",
    project_root: str | None = None,
) -> None:
    registry = load_registry(project_root)
    if "services" not in registry:
        registry["services"] = {}
    registry["services"][service_id] = {
        "name": name,
        "territory": territory,
        "skill_path": skill_path,
        "description": description,
        "last_sync": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
    }
    save_registry(registry, project_root)


def unregister_service(service_id: str, project_root: str | None = None) -> bool:
    registry = load_registry(project_root)
    if "services" not in registry or service_id not in registry["services"]:
        return False
    del registry["services"][service_id]
    save_registry(registry, project_root)
    return True


def get_service(service_id: str, project_root: str | None = None) -> dict[str, Any] | None:
    registry = load_registry(project_root)
    return registry.get("services", {}).get(service_id)


def list_services(project_root: str | None = None) -> dict[str, dict[str, Any]]:
    registry = load_registry(project_root)
    return registry.get("services", {})


def find_service_for_path(file_path: str, project_root: str | None = None) -> str | None:
    registry = load_registry(project_root)
    if project_root is None:
        try:
            project_root = get_project_root()
        except RootResolutionError:
            return None
    project_root = Path(project_root)
    file_path_obj = Path(file_path)
    test_path = project_root / file_path_obj if not file_path_obj.is_absolute() else file_path_obj
    for service_id, service_data in registry.get("services", {}).items():
        for pattern in service_data.get("territory", []):
            for glob_match in Path(project_root).glob(pattern):
                if glob_match == test_path:
                    return service_id
            base = pattern.replace("/**/*", "").replace("/**", "").rstrip("/")
            if str(file_path).startswith(base + "/") or str(file_path) == base:
                return service_id
    return None


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python bootstrap.py <command> [args...]")
        print("Commands: root, registry, list, find <path>")
        sys.exit(1)
    command = sys.argv[1]
    if command == "root":
        print(get_project_root())
    elif command == "registry":
        print(json.dumps(load_registry(), indent=2))
    elif command == "list":
        for sid, data in list_services().items():
            print(f"- {sid}: {data.get('name', 'N/A')} ({data.get('description', 'N/A')})")
    elif command == "find" and len(sys.argv) > 2:
        result = find_service_for_path(sys.argv[2])
        print(result if result else "No service found")
    else:
        print(f"Unknown command: {command}")
        sys.exit(1)
