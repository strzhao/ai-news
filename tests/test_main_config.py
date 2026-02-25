from __future__ import annotations

import pytest

from src.main import _build_summarizer


def test_build_summarizer_requires_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    with pytest.raises(RuntimeError):
        _build_summarizer()
