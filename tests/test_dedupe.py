from datetime import datetime, timezone

from src.models import Article
from src.process.dedupe import dedupe_articles, normalize_url


NOW = datetime(2026, 2, 25, tzinfo=timezone.utc)


def _article(article_id: str, title: str, url: str) -> Article:
    return Article(
        id=article_id,
        title=title,
        url=url,
        source_id="s",
        source_name="S",
        published_at=NOW,
        summary_raw="",
        lead_paragraph="",
        content_text=title,
    )


def test_normalize_url_removes_tracking() -> None:
    url = "https://example.com/path/?utm_source=newsletter&a=1#section"
    assert normalize_url(url) == "https://example.com/path?a=1"


def test_dedupe_by_title_similarity() -> None:
    a1 = _article("1", "OpenAI launches new inference optimization", "https://a.com/1")
    a2 = _article("2", "OpenAI launches new inference optimizations", "https://b.com/2")
    deduped = dedupe_articles([a1, a2], title_similarity_threshold=0.95)
    assert len(deduped) == 1


def test_dedupe_stats_include_dropped_items() -> None:
    a1 = _article("1", "OpenAI launches new inference optimization", "https://a.com/1?utm_source=x")
    a2 = _article("2", "OpenAI launches new inference optimization", "https://b.com/2")
    a3 = _article("3", "Another article", "https://a.com/1")
    deduped, stats = dedupe_articles([a1, a2, a3], title_similarity_threshold=0.95, return_stats=True)
    assert len(deduped) == 1
    assert stats.title_duplicates == 1
    assert stats.url_duplicates == 1
    assert len(stats.dropped_items) == 2
    reasons = {str(item.get("reason")) for item in stats.dropped_items}
    assert "title_similar" in reasons
    assert "url_duplicate" in reasons
