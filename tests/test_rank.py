from datetime import datetime, timezone

from src.models import Article
from src.process.rank import rank_articles


NOW = datetime(2026, 2, 25, tzinfo=timezone.utc)


def _article(article_id: str, source_id: str, content_text: str = "") -> Article:
    return Article(
        id=article_id,
        title="test",
        url=f"https://example.com/{article_id}",
        source_id=source_id,
        source_name=source_id,
        published_at=NOW,
        summary_raw="",
        lead_paragraph="",
        content_text=content_text,
    )


def test_rank_worth_boundaries() -> None:
    config = {
        "weights": {
            "engineering_value": 0,
            "novelty": 0,
            "authority": 100,
            "actionability": 0,
            "recency": 0,
        },
        "worth_thresholds": {"must_read": 75, "worth_reading": 55},
        "source_authority_defaults": {"high": 75, "mid": 55, "low": 54},
    }

    ranked = rank_articles(
        [_article("a", "high"), _article("b", "mid"), _article("c", "low")],
        scoring_config=config,
        source_weight_map={"high": 1.0, "mid": 1.0, "low": 1.0},
        now_utc=NOW,
    )

    worth_map = {item.source_id: item.worth for item in ranked}
    assert worth_map["high"] == "必读"
    assert worth_map["mid"] == "可读"
    assert worth_map["low"] == "跳过"


def test_rank_applies_marketing_penalty() -> None:
    config = {
        "weights": {
            "engineering_value": 0,
            "novelty": 100,
            "authority": 0,
            "actionability": 0,
            "recency": 0,
        },
        "worth_thresholds": {"must_read": 75, "worth_reading": 55},
        "source_authority_defaults": {},
        "keyword_signals": {
            "novelty": {
                "strong": ["breakthrough", "launch", "major update"],
                "medium": [],
            }
        },
        "penalties": {
            "outdated_days": 14,
            "outdated_penalty": 0,
            "overly_marketing_terms": ["best ever"],
            "marketing_penalty": 20,
        },
    }

    clean = _article("clean", "s", content_text="breakthrough launch major update")
    marketing = _article("marketing", "s", content_text="breakthrough launch major update best ever")

    ranked = rank_articles(
        [clean, marketing],
        scoring_config=config,
        source_weight_map={"s": 1.0},
        now_utc=NOW,
    )

    score_map = {item.id: item.score for item in ranked}
    assert score_map["clean"] > score_map["marketing"]
