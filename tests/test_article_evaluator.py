from __future__ import annotations

from datetime import datetime, timezone

from src.cache.article_eval_cache import ArticleEvalCache
from src.llm.article_evaluator import ArticleEvaluator, build_article_cache_key
from src.models import Article


class _FakeClient:
    def __init__(self, payload: dict) -> None:
        self.payload = payload
        self.model = "deepseek-chat"
        self.call_count = 0

    def chat_json(self, messages, temperature=0.1):  # noqa: ANN001
        self.call_count += 1
        return self.payload


def _article(summary: str = "summary", article_id: str = "a1") -> Article:
    return Article(
        id=article_id,
        title=f"title-{article_id}",
        url=f"https://example.com/{article_id}",
        source_id="s",
        source_name="source",
        published_at=datetime(2026, 2, 25, tzinfo=timezone.utc),
        summary_raw=summary,
        lead_paragraph="lead",
        content_text="content",
    )


def test_evaluate_articles_uses_cache(tmp_path) -> None:  # noqa: ANN001
    payload = {
        "article_id": "a1",
        "worth": "必读",
        "quality_score": 91,
        "practicality_score": 92,
        "actionability_score": 88,
        "novelty_score": 82,
        "clarity_score": 86,
        "one_line_summary": "可落地实践细节充分，值得优先阅读",
        "reason_short": "含代码与评测，实战收益明确",
        "evidence_signals": ["code", "benchmark"],
        "confidence": 0.9,
    }
    client = _FakeClient(payload)
    evaluator = ArticleEvaluator(client=client, cache=ArticleEvalCache(str(tmp_path / "cache.sqlite3")))
    article = _article()

    first = evaluator.evaluate_articles([article])
    second = evaluator.evaluate_articles([article])

    assert "a1" in first
    assert "a1" in second
    assert client.call_count == 1


def test_cache_key_changes_when_content_changes() -> None:
    article_a = _article(summary="s1", article_id="a1")
    article_b = _article(summary="s2", article_id="a1")
    key_a = build_article_cache_key(article_a, model_name="deepseek-chat", prompt_version="v2")
    key_b = build_article_cache_key(article_b, model_name="deepseek-chat", prompt_version="v2")
    assert key_a != key_b

