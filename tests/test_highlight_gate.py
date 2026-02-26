from __future__ import annotations

import pytest

from src.main import _highlight_cap, _percentile


def test_percentile_handles_empty_values() -> None:
    assert _percentile([], 70) == 0.0


def test_percentile_interpolates_values() -> None:
    assert _percentile([50, 60, 70, 80, 90], 70) == pytest.approx(78.0)


def test_highlight_cap_default_is_strict_for_small_pool(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("HIGHLIGHT_SELECTION_RATIO", raising=False)
    monkeypatch.delenv("HIGHLIGHT_MIN_COUNT", raising=False)
    assert _highlight_cap(total_assessed=8, top_n=16) == 4


def test_highlight_cap_honors_env_override(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HIGHLIGHT_SELECTION_RATIO", "0.2")
    monkeypatch.setenv("HIGHLIGHT_MIN_COUNT", "2")
    assert _highlight_cap(total_assessed=10, top_n=16) == 2

