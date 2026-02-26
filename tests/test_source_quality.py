from __future__ import annotations

from datetime import datetime, timezone

from src.models import Article, ArticleAssessment, SourceConfig, SourceQualityScore
from src.process.source_quality import (
    build_budgeted_source_limits,
    build_source_fetch_limits,
    compute_source_quality_scores,
    rank_sources_by_priority,
)


def _article(article_id: str, source_id: str) -> Article:
    return Article(
        id=article_id,
        title=f"title-{article_id}",
        url=f"https://example.com/{article_id}",
        source_id=source_id,
        source_name=source_id,
        published_at=datetime(2026, 2, 25, tzinfo=timezone.utc),
        summary_raw="summary",
        lead_paragraph="lead",
        content_text="content",
    )


def _assessment(article_id: str, worth: str, score: float) -> ArticleAssessment:
    return ArticleAssessment(
        article_id=article_id,
        worth=worth,
        quality_score=score,
        practicality_score=score,
        actionability_score=score,
        novelty_score=score,
        clarity_score=score,
        one_line_summary="summary",
        reason_short="reason",
        evidence_signals=["code"],
        confidence=0.8,
    )


def test_rank_sources_by_priority_prefers_historical_quality() -> None:
    sources = [
        SourceConfig(id="high", name="high", url="https://h", source_weight=0.8),
        SourceConfig(id="low", name="low", url="https://l", source_weight=1.0),
    ]
    historical = {
        "high": SourceQualityScore(
            source_id="high",
            quality_score=90,
            article_count=10,
            must_read_rate=0.4,
            avg_confidence=0.9,
            freshness=0.7,
        )
    }
    ranked = rank_sources_by_priority(sources, historical)
    assert ranked[0].id == "high"


def test_compute_source_quality_scores() -> None:
    articles = [_article("a1", "s1"), _article("a2", "s1")]
    assessments = {
        "a1": _assessment("a1", "必读", 90),
        "a2": _assessment("a2", "可读", 70),
    }
    scores = compute_source_quality_scores(articles, assessments)
    assert len(scores) == 1
    assert scores[0].source_id == "s1"
    assert scores[0].quality_score > 50
    assert scores[0].must_read_rate == 0.5


def test_build_source_fetch_limits() -> None:
    sources = [
        SourceConfig(id=f"s{idx}", name=f"s{idx}", url="https://x")
        for idx in range(6)
    ]
    limits = build_source_fetch_limits(sources, high_limit=30, medium_limit=20, low_limit=10)
    assert limits["s0"] == 30
    assert limits["s2"] == 20
    assert limits["s5"] == 10


def test_build_budgeted_source_limits_guarantees_coverage() -> None:
    sources = [
        SourceConfig(id=f"s{idx}", name=f"s{idx}", url="https://x")
        for idx in range(4)
    ]
    source_limits = {"s0": 30, "s1": 20, "s2": 10, "s3": 10}
    budgeted = build_budgeted_source_limits(sources, source_limits, total_budget=12, min_per_source=2)
    assert sum(budgeted.values()) == 12
    assert all(budgeted[source.id] >= 2 for source in sources)
