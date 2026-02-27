from __future__ import annotations

from datetime import datetime, timezone

from src.personalization.behavior_weight import compute_behavior_multipliers, select_preferred_sources


def test_compute_behavior_multipliers_prefers_more_recent_clicks() -> None:
    source_daily = {
        "s1": {"2026-02-27": 8, "2026-02-26": 2},
        "s2": {"2026-02-27": 1},
    }
    multipliers = compute_behavior_multipliers(
        source_daily,
        lookback_days=90,
        half_life_days=21,
        now_utc=datetime(2026, 2, 27, tzinfo=timezone.utc),
    )

    assert multipliers["s1"] > multipliers["s2"]
    assert 0.85 <= multipliers["s1"] <= 1.2
    assert 0.85 <= multipliers["s2"] <= 1.2


def test_select_preferred_sources_uses_quantile_and_click_floor() -> None:
    source_daily = {
        "s1": {"2026-02-27": 5},
        "s2": {"2026-02-27": 3},
        "s3": {"2026-02-27": 1},
    }
    preferred = select_preferred_sources(source_daily, min_clicks=2, top_quantile=0.5)
    assert preferred == {"s1"}

