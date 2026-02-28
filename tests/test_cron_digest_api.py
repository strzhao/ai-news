from __future__ import annotations

from api.cron_digest import _build_digest_argv


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
