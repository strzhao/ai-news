from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from src.models import (
    Article,
    ArticleAssessment,
    SourceConfig,
    SourceQualityScore,
    WORTH_MUST_READ,
)


def rank_sources_by_priority(
    sources: list[SourceConfig],
    historical_scores: dict[str, SourceQualityScore],
) -> list[SourceConfig]:
    def priority(source: SourceConfig) -> float:
        historical = historical_scores.get(source.id)
        source_quality = historical.quality_score if historical else 50.0
        return source_quality * 0.7 + float(source.source_weight) * 100 * 0.3

    return sorted(sources, key=priority, reverse=True)


def build_source_fetch_limits(
    sources: list[SourceConfig],
    high_limit: int = 30,
    medium_limit: int = 22,
    low_limit: int = 12,
) -> dict[str, int]:
    if not sources:
        return {}
    high_cutoff = max(1, len(sources) // 3)
    medium_cutoff = max(high_cutoff + 1, (len(sources) * 2) // 3)
    limits: dict[str, int] = {}
    for idx, source in enumerate(sources):
        if idx < high_cutoff:
            limits[source.id] = high_limit
        elif idx < medium_cutoff:
            limits[source.id] = medium_limit
        else:
            limits[source.id] = low_limit
    return limits


def compute_source_quality_scores(
    articles: list[Article],
    assessments: dict[str, ArticleAssessment],
    historical_scores: dict[str, SourceQualityScore] | None = None,
    lookback_days: int = 30,
    min_articles_for_reliable_score: int = 8,
    now_utc: datetime | None = None,
) -> list[SourceQualityScore]:
    now_utc = now_utc or datetime.now(timezone.utc)
    historical_scores = historical_scores or {}
    lookback_threshold = now_utc - timedelta(days=lookback_days)
    recent_threshold = now_utc - timedelta(days=7)

    grouped_articles: dict[str, list[tuple[Article, ArticleAssessment]]] = defaultdict(list)
    for article in articles:
        if article.published_at and article.published_at < lookback_threshold:
            continue
        assessment = assessments.get(article.id)
        if not assessment:
            continue
        grouped_articles[article.source_id].append((article, assessment))

    results: list[SourceQualityScore] = []
    for source_id, rows in grouped_articles.items():
        if not rows:
            continue
        count = len(rows)
        avg_quality = sum(item.quality_score for _, item in rows) / count
        must_read_rate = sum(1 for _, item in rows if item.worth == WORTH_MUST_READ) / count
        avg_confidence = sum(item.confidence for _, item in rows) / count
        freshness = sum(
            1
            for article, _ in rows
            if article.published_at and article.published_at >= recent_threshold
        ) / count

        batch_quality = (
            avg_quality * 0.45
            + must_read_rate * 100 * 0.30
            + avg_confidence * 100 * 0.15
            + freshness * 100 * 0.10
        )
        historical = historical_scores.get(source_id)
        if historical and count < min_articles_for_reliable_score:
            weight = count / max(min_articles_for_reliable_score, 1)
            quality = historical.quality_score * (1 - weight) + batch_quality * weight
        elif historical:
            quality = historical.quality_score * 0.35 + batch_quality * 0.65
        elif count < min_articles_for_reliable_score:
            weight = count / max(min_articles_for_reliable_score, 1)
            quality = 50.0 * (1 - weight) + batch_quality * weight
        else:
            quality = batch_quality

        results.append(
            SourceQualityScore(
                source_id=source_id,
                quality_score=round(max(0.0, min(100.0, quality)), 2),
                article_count=count,
                must_read_rate=round(must_read_rate, 4),
                avg_confidence=round(avg_confidence, 4),
                freshness=round(freshness, 4),
            )
        )
    return sorted(results, key=lambda item: item.quality_score, reverse=True)
