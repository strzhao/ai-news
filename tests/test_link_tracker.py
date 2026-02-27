from __future__ import annotations

from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

from src.models import ScoredArticle
from src.tracking.link_tracker import LinkTracker


def _article() -> ScoredArticle:
    return ScoredArticle(
        id="a-1",
        title="A1",
        url="https://example.com/post?a=1",
        source_id="source-x",
        source_name="Source X",
        published_at=datetime(2026, 2, 27, tzinfo=timezone.utc),
        summary_raw="",
        lead_paragraph="lead",
        content_text="text",
    )


def test_tracker_disabled_returns_original_url() -> None:
    tracker = LinkTracker(base_url="", signing_secret="")
    assert tracker.build_tracking_url(_article(), digest_date="2026-02-27", channel="markdown") == "https://example.com/post?a=1"


def test_tracker_builds_signed_redirect_url() -> None:
    tracker = LinkTracker(base_url="https://tracker.example.com", signing_secret="secret")
    tracked = tracker.build_tracking_url(_article(), digest_date="2026-02-27", channel="flomo")

    parsed = urlparse(tracked)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "https"
    assert parsed.netloc == "tracker.example.com"
    assert parsed.path == "/api/r"
    assert query["sid"] == ["source-x"]
    assert query["aid"] == ["a-1"]
    assert query["d"] == ["2026-02-27"]
    assert query["ch"] == ["flomo"]
    assert "sig" in query and len(query["sig"][0]) == 64
