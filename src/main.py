from __future__ import annotations

import argparse
import logging
import os
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from src.cache.article_eval_cache import ArticleEvalCache
from src.config_loader import load_sources
from src.fetch.rss_fetcher import fetch_articles
from src.integrations.flomo_client import FlomoClient, FlomoSyncError
from src.llm.article_evaluator import ArticleEvaluator
from src.llm.deepseek_client import DeepSeekClient, DeepSeekError
from src.llm.summarizer import DigestSummarizer
from src.models import DailyDigest, ScoredArticle, TaggedArticle
from src.output.flomo_formatter import build_flomo_payload
from src.output.markdown_writer import render_digest_markdown, write_digest_markdown
from src.process.dedupe import dedupe_articles
from src.process.normalize import normalize_articles
from src.process.source_quality import (
    build_budgeted_source_limits,
    build_source_fetch_limits,
    compute_source_quality_scores,
    rank_sources_by_priority,
)

LOGGER = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate daily AI RSS digest")
    parser.add_argument("--date", help="Target date in YYYY-MM-DD, defaults to today in --tz")
    parser.add_argument("--tz", default="Asia/Shanghai", help="Timezone name, default Asia/Shanghai")
    parser.add_argument("--top-n", type=int, default=8, help="Number of highlight articles")
    parser.add_argument("--output-dir", default="reports", help="Directory for markdown reports")
    parser.add_argument("--sources-config", default="src/config/sources.yaml")
    parser.add_argument("--sync-flomo", action="store_true", help="Force sync to flomo")
    parser.add_argument("--no-sync-flomo", action="store_true", help="Disable flomo sync")
    return parser.parse_args()


def _target_date(date_value: str | None, timezone_name: str) -> str:
    tz = ZoneInfo(timezone_name)
    if date_value:
        return date_value
    return datetime.now(tz).strftime("%Y-%m-%d")


def _build_client() -> DeepSeekClient:
    api_key = os.getenv("DEEPSEEK_API_KEY")
    if not api_key:
        raise RuntimeError("未配置 DEEPSEEK_API_KEY。请先配置后再运行，当前不提供规则摘要降级。")
    return DeepSeekClient(api_key=api_key)


def _build_summarizer(client: DeepSeekClient | None = None) -> DigestSummarizer:
    return DigestSummarizer(client=client or _build_client())


def _build_evaluator(client: DeepSeekClient | None = None) -> ArticleEvaluator:
    cache = ArticleEvalCache(os.getenv("AI_EVAL_CACHE_DB"))
    return ArticleEvaluator(client=client or _build_client(), cache=cache)


def _should_sync_flomo(args: argparse.Namespace) -> bool:
    if args.no_sync_flomo:
        return False
    if args.sync_flomo:
        return True
    return bool(os.getenv("FLOMO_API_URL"))


def run() -> int:
    args = parse_args()
    logging.basicConfig(
        level=os.getenv("LOG_LEVEL", "INFO"),
        format="%(asctime)s %(levelname)s %(name)s - %(message)s",
    )

    try:
        client = _build_client()
    except RuntimeError as exc:
        LOGGER.error("%s", exc)
        return 2
    summarizer = _build_summarizer(client=client)
    evaluator = _build_evaluator(client=client)
    cache = evaluator.cache

    report_date = _target_date(args.date, args.tz)
    sources = load_sources(args.sources_config)
    historical_source_scores = cache.load_source_scores()
    prioritized_sources = rank_sources_by_priority(sources, historical_source_scores)
    per_source_limits = build_source_fetch_limits(prioritized_sources)
    fetch_budget = max(0, int(os.getenv("SOURCE_FETCH_BUDGET", "60")))
    per_source_limits = build_budgeted_source_limits(
        prioritized_sources,
        per_source_limits,
        total_budget=fetch_budget,
        min_per_source=max(1, int(os.getenv("MIN_FETCH_PER_SOURCE", "3"))),
    )
    max_eval_articles = max(1, int(os.getenv("MAX_EVAL_ARTICLES", "60")))

    fetched = fetch_articles(
        prioritized_sources,
        per_source_limits=per_source_limits,
        total_budget=0,
    )
    normalized = normalize_articles(fetched)
    deduped = dedupe_articles(normalized)
    deduped = sorted(
        deduped,
        key=lambda item: item.published_at or datetime.min.replace(tzinfo=timezone.utc),
        reverse=True,
    )[:max_eval_articles]

    if not deduped:
        LOGGER.error("RSS 抓取后无可用文章，无法生成日报。")
        return 3

    assessments = evaluator.evaluate_articles(deduped)
    if not assessments:
        LOGGER.error("AI 单篇评估失败：无可用评估结果。")
        return 4

    source_quality_list = compute_source_quality_scores(
        deduped,
        assessments,
        historical_scores=historical_source_scores,
    )
    cache.upsert_source_scores(source_quality_list)
    source_quality_map = {item.source_id: item for item in source_quality_list}

    try:
        top_summary, ai_highlights, daily_tags = summarizer.build_digest_content(
            deduped,
            date=report_date,
            timezone_name=args.tz,
            top_n=args.top_n,
            assessments=assessments,
            source_quality_scores=source_quality_map,
        )
    except DeepSeekError as exc:
        LOGGER.error("AI 生成失败：%s", exc)
        return 5

    article_map = {article.id: article for article in deduped}
    tagged_highlights: list[TaggedArticle] = []
    for highlight in ai_highlights:
        article = article_map.get(highlight.article_id)
        if not article:
            continue
        assessment = assessments.get(article.id)
        scored_article = ScoredArticle(
            id=article.id,
            title=article.title,
            url=article.url,
            source_id=article.source_id,
            source_name=article.source_name,
            published_at=article.published_at,
            summary_raw=article.summary_raw,
            lead_paragraph=highlight.one_line_summary or (assessment.one_line_summary if assessment else ""),
            content_text=article.content_text,
            tags=[],
            score=float(assessment.quality_score if assessment else max(0, 100 - (highlight.rank - 1) * 5)),
            worth=highlight.worth or (assessment.worth if assessment else ""),
            reason_short=highlight.reason_short or (assessment.reason_short if assessment else ""),
        )
        tagged_highlights.append(TaggedArticle(article=scored_article, generated_tags=[]))

    digest = DailyDigest(
        date=report_date,
        timezone=args.tz,
        top_summary=top_summary,
        highlights=tagged_highlights,
        daily_tags=daily_tags,
        extras=[],
    )

    markdown = render_digest_markdown(digest)
    output_path = write_digest_markdown(markdown, report_date=report_date, output_dir=args.output_dir)
    LOGGER.info("Digest report generated: %s", output_path)

    if _should_sync_flomo(args):
        payload = build_flomo_payload(digest)
        try:
            flomo = FlomoClient()
            flomo.send(payload)
        except FlomoSyncError as exc:
            LOGGER.warning("Flomo sync failed: %s", exc)

    if not tagged_highlights:
        LOGGER.error("AI 未返回可用重点文章，已中止。")
        return 6

    return 0


if __name__ == "__main__":
    raise SystemExit(run())
