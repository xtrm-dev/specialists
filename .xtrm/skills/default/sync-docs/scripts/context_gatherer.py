#!/usr/bin/env python3
"""
Gather project context for documentation sync.

Collects:
  - Recent commits in a time window (not merges)
  - Changed files per commit
  - Recently closed bd issues
  - bd memories
  - Docs drift report

Outputs JSON to stdout. Safe to run in any project — degrades gracefully
when bd or drift detection tools are unavailable.

Usage:
  context_gatherer.py [options]

  Time window (pick one):
    --since-hours N     Look back N hours (default: 24)
    --since-days N      Look back N days
    --since-commits N   Look back N commits (legacy fallback)

  Scope:
    --scope-path PATH   Limit git gathering to this subtree (repeatable)
    --doc PATH          Declare explicit doc target (repeatable)

  Output:
    --json              JSON output (default, kept for compat)
"""

import sys
import json
import subprocess
import time
from pathlib import Path
from datetime import datetime, timezone


def run(cmd: list, cwd: str | None = None, timeout: int = 10) -> str | None:
    """Run a command, return stdout or None on failure."""
    try:
        result = subprocess.run(
            cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout
        )
        if result.returncode == 0:
            return result.stdout.strip()
        return None
    except Exception:
        return None


def find_project_root() -> Path:
    """Walk up from cwd looking for .git."""
    p = Path.cwd()
    for parent in [p, *p.parents]:
        if (parent / ".git").exists():
            return parent
    return p


def find_main_repo_root(root: Path) -> Path:
    """For git worktrees, resolve the main repo root."""
    git_path = root / ".git"
    if git_path.is_file():
        content = git_path.read_text(encoding="utf-8").strip()
        if content.startswith("gitdir:"):
            worktree_git = Path(content[len("gitdir:"):].strip())
            main_git = worktree_git.parent.parent
            return main_git.parent
    return root


def ensure_dolt_server(cwd: str) -> bool:
    """Ensure the Dolt server is running. Returns True if ready."""
    test = run(["bd", "dolt", "test"], cwd=cwd, timeout=5)
    if test is not None:
        return True

    try:
        subprocess.run(
            ["bd", "dolt", "start"],
            cwd=cwd, capture_output=True, text=True, timeout=15,
        )
    except Exception:
        return False

    for _ in range(6):
        time.sleep(1)
        if run(["bd", "dolt", "test"], cwd=cwd, timeout=3) is not None:
            return True

    return False


def has_beads(root: Path) -> bool:
    return (root / ".beads").exists()


def build_git_since_arg(since_hours: int | None, since_days: int | None) -> str | None:
    """Build --since argument for git log from time window flags."""
    if since_hours is not None:
        return f"{since_hours} hours ago"
    if since_days is not None:
        return f"{since_days} days ago"
    return None


def gather_commits_by_time(
    root: Path,
    git_since: str,
    scope_paths: list[str],
) -> list[dict]:
    """Get commits within a time window, optionally scoped to paths."""
    cmd = [
        "git", "log",
        f"--since={git_since}",
        "--no-merges",
        "--format=%H|%s|%ci",
        "--name-only",
    ]
    if scope_paths:
        cmd.append("--")
        cmd.extend(scope_paths)

    out = run(cmd, cwd=str(root), timeout=15)
    if not out:
        return []

    commits = []
    current: dict | None = None

    for line in out.splitlines():
        if "|" in line and line.count("|") >= 2:
            if current:
                commits.append(current)
            parts = line.split("|", 2)
            current = {
                "sha": parts[0][:8],
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "files": [],
            }
        elif current and line.strip():
            current["files"].append(line.strip())

    if current:
        commits.append(current)

    return commits


def gather_commits_by_count(
    root: Path,
    count: int,
    scope_paths: list[str],
) -> list[dict]:
    """Fallback: get N recent commits."""
    cmd = [
        "git", "log",
        f"-{count}",
        "--no-merges",
        "--format=%H|%s|%ci",
        "--name-only",
    ]
    if scope_paths:
        cmd.append("--")
        cmd.extend(scope_paths)

    out = run(cmd, cwd=str(root), timeout=15)
    if not out:
        return []

    commits = []
    current: dict | None = None

    for line in out.splitlines():
        if "|" in line and line.count("|") >= 2:
            if current:
                commits.append(current)
            parts = line.split("|", 2)
            current = {
                "sha": parts[0][:8],
                "subject": parts[1].strip(),
                "date": parts[2].strip(),
                "files": [],
            }
        elif current and line.strip():
            current["files"].append(line.strip())

    if current:
        commits.append(current)

    return commits


def summarize_changed_files(commits: list[dict]) -> list[dict]:
    """Summarize unique changed files across all commits."""
    file_counts: dict[str, int] = {}
    for c in commits:
        for f in c.get("files", []):
            file_counts[f] = file_counts.get(f, 0) + 1

    return [
        {"path": path, "commit_count": count}
        for path, count in sorted(file_counts.items(), key=lambda x: -x[1])
    ]


def summarize_changed_dirs(commits: list[dict]) -> list[dict]:
    """Summarize changed directories for quick scope overview."""
    dir_counts: dict[str, int] = {}
    for c in commits:
        for f in c.get("files", []):
            d = str(Path(f).parent) if "/" in f else "."
            dir_counts[d] = dir_counts.get(d, 0) + 1

    return [
        {"directory": d, "file_changes": count}
        for d, count in sorted(dir_counts.items(), key=lambda x: -x[1])[:15]
    ]


def gather_bd_closed(cwd: str, git_since: str | None) -> list[dict]:
    """Get recently closed bd issues."""
    out = run(["bd", "list", "--status=closed"], cwd=cwd)
    if not out:
        return []

    issues = []
    for line in out.splitlines():
        line = line.strip()
        if line.startswith("\u2713") or "closed" in line.lower():
            parts = line.lstrip("\u2713 ").split()
            if len(parts) >= 2:
                issue_id = parts[0]
                title_start = 2 if len(parts) > 2 and parts[1].startswith("P") else 1
                title = " ".join(parts[title_start:])
                issues.append({"id": issue_id, "title": title})

    return issues[:20]


def gather_bd_memories(cwd: str) -> list[dict]:
    """Read bd memories via bd kv list, filtering memory.* keys."""
    out = run(["bd", "kv", "list"], cwd=cwd)
    if not out:
        return []

    memories = []
    for line in out.splitlines():
        stripped = line.strip()
        if not stripped.startswith("memory."):
            continue
        if " = " in stripped:
            key, _, value = stripped.partition(" = ")
            memories.append({"key": key.strip(), "value": value.strip()})
        else:
            memories.append({"key": stripped, "value": ""})

    return memories[:20]


def gather_docs_drift(root: Path) -> dict:
    """Run drift_detector.py and capture stale docs report."""
    detector = Path(__file__).parent / "drift_detector.py"
    if not detector.exists():
        return {"available": False, "stale": []}

    out = run(
        [sys.executable, str(detector), "scan", "--json"],
        cwd=str(root),
    )
    if out is None:
        return {"available": False, "stale": []}

    try:
        data = json.loads(out)
        return {
            "available": True,
            "stale": data.get("stale", []),
            "count": data.get("count", 0),
        }
    except json.JSONDecodeError:
        return {"available": True, "stale": [], "parse_error": True}


def infer_mode(doc_targets: list[str], scope_paths: list[str]) -> str:
    """Infer operating mode from CLI args."""
    if doc_targets:
        return "targeted"
    if scope_paths:
        return "area"
    return "full"


def parse_args(argv: list[str]) -> dict:
    """Parse CLI arguments."""
    args = {
        "since_hours": None,
        "since_days": None,
        "since_commits": None,
        "scope_paths": [],
        "doc_targets": [],
    }

    i = 1
    while i < len(argv):
        arg = argv[i]
        if arg.startswith("--since-hours"):
            val = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]; i += 0 if "=" in arg else 1
            args["since_hours"] = int(val)
        elif arg.startswith("--since-days"):
            val = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]; i += 0 if "=" in arg else 1
            args["since_days"] = int(val)
        elif arg.startswith("--since-commits"):
            val = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]; i += 0 if "=" in arg else 1
            args["since_commits"] = int(val)
        elif arg.startswith("--since="):
            # Legacy compat: --since=N means commits
            args["since_commits"] = int(arg.split("=", 1)[1])
        elif arg.startswith("--scope-path"):
            val = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]; i += 0 if "=" in arg else 1
            args["scope_paths"].append(val)
        elif arg.startswith("--doc"):
            val = arg.split("=", 1)[1] if "=" in arg else argv[i + 1]; i += 0 if "=" in arg else 1
            args["doc_targets"].append(val)
        elif arg == "--json":
            pass  # Always JSON, kept for compat
        i += 1

    # Default to 24 hours if no window specified
    if args["since_hours"] is None and args["since_days"] is None and args["since_commits"] is None:
        args["since_hours"] = 24

    return args


def main() -> None:
    args = parse_args(sys.argv)

    root = find_project_root()
    main_root = find_main_repo_root(root)
    bd_cwd = str(main_root)
    bd_available = has_beads(main_root)

    dolt_ready = False
    warnings: list[str] = []
    if bd_available:
        dolt_ready = ensure_dolt_server(bd_cwd)
        if not dolt_ready:
            warnings.append(
                "Dolt server could not be started — bd data unavailable. "
                "Run 'bd dolt start' manually and retry."
            )

    # Determine window
    git_since = build_git_since_arg(args["since_hours"], args["since_days"])

    if git_since:
        commits = gather_commits_by_time(root, git_since, args["scope_paths"])
        window_info = {
            "type": "hours" if args["since_hours"] else "days",
            "value": args["since_hours"] or args["since_days"],
            "git_since": git_since,
        }
    else:
        count = args["since_commits"] or 30
        commits = gather_commits_by_count(root, count, args["scope_paths"])
        window_info = {
            "type": "commits",
            "value": count,
            "git_since": None,
        }

    mode = infer_mode(args["doc_targets"], args["scope_paths"])

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "project_root": str(root),
        "mode_hint": mode,
        "window": window_info,
        "scope": {
            "docs": args["doc_targets"],
            "source_paths": args["scope_paths"],
        },
        "bd": {
            "available": bd_available and dolt_ready,
            "closed_issues": gather_bd_closed(bd_cwd, git_since) if dolt_ready else [],
            "memories": gather_bd_memories(bd_cwd) if dolt_ready else [],
        },
        "git": {
            "commit_count": len(commits),
            "recent_commits": commits[:30],
            "changed_files": summarize_changed_files(commits),
            "changed_dirs": summarize_changed_dirs(commits),
        },
        "docs": gather_docs_drift(root),
        "warnings": warnings,
    }

    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
