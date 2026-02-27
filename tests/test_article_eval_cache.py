from __future__ import annotations

from datetime import datetime, timezone

from src.cache.article_eval_cache import ArticleEvalCache
from src.models import ArticleAssessment


def _assessment(article_id: str = "a1") -> ArticleAssessment:
    return ArticleAssessment(
        article_id=article_id,
        worth="必读",
        quality_score=90,
        practicality_score=92,
        actionability_score=88,
        novelty_score=80,
        clarity_score=85,
        one_line_summary="可直接落地的工程实践总结",
        reason_short="实战细节充分，投入回报高",
        evidence_signals=["code", "benchmark"],
        confidence=0.9,
        primary_type="benchmark",
        secondary_types=["engineering_practice"],
    )


def test_cache_set_and_get(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    cache.set_assessment(
        cache_key="k1",
        source_id="s1",
        article_id="a1",
        content_hash="h1",
        model_name="deepseek-chat",
        prompt_version="v2",
        assessment=_assessment(),
    )
    cached = cache.get_assessment("k1")
    assert cached is not None
    assert cached.article_id == "a1"
    assert cached.worth == "必读"
    assert cached.evidence_signals == ["code", "benchmark"]
    assert cached.primary_type == "benchmark"
    assert cached.secondary_types == ["engineering_practice"]


def test_cache_prune(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    for idx in range(3):
        cache.set_assessment(
            cache_key=f"k{idx}",
            source_id="s1",
            article_id=f"a{idx}",
            content_hash=f"h{idx}",
            model_name="deepseek-chat",
            prompt_version="v2",
            assessment=_assessment(article_id=f"a{idx}"),
        )
    cache.prune(max_rows=2)
    kept = sum(1 for key in ("k0", "k1", "k2") if cache.get_assessment(key) is not None)
    assert kept == 2


def test_highlight_history_counts_and_lookback(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    cache.record_highlight_entries(
        "2026-02-27",
        [
            ("a1", "info:k1", "title:t1"),
            ("a2", "info:k1", "title:t2"),
            ("a3", "info:k2", "title:t1"),
        ],
    )
    cache.record_highlight_entries(
        "2026-02-20",
        [
            ("a4", "info:k1", "title:t1"),
        ],
    )

    info_counts, title_counts = cache.load_highlight_key_counts(
        lookback_days=7,
        now_utc=datetime(2026, 2, 27, tzinfo=timezone.utc),
    )

    assert info_counts["info:k1"] == 2
    assert info_counts["info:k2"] == 1
    assert title_counts["title:t1"] == 2
    assert title_counts["title:t2"] == 1


def test_highlight_history_upsert_same_article_same_day(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    cache.record_highlight_entries("2026-02-27", [("a1", "info:k1", "title:t1")])
    cache.record_highlight_entries("2026-02-27", [("a1", "info:k1", "title:t1")])

    info_counts, title_counts = cache.load_highlight_key_counts(
        lookback_days=30,
        now_utc=datetime(2026, 2, 27, tzinfo=timezone.utc),
    )

    assert info_counts["info:k1"] == 1
    assert title_counts["title:t1"] == 1
