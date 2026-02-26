from __future__ import annotations

import hashlib
import json
import os
import time
from typing import Any

import logging

from src.cache.article_eval_cache import ArticleEvalCache
from src.llm.deepseek_client import DeepSeekClient, DeepSeekError
from src.models import (
    Article,
    ArticleAssessment,
    WORTH_MUST_READ,
    WORTH_SKIP,
    WORTH_WORTH_READING,
)

VALID_WORTH = {WORTH_MUST_READ, WORTH_WORTH_READING, WORTH_SKIP}
LOGGER = logging.getLogger(__name__)


def _coerce_score(value: Any) -> float:
    score = float(value)
    return max(0.0, min(100.0, score))


def _coerce_confidence(value: Any) -> float:
    confidence = float(value)
    return max(0.0, min(1.0, confidence))


def compute_article_content_hash(article: Article) -> str:
    base = "|".join(
        [
            article.title.strip(),
            article.summary_raw.strip(),
            article.lead_paragraph.strip(),
        ]
    ).encode("utf-8", errors="ignore")
    return hashlib.sha256(base).hexdigest()


def build_article_cache_key(
    article: Article,
    *,
    model_name: str,
    prompt_version: str,
) -> str:
    base = "|".join(
        [
            model_name.strip(),
            prompt_version.strip(),
            article.url.strip().lower(),
            compute_article_content_hash(article),
        ]
    ).encode("utf-8", errors="ignore")
    return hashlib.sha256(base).hexdigest()


class ArticleEvaluator:
    def __init__(self, client: DeepSeekClient, cache: ArticleEvalCache) -> None:
        self.client = client
        self.cache = cache
        self.prompt_version = os.getenv("AI_EVAL_PROMPT_VERSION", "v2")
        self.max_retries = max(0, int(os.getenv("AI_EVAL_MAX_RETRIES", "2")))

    def evaluate_articles(self, articles: list[Article]) -> dict[str, ArticleAssessment]:
        assessments: dict[str, ArticleAssessment] = {}
        for article in articles:
            cache_key = build_article_cache_key(
                article,
                model_name=self.client.model,
                prompt_version=self.prompt_version,
            )
            cached = self.cache.get_assessment(cache_key)
            if cached:
                cached.cache_key = cache_key
                assessments[article.id] = cached
                continue

            last_error: Exception | None = None
            for attempt in range(self.max_retries + 1):
                try:
                    assessment = self.evaluate_article(article)
                    assessment.cache_key = cache_key
                    self.cache.set_assessment(
                        cache_key=cache_key,
                        source_id=article.source_id,
                        article_id=article.id,
                        content_hash=compute_article_content_hash(article),
                        model_name=self.client.model,
                        prompt_version=self.prompt_version,
                        assessment=assessment,
                    )
                    assessments[article.id] = assessment
                    last_error = None
                    break
                except DeepSeekError as exc:
                    last_error = exc
                    if attempt < self.max_retries:
                        time.sleep(0.35 * (attempt + 1))
            if last_error:
                LOGGER.warning("Article evaluation failed for %s: %s", article.id, last_error)
                # Keep the pipeline running: this article will be skipped downstream.
                continue

        self.cache.prune(max_rows=5000)
        return assessments

    def evaluate_article(self, article: Article) -> ArticleAssessment:
        system_prompt = (
            "你是互联网公司 AI 资讯质检编辑，严格评估一篇文章是否值得工程团队投入阅读时间。"
            "评估优先级：实战可落地 > 可操作性 > 新颖性 > 表达清晰度。"
            "必读通常需要至少一个强实战证据：代码实现、架构细节、部署经验、评测数据、成本或性能优化。"
            "若文章主要是泛观点、营销宣传、无实操证据，必须降级。"
            "你必须只输出 JSON，不能输出解释文本。"
            "输出字段：article_id, worth, quality_score, practicality_score, actionability_score, "
            "novelty_score, clarity_score, one_line_summary, reason_short, evidence_signals, confidence。"
            "worth 仅允许：必读/可读/跳过。"
            "evidence_signals 是字符串数组，可选值：code, benchmark, deployment, cost, architecture, case_study, none。"
            "one_line_summary 控制在 20-35 字，reason_short 控制在 12-28 字。"
        )
        payload = {
            "article_id": article.id,
            "title": article.title,
            "published_at": article.published_at.isoformat() if article.published_at else "",
            "summary": article.summary_raw,
            "lead_paragraph": article.lead_paragraph,
        }
        result = self.client.chat_json(
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": json.dumps(payload, ensure_ascii=False)},
            ],
            temperature=0.1,
        )
        return self._parse_assessment(article.id, result)

    def _parse_assessment(self, article_id: str, row: dict[str, Any]) -> ArticleAssessment:
        if not isinstance(row, dict):
            raise DeepSeekError(f"Invalid article assessment payload: {row}")
        worth = str(row.get("worth", "")).strip()
        if worth not in VALID_WORTH:
            raise DeepSeekError(f"Invalid worth label from DeepSeek: {worth}")

        evidence = row.get("evidence_signals", [])
        if not isinstance(evidence, list):
            evidence = []
        evidence_signals = list(dict.fromkeys(str(item).strip() for item in evidence if str(item).strip()))
        if not evidence_signals:
            evidence_signals = ["none"]

        one_line_summary = str(row.get("one_line_summary", "")).strip()
        reason_short = str(row.get("reason_short", "")).strip()
        if not one_line_summary:
            raise DeepSeekError("DeepSeek returned empty one_line_summary")
        if not reason_short:
            raise DeepSeekError("DeepSeek returned empty reason_short")

        return ArticleAssessment(
            article_id=str(row.get("article_id", article_id)).strip() or article_id,
            worth=worth,
            quality_score=_coerce_score(row.get("quality_score", 0)),
            practicality_score=_coerce_score(row.get("practicality_score", 0)),
            actionability_score=_coerce_score(row.get("actionability_score", 0)),
            novelty_score=_coerce_score(row.get("novelty_score", 0)),
            clarity_score=_coerce_score(row.get("clarity_score", 0)),
            one_line_summary=one_line_summary,
            reason_short=reason_short,
            evidence_signals=evidence_signals,
            confidence=_coerce_confidence(row.get("confidence", 0)),
        )
