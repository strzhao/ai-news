from __future__ import annotations

import pytest

from api.cron_digest import _analysis_archive_enabled, _build_digest_argv, _count_highlights


def test_build_digest_argv_default() -> None:
    argv = _build_digest_argv("/api/cron_digest", "Asia/Shanghai", "/tmp/reports")
    assert argv == ["vercel-cron", "--tz", "Asia/Shanghai", "--output-dir", "/tmp/reports"]


def test_build_digest_argv_supports_date_and_ignore_repeat_limit() -> None:
    argv = _build_digest_argv(
        "/api/cron_digest?date=2026-02-28&ignore_repeat_limit=1",
        "Asia/Shanghai",
        "/tmp/reports",
    )
    assert "--date" in argv
    assert "2026-02-28" in argv
    assert "--ignore-repeat-limit" in argv


def test_build_digest_argv_supports_top_n() -> None:
    argv = _build_digest_argv(
        "/api/cron_digest?top_n=12",
        "Asia/Shanghai",
        "/tmp/reports",
    )
    assert "--top-n" in argv
    assert "12" in argv


def test_count_highlights_from_markdown() -> None:
    markdown = "\n".join(
        [
            "## 今日速览",
            "- A",
            "## 重点文章",
            "### 1. [a](https://example.com/a)",
            "- one",
            "### 2. [b](https://example.com/b)",
            "- two",
        ]
    )
    assert _count_highlights(markdown) == 2


def test_analysis_archive_disabled_by_default(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ARCHIVE_ANALYSIS_ENABLED", raising=False)
    assert _analysis_archive_enabled("/api/cron_digest") is False


def test_analysis_archive_supports_query_and_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("ARCHIVE_ANALYSIS_ENABLED", "false")
    assert _analysis_archive_enabled("/api/cron_digest?archive_analysis=1") is True
    monkeypatch.setenv("ARCHIVE_ANALYSIS_ENABLED", "true")
    assert _analysis_archive_enabled("/api/cron_digest") is True
