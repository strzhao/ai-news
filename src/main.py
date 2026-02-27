from __future__ import annotations

import argparse
import logging
import os
from collections import Counter
from math import ceil, floor
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from src.cache.article_eval_cache import ArticleEvalCache
from src.config_loader import load_article_types, load_sources
from src.fetch.rss_fetcher import fetch_articles
from src.integrations.flomo_client import FlomoClient, FlomoSyncError
from src.llm.article_evaluator import ArticleEvaluator
from src.llm.deepseek_client import DeepSeekClient, DeepSeekError
from src.llm.summarizer import DigestSummarizer
from src.models import (
    AIHighlight,
    ArticleAssessment,
    DailyDigest,
    ScoredArticle,
    TaggedArticle,
    WORTH_MUST_READ,
    WORTH_SKIP,
    WORTH_WORTH_READING,
)
from src.output.flomo_formatter import build_flomo_payload
from src.output.markdown_writer import render_digest_markdown, write_digest_markdown
from src.process.dedupe import dedupe_articles
from src.process.info_cluster import build_info_key, build_title_key
from src.process.normalize import normalize_articles
from src.process.source_quality import (
    build_budgeted_source_limits,
    build_source_fetch_limits,
    compute_source_quality_scores,
    rank_sources_by_priority,
)
from src.personalization.behavior_weight import compute_behavior_multipliers, select_preferred_sources
from src.personalization.consumption_client import (
    ConsumptionClientError,
    load_source_daily_clicks,
    load_type_daily_clicks,
)
from src.personalization.type_weight import compute_type_multipliers
from src.tracking.link_tracker import LinkTracker

LOGGER = logging.getLogger(__name__)


def _percentile(values: list[float], percentile: float) -> float:
    if not values:
        return 0.0
    sorted_values = sorted(values)
    if percentile <= 0:
        return sorted_values[0]
    if percentile >= 100:
        return sorted_values[-1]

    index = (len(sorted_values) - 1) * (percentile / 100.0)
    lower = floor(index)
    upper = ceil(index)
    if lower == upper:
        return sorted_values[lower]
    weight = index - lower
    return sorted_values[lower] * (1 - weight) + sorted_values[upper] * weight


def _highlight_cap(total_assessed: int, top_n: int) -> int:
    default_ratio = "1.0" if _expanded_discovery_mode_enabled() else "0.45"
    default_minimum = "8" if _expanded_discovery_mode_enabled() else "4"
    ratio = min(1.0, max(0.05, float(os.getenv("HIGHLIGHT_SELECTION_RATIO", default_ratio))))
    minimum = max(1, int(os.getenv("HIGHLIGHT_MIN_COUNT", default_minimum)))
    capped = max(minimum, int(round(total_assessed * ratio)))
    return max(1, min(top_n, capped))


def _expanded_discovery_mode_enabled() -> bool:
    return os.getenv("EXPANDED_DISCOVERY_MODE", "true").strip().lower() not in {
        "0",
        "false",
        "no",
        "off",
    }


def parse_args() -> argparse.Namespace:
    expanded_mode = _expanded_discovery_mode_enabled()
    default_top_n = 32 if expanded_mode else 16
    parser = argparse.ArgumentParser(description="Generate daily AI RSS digest")
    parser.add_argument("--date", help="Target date in YYYY-MM-DD, defaults to today in --tz")
    parser.add_argument("--tz", default="Asia/Shanghai", help="Timezone name, default Asia/Shanghai")
    parser.add_argument("--top-n", type=int, default=default_top_n, help="Max number of highlight articles")
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


def _build_evaluator(
    client: DeepSeekClient | None = None,
    *,
    article_types: list[str] | None = None,
) -> ArticleEvaluator:
    cache = ArticleEvalCache(os.getenv("AI_EVAL_CACHE_DB"))
    return ArticleEvaluator(
        client=client or _build_client(),
        cache=cache,
        article_types=article_types,
    )


def _should_sync_flomo(args: argparse.Namespace) -> bool:
    if args.no_sync_flomo:
        return False
    if args.sync_flomo:
        return True
    return bool(os.getenv("FLOMO_API_URL"))


def _is_enabled(env_name: str, default: str = "true") -> bool:
    return os.getenv(env_name, default).strip().lower() not in {"0", "false", "no", "off"}


def _personalized_quality_score(
    base_quality: float,
    primary_type: str,
    type_multipliers: dict[str, float],
    blend: float,
) -> float:
    if blend <= 0:
        return base_quality
    multiplier = float(type_multipliers.get(primary_type, 1.0))
    return base_quality * (1.0 + (multiplier - 1.0) * blend)


def _reorder_candidates_by_type_preference(
    candidates: list[tuple[int, AIHighlight, ScoredArticle, ArticleAssessment]],
    *,
    type_multipliers: dict[str, float],
    blend: float,
    quality_gap_guard: float,
) -> tuple[list[tuple[int, AIHighlight, ScoredArticle, ArticleAssessment]], int]:
    if not candidates or not type_multipliers or blend <= 0:
        return candidates, 0

    enriched: list[tuple[int, AIHighlight, ScoredArticle, ArticleAssessment, float]] = []
    for index, highlight, scored_article, assessment in candidates:
        personalized_score = _personalized_quality_score(
            float(scored_article.score),
            scored_article.primary_type,
            type_multipliers,
            blend,
        )
        enriched.append((index, highlight, scored_article, assessment, personalized_score))

    ordered = sorted(
        enriched,
        key=lambda item: (item[4], item[2].score, -item[0]),
        reverse=True,
    )

    gap = max(0.0, float(quality_gap_guard))
    if gap > 0:
        changed = True
        while changed:
            changed = False
            for idx in range(1, len(ordered)):
                prev = ordered[idx - 1]
                cur = ordered[idx]
                if cur[2].score - prev[2].score > gap:
                    ordered[idx - 1], ordered[idx] = cur, prev
                    changed = True

    before = [item[2].id for item in candidates]
    after = [item[2].id for item in ordered]
    reordered_count = sum(1 for idx, article_id in enumerate(before) if after[idx] != article_id)

    return [(index, highlight, scored_article, assessment) for index, highlight, scored_article, assessment, _ in ordered], reordered_count


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

    try:
        article_types = load_article_types(os.getenv("ARTICLE_TYPES_CONFIG") or None)
    except (OSError, ValueError) as exc:
        LOGGER.error("Failed to load article types config: %s", exc)
        return 2

    summarizer = _build_summarizer(client=client)
    evaluator = _build_evaluator(client=client, article_types=article_types)
    cache = evaluator.cache

    report_date = _target_date(args.date, args.tz)
    sources = load_sources(args.sources_config)
    historical_source_scores = cache.load_source_scores()
    behavior_multipliers: dict[str, float] = {}
    type_multipliers: dict[str, float] = {}
    preferred_source_ids: set[str] = set()
    personalization_enabled = _is_enabled("PERSONALIZATION_ENABLED", "true")
    type_personalization_enabled = _is_enabled("TYPE_PERSONALIZATION_ENABLED", "true")
    lookback_days = max(1, int(os.getenv("PERSONALIZATION_LOOKBACK_DAYS", "90")))
    half_life_days = max(1.0, float(os.getenv("PERSONALIZATION_HALF_LIFE_DAYS", "21")))
    min_multiplier = float(os.getenv("PERSONALIZATION_MIN_MULTIPLIER", "0.85"))
    max_multiplier = float(os.getenv("PERSONALIZATION_MAX_MULTIPLIER", "1.2"))
    if personalization_enabled:
        try:
            source_daily_clicks = load_source_daily_clicks(days=lookback_days)
            behavior_multipliers = compute_behavior_multipliers(
                source_daily_clicks,
                lookback_days=lookback_days,
                half_life_days=half_life_days,
                min_multiplier=min_multiplier,
                max_multiplier=max_multiplier,
            )
            preferred_source_ids = select_preferred_sources(source_daily_clicks, min_clicks=2, top_quantile=0.3)
            LOGGER.info(
                "Personalization enabled: click_sources=%d behavior_weights=%d preferred_sources=%d",
                len(source_daily_clicks),
                len(behavior_multipliers),
                len(preferred_source_ids),
            )
        except ConsumptionClientError as exc:
            LOGGER.warning("Failed to load tracker stats, fallback to static source priority: %s", exc)

    type_lookback_days = max(1, int(os.getenv("TYPE_PERSONALIZATION_LOOKBACK_DAYS", "90")))
    type_half_life_days = max(1.0, float(os.getenv("TYPE_PERSONALIZATION_HALF_LIFE_DAYS", "21")))
    type_min_multiplier = float(os.getenv("TYPE_PERSONALIZATION_MIN_MULTIPLIER", "0.9"))
    type_max_multiplier = float(os.getenv("TYPE_PERSONALIZATION_MAX_MULTIPLIER", "1.15"))
    type_blend = max(0.0, min(1.0, float(os.getenv("TYPE_PERSONALIZATION_BLEND", "0.2"))))
    type_quality_gap_guard = max(0.0, float(os.getenv("TYPE_PERSONALIZATION_QUALITY_GAP_GUARD", "8")))
    if type_personalization_enabled:
        try:
            type_daily_clicks = load_type_daily_clicks(days=type_lookback_days)
            type_multipliers = compute_type_multipliers(
                type_daily_clicks,
                lookback_days=type_lookback_days,
                half_life_days=type_half_life_days,
                min_multiplier=type_min_multiplier,
                max_multiplier=type_max_multiplier,
            )
            LOGGER.info(
                "Type personalization enabled: click_types=%d type_weights=%d",
                len(type_daily_clicks),
                len(type_multipliers),
            )
        except ConsumptionClientError as exc:
            LOGGER.warning("Failed to load type stats, fallback to baseline article ranking: %s", exc)

    prioritized_sources = rank_sources_by_priority(
        sources,
        historical_source_scores,
        behavior_multipliers=behavior_multipliers,
    )
    per_source_limits = build_source_fetch_limits(prioritized_sources)
    fetch_budget = max(0, int(os.getenv("SOURCE_FETCH_BUDGET", "60")))
    exploration_ratio = float(os.getenv("EXPLORATION_RATIO", "0.15"))
    per_source_limits = build_budgeted_source_limits(
        prioritized_sources,
        per_source_limits,
        total_budget=fetch_budget,
        min_per_source=max(1, int(os.getenv("MIN_FETCH_PER_SOURCE", "3"))),
        preferred_source_ids=preferred_source_ids,
        exploration_ratio=exploration_ratio,
    )
    default_max_eval = 120 if _expanded_discovery_mode_enabled() else 60
    max_eval_articles = max(1, int(os.getenv("MAX_EVAL_ARTICLES", str(default_max_eval))))

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
    min_highlight_score = float(os.getenv("MIN_HIGHLIGHT_SCORE", "62"))
    min_worth_reading_score = float(os.getenv("MIN_WORTH_READING_SCORE", "58"))
    min_highlight_confidence = float(os.getenv("MIN_HIGHLIGHT_CONFIDENCE", "0.55"))
    dynamic_percentile = float(os.getenv("HIGHLIGHT_DYNAMIC_PERCENTILE", "70"))
    scored_assessments = [item.quality_score for item in assessments.values() if item.worth != WORTH_SKIP]
    dynamic_threshold = _percentile(scored_assessments, dynamic_percentile) if scored_assessments else min_highlight_score
    effective_threshold = max(min_highlight_score, dynamic_threshold)
    selection_cap = _highlight_cap(len(scored_assessments), args.top_n)
    LOGGER.info(
        "Highlight gating: must_read>=%.1f (base=%.1f, p%.0f=%.1f), worth_reading>=%.1f, min_confidence=%.2f, cap=%d",
        effective_threshold,
        min_highlight_score,
        dynamic_percentile,
        dynamic_threshold,
        min_worth_reading_score,
        min_highlight_confidence,
        selection_cap,
    )

    must_read_candidates: list[tuple[int, AIHighlight, ScoredArticle, ArticleAssessment]] = []
    fallback_worth_reading: list[tuple[int, AIHighlight, ScoredArticle, ArticleAssessment]] = []
    max_info_dup = max(1, int(os.getenv("MAX_INFO_DUP_PER_DIGEST", "2")))
    info_key_counts: Counter[str] = Counter()
    title_key_counts: Counter[str] = Counter()

    def _reserve_info_slot(article: ScoredArticle) -> bool:
        info_key = build_info_key(article)
        title_key = build_title_key(article.title)
        if info_key_counts[info_key] >= max_info_dup:
            return False
        if title_key_counts[title_key] >= max_info_dup:
            return False
        info_key_counts[info_key] += 1
        title_key_counts[title_key] += 1
        return True

    for index, highlight in enumerate(ai_highlights):
        if highlight.worth == WORTH_SKIP:
            continue
        article = article_map.get(highlight.article_id)
        if not article:
            continue
        assessment = assessments.get(article.id)
        if not assessment:
            continue
        if assessment.worth == WORTH_SKIP:
            continue
        if assessment.confidence < min_highlight_confidence:
            continue
        if assessment.worth == WORTH_MUST_READ and assessment.quality_score < effective_threshold:
            continue
        if assessment.worth == WORTH_WORTH_READING and assessment.quality_score < min_worth_reading_score:
            continue

        scored_article = ScoredArticle(
            id=article.id,
            title=article.title,
            url=article.url,
            source_id=article.source_id,
            source_name=article.source_name,
            published_at=article.published_at,
            summary_raw=article.summary_raw,
            lead_paragraph=highlight.one_line_summary or assessment.one_line_summary,
            content_text=article.content_text,
            info_url=article.info_url,
            tags=[],
            primary_type=assessment.primary_type,
            secondary_types=assessment.secondary_types[:],
            score=float(assessment.quality_score),
            worth=assessment.worth,
            reason_short=highlight.reason_short or assessment.reason_short,
        )
        tuple_item = (index, highlight, scored_article, assessment)
        if assessment.worth == WORTH_MUST_READ:
            must_read_candidates.append(tuple_item)
        else:
            fallback_worth_reading.append(tuple_item)

    must_read_candidates, must_read_reordered = _reorder_candidates_by_type_preference(
        must_read_candidates,
        type_multipliers=type_multipliers,
        blend=type_blend,
        quality_gap_guard=type_quality_gap_guard,
    )
    fallback_worth_reading, worth_reading_reordered = _reorder_candidates_by_type_preference(
        fallback_worth_reading,
        type_multipliers=type_multipliers,
        blend=type_blend,
        quality_gap_guard=type_quality_gap_guard,
    )
    if type_multipliers:
        LOGGER.info(
            "Type personalization reorder: must_read=%d worth_reading=%d blend=%.2f gap_guard=%.1f",
            must_read_reordered,
            worth_reading_reordered,
            type_blend,
            type_quality_gap_guard,
        )

    for _, _, scored_article, _ in must_read_candidates:
        if not _reserve_info_slot(scored_article):
            continue
        tagged_highlights.append(TaggedArticle(article=scored_article, generated_tags=[]))
        if len(tagged_highlights) >= selection_cap:
            break

    if len(tagged_highlights) < selection_cap:
        for _, _, scored_article, _ in fallback_worth_reading:
            if not _reserve_info_slot(scored_article):
                continue
            tagged_highlights.append(TaggedArticle(article=scored_article, generated_tags=[]))
            if len(tagged_highlights) >= selection_cap:
                break

    digest = DailyDigest(
        date=report_date,
        timezone=args.tz,
        top_summary=top_summary,
        highlights=tagged_highlights,
        daily_tags=daily_tags,
        extras=[],
    )

    tracker = LinkTracker.from_env()
    markdown = render_digest_markdown(
        digest,
        link_resolver=lambda article: tracker.build_tracking_url(
            article,
            digest_date=report_date,
            channel="markdown",
        ),
    )
    output_path = write_digest_markdown(markdown, report_date=report_date, output_dir=args.output_dir)
    LOGGER.info("Digest report generated: %s", output_path)

    if _should_sync_flomo(args):
        payload = build_flomo_payload(
            digest,
            link_resolver=lambda article: tracker.build_tracking_url(
                article,
                digest_date=report_date,
                channel="flomo",
            ),
        )
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
