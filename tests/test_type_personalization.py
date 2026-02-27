from __future__ import annotations

from datetime import datetime, timezone

from src.main import _reorder_candidates_by_type_preference
from src.models import ScoredArticle


def _article(article_id: str, score: float, primary_type: str) -> ScoredArticle:
    return ScoredArticle(
        id=article_id,
        title=article_id,
        url=f"https://example.com/{article_id}",
        source_id="s1",
        source_name="source",
        published_at=datetime(2026, 2, 27, tzinfo=timezone.utc),
        summary_raw="",
        lead_paragraph="",
        content_text="",
        score=score,
        worth="必读",
        primary_type=primary_type,
    )


def test_reorder_candidates_by_type_preference_reorders_when_gap_is_small() -> None:
    candidates = [
        (0, _article("a1", 80, "research_progress")),
        (1, _article("a2", 76, "benchmark")),
    ]

    reordered, changed = _reorder_candidates_by_type_preference(
        candidates,
        type_multipliers={"benchmark": 1.15, "research_progress": 0.9},
        blend=0.5,
        quality_gap_guard=8,
    )

    assert changed > 0
    assert [item[1].id for item in reordered] == ["a2", "a1"]


def test_reorder_candidates_by_type_preference_respects_quality_gap_guard() -> None:
    candidates = [
        (0, _article("a1", 80, "research_progress")),
        (1, _article("a2", 76, "benchmark")),
    ]

    reordered, changed = _reorder_candidates_by_type_preference(
        candidates,
        type_multipliers={"benchmark": 1.15, "research_progress": 0.9},
        blend=0.5,
        quality_gap_guard=3,
    )

    assert changed == 0
    assert [item[1].id for item in reordered] == ["a1", "a2"]
