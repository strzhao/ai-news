from __future__ import annotations

from datetime import datetime, timezone
from math import ceil


def _parse_date(value: str) -> datetime | None:
    try:
        dt = datetime.fromisoformat(value)
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def _decay_weight(age_days: int, half_life_days: float) -> float:
    if age_days <= 0:
        return 1.0
    if half_life_days <= 0:
        return 1.0
    return 0.5 ** (age_days / half_life_days)


def compute_behavior_multipliers(
    source_daily_clicks: dict[str, dict[str, int]],
    *,
    lookback_days: int = 90,
    half_life_days: float = 21,
    min_multiplier: float = 0.85,
    max_multiplier: float = 1.2,
    now_utc: datetime | None = None,
) -> dict[str, float]:
    now_utc = now_utc or datetime.now(timezone.utc)
    days = max(1, lookback_days)
    max_age = days - 1
    decayed_scores: dict[str, float] = {}

    for source_id, daily in source_daily_clicks.items():
        score = 0.0
        for date_text, count in daily.items():
            dt = _parse_date(date_text)
            if not dt:
                continue
            age_days = max(0, (now_utc.date() - dt.date()).days)
            if age_days > max_age:
                continue
            score += max(0, int(count)) * _decay_weight(age_days, half_life_days)
        if score > 0:
            decayed_scores[source_id] = score

    if not decayed_scores:
        return {}

    baseline = sum(decayed_scores.values()) / max(1, len(decayed_scores))
    if baseline <= 0:
        return {source_id: 1.0 for source_id in decayed_scores}

    low = min(min_multiplier, max_multiplier)
    high = max(min_multiplier, max_multiplier)
    multipliers: dict[str, float] = {}
    for source_id, score in decayed_scores.items():
        centered = (score - baseline) / baseline
        raw = 1.0 + centered * 0.25
        multipliers[source_id] = round(max(low, min(high, raw)), 4)
    return multipliers


def select_preferred_sources(
    source_daily_clicks: dict[str, dict[str, int]],
    *,
    min_clicks: int = 2,
    top_quantile: float = 0.3,
) -> set[str]:
    totals: list[tuple[str, int]] = []
    for source_id, daily in source_daily_clicks.items():
        total = sum(max(0, int(count)) for count in daily.values())
        if total >= min_clicks:
            totals.append((source_id, total))

    if not totals:
        return set()

    totals.sort(key=lambda item: item[1], reverse=True)
    quantile = min(1.0, max(0.01, top_quantile))
    keep_count = max(1, ceil(len(totals) * quantile))
    return {source_id for source_id, _ in totals[:keep_count]}
