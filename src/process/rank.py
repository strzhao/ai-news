from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
from typing import Any

from src.models import (
    Article,
    ScoredArticle,
    WORTH_MUST_READ,
    WORTH_SKIP,
    WORTH_WORTH_READING,
)


def _count_keyword_hits(text: str, keywords: list[str]) -> int:
    haystack = text.lower()
    return sum(1 for keyword in keywords if keyword.lower() in haystack)


def _compute_signal_score(
    text: str,
    strong_keywords: list[str],
    medium_keywords: list[str],
    strong_weight: float = 20,
    medium_weight: float = 10,
) -> float:
    strong_hits = _count_keyword_hits(text, strong_keywords)
    medium_hits = _count_keyword_hits(text, medium_keywords)
    baseline = 45 if text.strip() else 0
    score = baseline + strong_hits * strong_weight + medium_hits * medium_weight
    return min(score, 100)


def _compute_recency_score(article: Article, now_utc: datetime) -> float:
    if not article.published_at:
        return 50
    delta = now_utc - article.published_at
    days = max(delta.total_seconds() / 86400, 0)
    if days <= 1:
        return 100
    if days <= 3:
        return 85
    if days <= 7:
        return 70
    if days <= 14:
        return 50
    return 30


def _compute_authority_score(
    article: Article,
    source_authority_defaults: dict[str, Any],
    source_weight_map: dict[str, float],
) -> float:
    base = float(source_authority_defaults.get(article.source_id, 70))
    source_weight = source_weight_map.get(article.source_id, 1.0)
    return min(base * source_weight, 100)


def _apply_penalties(score: float, article: Article, config: dict[str, Any], now_utc: datetime) -> float:
    penalties = config.get("penalties", {})
    outdated_days = int(penalties.get("outdated_days", 14))
    outdated_penalty = float(penalties.get("outdated_penalty", 12))
    marketing_terms = penalties.get("overly_marketing_terms", [])
    marketing_penalty = float(penalties.get("marketing_penalty", 6))

    if article.published_at and (now_utc - article.published_at).days > outdated_days:
        score -= outdated_penalty

    content = article.content_text.lower()
    if any(term.lower() in content for term in marketing_terms):
        score -= marketing_penalty

    return max(score, 0)


def _worth_from_score(score: float, thresholds: dict[str, Any]) -> str:
    must_read = float(thresholds.get("must_read", 75))
    worth_reading = float(thresholds.get("worth_reading", 55))
    if score >= must_read:
        return WORTH_MUST_READ
    if score >= worth_reading:
        return WORTH_WORTH_READING
    return WORTH_SKIP


def _reason_short(article: Article, components: dict[str, float], worth: str) -> str:
    reason_parts: list[str] = []
    highest = Counter(
        {
            "工程价值": components["engineering_value"],
            "信息新颖": components["novelty"],
            "来源权威": components["authority"],
            "可操作性": components["actionability"],
        }
    ).most_common(2)
    reason_parts.extend([label for label, _ in highest])
    if article.published_at:
        reason_parts.append("时效性")
    return f"{worth}：{'+'.join(reason_parts)}"


def rank_articles(
    articles: list[Article],
    scoring_config: dict[str, Any],
    source_weight_map: dict[str, float],
    now_utc: datetime | None = None,
) -> list[ScoredArticle]:
    now_utc = now_utc or datetime.now(timezone.utc)
    weights = scoring_config.get("weights", {})
    keyword_signals = scoring_config.get("keyword_signals", {})
    thresholds = scoring_config.get("worth_thresholds", {})
    source_authority_defaults = scoring_config.get("source_authority_defaults", {})

    total_weight = float(sum(weights.values())) or 1.0

    scored_articles: list[ScoredArticle] = []
    for article in articles:
        text = article.content_text
        engineering_value = _compute_signal_score(
            text,
            keyword_signals.get("engineering_value", {}).get("strong", []),
            keyword_signals.get("engineering_value", {}).get("medium", []),
        )
        novelty = _compute_signal_score(
            text,
            keyword_signals.get("novelty", {}).get("strong", []),
            keyword_signals.get("novelty", {}).get("medium", []),
        )
        actionability = _compute_signal_score(
            text,
            keyword_signals.get("actionability", {}).get("strong", []),
            keyword_signals.get("actionability", {}).get("medium", []),
        )
        authority = _compute_authority_score(article, source_authority_defaults, source_weight_map)
        recency = _compute_recency_score(article, now_utc)

        weighted_score = (
            engineering_value * float(weights.get("engineering_value", 35))
            + novelty * float(weights.get("novelty", 25))
            + authority * float(weights.get("authority", 20))
            + actionability * float(weights.get("actionability", 15))
            + recency * float(weights.get("recency", 5))
        ) / total_weight

        weighted_score = _apply_penalties(weighted_score, article, scoring_config, now_utc)
        worth = _worth_from_score(weighted_score, thresholds)
        components = {
            "engineering_value": engineering_value,
            "novelty": novelty,
            "authority": authority,
            "actionability": actionability,
            "recency": recency,
        }

        scored_articles.append(
            ScoredArticle(
                id=article.id,
                title=article.title,
                url=article.url,
                source_id=article.source_id,
                source_name=article.source_name,
                published_at=article.published_at,
                summary_raw=article.summary_raw,
                lead_paragraph=article.lead_paragraph,
                content_text=article.content_text,
                tags=article.tags[:],
                score=round(weighted_score, 2),
                worth=worth,
                reason_short=_reason_short(article, components, worth),
            )
        )

    return sorted(scored_articles, key=lambda item: item.score, reverse=True)
