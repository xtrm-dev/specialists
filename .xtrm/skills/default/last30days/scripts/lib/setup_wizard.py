"""First-run setup wizard for last30days.

Detects first run, performs auto-setup (cookie extraction + yt-dlp check),
and writes configuration. The actual wizard UI is SKILL.md-driven (the LLM
presents it), but this module provides the detection and setup actions.
"""

import logging
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)


def is_first_run(config: Dict[str, Any]) -> bool:
    """Return True if the setup wizard has not been completed.

    Checks for SETUP_COMPLETE in the config dict. If it's not set
    (None or empty string), the user hasn't gone through setup yet.
    """
    return not config.get("SETUP_COMPLETE")


def run_auto_setup(config: Dict[str, Any]) -> Dict[str, Any]:
    """Perform the auto-setup actions.

    - Runs cookie extraction in auto mode for all registered domains
    - Checks if yt-dlp is installed

    Returns:
        Dict with keys:
          cookies_found: {source_name: browser_name} for each source where cookies were found
          ytdlp_installed: bool
          env_written: bool (always False here — caller writes config separately)
    """
    from . import cookie_extract
    from .env import COOKIE_DOMAINS

    cookies_found: Dict[str, str] = {}

    for source_name, spec in COOKIE_DOMAINS.items():
        domain = spec["domain"]
        cookie_names = spec["cookies"]

        try:
            result = cookie_extract.extract_cookies_with_source("auto", domain, cookie_names)
        except Exception as exc:
            logger.debug("Cookie extraction failed for %s: %s", source_name, exc)
            continue

        if result is not None:
            _cookies, browser_name = result
            cookies_found[source_name] = browser_name

    # Check yt-dlp availability and install via Homebrew if missing
    ytdlp_action: str
    if shutil.which("yt-dlp") is not None:
        ytdlp_installed = True
        ytdlp_action = "already_installed"
    elif shutil.which("brew") is not None:
        brew_stderr = ""
        try:
            proc = subprocess.run(
                ["brew", "install", "yt-dlp"],
                capture_output=True, text=True, timeout=120,
            )
            if proc.returncode == 0:
                ytdlp_installed = True
                ytdlp_action = "installed"
            else:
                ytdlp_installed = False
                ytdlp_action = "install_failed"
                brew_stderr = proc.stderr
                logger.warning("brew install yt-dlp failed: %s", proc.stderr)
        except Exception as exc:
            ytdlp_installed = False
            ytdlp_action = "install_failed"
            brew_stderr = str(exc)
            logger.warning("brew install yt-dlp exception: %s", exc)
    else:
        ytdlp_installed = False
        ytdlp_action = "no_homebrew"

    results: Dict[str, Any] = {
        "cookies_found": cookies_found,
        "ytdlp_installed": ytdlp_installed,
        "ytdlp_action": ytdlp_action,
        "env_written": False,
    }
    if ytdlp_action == "install_failed":
        results["ytdlp_stderr"] = brew_stderr
    return results


def write_setup_config(env_path: Path, from_browser: str = "auto") -> bool:
    """Write SETUP_COMPLETE and FROM_BROWSER to the .env file.

    Creates the file and parent directories if needed.
    Appends to existing file without overwriting existing keys.

    Args:
        env_path: Path to the .env file (e.g. ~/.config/last30days/.env)
        from_browser: Browser extraction mode to write (default: "auto")

    Returns:
        True if config was written successfully, False on error.
    """
    try:
        env_path = Path(env_path)
        env_path.parent.mkdir(parents=True, exist_ok=True)

        # Read existing content to avoid overwriting keys
        existing_keys: set = set()
        existing_content = ""
        if env_path.exists():
            existing_content = env_path.read_text(encoding="utf-8")
            for line in existing_content.splitlines():
                stripped = line.strip()
                if stripped and not stripped.startswith("#") and "=" in stripped:
                    key = stripped.split("=", 1)[0].strip()
                    existing_keys.add(key)

        lines_to_add = []
        if "SETUP_COMPLETE" not in existing_keys:
            lines_to_add.append("SETUP_COMPLETE=true")
        if "FROM_BROWSER" not in existing_keys:
            lines_to_add.append(f"FROM_BROWSER={from_browser}")

        if not lines_to_add:
            return True  # Nothing to write, already configured

        # Ensure trailing newline before appending
        with open(env_path, "a", encoding="utf-8") as f:
            if existing_content and not existing_content.endswith("\n"):
                f.write("\n")
            f.write("\n".join(lines_to_add) + "\n")

        return True

    except OSError as exc:
        logger.error("Failed to write setup config to %s: %s", env_path, exc)
        return False


def get_setup_status_text(results: Dict[str, Any]) -> str:
    """Return a human-readable summary of auto-setup results.

    Args:
        results: Dict from run_auto_setup()

    Returns:
        Multi-line status text.
    """
    lines = []
    lines.append("Setup complete! Here's what I found:")
    lines.append("")

    cookies_found = results.get("cookies_found", {})
    if cookies_found:
        for source, browser in cookies_found.items():
            lines.append(f"  - {source.upper()} cookies found in {browser}")
    else:
        lines.append("  - No browser cookies found for X/Twitter")

    ytdlp_action = results.get("ytdlp_action", "")
    if ytdlp_action == "installed":
        lines.append("  - Installed yt-dlp via Homebrew")
    elif ytdlp_action == "install_failed":
        lines.append("  - yt-dlp install failed \u2014 run `brew install yt-dlp` manually")
    elif ytdlp_action == "no_homebrew":
        lines.append("  - yt-dlp not found. Install Homebrew first, then: brew install yt-dlp")
    elif ytdlp_action == "already_installed":
        lines.append("  - yt-dlp already installed")
    elif results.get("ytdlp_installed", False):
        lines.append("  - yt-dlp is installed (YouTube search ready)")
    else:
        lines.append("  - yt-dlp not found (install with: brew install yt-dlp)")

    env_written = results.get("env_written", False)
    if env_written:
        lines.append("")
        lines.append("Configuration saved. Future runs will auto-detect your browsers.")

    return "\n".join(lines)
