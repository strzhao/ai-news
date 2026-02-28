import fs from "node:fs/promises";
import path from "node:path";
import {
  DailyDigest,
  DigestRunResult,
  ScoredArticle,
  TaggedArticle,
  WORTH_MUST_READ,
  WORTH_SKIP,
  WORTH_WORTH_READING,
} from "@/lib/domain/models";
import { buildAnalysisJson, renderAnalysisMarkdown } from "@/lib/output/analysis-writer";
import { renderDigestMarkdown } from "@/lib/output/markdown-writer";
import { buildFlomoPayload } from "@/lib/output/flomo-formatter";
import { FlomoClient, FlomoSyncError } from "@/lib/integrations/flomo-client";
import { DeepSeekClient } from "@/lib/llm/deepseek-client";
import { ArticleEvaluator } from "@/lib/llm/article-evaluator";
import { DigestSummarizer } from "@/lib/llm/summarizer";
import { ArticleEvalCache } from "@/lib/cache/article-eval-cache";
import { loadArticleTypes, loadSources } from "@/lib/config-loader";
import { fetchArticles } from "@/lib/fetch/rss-fetcher";
import { normalizeArticles } from "@/lib/process/normalize";
import { dedupeArticles } from "@/lib/process/dedupe";
import {
  buildBudgetedSourceLimits,
  buildSourceFetchLimits,
  computeSourceQualityScores,
  rankSourcesByPriority,
} from "@/lib/process/source-quality";
import { buildInfoKey } from "@/lib/process/info-cluster";
import { computeBehaviorMultipliers, selectPreferredSources } from "@/lib/personalization/behavior-weight";
import { computeTypeMultipliers } from "@/lib/personalization/type-weight";
import { loadSourceDailyClicks, loadTypeDailyClicks } from "@/lib/personalization/consumption-client";
import { LinkTracker } from "@/lib/tracking/link-tracker";

function isEnabled(name: string, defaultValue = "true"): boolean {
  const value = String(process.env[name] || defaultValue || "").trim().toLowerCase();
  return !["0", "false", "no", "off"].includes(value);
}

function expandedDiscoveryModeEnabled(): boolean {
  return isEnabled("EXPANDED_DISCOVERY_MODE", "true");
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  if (p <= 0) return sorted[0];
  if (p >= 100) return sorted[sorted.length - 1];
  const index = (sorted.length - 1) * (p / 100);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

function highlightCap(totalAssessed: number, topN: number): number {
  const defaultRatio = expandedDiscoveryModeEnabled() ? "1.0" : "0.45";
  const defaultMinimum = expandedDiscoveryModeEnabled() ? "8" : "4";
  const ratio = Math.min(1, Math.max(0.05, Number(process.env.HIGHLIGHT_SELECTION_RATIO || defaultRatio) || 1));
  const minimum = Math.max(1, Number.parseInt(String(process.env.HIGHLIGHT_MIN_COUNT || defaultMinimum), 10) || 1);
  const capped = Math.max(minimum, Math.round(totalAssessed * ratio));
  return Math.max(1, Math.min(topN, capped));
}

function shouldSyncFlomo(options: RunDigestOptions): boolean {
  if (options.noSyncFlomo) return false;
  if (options.syncFlomo) return true;
  return Boolean(process.env.FLOMO_API_URL);
}

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

function repeatLimitEnabled(options: RunDigestOptions): boolean {
  return isEnabled("REPORT_ARTICLE_REPEAT_LIMIT_ENABLED", "true") && !options.ignoreRepeatLimit;
}

function personalizedQualityScore(
  baseQuality: number,
  primaryType: string,
  typeMultipliers: Record<string, number>,
  blend: number,
): number {
  if (blend <= 0) return baseQuality;
  const multiplier = Number(typeMultipliers[primaryType] || 1);
  return baseQuality * (1 + (multiplier - 1) * blend);
}

function reorderCandidatesByTypePreference(
  candidates: Array<[number, ScoredArticle]>,
  options: {
    typeMultipliers: Record<string, number>;
    blend: number;
    qualityGapGuard: number;
  },
): [Array<[number, ScoredArticle]>, number] {
  if (!candidates.length || !Object.keys(options.typeMultipliers).length || options.blend <= 0) {
    return [candidates, 0];
  }

  const enriched = candidates.map(([index, article]) => {
    const score = personalizedQualityScore(article.score, article.primaryType, options.typeMultipliers, options.blend);
    return { index, article, score };
  });

  const ordered = [...enriched].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.article.score !== a.article.score) return b.article.score - a.article.score;
    return a.index - b.index;
  });

  const gap = Math.max(0, Number(options.qualityGapGuard) || 0);
  if (gap > 0) {
    let changed = true;
    while (changed) {
      changed = false;
      for (let idx = 1; idx < ordered.length; idx += 1) {
        const prev = ordered[idx - 1];
        const cur = ordered[idx];
        if (cur.article.score - prev.article.score > gap) {
          ordered[idx - 1] = cur;
          ordered[idx] = prev;
          changed = true;
        }
      }
    }
  }

  const before = candidates.map((item) => item[1].id);
  const after = ordered.map((item) => item.article.id);
  const reorderedCount = before.reduce((sum, articleId, index) => sum + (articleId === after[index] ? 0 : 1), 0);

  return [ordered.map((item) => [item.index, item.article]), reorderedCount];
}

function summarizeMultipliers(values: Record<string, number>, topN = 5): Record<string, unknown> {
  const entries = Object.entries(values || {});
  if (!entries.length) {
    return {
      count: 0,
      min: 1,
      max: 1,
      avg: 1,
      top_positive: [],
    };
  }
  const numeric = entries.map(([, value]) => Number(value));
  const topPositive = [...entries]
    .sort((a, b) => Number(b[1]) - Number(a[1]))
    .slice(0, Math.max(1, topN))
    .map(([id, multiplier]) => ({ id, multiplier: Math.round(Number(multiplier) * 10_000) / 10_000 }));
  return {
    count: entries.length,
    min: Math.round(Math.min(...numeric) * 10_000) / 10_000,
    max: Math.round(Math.max(...numeric) * 10_000) / 10_000,
    avg: Math.round((numeric.reduce((sum, value) => sum + value, 0) / numeric.length) * 10_000) / 10_000,
    top_positive: topPositive,
  };
}

function sourceQualityRows(rows: any[], limit = 5, reverse = true): Array<Record<string, unknown>> {
  const sortedRows = [...rows].sort((a, b) => (reverse ? b.qualityScore - a.qualityScore : a.qualityScore - b.qualityScore));
  return sortedRows.slice(0, Math.max(1, limit)).map((item) => ({
    source_id: item.sourceId,
    quality_score: Math.round(Number(item.qualityScore || 0) * 100) / 100,
    article_count: Number(item.articleCount || 0),
    must_read_rate: Math.round(Number(item.mustReadRate || 0) * 1000) / 1000,
    avg_confidence: Math.round(Number(item.avgConfidence || 0) * 1000) / 1000,
    freshness: Math.round(Number(item.freshness || 0) * 1000) / 1000,
  }));
}

function articleBriefRow(article: any): Record<string, unknown> {
  return {
    article_id: String(article.id || ""),
    title: String(article.title || ""),
    source_id: String(article.sourceId || ""),
    url: String(article.url || ""),
    published_at: article.publishedAt ? article.publishedAt.toISOString() : "",
  };
}

async function writeOutput(content: string, reportDate: string, outputDir: string, suffix = "md"): Promise<string> {
  await fs.mkdir(outputDir, { recursive: true });
  const outputPath = path.join(outputDir, `${reportDate}.${suffix}`);
  await fs.writeFile(outputPath, content, "utf-8");
  return outputPath;
}

export interface RunDigestOptions {
  date?: string;
  tz?: string;
  topN?: number;
  outputDir?: string;
  sourcesConfig?: string;
  syncFlomo?: boolean;
  noSyncFlomo?: boolean;
  ignoreRepeatLimit?: boolean;
}

export async function runDigestWithResult(options: RunDigestOptions = {}): Promise<DigestRunResult> {
  const timezoneName = String(options.tz || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const reportDate = targetDate(options.date, timezoneName);
  const outputDir = String(options.outputDir || "reports").trim() || "reports";

  const result: DigestRunResult = {
    exitCode: 1,
    reportDate,
    timezoneName,
    outputDir,
    reportPath: "",
    reportMarkdown: "",
    topSummary: "",
    highlightCount: 0,
    hasHighlights: false,
    analysisPath: "",
    analysisMarkdown: "",
    analysisJson: {},
    stats: {},
  };

  let client: DeepSeekClient;
  try {
    client = new DeepSeekClient();
  } catch {
    result.exitCode = 2;
    return result;
  }

  let articleTypes: string[];
  try {
    articleTypes = loadArticleTypes(process.env.ARTICLE_TYPES_CONFIG || undefined);
  } catch {
    result.exitCode = 2;
    return result;
  }

  const summarizer = new DigestSummarizer(client);
  const cache = new ArticleEvalCache();
  const evaluator = new ArticleEvaluator(client, cache, articleTypes);

  const topNDefault = expandedDiscoveryModeEnabled() ? 32 : 16;
  const topN = Math.max(1, Number(options.topN || topNDefault));
  const sources = loadSources(options.sourcesConfig || undefined);

  const historicalSourceScores = await cache.loadSourceScores();

  let behaviorMultipliers: Record<string, number> = {};
  let typeMultipliers: Record<string, number> = {};
  let preferredSourceIds = new Set<string>();

  const personalizationEnabled = isEnabled("PERSONALIZATION_ENABLED", "true");
  const typePersonalizationEnabled = isEnabled("TYPE_PERSONALIZATION_ENABLED", "true");

  const lookbackDays = Math.max(1, Number.parseInt(String(process.env.PERSONALIZATION_LOOKBACK_DAYS || "90"), 10) || 90);
  const halfLifeDays = Math.max(1, Number.parseFloat(String(process.env.PERSONALIZATION_HALF_LIFE_DAYS || "21")) || 21);
  const minMultiplier = Number.parseFloat(String(process.env.PERSONALIZATION_MIN_MULTIPLIER || "0.85")) || 0.85;
  const maxMultiplier = Number.parseFloat(String(process.env.PERSONALIZATION_MAX_MULTIPLIER || "1.2")) || 1.2;

  if (personalizationEnabled) {
    try {
      const sourceDailyClicks = await loadSourceDailyClicks(lookbackDays);
      behaviorMultipliers = computeBehaviorMultipliers(sourceDailyClicks, {
        lookbackDays,
        halfLifeDays,
        minMultiplier,
        maxMultiplier,
      });
      preferredSourceIds = selectPreferredSources(sourceDailyClicks, { minClicks: 2, topQuantile: 0.3 });
    } catch {
      behaviorMultipliers = {};
    }
  }

  const typeLookbackDays = Math.max(
    1,
    Number.parseInt(String(process.env.TYPE_PERSONALIZATION_LOOKBACK_DAYS || "90"), 10) || 90,
  );
  const typeHalfLifeDays = Math.max(
    1,
    Number.parseFloat(String(process.env.TYPE_PERSONALIZATION_HALF_LIFE_DAYS || "21")) || 21,
  );
  const typeMinMultiplier = Number.parseFloat(String(process.env.TYPE_PERSONALIZATION_MIN_MULTIPLIER || "0.9")) || 0.9;
  const typeMaxMultiplier = Number.parseFloat(String(process.env.TYPE_PERSONALIZATION_MAX_MULTIPLIER || "1.15")) || 1.15;
  const typeBlend = Math.max(0, Math.min(1, Number.parseFloat(String(process.env.TYPE_PERSONALIZATION_BLEND || "0.2")) || 0.2));
  const typeQualityGapGuard = Math.max(
    0,
    Number.parseFloat(String(process.env.TYPE_PERSONALIZATION_QUALITY_GAP_GUARD || "8")) || 8,
  );

  if (typePersonalizationEnabled) {
    try {
      const typeDailyClicks = await loadTypeDailyClicks(typeLookbackDays);
      typeMultipliers = computeTypeMultipliers(typeDailyClicks, {
        lookbackDays: typeLookbackDays,
        halfLifeDays: typeHalfLifeDays,
        minMultiplier: typeMinMultiplier,
        maxMultiplier: typeMaxMultiplier,
      });
    } catch {
      typeMultipliers = {};
    }
  }

  const prioritizedSources = rankSourcesByPriority(sources, historicalSourceScores, behaviorMultipliers);
  let perSourceLimits = buildSourceFetchLimits(prioritizedSources);

  const fetchBudget = Math.max(0, Number.parseInt(String(process.env.SOURCE_FETCH_BUDGET || "60"), 10) || 60);
  const explorationRatio = Number.parseFloat(String(process.env.EXPLORATION_RATIO || "0.15")) || 0.15;

  perSourceLimits = buildBudgetedSourceLimits(
    prioritizedSources,
    perSourceLimits,
    fetchBudget,
    Math.max(1, Number.parseInt(String(process.env.MIN_FETCH_PER_SOURCE || "3"), 10) || 3),
    preferredSourceIds,
    explorationRatio,
  );

  const defaultMaxEval = expandedDiscoveryModeEnabled() ? 120 : 60;
  const maxEvalArticles = Math.max(1, Number.parseInt(String(process.env.MAX_EVAL_ARTICLES || defaultMaxEval), 10) || defaultMaxEval);

  const fetched = await fetchArticles(prioritizedSources, {
    perSourceLimits,
    totalBudget: 0,
  });

  const normalized = normalizeArticles(fetched);
  const dedupeResult = dedupeArticles(normalized, 0.93, true) as [any[], any];
  const dedupedPreCap = dedupeResult[0];
  const dedupeStats = dedupeResult[1];

  const rankedDeduped = [...dedupedPreCap].sort((a, b) => {
    const left = a.publishedAt ? a.publishedAt.getTime() : 0;
    const right = b.publishedAt ? b.publishedAt.getTime() : 0;
    return right - left;
  });

  const deduped = rankedDeduped.slice(0, maxEvalArticles);
  const evalCapSkipped = rankedDeduped.slice(maxEvalArticles);
  const analysisListLimit = Math.max(1, Math.min(Number.parseInt(String(process.env.ANALYSIS_DEDUPE_LIST_LIMIT || "300"), 10) || 300, 1000));

  if (!deduped.length) {
    result.exitCode = 3;
    result.stats = {
      source_count: sources.length,
      fetched_count: fetched.length,
      normalized_count: normalized.length,
      deduped_after_dedupe: dedupeStats.kept,
      evaluation_pool_count: 0,
      eval_cap_skipped_count: evalCapSkipped.length,
      max_eval_articles: maxEvalArticles,
    };
    return result;
  }

  const assessments = await evaluator.evaluateArticles(deduped);
  if (!Object.keys(assessments).length) {
    result.exitCode = 4;
    result.stats = {
      source_count: sources.length,
      fetched_count: fetched.length,
      normalized_count: normalized.length,
      deduped_after_dedupe: dedupeStats.kept,
      evaluation_pool_count: deduped.length,
      eval_cap_skipped_count: evalCapSkipped.length,
      evaluated_count: 0,
    };
    return result;
  }

  const sourceQualityList = computeSourceQualityScores(deduped, assessments, historicalSourceScores);
  await cache.upsertSourceScores(sourceQualityList);

  const sourceQualityMap = Object.fromEntries(sourceQualityList.map((item) => [item.sourceId, item]));

  let topSummary = "";
  let dailyTags: string[] = [];
  try {
    [topSummary, dailyTags] = await summarizer.buildOverviewContent({
      articles: deduped,
      date: reportDate,
      timezoneName,
      topN,
      assessments,
      sourceQualityScores: sourceQualityMap,
    });
  } catch {
    result.exitCode = 5;
    return result;
  }

  const taggedHighlights: TaggedArticle[] = [];
  const gateSkips: Record<string, number> = {
    missing_assessment: 0,
    worth_skip: 0,
    low_confidence: 0,
    must_read_below_threshold: 0,
    worth_reading_below_threshold: 0,
    repeat_limit_blocked: 0,
  };

  const minHighlightScore = Number.parseFloat(String(process.env.MIN_HIGHLIGHT_SCORE || "62")) || 62;
  const minWorthReadingScore = Number.parseFloat(String(process.env.MIN_WORTH_READING_SCORE || "58")) || 58;
  const minHighlightConfidence = Number.parseFloat(String(process.env.MIN_HIGHLIGHT_CONFIDENCE || "0.55")) || 0.55;
  const dynamicPercentile = Number.parseFloat(String(process.env.HIGHLIGHT_DYNAMIC_PERCENTILE || "70")) || 70;

  const scoredAssessments = Object.values(assessments)
    .filter((item) => item.worth !== WORTH_SKIP)
    .map((item) => Number(item.qualityScore));

  const dynamicThreshold = scoredAssessments.length ? percentile(scoredAssessments, dynamicPercentile) : minHighlightScore;
  const effectiveThreshold = Math.max(minHighlightScore, dynamicThreshold);
  const selectionCap = highlightCap(scoredAssessments.length, topN);

  let mustReadCandidates: Array<[number, ScoredArticle]> = [];
  let fallbackWorthReading: Array<[number, ScoredArticle]> = [];

  const limitEnabled = repeatLimitEnabled(options);
  const maxInfoDup = Math.max(1, Number.parseInt(String(process.env.MAX_INFO_DUP_PER_DIGEST || "2"), 10) || 2);
  const historicalArticleCounts = limitEnabled ? await cache.loadReportArticleCounts() : {};
  const articleKeyCounts: Record<string, number> = {};
  let repeatGuardSkips = 0;

  function reserveReportSlot(article: ScoredArticle): boolean {
    if (!limitEnabled) return true;
    const articleKey = buildInfoKey(article);
    const historicalHits = Number(historicalArticleCounts[articleKey] || 0);
    const current = Number(articleKeyCounts[articleKey] || 0);
    if (historicalHits + current >= maxInfoDup) {
      repeatGuardSkips += 1;
      gateSkips.repeat_limit_blocked += 1;
      return false;
    }
    articleKeyCounts[articleKey] = current + 1;
    return true;
  }

  deduped.forEach((article, index) => {
    const assessment = assessments[article.id];
    if (!assessment) {
      gateSkips.missing_assessment += 1;
      return;
    }
    if (assessment.worth === WORTH_SKIP) {
      gateSkips.worth_skip += 1;
      return;
    }
    if (assessment.confidence < minHighlightConfidence) {
      gateSkips.low_confidence += 1;
      return;
    }
    if (assessment.worth === WORTH_MUST_READ && assessment.qualityScore < effectiveThreshold) {
      gateSkips.must_read_below_threshold += 1;
      return;
    }
    if (assessment.worth === WORTH_WORTH_READING && assessment.qualityScore < minWorthReadingScore) {
      gateSkips.worth_reading_below_threshold += 1;
      return;
    }

    const scoredArticle: ScoredArticle = {
      ...article,
      leadParagraph: assessment.oneLineSummary,
      primaryType: assessment.primaryType,
      secondaryTypes: [...assessment.secondaryTypes],
      score: Number(assessment.qualityScore),
      worth: assessment.worth,
      reasonShort: assessment.reasonShort,
    };

    const tuple: [number, ScoredArticle] = [index, scoredArticle];
    if (assessment.worth === WORTH_MUST_READ) {
      mustReadCandidates.push(tuple);
    } else {
      fallbackWorthReading.push(tuple);
    }
  });

  let mustReadReordered = 0;
  let worthReadingReordered = 0;
  [mustReadCandidates, mustReadReordered] = reorderCandidatesByTypePreference(mustReadCandidates, {
    typeMultipliers,
    blend: typeBlend,
    qualityGapGuard: typeQualityGapGuard,
  });
  [fallbackWorthReading, worthReadingReordered] = reorderCandidatesByTypePreference(fallbackWorthReading, {
    typeMultipliers,
    blend: typeBlend,
    qualityGapGuard: typeQualityGapGuard,
  });

  let selectedFromMustRead = 0;
  for (const [, scoredArticle] of mustReadCandidates) {
    if (!reserveReportSlot(scoredArticle)) continue;
    taggedHighlights.push({ article: scoredArticle, generatedTags: [] });
    selectedFromMustRead += 1;
    if (taggedHighlights.length >= selectionCap) break;
  }

  let selectedFromWorthReading = 0;
  if (taggedHighlights.length < selectionCap) {
    for (const [, scoredArticle] of fallbackWorthReading) {
      if (!reserveReportSlot(scoredArticle)) continue;
      taggedHighlights.push({ article: scoredArticle, generatedTags: [] });
      selectedFromWorthReading += 1;
      if (taggedHighlights.length >= selectionCap) break;
    }
  }

  const digest: DailyDigest = {
    date: reportDate,
    timezone: timezoneName,
    topSummary,
    highlights: taggedHighlights,
    dailyTags,
    extras: [],
  };

  const reportArticleKeySet = new Set<string>();
  deduped.forEach((article) => {
    if (!assessments[article.id]) return;
    const articleKey = buildInfoKey(article);
    if (articleKey) {
      reportArticleKeySet.add(articleKey);
    }
  });
  await cache.recordReportArticleKeys(Array.from(reportArticleKeySet).sort());

  const tracker = LinkTracker.fromEnv();
  const markdown = renderDigestMarkdown(digest, (article) =>
    tracker.buildTrackingUrl(article, {
      digestDate: reportDate,
      channel: "markdown",
    }),
  );

  const reportPath = await writeOutput(markdown, reportDate, outputDir, "md");

  const worthCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};
  const qualityScores: number[] = [];
  const confidenceScores: number[] = [];

  Object.values(assessments).forEach((item) => {
    worthCounts[item.worth] = (worthCounts[item.worth] || 0) + 1;
    const type = item.primaryType || "other";
    typeCounts[type] = (typeCounts[type] || 0) + 1;
    qualityScores.push(Number(item.qualityScore));
    confidenceScores.push(Number(item.confidence));
  });

  const skipRate = Object.values(assessments).length ? Number(worthCounts[WORTH_SKIP] || 0) / Object.values(assessments).length : 0;

  const diagnosticFlags: string[] = [];
  if (!taggedHighlights.length) diagnosticFlags.push("无重点文章入选");
  if (skipRate >= 0.7) diagnosticFlags.push("跳过占比过高");
  if (repeatGuardSkips > 0) diagnosticFlags.push("重复限制阻塞了部分候选");
  if (dedupeStats.urlDuplicates + dedupeStats.titleDuplicates > Math.max(10, Math.trunc(normalized.length / 3))) {
    diagnosticFlags.push("去重命中偏高，信息同质化明显");
  }
  if (personalizationEnabled && !Object.keys(behaviorMultipliers).length) {
    diagnosticFlags.push("行为个性化未获得有效权重");
  }
  if (typePersonalizationEnabled && !Object.keys(typeMultipliers).length) {
    diagnosticFlags.push("类型个性化未获得有效权重");
  }

  const analysisEnabled = isEnabled("ANALYSIS_REPORT_ENABLED", "true");
  let analysisJson: Record<string, unknown> = {};
  let analysisMarkdown = "";
  let analysisPath = "";

  const analysisContext: Record<string, unknown> = {
    report_date: reportDate,
    timezone: timezoneName,
    generated_at: new Date().toISOString(),
    pipeline_overview: {
      source_count: sources.length,
      fetch_budget: fetchBudget,
      fetched_count: fetched.length,
      normalized_count: normalized.length,
      deduped_after_dedupe: dedupeStats.kept,
      evaluation_pool_count: deduped.length,
      max_eval_articles: maxEvalArticles,
      eval_cap_skipped_count: evalCapSkipped.length,
      evaluated_count: Object.keys(assessments).length,
      selected_highlights_count: taggedHighlights.length,
    },
    quality_scores: qualityScores,
    confidence_scores: confidenceScores,
    worth_counts: worthCounts,
    type_counts: typeCounts,
    selection_gates: {
      thresholds: {
        min_highlight_score: Math.round(minHighlightScore * 100) / 100,
        dynamic_percentile: Math.round(dynamicPercentile * 100) / 100,
        dynamic_threshold: Math.round(dynamicThreshold * 100) / 100,
        effective_threshold: Math.round(effectiveThreshold * 100) / 100,
        min_worth_reading_score: Math.round(minWorthReadingScore * 100) / 100,
        min_highlight_confidence: Math.round(minHighlightConfidence * 1000) / 1000,
        selection_cap: selectionCap,
      },
      gate_skips: gateSkips,
      selection_mix: {
        must_read_candidates: mustReadCandidates.length,
        worth_reading_candidates: fallbackWorthReading.length,
        selected_from_must_read: selectedFromMustRead,
        selected_from_worth_reading: selectedFromWorthReading,
        selected_total: taggedHighlights.length,
      },
    },
    dedupe_and_repeat: {
      total_input: dedupeStats.totalInput,
      kept_after_dedupe: dedupeStats.kept,
      url_duplicates: dedupeStats.urlDuplicates,
      title_duplicates: dedupeStats.titleDuplicates,
      dropped_items: dedupeStats.droppedItems.slice(0, analysisListLimit),
      dropped_items_total: dedupeStats.droppedItems.length,
      analysis_list_limit: analysisListLimit,
      eval_cap_skipped_count: evalCapSkipped.length,
      eval_cap_skipped_items: evalCapSkipped.slice(0, analysisListLimit).map((item) => articleBriefRow(item)),
      repeat_guard_enabled: limitEnabled,
      max_info_dup: maxInfoDup,
      historical_article_key_count: Object.keys(historicalArticleCounts).length,
      repeat_blocked: repeatGuardSkips,
    },
    personalization_impact: {
      behavior_summary: {
        enabled: personalizationEnabled,
        lookback_days: lookbackDays,
        half_life_days: halfLifeDays,
        preferred_source_count: preferredSourceIds.size,
        ...summarizeMultipliers(behaviorMultipliers),
      },
      type_summary: {
        enabled: typePersonalizationEnabled,
        lookback_days: typeLookbackDays,
        half_life_days: typeHalfLifeDays,
        blend: Math.round(typeBlend * 1000) / 1000,
        quality_gap_guard: Math.round(typeQualityGapGuard * 1000) / 1000,
        ...summarizeMultipliers(typeMultipliers),
      },
      reorder_impact: {
        must_read_reordered: mustReadReordered,
        worth_reading_reordered: worthReadingReordered,
      },
    },
    source_quality_snapshot: {
      top_sources: sourceQualityRows(sourceQualityList, 5, true),
      bottom_sources: sourceQualityRows(sourceQualityList, 5, false),
    },
    diagnostic_flags: diagnosticFlags,
  };

  if (analysisEnabled) {
    analysisJson = buildAnalysisJson(analysisContext);
    analysisMarkdown = renderAnalysisMarkdown(analysisJson);
    analysisPath = await writeOutput(analysisMarkdown, reportDate, outputDir, "analysis.md");
  }

  if (shouldSyncFlomo(options)) {
    const payload = buildFlomoPayload(digest, (article) =>
      tracker.buildTrackingUrl(article, {
        digestDate: reportDate,
        channel: "flomo",
      }),
    );

    try {
      const flomo = new FlomoClient();
      await flomo.send(payload);
    } catch (error) {
      if (!(error instanceof FlomoSyncError)) {
        throw error;
      }
    }
  }

  result.exitCode = 0;
  result.reportPath = reportPath;
  result.reportMarkdown = markdown;
  result.topSummary = topSummary;
  result.highlightCount = taggedHighlights.length;
  result.hasHighlights = taggedHighlights.length > 0;
  result.analysisPath = analysisPath;
  result.analysisMarkdown = analysisMarkdown;
  result.analysisJson = analysisJson;
  result.stats = analysisContext;

  return result;
}
