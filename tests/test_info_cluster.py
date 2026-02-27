from __future__ import annotations

from datetime import datetime, timezone

from src.models import Article
from src.process.info_cluster import build_info_key, build_title_key


def _article(url: str, info_url: str = "") -> Article:
    return Article(
        id="a",
        title="Hello world",
        url=url,
        source_id="s",
        source_name="S",
        published_at=datetime(2026, 2, 27, tzinfo=timezone.utc),
        summary_raw="",
        lead_paragraph="",
        content_text="",
        info_url=info_url,
    )


def test_build_info_key_prefers_info_url_and_strips_tracking_params() -> None:
    article = _article(
        "https://x.com/u/status/1",
        info_url="https://example.com/post?utm_source=x&id=2",
    )
    assert build_info_key(article) == "https://example.com/post?id=2"


def test_build_info_key_falls_back_to_article_url() -> None:
    article = _article("https://example.com/post/?a=1")
    assert build_info_key(article) == "https://example.com/post?a=1"


def test_build_title_key_normalizes_punctuation_and_case() -> None:
    a = build_title_key("Hello, World!!!")
    b = build_title_key("hello world")
    assert a == b
