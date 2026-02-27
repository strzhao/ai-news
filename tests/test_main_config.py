from __future__ import annotations

import pytest

from src.main import _build_summarizer, _expanded_discovery_mode_enabled


def test_build_summarizer_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        _build_summarizer()


def test_expanded_discovery_mode_enabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("EXPANDED_DISCOVERY_MODE", raising=False)
    assert _expanded_discovery_mode_enabled() is True


def test_expanded_discovery_mode_can_be_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("EXPANDED_DISCOVERY_MODE", "false")
    assert _expanded_discovery_mode_enabled() is False
