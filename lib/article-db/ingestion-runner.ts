import { loadArticleTypes, loadSources } from "@/lib/config-loader";
import { Article, DedupeStats } from "@/lib/domain/models";
import { fetchArticles } from "@/lib/fetch/rss-fetcher";
import { DeepSeekClient } from "@/lib/llm/deepseek-client";
import { ArticleEvaluator } from "@/lib/llm/article-evaluator";
import { ArticleEvalCache } from "@/lib/cache/article-eval-cache";
import { dedupeArticles } from "@/lib/process/dedupe";
import { normalizeArticles } from "@/lib/process/normalize";
import {
  countDailyAnalyzed,
  countDailyHighQuality,
  createIngestionRun,
  finishIngestionRun,
  replaceDailyAnalyzed,
  replaceDailyHighQuality,
  upsertArticleAnalyses,
  upsertArticles,
  upsertDailyAnalyzed,
  upsertDailyHighQuality,
  upsertSources,
} from "@/lib/article-db/repository";

function targetDate(dateValue: string | undefined, timezoneName: string): string {
  if (dateValue) return dateValue;
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(new Date());
  return `${year}-${month}-${day}`;
}

function nonEmptyDate(value: string): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date: ${raw}`);
  }
  return raw;
}

function sortedByPublishedAtDesc(articles: Article[]): Article[] {
  return [...articles].sort((left, right) => {
    const leftTs = left.publishedAt ? left.publishedAt.getTime() : 0;
    const rightTs = right.publishedAt ? right.publishedAt.getTime() : 0;
    return rightTs - leftTs;
  });
}

function isEnabled(name: string, defaultValue = "true"): boolean {
  const raw = String(process.env[name] || defaultValue || "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(raw);
}

export interface RunIngestionOptions {
  date?: string;
  tz?: string;
  sourcesConfig?: string;
}

export interface IngestionResult {
  ok: boolean;
  runId: string;
  reportDate: string;
  timezone: string;
  fetchedCount: number;
  dedupedCount: number;
  evaluatedCount: number;
  selectedCount: number;
  qualityThreshold: number;
  stats: Record<string, unknown>;
  errorMessage: string;
}

export async function runIngestionWithResult(options: RunIngestionOptions = {}): Promise<IngestionResult> {
  const timezoneName = String(options.tz || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const reportDate = nonEmptyDate(targetDate(options.date, timezoneName));
  const qualityThreshold = Number.parseFloat(String(process.env.QUALITY_SCORE_THRESHOLD || "62")) || 62;
  const perSourceMax = Math.max(1, Math.min(60, Number.parseInt(String(process.env.ARTICLE_DB_MAX_PER_SOURCE || "25"), 10) || 25));
  const fetchBudget = Math.max(0, Number.parseInt(String(process.env.SOURCE_FETCH_BUDGET || "0"), 10) || 0);
  const maxEvalArticles = Math.max(1, Math.min(200, Number.parseInt(String(process.env.MAX_EVAL_ARTICLES || "120"), 10) || 120));
  const mergeDailySnapshot = isEnabled("INGESTION_DAILY_MERGE_MODE", "true");

  const runId = await createIngestionRun(reportDate);
  const result: IngestionResult = {
    ok: false,
    runId,
    reportDate,
    timezone: timezoneName,
    fetchedCount: 0,
    dedupedCount: 0,
    evaluatedCount: 0,
    selectedCount: 0,
    qualityThreshold,
    stats: {},
    errorMessage: "",
  };

  try {
    const sources = loadSources(options.sourcesConfig || undefined);
    await upsertSources(sources);

    const fetched = await fetchArticles(sources, {
      maxPerSource: perSourceMax,
      totalBudget: fetchBudget,
    });
    result.fetchedCount = fetched.length;

    const normalized = normalizeArticles(fetched);
    const [deduped, dedupeStats] = dedupeArticles(normalized, 0.93, true) as [Article[], DedupeStats];
    const ranked = sortedByPublishedAtDesc(deduped);
    const evaluationPool = ranked.slice(0, maxEvalArticles);
    result.dedupedCount = evaluationPool.length;

    if (!evaluationPool.length) {
      if (!mergeDailySnapshot) {
        await replaceDailyHighQuality(reportDate, []);
        await replaceDailyAnalyzed(reportDate, []);
      }
      const selectedTotal = await countDailyHighQuality(reportDate);
      const analyzedTotal = await countDailyAnalyzed(reportDate);
      result.ok = true;
      result.selectedCount = selectedTotal;
      result.stats = {
        source_count: sources.length,
        fetched_count: fetched.length,
        normalized_count: normalized.length,
        deduped_count: deduped.length,
        dedupe_url_duplicates: dedupeStats.urlDuplicates,
        dedupe_title_duplicates: dedupeStats.titleDuplicates,
        evaluated_count: 0,
        analyzed_count_total: analyzedTotal,
        selected_count_new: 0,
        selected_count_total: selectedTotal,
        daily_snapshot_merge_mode: mergeDailySnapshot,
        max_eval_articles: maxEvalArticles,
      };

      await finishIngestionRun({
        runId,
        status: "success",
        fetchedCount: result.fetchedCount,
        dedupedCount: result.dedupedCount,
        analyzedCount: 0,
        selectedCount: selectedTotal,
        statsJson: result.stats,
      });
      return result;
    }

    const client = new DeepSeekClient();
    const articleTypes = loadArticleTypes(process.env.ARTICLE_TYPES_CONFIG || undefined);
    const evaluator = new ArticleEvaluator(client, new ArticleEvalCache(), articleTypes);

    const assessments = await evaluator.evaluateArticles(evaluationPool);
    result.evaluatedCount = Object.keys(assessments).length;

    const inputToStoredId = await upsertArticles(evaluationPool);
    await upsertArticleAnalyses({
      inputToStoredId,
      assessments,
      modelName: client.model,
      promptVersion: evaluator.promptVersion,
    });

    const scoredRows = evaluationPool
      .map((article) => {
        const assessment = assessments[article.id];
        if (!assessment) return null;
        const storedId = inputToStoredId[article.id];
        if (!storedId) return null;
        return {
          articleId: storedId,
          quality: Number(assessment.qualityScore || 0),
          confidence: Number(assessment.confidence || 0),
        };
      })
      .filter((item): item is { articleId: string; quality: number; confidence: number } => Boolean(item))
      .sort((left, right) => {
        if (right.quality !== left.quality) return right.quality - left.quality;
        return right.confidence - left.confidence;
      });

    const analyzedRows = scoredRows.map((item, index) => ({
      articleId: item.articleId,
      qualityScoreSnapshot: item.quality,
      rankScore: Number((1000000 - index * 1000 + item.quality).toFixed(4)),
    }));

    const selectedRows = scoredRows
      .filter((item) => item.quality >= qualityThreshold)
      .map((item, index) => ({
        articleId: item.articleId,
        qualityScoreSnapshot: item.quality,
        rankScore: Number((1000000 - index * 1000 + item.quality).toFixed(4)),
      }));

    if (mergeDailySnapshot) {
      await upsertDailyHighQuality(reportDate, selectedRows);
      await upsertDailyAnalyzed(reportDate, analyzedRows);
    } else {
      await replaceDailyHighQuality(reportDate, selectedRows);
      await replaceDailyAnalyzed(reportDate, analyzedRows);
    }

    const selectedTotal = await countDailyHighQuality(reportDate);
    const analyzedTotal = await countDailyAnalyzed(reportDate);
    result.selectedCount = selectedTotal;
    result.ok = true;
    result.stats = {
      source_count: sources.length,
      fetched_count: fetched.length,
      normalized_count: normalized.length,
      deduped_count: deduped.length,
      dedupe_url_duplicates: dedupeStats.urlDuplicates,
      dedupe_title_duplicates: dedupeStats.titleDuplicates,
      evaluation_pool_count: evaluationPool.length,
      evaluated_count: result.evaluatedCount,
      analyzed_count_new: analyzedRows.length,
      analyzed_count_total: analyzedTotal,
      selected_count_new: selectedRows.length,
      selected_count_total: selectedTotal,
      daily_snapshot_merge_mode: mergeDailySnapshot,
      quality_threshold: qualityThreshold,
      max_eval_articles: maxEvalArticles,
      max_per_source: perSourceMax,
      fetch_budget: fetchBudget,
    };

    await finishIngestionRun({
      runId,
      status: "success",
      fetchedCount: result.fetchedCount,
      dedupedCount: result.dedupedCount,
      analyzedCount: result.evaluatedCount,
      selectedCount: result.selectedCount,
      statsJson: result.stats,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    result.errorMessage = message;
    result.stats = {
      ...(result.stats || {}),
      error: message,
    };

    await finishIngestionRun({
      runId,
      status: "failed",
      fetchedCount: result.fetchedCount,
      dedupedCount: result.dedupedCount,
      analyzedCount: result.evaluatedCount,
      selectedCount: result.selectedCount,
      errorMessage: message,
      statsJson: result.stats,
    });

    return result;
  }
}
