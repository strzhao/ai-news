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
    total = max(1, len(sources))
    index_map = {source.id: idx for idx, source in enumerate(sources)}

    def priority(source: SourceConfig) -> float:
        historical = historical_scores.get(source.id)
        source_quality = historical.quality_score if historical else 50.0
        # Respect manually curated source order first, then blend historical quality.
        index = index_map.get(source.id, total - 1)
        curated_priority = ((total - index) / total) * 100
        return curated_priority * 0.5 + float(source.source_weight) * 100 * 0.3 + source_quality * 0.2

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


def build_budgeted_source_limits(
    prioritized_sources: list[SourceConfig],
    source_limits: dict[str, int],
    total_budget: int,
    min_per_source: int = 3,
) -> dict[str, int]:
    if total_budget <= 0 or not prioritized_sources:
        return source_limits

    count = len(prioritized_sources)
    if total_budget < count:
        # Guarantee at least one candidate from top sources when budget is tiny.
        limited: dict[str, int] = {}
        for idx, source in enumerate(prioritized_sources):
            limited[source.id] = 1 if idx < total_budget else 0
        return limited

    base = min_per_source if total_budget >= count * min_per_source else max(1, total_budget // count)
    allocated: dict[str, int] = {}
    for source in prioritized_sources:
        cap = int(source_limits.get(source.id, base))
        allocated[source.id] = min(base, max(0, cap))

    used = sum(allocated.values())
    remaining = max(0, total_budget - used)
    if remaining == 0:
        return allocated

    rooms = {
        source.id: max(0, int(source_limits.get(source.id, allocated[source.id])) - allocated[source.id])
        for source in prioritized_sources
    }
    total_room = sum(rooms.values())
    if total_room <= 0:
        return allocated

    # First pass: proportional distribution to avoid one source monopolizing the budget.
    proportional_budget = remaining
    for source in prioritized_sources:
        room = rooms[source.id]
        if room <= 0 or proportional_budget <= 0:
            continue
        add = min(room, int((proportional_budget * room) / max(total_room, 1)))
        if add <= 0:
            continue
        allocated[source.id] += add
        rooms[source.id] -= add
        remaining -= add

    # Second pass: fill leftovers by priority.
    for source in prioritized_sources:
        if remaining <= 0:
            break
        room = rooms[source.id]
        if room <= 0:
            continue
        add = min(room, remaining)
        allocated[source.id] += add
        remaining -= add
    return allocated


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
        avg_impact = (
            sum((item.company_impact + item.team_impact + item.personal_impact) / 3 for _, item in rows) / count
        )
        must_read_rate = sum(1 for _, item in rows if item.worth == WORTH_MUST_READ) / count
        avg_confidence = sum(item.confidence for _, item in rows) / count
        freshness = sum(
            1
            for article, _ in rows
            if article.published_at and article.published_at >= recent_threshold
        ) / count

        batch_quality = (
            avg_quality * 0.40
            + avg_impact * 0.25
            + must_read_rate * 100 * 0.20
            + avg_confidence * 100 * 0.10
            + freshness * 100 * 0.05
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
