#!/usr/bin/env python3
"""
Manual service-skills migration + git-hook installer.

> NORMAL PATH: `xt update --apply` (or `xt init`) auto-detects a service-registry and
> runs this same migration — you usually do NOT need to run this script. The Claude
> SessionStart/PreToolUse/PostToolUse hooks ship via the global service-skills policy
> (registry-gated), and the skills themselves are delivered by `xt update`. This
> script is the runtime-agnostic manual fallback.

Run from inside your target project directory. It is idempotent and only:
  - migrates the pack to the v2 umbrella layout (layout_migrator)
  - upgrades per-service SKILL.md to the current section contract (skill_migrator)
  - (re)generates the per-repo umbrella (umbrella_generator)
  - installs the non-blocking git pre-commit/pre-push doc + staleness reminders
"""

import json
import os
import subprocess
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent.resolve()            # skills/service-skills/install/
GIT_HOOKS  = SCRIPT_DIR / "git-hooks"                   # install/git-hooks/

GREEN  = "\033[0;32m"
YELLOW = "\033[1;33m"
NC     = "\033[0m"

MARKER_DOC        = "# [jaggers] doc-reminder"
MARKER_STALENESS  = "# [jaggers] skill-staleness"
MARKER_DRIFT_SWEEP = "# [jaggers] drift-sweep"
MARKER_CHAIN      = "# [jaggers] chain-githooks"


def get_project_root() -> Path:
    try:
        r = subprocess.run(["git", "rev-parse", "--show-toplevel"],
                           capture_output=True, text=True, check=True, timeout=5)
        return Path(r.stdout.strip())
    except subprocess.CalledProcessError:
        print("Error: not inside a git repository.")
        sys.exit(1)


def install_git_hooks(project_root: Path) -> None:
    print("\n── Git hooks ───────────────────────────")
    doc_script      = GIT_HOOKS / "doc_reminder.py"
    staleness_script = GIT_HOOKS / "skill_staleness.py"
    drift_script    = GIT_HOOKS / "post_merge_drift_sweep.py"

    pre_commit = project_root / ".githooks" / "pre-commit"
    pre_push   = project_root / ".githooks" / "pre-push"
    post_merge = project_root / ".githooks" / "post-merge"

    for hp in (pre_commit, pre_push, post_merge):
        if not hp.exists():
            hp.parent.mkdir(parents=True, exist_ok=True)
            hp.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            hp.chmod(0o755)

    snippets = [
        (pre_commit, MARKER_DOC,
         f"\n{MARKER_DOC}\nif command -v python3 &>/dev/null && [ -f \"{doc_script}\" ]; then\n    python3 \"{doc_script}\" || true\nfi\n"),
        (pre_push, MARKER_STALENESS,
         f"\n{MARKER_STALENESS}\nif command -v python3 &>/dev/null && [ -f \"{staleness_script}\" ]; then\n    python3 \"{staleness_script}\" || true\nfi\n"),
        # post-merge drift sweep (xtrm-jcmub): on a default-branch merge, scan for
        # service-skills drift since each service's last_sync_ref and surface it +
        # drop a pending marker. Non-blocking; the script self-gates on branch/registry.
        (post_merge, MARKER_DRIFT_SWEEP,
         f"\n{MARKER_DRIFT_SWEEP}\nif command -v python3 &>/dev/null && [ -f \"{drift_script}\" ]; then\n    python3 \"{drift_script}\" || true\nfi\n"),
    ]

    for hook_path, marker, snippet in snippets:
        content = hook_path.read_text(encoding="utf-8")
        if marker not in content:
            hook_path.write_text(content + snippet, encoding="utf-8")
            print(f"{GREEN}  ✓{NC} {hook_path.relative_to(project_root)}")
        else:
            print(f"{YELLOW}  ○{NC} already installed: {hook_path.name}")

    hooks_path = ""
    try:
        r = subprocess.run(
            ["git", "config", "--get", "core.hooksPath"],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=5,
            check=False,
        )
        if r.returncode == 0:
            hooks_path = r.stdout.strip()
    except Exception:
        hooks_path = ""

    active_hooks_dir = (Path(hooks_path) if Path(hooks_path).is_absolute() else project_root / hooks_path) if hooks_path else (project_root / ".git" / "hooks")
    activation_targets = {project_root / ".git" / "hooks", active_hooks_dir}

    for hooks_dir in activation_targets:
        hooks_dir.mkdir(parents=True, exist_ok=True)
        for name, source_hook in (("pre-commit", pre_commit), ("pre-push", pre_push), ("post-merge", post_merge)):
            target_hook = hooks_dir / name
            if not target_hook.exists():
                target_hook.write_text("#!/usr/bin/env bash\n", encoding="utf-8")
            target_hook.chmod(0o755)

            if target_hook.resolve() == source_hook.resolve():
                continue

            chain_snippet = (
                f"\n{MARKER_CHAIN}\n"
                f"if [ -x \"{source_hook}\" ]; then\n"
                f"    \"{source_hook}\" \"$@\"\n"
                "fi\n"
            )
            target_content = target_hook.read_text(encoding="utf-8")
            if MARKER_CHAIN not in target_content:
                target_hook.write_text(target_content + chain_snippet, encoding="utf-8")

    print(f"{GREEN}  ✓{NC} activated in .git/hooks/")


def _packs_with_registry(project_root: Path) -> list[Path]:
    """Packs that carry a service registry (umbrella or legacy flat location)."""
    packs_root = project_root / ".xtrm" / "skills" / "user" / "packs"
    if not packs_root.exists():
        return []
    out = []
    for pack in sorted(p for p in packs_root.iterdir() if p.is_dir()):
        if (pack / "service-skills" / "service-registry.json").exists() or (pack / "service-registry.json").exists():
            out.append(pack)
    return out


def _pack_registry(pack: Path) -> Path | None:
    new = pack / "service-skills" / "service-registry.json"
    old = pack / "service-registry.json"
    return new if new.exists() else (old if old.exists() else None)


def run_layout_migration(project_root: Path) -> None:
    """One-time flat -> umbrella layout migration per pack (idempotent). Runs BEFORE
    content migration so heading upgrades land on the new on-disk layout."""
    print("\n── Layout migration ────────────────────")
    migrator = project_root / ".claude" / "skills" / "service-skills" / "scripts" / "layout_migrator.py"
    packs = _packs_with_registry(project_root)
    if not migrator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to migrate (no packs or migrator)")
        return
    moved = 0
    for pack in packs:
        env = {**os.environ, "XTRM_PACK": pack.name}
        r = subprocess.run(["python3", str(migrator), project_root.name],
                           cwd=str(project_root), env=env, capture_output=True, text=True, check=False)
        if r.returncode == 2:
            print(f"{YELLOW}  ⚠{NC} pack '{pack.name}': {r.stderr.strip()}")
            continue
        if any(line.startswith("migrated:") for line in r.stdout.splitlines()):
            moved += 1
            print(f"{GREEN}  ✓{NC} pack '{pack.name}' migrated to umbrella layout")
    if moved == 0:
        print(f"{GREEN}  ✓{NC} all packs already on umbrella layout")


def migrate_existing_skills(project_root: Path) -> None:
    """Upgrade already-installed per-service SKILL.md files to the current canonical
    section set (adds missing devops headings in contract order, preserves the
    SEMANTIC block, idempotent). Safe no-op when nothing needs upgrading."""
    print("\n── Migrate existing skills ─────────────")
    migrator = project_root / ".claude" / "skills" / "service-skills" / "scripts" / "skill_migrator.py"
    packs = _packs_with_registry(project_root)
    if not migrator.exists() or not packs:
        print(f"{YELLOW}  ○{NC} nothing to migrate (no registry or migrator)")
        return
    changed = 0
    for pack in packs:
        registry = _pack_registry(pack)
        if registry is None:
            continue
        try:
            services = json.loads(registry.read_text(encoding="utf-8")).get("services", {})
        except json.JSONDecodeError:
            print(f"{YELLOW}  ○{NC} registry malformed in pack '{pack.name}'; skipping")
            continue
        for service_id, info in services.items():
            skill_rel = info.get("skill_path")
            if not skill_rel:
                continue
            skill_md = project_root / skill_rel
            if not skill_md.exists():
                continue
            r = subprocess.run(["python3", str(migrator), str(skill_md)],
                               capture_output=True, text=True, check=False)
            # migrator prints "migrated: <path>" when it added sections, "unchanged: <path>" otherwise
            if r.returncode == 0 and r.stdout.strip().startswith("migrated:"):
                changed += 1
                print(f"{GREEN}  ✓{NC} upgraded {service_id} → devops sections")
    if changed == 0:
        print(f"{GREEN}  ✓{NC} all service skills already current")


def generate_umbrellas(project_root: Path) -> None:
    """Generate/refresh the per-repo umbrella SKILL.md (name: <repo>-services) for
    each pack that has a service-registry.json. The umbrella's service table is
    derived from the registry; its SEMANTIC block is preserved across regen.
    Idempotent — prints only when a file actually changes."""
    print("\n── Umbrella ────────────────────────────")
    generator = project_root / ".claude" / "skills" / "service-skills" / "scripts" / "umbrella_generator.py"
    packs_root = project_root / ".xtrm" / "skills" / "user" / "packs"
    if not generator.exists() or not packs_root.exists():
        print(f"{YELLOW}  ○{NC} nothing to generate (no generator or packs)")
        return
    repo_name = project_root.name
    wrote = 0
    for pack in sorted(p for p in packs_root.iterdir() if p.is_dir()):
        if not (pack / "service-registry.json").exists() and not (pack / "service-skills" / "service-registry.json").exists():
            continue
        env = {**os.environ, "XTRM_PACK": pack.name}
        r = subprocess.run(["python3", str(generator), repo_name],
                           cwd=str(project_root), env=env, capture_output=True, text=True, check=False)
        if r.returncode == 0 and r.stdout.strip().startswith("generated:"):
            wrote += 1
            print(f"{GREEN}  ✓{NC} umbrella refreshed for pack '{pack.name}' → {repo_name}-services")
    if wrote == 0:
        print(f"{GREEN}  ✓{NC} all umbrellas already current")


def main() -> None:
    project_root = get_project_root()

    # `--hooks-only`: wire the service-skills git hooks (incl. the post-merge drift
    # sweep) and exit. This is the entry point `xt update`/`ensureServiceSkills` calls
    # so the post-merge drift automation (xtrm-jcmub) auto-installs on the foolproof
    # path, without running the full migration again.
    if "--hooks-only" in sys.argv[1:]:
        install_git_hooks(project_root)
        return

    print(f"Installing into: {project_root}")

    # Skills are delivered by `xt update`; Claude hooks ship via the global
    # service-skills policy. This manual fallback only migrates + installs git hooks.
    install_git_hooks(project_root)
    run_layout_migration(project_root)   # flat -> umbrella (moves files) — must precede content migration
    migrate_existing_skills(project_root)
    generate_umbrellas(project_root)

    print(f"\n{GREEN}Done.{NC}")
    print("  Migration applied. Claude hooks are wired globally via the service-skills policy")
    print("  (run `xt update --apply` for the normal, foolproof path).")


if __name__ == "__main__":
    main()
