#!/usr/bin/env python3
"""
Post-merge service-skills drift sweep (xtrm-jcmub).

The canonical reconciliation point for service-skills drift is a merge onto the
default branch (master/main) — that is the single moment the code is final, and the
v2 design measures drift semantically from each service's `last_sync_ref`
(committed range `last_sync_ref..HEAD`). The in-session PostToolUse nudge is
best-effort and only fires on edits made inside an agent session, so drift can
accumulate silently (dogfood: market-data, ~5000 items since 2026-04-23).

This hook is the proactive backstop. On a default-branch merge it:
  1. self-gates: no-op unless a service-registry is present AND HEAD is the
     default branch (feature-branch merges are skipped per the documented cadence),
  2. runs the cost-bounded `drift_detector.scan_drift` over `last_sync_ref..HEAD`,
  3. on drift: prints a prominent, actionable notice and drops a pending marker
     at `.xtrm/.service-skills-drift-pending` so the next agent session / operator
     runs the reconciliation (`/updating-service-skills`, the service-skills-sync
     specialist) — a git hook must NOT auto-run a model-backed specialist.

It NEVER fails the merge (post-merge cannot abort anyway) and is silent when there
is no registry, the branch is not default, or there is no drift.
"""
from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

# Co-located machinery: this script lives in the skill's install/git-hooks/ dir; the
# drift detector lives in ../../scripts/. Resolve it relative to the active skill view
# so it works from both the source tree and the installed .xtrm/.claude views.
_HOOK_DIR = Path(__file__).resolve().parent
_SCRIPTS_DIR = _HOOK_DIR.parent.parent / "scripts"

MARKER_REL = Path(".xtrm") / ".service-skills-drift-pending"
DEFAULT_BRANCHES = {"main", "master"}


def _project_root() -> Path:
    env = os.environ.get("CLAUDE_PROJECT_DIR")
    if env:
        return Path(env)
    try:
        r = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        if r.returncode == 0 and r.stdout.strip():
            return Path(r.stdout.strip())
    except Exception:
        pass
    return Path.cwd()


def _current_branch(root: Path) -> str:
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        if r.returncode == 0:
            return r.stdout.strip()
    except Exception:
        pass
    return ""


def _default_branch(root: Path) -> str:
    """Resolve the repo's default branch from origin/HEAD; fall back to main/master."""
    try:
        r = subprocess.run(
            ["git", "-C", str(root), "symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
            capture_output=True, text=True, timeout=5, check=False,
        )
        if r.returncode == 0 and r.stdout.strip():
            # e.g. "origin/main" -> "main"
            return r.stdout.strip().split("/", 1)[-1]
    except Exception:
        pass
    return ""


def _has_registry(root: Path) -> bool:
    packs = root / ".xtrm" / "skills" / "user" / "packs"
    if packs.is_dir():
        for pack in packs.iterdir():
            if not pack.is_dir():
                continue
            if (pack / "service-skills" / "service-registry.json").exists() or (pack / "service-registry.json").exists():
                return True
    return (root / "service-registry.json").exists() or (root / ".claude" / "skills" / "service-registry.json").exists()


def main() -> int:
    root = _project_root()

    # Gate 1: registry-gated — silent no-op in non-service repos.
    if not _has_registry(root):
        return 0

    # Gate 2: default-branch only — skip feature-branch merges per the v2 cadence.
    branch = _current_branch(root)
    default = _default_branch(root)
    allowed = {default} if default else set()
    allowed |= DEFAULT_BRANCHES
    if branch and branch not in allowed:
        return 0

    # Cost-bounded drift scan (mtime pre-filter + gitnexus tiering, since last_sync_ref).
    sys.path.insert(0, str(_SCRIPTS_DIR))
    try:
        from drift_detector import scan_drift  # type: ignore[import-not-found]
    except Exception:
        # Machinery not importable (skills not installed) — nothing to do.
        return 0

    try:
        # Surface-only: the post-merge sweep just needs to DETECT drift and drop a marker;
        # semantic tiering is the librarian's job (/updating-service-skills). Force the cheap
        # mtime path so a default-branch merge can never trigger gitnexus fan-out (xtrm-08i0b).
        drift = scan_drift(project_root=str(root), use_gitnexus=False)
    except Exception:
        return 0

    if not drift:
        return 0

    services = sorted({str(i.get("service_id", "?")) for i in drift})
    marker = root / MARKER_REL
    try:
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text(
            "service-skills drift detected post-merge on '%s'\n"
            "services: %s\n"
            "files: %d\n"
            "action: run /updating-service-skills (service-skills-sync) to reconcile + stamp last_sync_ref\n"
            % (branch or default or "default", ", ".join(services), len(drift)),
            encoding="utf-8",
        )
    except Exception:
        pass

    print("")
    print("⚠  service-skills drift detected at the post-merge reconciliation point.")
    print("   %d drifted file(s) across service(s): %s" % (len(drift), ", ".join(services)))
    print("   Reconcile with /updating-service-skills (the service-skills-sync specialist),")
    print("   which syncs the drifted SKILL.md and advances last_sync_ref.")
    print("   (pending marker: %s)" % MARKER_REL)
    print("")
    return 0


if __name__ == "__main__":
    sys.exit(main())
