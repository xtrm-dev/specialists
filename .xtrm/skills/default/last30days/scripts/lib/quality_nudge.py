"""Post-research quality score and upgrade nudge.

Computes a quality score based on 5 core sources and builds
a nudge message describing what the user missed and how to fix it.
"""

from typing import Any, Dict, List, Optional


# The 5 core sources
CORE_SOURCES = ["hn", "polymarket", "x", "youtube", "reddit_comments"]

# Labels for display
SOURCE_LABELS = {
    "hn": "Hacker News",
    "polymarket": "Polymarket",
    "x": "X/Twitter",
    "youtube": "YouTube",
    "reddit_comments": "Reddit with comments",
}


def _is_x_active(config: dict, research_results: dict) -> bool:
    """Check if X source is active (has credentials AND didn't error)."""
    has_creds = bool(config.get("AUTH_TOKEN") or config.get("XAI_API_KEY"))
    if not has_creds:
        return False
    # If X errored this run, it's configured but broken
    if research_results.get("x_error"):
        return False
    return True


def _is_youtube_active(config: dict, research_results: dict) -> bool:
    """Check if YouTube source is active (yt-dlp installed)."""
    try:
        from . import youtube_yt
        has_ytdlp = youtube_yt.is_ytdlp_installed()
    except Exception:
        has_ytdlp = False
    if not has_ytdlp:
        return False
    if research_results.get("youtube_error"):
        return False
    return True


def _is_reddit_comments_active(config: dict, research_results: dict) -> bool:
    """Check if Reddit with comments is active (ScrapeCreators)."""
    has_sc = bool(config.get("SCRAPECREATORS_API_KEY"))
    if not has_sc:
        return False
    if research_results.get("reddit_error"):
        return False
    return True


def compute_quality_score(config: dict, research_results: dict) -> dict:
    """Compute research quality score based on 5 core sources.

    Args:
        config: Configuration dict from env.get_config()
        research_results: Dict with keys like x_error, youtube_error,
            reddit_error reflecting what happened this run.

    Returns:
        {
            "score_pct": 40-100,
            "core_active": ["hn", "polymarket", ...],
            "core_missing": ["x", "youtube", "reddit_comments"],
            "core_errored": ["reddit_comments"],  # configured but errored
            "nudge_text": "..." or None if 100%
        }
    """
    core_active: List[str] = []
    core_missing: List[str] = []
    core_errored: List[str] = []

    # HN and Polymarket are always active
    core_active.append("hn")
    core_active.append("polymarket")

    # X
    has_x_creds = bool(config.get("AUTH_TOKEN") or config.get("XAI_API_KEY"))
    if _is_x_active(config, research_results):
        core_active.append("x")
    else:
        core_missing.append("x")
        if has_x_creds and research_results.get("x_error"):
            core_errored.append("x")

    # YouTube
    try:
        from . import youtube_yt
        has_ytdlp = youtube_yt.is_ytdlp_installed()
    except Exception:
        has_ytdlp = False
    if _is_youtube_active(config, research_results):
        core_active.append("youtube")
    else:
        core_missing.append("youtube")
        if has_ytdlp and research_results.get("youtube_error"):
            core_errored.append("youtube")

    # Reddit with comments (ScrapeCreators)
    has_sc = bool(config.get("SCRAPECREATORS_API_KEY"))
    if _is_reddit_comments_active(config, research_results):
        core_active.append("reddit_comments")
    else:
        core_missing.append("reddit_comments")
        if has_sc and research_results.get("reddit_error"):
            core_errored.append("reddit_comments")

    score_pct = int(len(core_active) / 5 * 100)

    nudge_text = _build_nudge_text(core_missing, core_errored) if core_missing else None

    return {
        "score_pct": score_pct,
        "core_active": core_active,
        "core_missing": core_missing,
        "core_errored": core_errored,
        "nudge_text": nudge_text,
    }


def _build_nudge_text(core_missing: List[str], core_errored: List[str]) -> str:
    """Build human-readable nudge text describing what was missed.

    Prioritizes free suggestions before paid ones.
    """
    lines: List[str] = []

    # Describe what was missed
    missed_parts: List[str] = []
    for src in core_missing:
        label = SOURCE_LABELS[src]
        if src in core_errored:
            missed_parts.append(f"{label} (errored this run)")
        else:
            missed_parts.append(label)

    active_count = 5 - len(core_missing)
    lines.append(f"Research quality: {active_count}/5 core sources.")
    lines.append(f"Missing: {', '.join(missed_parts)}.")
    lines.append("")

    # Free suggestions first
    free_suggestions: List[str] = []
    paid_suggestions: List[str] = []

    if "x" in core_missing:
        if "x" in core_errored:
            free_suggestions.append(
                "X errored — try refreshing your browser cookies "
                "(log into x.com, then re-run)."
            )
        else:
            free_suggestions.append(
                "X/Twitter: scan browser cookies automatically — "
                "just log into x.com in any browser and re-run."
            )

    if "youtube" in core_missing:
        if "youtube" in core_errored:
            free_suggestions.append(
                "YouTube errored — check that yt-dlp is up to date: "
                "brew upgrade yt-dlp"
            )
        else:
            free_suggestions.append(
                "YouTube: install yt-dlp — brew install yt-dlp"
            )

    if "reddit_comments" in core_missing:
        if "reddit_comments" in core_errored:
            paid_suggestions.append(
                "Reddit comments errored — check your ScrapeCreators API key "
                "at scrapecreators.com."
            )
        else:
            paid_suggestions.append(
                "Reddit with comments: add SCRAPECREATORS_API_KEY — "
                "100 free API calls, no credit card — scrapecreators.com"
            )

    if free_suggestions:
        lines.append("Free fixes:")
        for s in free_suggestions:
            lines.append(f"  - {s}")
        lines.append("")

    if paid_suggestions:
        lines.append("Paid options:")
        for s in paid_suggestions:
            lines.append(f"  - {s}")
        lines.append("")

    lines.append("last30days has no affiliation with any API provider.")

    return "\n".join(lines)
