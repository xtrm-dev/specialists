"""Smoke tests for the Python client.

Skipped unless `SPECIALISTS_SERVICE_URL` is set. To run:

    SPECIALISTS_SERVICE_URL=http://localhost:8000 \
    SPECIALISTS_SMOKE_SPECIALIST=mercury-atomic-summarizer \
    pytest clients/python/tests/test_smoke.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

# Make `specialists_client` importable when running pytest from the repo root.
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from specialists_client import SpecialistErrorType, SpecialistsClient

SERVICE_URL: str = os.getenv("SPECIALISTS_SERVICE_URL", "")
SMOKE_SPECIALIST: str = os.getenv("SPECIALISTS_SMOKE_SPECIALIST", "")

requires_live_service = pytest.mark.skipif(
    not SERVICE_URL,
    reason="SPECIALISTS_SERVICE_URL not set; live-service smoke test skipped.",
)


@requires_live_service
def test_healthz() -> None:
    client = SpecialistsClient(base_url=SERVICE_URL)
    assert client.healthz(), (
        f"service at {SERVICE_URL} did not return ok=true on /healthz"
    )


@requires_live_service
def test_specialist_not_found_returns_canonical_error() -> None:
    client = SpecialistsClient(base_url=SERVICE_URL)
    result = client.run("definitely-does-not-exist-xyz", variables={})
    assert result.success is False
    assert result.error_type == SpecialistErrorType.SPECIALIST_NOT_FOUND
    assert result.error  # non-empty


@requires_live_service
def test_template_field_misuse_returns_canonical_error() -> None:
    """Passing a spec key name as the template body must be flagged.

    Uses changelog-drafter as a known-shipped script-class spec; that spec
    has `task_template` as a key on its prompt object, so passing
    `template="task_template"` triggers the misuse check.
    """
    client = SpecialistsClient(base_url=SERVICE_URL)
    result = client.run("changelog-drafter", variables={}, template="task_template")
    assert result.success is False
    assert result.error_type == SpecialistErrorType.TEMPLATE_FIELD_MISUSE
    assert "task_template" in (result.error or "")


@requires_live_service
@pytest.mark.skipif(
    not SMOKE_SPECIALIST,
    reason="SPECIALISTS_SMOKE_SPECIALIST not set; end-to-end specialist invocation skipped.",
)
def test_specialist_round_trip() -> None:
    """End-to-end: invoke a real specialist and check the canonical response shape.

    Variables intentionally minimal — this is a transport/contract check, not a
    quality check.
    """
    client = SpecialistsClient(base_url=SERVICE_URL)
    result = client.run(
        SMOKE_SPECIALIST, variables={"title": "smoke", "content": "smoke"}
    )
    assert isinstance(result.success, bool)
    assert isinstance(result.meta, dict)
    if result.success:
        assert result.output is not None
    else:
        assert result.error_type is not None
        assert result.error
