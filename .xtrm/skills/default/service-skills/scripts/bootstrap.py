#!/usr/bin/env python3
"""
Bootstrap module for Service Skill Trinity.

Provides root-discovery and registry CRUD operations shared across all
service-skill workflow scripts. All scripts in the trinity import from here.

Path model: the canonical home for service skills + registry is under .xtrm
(``.xtrm/skills/user/packs/<pack>/...``). ``.claude/skills`` is a Claude-Code
VIEW only — kept solely as a legacy READ fallback for pre-migration installs.
No code path EMITS a ``.claude/skills`` path for cross-tool consumption; use the
resolver helpers (get_service_skill_dir / get_service_skill_path_str) instead.

Registry resolution order:
  1) $SERVICE_REGISTRY_PATH override
  2) <root>/service-registry.json
  3) <root>/.claude/skills/service-registry.json   (legacy Claude-view read; back-compat)
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


def get_service_skill_dir(service_id: str, project_root: str | None = None) -> Path:
    """Resolve a service's skill-package directory (absolute, under .xtrm — never .claude).

    Single source of truth for *where a service skill lives*. Today that is
    ``<pack>/<service_id>`` under ``.xtrm/skills/user/packs``. Child .4 (layout
    migrator) re-points this to ``<pack>/service-skills/services/<service_id>``;
    every emitter (scaffolder bodies, activator/cataloger fallbacks, registry
    skill_path) routes through here, so they all follow automatically — no
    emitter hardcodes a path.
    """
    root: str = project_root if project_root is not None else (os.environ.get("CLAUDE_PROJECT_DIR") or get_project_root())
    pack = get_pack_path(root)
    base = pack if pack is not None else _packs_root(root)
    # New layout: services live under the per-repo umbrella (<pack>/service-skills/services/).
    return base / "service-skills" / "services" / service_id


def get_service_skill_path_str(service_id: str, project_root: str | None = None) -> str:
    """Project-relative POSIX path to a service's SKILL.md.

    Used for the registry ``skill_path`` and for injected "Read <path>" prompts.
    Resolves under ``.xtrm``; falls back to an absolute path only if the skill
    dir is somehow outside the project root. Never emits ``.claude/skills``.
    """
    root: str = project_root if project_root is not None else (os.environ.get("CLAUDE_PROJECT_DIR") or get_project_root())
    skill_md = get_service_skill_dir(service_id, root) / "SKILL.md"
    try:
        rel = skill_md.resolve(strict=False).relative_to(Path(root).resolve())
        return str(rel).replace(os.sep, "/")
    except ValueError:
        return str(skill_md).replace(os.sep, "/")


def get_umbrella_dir(project_root: str | None = None) -> Path | None:
    """Resolve the per-repo umbrella directory ``<pack>/service-skills`` (absolute),
    or None if no pack is resolvable. The umbrella SKILL.md (``<repo>-services``) and
    the relocated registry live here under the new layout."""
    pack = get_pack_path(project_root)
    return None if pack is None else pack / "service-skills"


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

    # Precedence — the canonical .xtrm umbrella location wins, so a stale root or
    # legacy .claude registry can NEVER shadow a migrated repo (the bug that made
    # market-data's migration not stick):
    #   1) umbrella-owned registry           (post-migration canonical)
    #   2) flat pack-root registry           (pre-migration .xtrm layout)
    #   3) <root>/service-registry.json      (legacy back-compat)
    #   4) .claude/skills/service-registry.json  (legacy Claude-view back-compat)
    umbrella_registries = sorted(root.glob(".xtrm/skills/user/packs/*/service-skills/service-registry.json"))
    if umbrella_registries:
        return _select_pack_registry(umbrella_registries, project_root)

    pack_registries = sorted(root.glob(".xtrm/skills/user/packs/*/service-registry.json"))
    if pack_registries:
        return _select_pack_registry(pack_registries, project_root)

    if preferred.exists():
        return preferred

    legacy = root / ".claude" / "skills" / "service-registry.json"
    if legacy.exists():
        return legacy

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
    # Registration is CATALOGUING, not a verified sync. Deliberately do NOT stamp
    # ``last_sync`` here: claiming "synced as of now" without auditing the SKILL.md
    # against code is the exact "timestamp-only sync without evidence" anti-pattern the
    # librarian's own prompt forbids — and when done in bulk it set every service's
    # last_sync=now with no last_sync_ref, so the drift scan's mtime pre-filter returned
    # 0 candidates and masked real drift (xtrm-008tr). Only a verified audit
    # (drift_detector.update_sync_time) may stamp last_sync, and it stamps last_sync_ref
    # atomically alongside. A catalogued-but-never-synced service is surfaced as drift by
    # scan_drift (needs initial verified sync) rather than appearing falsely clean.
    registry["services"][service_id] = {
        "name": name,
        "territory": territory,
        "skill_path": skill_path,
        "description": description,
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

def _gitnexus_repo_name(project_root: str | None = None) -> str:
    """Resolve the repo label gitnexus indexed under — the MAIN worktree's basename.

    In a linked git worktree ``get_project_root()`` returns the worktree dir, whose basename
    (e.g. ``market-data-uh1r-service-skills-sync``) gitnexus has NOT indexed; injecting it as
    ``--repo`` makes every gitnexus call fail → drift silently degrades to mtime-only tiering.
    The service-skills-sync librarian ALWAYS runs in such an auto-provisioned worktree, so it
    would otherwise never get semantic enrichment. ``git rev-parse --git-common-dir`` points at
    the shared (main) ``.git``; its parent is the indexed checkout (xtrm-vvhfs). Falls back to the
    local basename on any git failure. ``GITNEXUS_REPO`` still wins when explicitly set.
    """
    env = os.environ.get("GITNEXUS_REPO")
    if env:
        return env
    root = Path(project_root or get_project_root())
    try:
        result = subprocess.run(  # nosec B603 B607
            ["git", "-C", str(root), "rev-parse", "--git-common-dir"],
            capture_output=True, text=True, check=True, timeout=5,
        )
        common = result.stdout.strip()
        if common:
            common_path = Path(common)
            if not common_path.is_absolute():
                common_path = root / common_path
            main_root = common_path.resolve().parent
            if main_root.name:
                return main_root.name
    except (subprocess.SubprocessError, OSError):
        pass
    return root.name


def _gitnexus_tool_name(args: list[str]) -> str | None:
    return args[0] if args and args[0] in {"detect_changes", "impact", "query", "context"} else None


def _kill_process_tree(proc: "subprocess.Popen") -> None:
    """Reap the WHOLE process group started by Popen(start_new_session=True), then wait.

    `npx gitnexus` spawns a child `node` that loads the repo graph into memory; a plain
    subprocess kill only signals the direct `npx` pid, leaving the `node` grandchild
    orphaned and still resident. Over an unbounded candidate set those orphans OOM the
    host (xtrm-08i0b). Killing the session/process group guarantees nothing lingers.
    """
    import os
    import signal
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except Exception:
            pass
    try:
        proc.wait(timeout=2)
    except Exception:
        pass


def run_gitnexus_json(args: list[str], timeout: float = 2.0, repo_name: str | None = None) -> dict[str, Any] | list[Any] | None:
    cmd = ["npx", "gitnexus", *args]
    tool_name = _gitnexus_tool_name(args)
    if tool_name and "--repo" not in args:
        cmd.extend(["--repo", repo_name or _gitnexus_repo_name()])
    # Run in its own session (process group) so a timeout — or any failure — lets us reap
    # the full tree, not just the npx pid (xtrm-08i0b). Without this, a slow/hung gitnexus
    # leaves a resident node process behind on every call.
    proc = None
    stdout = ""
    try:
        proc = subprocess.Popen(
            cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=True
        )
        try:
            stdout, _ = proc.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            _kill_process_tree(proc)
            return None
        if proc.returncode != 0:
            return None
    except Exception:
        return None
    finally:
        if proc is not None and proc.poll() is None:
            _kill_process_tree(proc)
    stdout = (stdout or "").strip()
    if not stdout:
        return {}
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"output": stdout}


def is_gitnexus_available(timeout: float = 2.0) -> tuple[bool, str]:
    if os.environ.get("GITNEXUS_DISABLE"):
        return False, "disabled by GITNEXUS_DISABLE"
    try:
        probe = run_gitnexus_json(["detect_changes", "--scope", "unstaged"], timeout=timeout)
    except Exception as exc:
        return False, str(exc)
    if probe is None:
        return False, "cli_error"
    if isinstance(probe, dict) and probe.get("warning"):
        return False, str(probe.get("warning"))
    return True, "ok"
