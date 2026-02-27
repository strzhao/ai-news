from datetime import datetime, timezone

from src.models import DailyDigest, ScoredArticle, TaggedArticle, WORTH_WORTH_READING
from src.output.flomo_formatter import build_flomo_payload


def _tagged(title: str) -> TaggedArticle:
    article = ScoredArticle(
        id=title,
        title=title,
        url=f"https://example.com/{title}",
        source_id="s",
        source_name="S",
        published_at=datetime(2026, 2, 25, tzinfo=timezone.utc),
        summary_raw="",
        lead_paragraph="One-line summary",
        content_text="",
        score=80,
        worth="必读",
        reason_short="工程价值高",
    )
    return TaggedArticle(article=article, generated_tags=[])


def test_build_flomo_payload_contains_daily_tags() -> None:
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A\n- B",
        highlights=[_tagged("t1"), _tagged("t2")],
        daily_tags=["#RAG", "#MoE"],
    )

    payload = build_flomo_payload(digest)

    assert payload.dedupe_key == "digest-2026-02-26"
    assert "2026-02-26" not in payload.content
    assert "【本期技术标签】" not in payload.content
    assert "建议：" not in payload.content
    assert "#RAG #MoE" in payload.content


def test_flomo_star_marker_only_for_must_read() -> None:
    must_read = _tagged("t1")
    worth_reading = _tagged("t2")
    worth_reading.article.worth = WORTH_WORTH_READING
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A",
        highlights=[must_read, worth_reading],
    )
    payload = build_flomo_payload(digest)
    assert "1. ⭐ t1" in payload.content
    assert "2. ⭐ t2" not in payload.content


def test_flomo_supports_link_resolver() -> None:
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A",
        highlights=[_tagged("t1")],
    )

    payload = build_flomo_payload(digest, link_resolver=lambda article: f"https://track.test/{article.id}")

    assert "链接：https://track.test/t1" in payload.content
