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
  failStaleIngestionRuns,
  finishIngestionRun,
  loadFeedbackAdjustmentMap,
  pruneDailyHighQualityByCurrentScore,
  removeDailyHighQualityByArticleIds,
  replaceDailyAnalyzed,
  replaceDailyHighQuality,
  touchIngestionRun,
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

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function boundedFloat(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseFloat(String(raw || fallback));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeBucketKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

async function withTimeout<T>(label: string, timeoutMs: number, task: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });
  try {
    return await Promise.race([task, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  const perSourceMax = boundedInt(String(process.env.ARTICLE_DB_MAX_PER_SOURCE || "25"), 25, 1, 60);
  const fetchBudget = boundedInt(String(process.env.SOURCE_FETCH_BUDGET || "0"), 0, 0, 2000);
  const maxEvalArticlesConfig = boundedInt(String(process.env.MAX_EVAL_ARTICLES || "120"), 120, 1, 200);
  const fetchTimeoutSeconds = boundedFloat(String(process.env.RSS_FETCH_TIMEOUT_SECONDS || "12"), 12, 2, 30);
  const fetchConcurrency = boundedInt(String(process.env.RSS_FETCH_CONCURRENCY || "6"), 6, 1, 12);
  const mergeDailySnapshot = isEnabled("INGESTION_DAILY_MERGE_MODE", "true");
  const staleRunSeconds = boundedInt(String(process.env.INGESTION_RUN_STALE_SECONDS || "900"), 900, 120, 86_400);
  const heartbeatIntervalMs = boundedInt(String(process.env.INGESTION_HEARTBEAT_INTERVAL_MS || "15000"), 15_000, 5_000, 60_000);
  const fetchStageTimeoutMs = boundedInt(String(process.env.INGESTION_FETCH_STAGE_TIMEOUT_MS || "90000"), 90_000, 10_000, 240_000);
  const evalStageTimeoutMs = boundedInt(String(process.env.INGESTION_EVAL_STAGE_TIMEOUT_MS || "150000"), 150_000, 10_000, 260_000);
  const runHardTimeoutMs = boundedInt(String(process.env.INGESTION_RUN_TIMEOUT_MS || "270000"), 270_000, 30_000, 295_000);
  const evalPerArticleEstimateMs = boundedInt(
    String(process.env.INGESTION_EVAL_ESTIMATE_PER_ARTICLE_MS || "12000"),
    12_000,
    1_000,
    30_000,
  );
  const feedbackAdjustEnabled = isEnabled("INGESTION_FEEDBACK_ADJUST_ENABLED", "true");
  const feedbackLookbackDays = boundedInt(String(process.env.FEEDBACK_LOOKBACK_DAYS || "120"), 120, 1, 365);
  const feedbackArticleWeight = boundedFloat(String(process.env.FEEDBACK_ARTICLE_WEIGHT || "6"), 6, 0, 20);
  const feedbackSourceWeight = boundedFloat(String(process.env.FEEDBACK_SOURCE_WEIGHT || "3"), 3, 0, 20);
  const feedbackTypeWeight = boundedFloat(String(process.env.FEEDBACK_TYPE_WEIGHT || "2"), 2, 0, 20);
  const feedbackArticleMinSamples = boundedInt(String(process.env.FEEDBACK_ARTICLE_MIN_SAMPLES || "3"), 3, 1, 1000);
  const feedbackSourceMinSamples = boundedInt(String(process.env.FEEDBACK_SOURCE_MIN_SAMPLES || "6"), 6, 1, 1000);
  const feedbackTypeMinSamples = boundedInt(String(process.env.FEEDBACK_TYPE_MIN_SAMPLES || "8"), 8, 1, 1000);
  const feedbackArticleMaxAbs = boundedFloat(String(process.env.FEEDBACK_ARTICLE_MAX_ABS || "10"), 10, 0, 30);
  const feedbackSourceMaxAbs = boundedFloat(String(process.env.FEEDBACK_SOURCE_MAX_ABS || "6"), 6, 0, 30);
  const feedbackTypeMaxAbs = boundedFloat(String(process.env.FEEDBACK_TYPE_MAX_ABS || "5"), 5, 0, 30);
  const feedbackMaxPerArticle = boundedFloat(
    String(process.env.FEEDBACK_MAX_TOTAL_ADJUST_PER_ARTICLE || "12"),
    12,
    0,
    30,
  );
  const evalBudgetCap = Math.max(1, Math.floor(evalStageTimeoutMs / evalPerArticleEstimateMs));
  const maxEvalArticles = Math.max(1, Math.min(maxEvalArticlesConfig, evalBudgetCap));

  await failStaleIngestionRuns({
    runDate: reportDate,
    staleSeconds: staleRunSeconds,
  });

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

  const heartbeatTimer = setInterval(() => {
    void touchIngestionRun(runId).catch(() => {
      // ignore heartbeat errors; final state is still written by finishIngestionRun
    });
  }, heartbeatIntervalMs);

  try {
    await withTimeout(
      "ingestion_run",
      runHardTimeoutMs,
      (async () => {
        const sources = loadSources(options.sourcesConfig || undefined);
        await upsertSources(sources);

        const fetched = await withTimeout(
          "rss_fetch_stage",
          fetchStageTimeoutMs,
          fetchArticles(sources, {
            timeoutSeconds: fetchTimeoutSeconds,
            concurrency: fetchConcurrency,
            totalTimeoutSeconds: Math.max(1, fetchStageTimeoutMs / 1000),
            maxPerSource: perSourceMax,
            totalBudget: fetchBudget,
          }),
        );
        result.fetchedCount = fetched.length;

        const normalized = normalizeArticles(fetched);
        const [deduped, dedupeStats] = dedupeArticles(normalized, 0.93, true) as [Article[], DedupeStats];
        const ranked = sortedByPublishedAtDesc(deduped);
        const evaluationPool = ranked.slice(0, maxEvalArticles);
        result.dedupedCount = evaluationPool.length;

        if (!evaluationPool.length) {
          let prunedByCurrentScore = 0;
          if (mergeDailySnapshot) {
            prunedByCurrentScore = await pruneDailyHighQualityByCurrentScore(reportDate, qualityThreshold);
          }
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
            selected_count_pruned_by_current_score: prunedByCurrentScore,
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
          return;
        }

        const client = new DeepSeekClient();
        const articleTypes = loadArticleTypes(process.env.ARTICLE_TYPES_CONFIG || undefined);
        const evaluator = new ArticleEvaluator(client, new ArticleEvalCache(), articleTypes);

        const assessments = await evaluator.evaluateArticles(evaluationPool, {
          maxWallTimeMs: evalStageTimeoutMs,
        });
        result.evaluatedCount = Object.keys(assessments).length;

        const inputToStoredId = await upsertArticles(evaluationPool);
        await upsertArticleAnalyses({
          inputToStoredId,
          assessments,
          modelName: client.model,
          promptVersion: evaluator.promptVersion,
        });

        const feedbackAdjustment = feedbackAdjustEnabled
          ? await loadFeedbackAdjustmentMap({
              lookbackDays: feedbackLookbackDays,
              articleWeight: feedbackArticleWeight,
              sourceWeight: feedbackSourceWeight,
              typeWeight: feedbackTypeWeight,
              articleMinSamples: feedbackArticleMinSamples,
              sourceMinSamples: feedbackSourceMinSamples,
              typeMinSamples: feedbackTypeMinSamples,
              articleMaxAbs: feedbackArticleMaxAbs,
              sourceMaxAbs: feedbackSourceMaxAbs,
              typeMaxAbs: feedbackTypeMaxAbs,
            })
          : {
              lookback_days: feedbackLookbackDays,
              sample_count: 0,
              article_bias: {},
              source_bias: {},
              type_bias: {},
            };

        const scoredRows = evaluationPool
          .map((article) => {
            const assessment = assessments[article.id];
            if (!assessment) return null;
            const storedId = inputToStoredId[article.id];
            if (!storedId) return null;
            const baseQuality = Number(assessment.qualityScore || 0);
            const typeKey = normalizeBucketKey(String(assessment.primaryType || "other")) || "other";
            const articleBias = Number(feedbackAdjustment.article_bias[storedId] || 0);
            const sourceBias = Number(feedbackAdjustment.source_bias[String(article.sourceId || "").trim()] || 0);
            const typeBias = Number(feedbackAdjustment.type_bias[typeKey] || 0);
            const totalBiasRaw = articleBias + sourceBias + typeBias;
            const totalBias = Math.max(-feedbackMaxPerArticle, Math.min(feedbackMaxPerArticle, totalBiasRaw));
            const adjustedQuality = Math.max(0, Math.min(100, Number((baseQuality + totalBias).toFixed(4))));
            return {
              articleId: storedId,
              quality: adjustedQuality,
              confidence: Number(assessment.confidence || 0),
              baseQuality,
              feedbackAdjustment: Number(totalBias.toFixed(4)),
              feedbackArticleBias: Number(articleBias.toFixed(4)),
              feedbackSourceBias: Number(sourceBias.toFixed(4)),
              feedbackTypeBias: Number(typeBias.toFixed(4)),
            };
          })
          .filter(
            (
              item,
            ): item is {
              articleId: string;
              quality: number;
              confidence: number;
              baseQuality: number;
              feedbackAdjustment: number;
              feedbackArticleBias: number;
              feedbackSourceBias: number;
              feedbackTypeBias: number;
            } => Boolean(item),
          )
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

        const adjustedRows = scoredRows.filter((item) => item.feedbackAdjustment !== 0);
        const feedbackAdjustmentTotal = adjustedRows.reduce((sum, item) => sum + item.feedbackAdjustment, 0);
        const feedbackAdjustmentPositive = adjustedRows.filter((item) => item.feedbackAdjustment > 0).length;
        const feedbackAdjustmentNegative = adjustedRows.filter((item) => item.feedbackAdjustment < 0).length;

        let demotedCount = 0;
        let prunedByCurrentScore = 0;
        if (mergeDailySnapshot) {
          await upsertDailyHighQuality(reportDate, selectedRows);
          await upsertDailyAnalyzed(reportDate, analyzedRows);
          const selectedIdSet = new Set(selectedRows.map((item) => item.articleId));
          const demotedArticleIds = analyzedRows
            .map((item) => item.articleId)
            .filter((articleId) => !selectedIdSet.has(articleId));
          demotedCount = await removeDailyHighQualityByArticleIds(reportDate, demotedArticleIds);
          prunedByCurrentScore = await pruneDailyHighQualityByCurrentScore(reportDate, qualityThreshold);
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
          selected_count_demoted: demotedCount,
          selected_count_pruned_by_current_score: prunedByCurrentScore,
          daily_snapshot_merge_mode: mergeDailySnapshot,
          quality_threshold: qualityThreshold,
          max_eval_articles: maxEvalArticles,
          max_per_source: perSourceMax,
          fetch_budget: fetchBudget,
          fetch_timeout_seconds: fetchTimeoutSeconds,
          fetch_concurrency: fetchConcurrency,
          fetch_stage_timeout_ms: fetchStageTimeoutMs,
          eval_stage_timeout_ms: evalStageTimeoutMs,
          run_timeout_ms: runHardTimeoutMs,
          feedback_adjust_enabled: feedbackAdjustEnabled,
          feedback_lookback_days: feedbackAdjustment.lookback_days,
          feedback_sample_count: feedbackAdjustment.sample_count,
          feedback_article_bias_keys: Object.keys(feedbackAdjustment.article_bias).length,
          feedback_source_bias_keys: Object.keys(feedbackAdjustment.source_bias).length,
          feedback_type_bias_keys: Object.keys(feedbackAdjustment.type_bias).length,
          feedback_adjusted_article_count: adjustedRows.length,
          feedback_adjustment_total: Number(feedbackAdjustmentTotal.toFixed(4)),
          feedback_adjustment_avg: adjustedRows.length ? Number((feedbackAdjustmentTotal / adjustedRows.length).toFixed(4)) : 0,
          feedback_adjustment_positive_count: feedbackAdjustmentPositive,
          feedback_adjustment_negative_count: feedbackAdjustmentNegative,
          feedback_adjustment_max_per_article: feedbackMaxPerArticle,
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
      })(),
    );

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
  } finally {
    clearInterval(heartbeatTimer);
    await touchIngestionRun(runId).catch(() => {
      // ignore cleanup heartbeat errors
    });
  }
}
