from __future__ import annotations

import sqlite3

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


def test_report_article_counts_are_global(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    cache.record_report_article_keys(
        [
            "info:k1",
            "info:k1",
            "info:k2",
            "info:k1",
        ],
    )

    counts = cache.load_report_article_counts()

    assert counts["info:k1"] == 3
    assert counts["info:k2"] == 1


def test_report_article_counts_duplicate_entries(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    cache = ArticleEvalCache(str(db_path))
    cache.record_report_article_keys(["info:k1"])
    cache.record_report_article_keys(["info:k1"])

    counts = cache.load_report_article_counts()

    assert counts["info:k1"] == 2


def test_migrate_from_legacy_highlight_key_counts(tmp_path) -> None:  # noqa: ANN001
    db_path = tmp_path / "cache.sqlite3"
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE highlight_key_counts (
                key_kind TEXT NOT NULL,
                key_value TEXT NOT NULL,
                hit_count INTEGER NOT NULL,
                updated_at TEXT NOT NULL,
                PRIMARY KEY (key_kind, key_value)
            )
            """
        )
        conn.execute(
            """
            INSERT INTO highlight_key_counts (key_kind, key_value, hit_count, updated_at)
            VALUES ('info', 'info:k1', 2, '2026-02-01T00:00:00+00:00')
            """
        )
        conn.execute(
            """
            INSERT INTO highlight_key_counts (key_kind, key_value, hit_count, updated_at)
            VALUES ('title', 'title:ignored', 9, '2026-02-01T00:00:00+00:00')
            """
        )

    cache = ArticleEvalCache(str(db_path))
    counts = cache.load_report_article_counts()

    assert counts["info:k1"] == 2
    assert "title:ignored" not in counts
