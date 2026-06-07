#!/usr/bin/env python3
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, cast

# bootstrap.py is a sibling in this consolidated scripts/ dir (no cross-skill hop).
sys.path.insert(0, str(Path(__file__).parent))
from bootstrap import RootResolutionError, _gitnexus_repo_name, find_service_for_path, get_project_root, get_registry_path, get_service, is_gitnexus_available, load_registry, run_gitnexus_json, save_registry  # type: ignore[import-not-found]  # noqa: E402

# Hard cap on per-item gitnexus enrichment: beyond this many drifted candidates the scan
# falls back to mtime instead of fanning out a gitnexus subprocess per file (which OOMs the
# host on a broad/unfiltered territory — xtrm-08i0b). Override via DRIFT_MAX_ENRICH.
MAX_ENRICH_CANDIDATES = int(os.environ.get("DRIFT_MAX_ENRICH", "200"))

def check_drift(file_path: str, project_root: str | None = None) -> dict:
    if project_root is None:
        try: project_root = get_project_root()
        except RootResolutionError: return {"drift": False, "reason": "Cannot resolve project root"}
    project_root = cast(str, project_root)
    fp = Path(file_path)
    if fp.is_absolute():
        try: file_path = str(fp.relative_to(project_root))
        except ValueError: pass
    service_id = find_service_for_path(file_path, project_root)
    if not service_id: return {"drift": False, "reason": "No service owns this file"}
    service = get_service(service_id, project_root)
    if not service: return {"drift": False, "reason": "Service not found in registry"}
    return {"drift": True, "service_id": service_id, "service_name": service.get("name", service_id), "skill_path": service.get("skill_path"), "last_sync": service.get("last_sync", ""), "file_path": file_path, "message": f"[Skill Sync]: Implementation drift detected in '{service_id}'. File '{file_path}' was modified."}

def check_drift_from_hook_stdin() -> None:
    try: data = json.load(sys.stdin)
    except (json.JSONDecodeError, EOFError): sys.exit(0)
    file_path = data.get("tool_input", {}).get("file_path", "")
    if not file_path: sys.exit(0)
    result = check_drift(file_path)
    if result.get("drift"): print(json.dumps({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": result["message"]}}))
    sys.exit(0)

def _print_missing_registry_hint(project_root: str | None = None) -> None:
    if project_root is None:
        try: project_root = get_project_root()
        except RootResolutionError: project_root = "."
    project_root = cast(str, project_root)
    root = Path(project_root)
    # Diagnostic only: lists the registry search order. The .claude/skills entry
    # is the legacy Claude-view read (back-compat); the canonical home is .xtrm packs.
    print(f"Registry not found. Expected one of: {root / 'service-registry.json'}, {root / '.claude/skills/service-registry.json (legacy view)'}, {root / '.xtrm/skills/user/packs/*/service-registry.json'}", file=sys.stderr)

def update_sync_time(service_id: str, project_root: str | None = None) -> bool:
    try:
        registry = load_registry(project_root)
    except Exception:
        return False
    if "services" not in registry or service_id not in registry["services"]:
        return False
    registry["services"][service_id]["last_sync"] = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        # Resolve the root the same way load_registry does. On the CLI path
        # (`drift_detector.py sync <id>`) project_root is None; passing that straight to
        # _git_head ran `git -C None ...`, which raised and silently stored an empty ref —
        # so scan could never tier semantically (no_ref -> mtime fallback) for any service.
        resolved_root = project_root if project_root is not None else get_project_root()
        registry["services"][service_id]["last_sync_ref"] = _git_head(resolved_root)
    except Exception:
        registry["services"][service_id]["last_sync_ref"] = ""
    try:
        save_registry(registry, project_root)
        return True
    except Exception:
        return False

def _classify_tier(symbols: list[str], processes: list[str], changed_files: list[str]) -> str:
    if processes or len(symbols) >= 2 or len(changed_files) >= 3:
        return "high"
    if symbols or changed_files:
        return "medium"
    return "cosmetic"

def _extract_cross_territory(file_path: str, service_id: str, project_root: str) -> list[str]:
    registry = load_registry(project_root)
    text = (Path(project_root) / file_path).read_text(encoding="utf-8", errors="ignore")
    out = []
    for other_id, service in registry.get("services", {}).items():
        if other_id == service_id:
            continue
        for pattern in service.get("territory", []):
            base = pattern.replace("/**/*", "").replace("/**", "").rstrip("/")
            if base and base in text:
                out.append(f"cross-territory drift signal: {other_id}")
                break
    return out

def _git_head(project_root: str) -> str:
    import subprocess
    result = subprocess.run(["git", "-C", project_root, "rev-parse", "HEAD"], capture_output=True, text=True, check=False)
    return result.stdout.strip()


def _git_tracked_files(project_root: str) -> set[str] | None:
    """Set of git-tracked file paths (relative, POSIX), or None if git is unavailable.

    Territory globs match the FILESYSTEM, so build/vendor/cache trees (rust ``target/``,
    ``__pycache__``, ``node_modules``) get swept into the drift candidate set even though
    they are gitignored. Filtering candidates to tracked files is the primary defense
    against the OOM fan-out (xtrm-08i0b)."""
    import subprocess
    try:
        result = subprocess.run(["git", "-C", project_root, "ls-files", "-z"],
                                capture_output=True, text=True, check=False, timeout=10)
    except Exception:
        return None
    if result.returncode != 0:
        return None
    return {p for p in result.stdout.split("\0") if p}


def _git_diff_files(project_root: str, base_ref: str | None) -> list[str]:
    import subprocess
    if not base_ref:
        return []
    result = subprocess.run(["git", "-C", project_root, "diff", "--name-only", f"{base_ref}..HEAD"], capture_output=True, text=True, check=False)
    if result.returncode != 0:
        return []
    return [line.strip() for line in result.stdout.splitlines() if line.strip()]


def _normalize_detect_output(output: Any) -> list[str]:
    if isinstance(output, dict):
        raw = output.get("output", "")
    else:
        raw = output
    if not isinstance(raw, str):
        return []
    return [line.strip() for line in raw.splitlines() if line.strip()]


def _resolve_base_ref(base_ref: str | None, project_root: str) -> str | None:
    if base_ref:
        return base_ref
    import subprocess
    result = subprocess.run(["git", "-C", project_root, "rev-parse", "HEAD^1"], capture_output=True, text=True, check=False)
    candidate = result.stdout.strip()
    return candidate or None


def _gitnexus_compare(base_ref: str | None, repo_name: str, timeout: float = 2.0) -> tuple[str, list[str]]:
    if not base_ref:
        return "no_ref", []
    output = run_gitnexus_json(["detect_changes", "--scope", "compare", "--base-ref", base_ref], timeout, repo_name)
    if output is None:
        return "cli_error", []
    lines = _normalize_detect_output(output)
    return "ok", lines


def _enrich_item(item: dict, project_root: str, repo_name: str, base_ref: str | None) -> dict:
    resolved_base_ref = _resolve_base_ref(base_ref, project_root)
    status, lines = _gitnexus_compare(resolved_base_ref, repo_name)
    changed_files = _git_diff_files(project_root, resolved_base_ref)
    symbols = [line for line in lines if item["file_path"] in line]
    processes = []
    if status == "ok" and changed_files and item["file_path"] in changed_files:
        processes.append("compare-range")
    item["gitnexus_status"] = status
    item["tier_source"] = "gitnexus" if status == "ok" else "mtime"
    item["symbols"] = list(dict.fromkeys(symbols))
    item["processes"] = list(dict.fromkeys(processes))
    item["cross_territory"] = _extract_cross_territory(item["file_path"], item["service_id"], project_root)
    item["tier"] = _classify_tier(item["symbols"], item["processes"], changed_files)
    if item["tier_source"] != "gitnexus":
        item["tier"] = "unknown"
    return item

def _service_last_sync_ref(service: dict[str, Any]) -> str | None:
    value = service.get("last_sync_ref")
    return value if isinstance(value, str) and value else None


def territory_gitignore_report(project_root: str | None = None) -> list[dict]:
    """Per (service, territory pattern), report filesystem-glob matches that are NOT git-tracked
    — i.e. gitignored build/vendor/cache files a glob sweeps in (xtrm-br179).

    Read-only. Returns one entry per pattern with a nonzero ignored-delta (empty if git is
    unavailable or no registry). These files are already dropped at scan time by the
    ``_git_tracked_files`` filter (xtrm-08i0b), so this is an advisory lint: a flagged pattern is
    matching the filesystem rather than git and should be narrowed (e.g. ``dir/**/*`` ->
    ``dir/**/*.py``) so the territory tracks only real source.
    """
    if project_root is None:
        try:
            project_root = get_project_root()
        except RootResolutionError:
            return []
    project_root = cast(str, project_root)
    root = Path(project_root)
    if not get_registry_path(project_root).exists():
        return []
    tracked = _git_tracked_files(project_root)
    if tracked is None:
        return []
    registry = load_registry(project_root)
    report: list[dict] = []
    for service_id, service in registry.get("services", {}).items():
        for pattern in service.get("territory", []):
            fs = [str(p.relative_to(root)) for p in root.glob(pattern) if p.is_file()]
            if not fs:
                continue
            ignored = sorted(f for f in fs if f not in tracked)
            if ignored:
                report.append({
                    "service_id": service_id, "pattern": pattern, "fs": len(fs),
                    "tracked": len(fs) - len(ignored), "ignored": len(ignored),
                    "samples": ignored[:3],
                })
    return report


def scan_drift(project_root: str | None = None, enrich_with_gitnexus: bool = False, use_gitnexus: bool = True) -> list[dict]:
    if project_root is None:
        try:
            project_root = get_project_root()
        except RootResolutionError:
            return []
    project_root = cast(str, project_root)
    root = Path(project_root)
    if not get_registry_path(project_root).exists():
        _print_missing_registry_hint(project_root)
        return []
    registry = load_registry(project_root)
    drifted = []
    for service_id, service in registry.get("services", {}).items():
        last_sync_str = service.get("last_sync", "")
        try:
            sync_time = datetime.fromisoformat(last_sync_str.replace("Z", "+00:00")) if last_sync_str else None
        except ValueError:
            sync_time = None
        # A service with no (or unparseable, e.g. the "never" sentinel) last_sync has been
        # CATALOGUED but never verified-synced. Surface its WHOLE territory as drift (needs an
        # initial verified sync) instead of skipping — skipping is exactly how a bulk
        # timestamp-less catalog masked real drift: the mtime pre-filter returned 0 and every
        # service looked clean (xtrm-008tr). Compare against the epoch so every tracked file
        # counts; the git-tracked filter + enrichment cap below keep the candidate set bounded.
        never_synced = sync_time is None
        floor = sync_time if sync_time is not None else datetime.fromtimestamp(0, tz=timezone.utc)
        for pattern in service.get("territory", []):
            for fp in root.glob(pattern):
                if fp.is_file() and datetime.fromtimestamp(fp.stat().st_mtime, tz=timezone.utc) > floor:
                    drifted.append({"service_id": service_id, "service_name": service.get("name", service_id), "file_path": str(fp.relative_to(root)), "last_sync": last_sync_str, "last_sync_ref": _service_last_sync_ref(service), "never_synced": never_synced})
    if not drifted:
        return []
    # Respect .gitignore: drop candidates that are not git-tracked (build/vendor/cache trees
    # swept in by filesystem globs) before any gitnexus enrichment (xtrm-08i0b).
    tracked = _git_tracked_files(project_root)
    if tracked is not None:
        before = len(drifted)
        drifted = [d for d in drifted if d["file_path"] in tracked]
        dropped = before - len(drifted)
        if dropped:
            # Advisory: a territory glob is matching gitignored build/vendor/cache files. They are
            # safely excluded here (xtrm-08i0b), but the pattern should be narrowed (xtrm-br179).
            print(f"drift_detector: dropped {dropped} gitignored candidate(s) swept in by territory "
                  f"globs; run 'drift_detector.py validate-territories' to find which to narrow.",
                  file=sys.stderr)
        if not drifted:
            return []
    # Hard cap: an unbounded candidate set fans out one gitnexus subprocess per file and OOMs
    # the host. Beyond the cap, fall back to mtime and warn loudly (xtrm-08i0b).
    if use_gitnexus and len(drifted) > MAX_ENRICH_CANDIDATES:
        print(f"drift_detector: {len(drifted)} drifted candidates exceed "
              f"DRIFT_MAX_ENRICH={MAX_ENRICH_CANDIDATES}; skipping gitnexus enrichment "
              f"(mtime-only). Narrow the service territory globs or raise DRIFT_MAX_ENRICH.",
              file=sys.stderr)
        use_gitnexus = False
    if not use_gitnexus:
        for item in drifted:
            item["gitnexus_status"] = "disabled"
            item["tier_source"] = "mtime"
            item["tier"] = "unknown"
        return drifted
    ok, reason = is_gitnexus_available(timeout=2.0)
    if not ok:
        for item in drifted:
            item["gitnexus_status"] = "absent" if reason == "disabled by GITNEXUS_DISABLE" else ("no_ref" if item.get("last_sync_ref") is None else "cli_error")
            item["tier_source"] = "mtime"
            item["tier"] = "unknown"
        print(f"gitnexus enrichment skipped: {reason}", file=sys.stderr)
        return drifted
    out = []
    for item in drifted:
        try:
            out.append(_enrich_item(item, project_root, _gitnexus_repo_name(project_root), item.get("last_sync_ref")))
        except Exception as exc:
            item["gitnexus_status"] = "cli_error"
            item["tier_source"] = "mtime"
            item["tier"] = "unknown"
            print(f"gitnexus enrichment skipped for {item['file_path']}: {exc}", file=sys.stderr)
            out.append(item)
    return out

def main() -> None:
    args = sys.argv[1:]
    if not args:
        sys.exit(1)
    enrich = "--enrich-with-gitnexus" in args
    no_gitnexus = "--no-gitnexus" in args
    cmd = args[0]
    if cmd == "check-hook":
        check_drift_from_hook_stdin()
    elif cmd == "check" and len(args) > 1:
        r = check_drift(args[1])
        print(r["message"] if r.get("drift") else f"No drift: {r.get('reason', 'OK')}")
    elif cmd == "sync" and len(args) > 1:
        sys.exit(0 if update_sync_time(args[1]) else 1)
    elif cmd == "validate-territories":
        report = territory_gitignore_report()
        if not report:
            print("Territory validation: no gitignored files swept in by any territory glob "
                  "(or git/registry unavailable).")
            return
        total = sum(r["ignored"] for r in report)
        print(f"Territory validation: {len(report)} pattern(s) sweep in {total} gitignored file(s). "
              "These are dropped at scan time but indicate the glob should be narrowed:")
        for r in report:
            print(f"  [{r['service_id']}] '{r['pattern']}': {r['fs']} fs / {r['tracked']} tracked / "
                  f"{r['ignored']} ignored")
            print(f"      e.g. {r['samples']}")
        print("Tip: narrow recursive globs (e.g. 'dir/**/*' -> 'dir/**/*.py') so the territory "
              "tracks only real source.")
    elif cmd == "scan":
        d = scan_drift(enrich_with_gitnexus=enrich, use_gitnexus=not no_gitnexus)
        if not d:
            print("No drift detected.")
            return
        print(f"Found {len(d)} drifted service(s):")
        for i in d:
            print(f"  {i['service_id']}: {i['file_path']} (last sync: {i['last_sync']})")
            print(f"    gitnexus_status={i.get('gitnexus_status', 'absent')} tier_source={i.get('tier_source', 'mtime')} tier={i.get('tier', 'unknown')} symbols={','.join(i.get('symbols', [])) or '-'} processes={','.join(i.get('processes', [])) or '-'} cross_territory={'; '.join(i.get('cross_territory', [])) or '-'}")
    else:
        sys.exit(1)

if __name__ == "__main__": main()
