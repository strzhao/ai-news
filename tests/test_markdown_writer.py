from datetime import datetime, timezone

from src.models import DailyDigest, ScoredArticle, TaggedArticle, WORTH_WORTH_READING
from src.output.markdown_writer import render_digest_markdown


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


def test_markdown_title_and_tag_placement() -> None:
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A\n- B",
        highlights=[_tagged("t1")],
        daily_tags=["#RAG", "#MoE"],
    )
    output = render_digest_markdown(digest)
    assert "# AI 每日摘要" not in output
    assert output.startswith("## 今日速览")
    assert "## 重点文章（最多 16）" in output
    assert "阅读建议" not in output
    assert "## 本期技术标签" not in output
    assert output.rstrip().endswith("#RAG #MoE")


def test_markdown_star_marker_only_for_must_read() -> None:
    must_read = _tagged("must-read")
    worth_reading = _tagged("worth-reading")
    worth_reading.article.worth = WORTH_WORTH_READING
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A",
        highlights=[must_read, worth_reading],
    )
    output = render_digest_markdown(digest)
    assert "⭐ [must-read]" in output
    assert "⭐ [worth-reading]" not in output


def test_markdown_supports_link_resolver() -> None:
    digest = DailyDigest(
        date="2026-02-26",
        timezone="Asia/Shanghai",
        top_summary="- A",
        highlights=[_tagged("t1")],
    )

    output = render_digest_markdown(digest, link_resolver=lambda article: f"https://track.test/{article.id}")

    assert "(https://track.test/t1)" in output
