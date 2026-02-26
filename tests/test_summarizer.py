from __future__ import annotations

from datetime import datetime, timezone

import pytest

from src.llm.deepseek_client import DeepSeekError
from src.llm.summarizer import DigestSummarizer
from src.models import Article, ArticleAssessment, SourceQualityScore


class _FakeClient:
    def __init__(self, payload: dict) -> None:
        self.payload = payload

    def chat_json(self, messages, temperature=0.1):  # noqa: ANN001
        return self.payload


def _article(article_id: str) -> Article:
    return Article(
        id=article_id,
        title=f"title-{article_id}",
        url=f"https://example.com/{article_id}",
        source_id="s",
        source_name="source",
        published_at=datetime(2026, 2, 25, tzinfo=timezone.utc),
        summary_raw="summary",
        lead_paragraph="lead",
        content_text="content",
    )


def test_build_digest_content_success() -> None:
    payload = {
        "top_summary": ["要点1", "要点2"],
        "highlights": [
            {
                "article_id": "a1",
                "rank": 1,
                "one_line_summary": "一句话总结",
                "worth": "必读",
                "reason_short": "工程价值高",
            }
        ],
        "daily_tags": ["RAG", "MoE"],
    }
    summarizer = DigestSummarizer(client=_FakeClient(payload))
    summary, highlights, daily_tags = summarizer.build_digest_content(
        [_article("a1")], "2026-02-26", "Asia/Shanghai", top_n=8
    )
    assert summary.startswith("- 要点1")
    assert highlights[0].article_id == "a1"
    assert daily_tags == ["#RAG", "#MoE"]


def test_build_digest_content_requires_highlights() -> None:
    payload = {
        "top_summary": ["要点1"],
        "highlights": [],
        "daily_tags": ["RAG"],
    }
    summarizer = DigestSummarizer(client=_FakeClient(payload))
    with pytest.raises(DeepSeekError):
        summarizer.build_digest_content([_article("a1")], "2026-02-26", "Asia/Shanghai", top_n=8)


def test_build_digest_content_accepts_string_daily_tags() -> None:
    payload = {
        "top_summary": ["要点1"],
        "highlights": [
            {
                "article_id": "a1",
                "rank": 1,
                "one_line_summary": "一句话总结",
                "worth": "必读",
                "reason_short": "工程价值高",
            }
        ],
        "daily_tags": "#RAG/#vLLM/#MoE",
    }
    summarizer = DigestSummarizer(client=_FakeClient(payload))
    _, _, daily_tags = summarizer.build_digest_content([_article("a1")], "2026-02-26", "Asia/Shanghai", top_n=8)
    assert daily_tags == ["#RAG", "#vLLM", "#MoE"]


def test_build_digest_content_with_assessments() -> None:
    payload = {
        "top_summary": ["要点1"],
        "highlights": [
            {
                "article_id": "a1",
                "rank": 1,
                "one_line_summary": "一句话总结",
                "worth": "可读",
                "reason_short": "有参考价值",
            }
        ],
        "daily_tags": ["Agent", "Cursor"],
    }
    summarizer = DigestSummarizer(client=_FakeClient(payload))
    assessments = {
        "a1": ArticleAssessment(
            article_id="a1",
            worth="必读",
            quality_score=88,
            practicality_score=90,
            actionability_score=87,
            novelty_score=80,
            clarity_score=86,
            one_line_summary="单篇评估总结",
            reason_short="单篇评估理由",
            evidence_signals=["code"],
            confidence=0.9,
        )
    }
    source_scores = {
        "s": SourceQualityScore(
            source_id="s",
            quality_score=83,
            article_count=10,
            must_read_rate=0.4,
            avg_confidence=0.8,
            freshness=0.5,
        )
    }
    _, highlights, daily_tags = summarizer.build_digest_content(
        [_article("a1")],
        "2026-02-26",
        "Asia/Shanghai",
        top_n=8,
        assessments=assessments,
        source_quality_scores=source_scores,
    )
    assert highlights[0].worth == "可读"
    assert daily_tags == ["#Agent", "#Cursor"]
