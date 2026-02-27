from __future__ import annotations

from datetime import datetime, timezone

from src.personalization.type_weight import compute_type_multipliers


def test_compute_type_multipliers_prefers_more_recent_clicks() -> None:
    type_daily = {
        "benchmark": {"2026-02-27": 5, "2026-02-26": 1},
        "research_progress": {"2026-02-27": 1},
    }
    multipliers = compute_type_multipliers(
        type_daily,
        lookback_days=90,
        half_life_days=21,
        now_utc=datetime(2026, 2, 27, tzinfo=timezone.utc),
    )

    assert multipliers["benchmark"] > multipliers["research_progress"]
    assert 0.9 <= multipliers["benchmark"] <= 1.15
    assert 0.9 <= multipliers["research_progress"] <= 1.15


def test_compute_type_multipliers_ignores_outdated_data() -> None:
    type_daily = {
        "benchmark": {"2026-01-01": 10},
        "agent_workflow": {"2026-02-27": 2},
    }
    multipliers = compute_type_multipliers(
        type_daily,
        lookback_days=7,
        now_utc=datetime(2026, 2, 27, tzinfo=timezone.utc),
    )

    assert "benchmark" not in multipliers
    assert "agent_workflow" in multipliers
