from __future__ import annotations

from api.r import _accepts_html, _build_redirect_page_html


def test_accepts_html_only_for_browser_accept_header() -> None:
    assert _accepts_html("text/html,application/xhtml+xml") is True
    assert _accepts_html("application/xhtml+xml") is True
    assert _accepts_html("application/json") is False
    assert _accepts_html("*/*") is False
    assert _accepts_html(None) is False


def test_build_redirect_page_html_includes_context_and_escapes() -> None:
    html = _build_redirect_page_html(
        {
            "u": "https://example.com/path?q=1",
            "sid": "source-1",
            "aid": "a1",
            "d": "2026-02-28",
            "ch": "markdown",
            "pt": "agent<script>",
        }
    )
    assert "正在跳转到原文" in html
    assert "source-1" in html
    assert "markdown" in html
    assert "example.com" in html
    assert "agent&lt;script&gt;" in html
