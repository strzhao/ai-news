import crypto from "node:crypto";
import { listArchiveArticles, type ArchiveArticleSummary } from "@/lib/domain/archive-articles";
import {
  createFlomoArchivePushBatch,
  getNextRetryableFlomoArchivePushBatch,
  listConsumedFlomoArchiveArticleIds,
  markFlomoArchivePushBatchFailed,
  markFlomoArchivePushBatchSent,
  releaseFlomoArchivePushLock,
  tryAcquireFlomoArchivePushLock,
} from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";
import { FlomoClient } from "@/lib/integrations/flomo-client";
import { buildFlomoArchiveArticlesPayload } from "@/lib/output/flomo-archive-articles-formatter";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];

function queryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function boundedIntAllowZero(raw: string, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(parsed, max));
}

function dateShift(daysAgo: number, timezoneName: string): string {
  const now = new Date(Date.now() - daysAgo * 86_400_000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(now);
  return `${year}-${month}-${day}`;
}

function normalizedDate(raw: string, fallback: string): string {
  const value = String(raw || "").trim() || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
}

function normalizeQualityTier(raw: string): "high" | "general" | "all" {
  const value = String(raw || "").trim().toLowerCase();
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  if (["all", "any"].includes(value)) return "all";
  return "high";
}

function isAuthorized(request: Request, url: URL): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) {
    return true;
  }
  const authHeader = String(request.headers.get("authorization") || "").trim();
  if (authHeader === `Bearer ${cronSecret}`) {
    return true;
  }
  return queryValue(url, "token") === cronSecret;
}

function buildBatchKey(sourceDate: string): string {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const hash = crypto.createHash("sha256").update(`${sourceDate}:${nonce}`).digest("hex").slice(0, 12);
  return `archive-articles-${sourceDate}-${hash}`;
}

function sortGroupsByDateDesc<T extends { date: string }>(groups: T[]): T[] {
  return [...groups].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function flattenArticleIds(groups: Array<{ items: ArchiveArticleSummary[] }>): string[] {
  const ids: string[] = [];
  groups.forEach((group) => {
    group.items.forEach((item) => {
      const articleId = String(item.article_id || "").trim();
      if (articleId) {
        ids.push(articleId);
      }
    });
  });
  return ids;
}

function filterUnconsumedArticles(articles: ArchiveArticleSummary[], consumedIds: Set<string>): ArchiveArticleSummary[] {
  return articles.filter((item) => {
    const articleId = String(item.article_id || "").trim();
    return articleId && !consumedIds.has(articleId);
  });
}

async function buildRetryPayloadFromArchives(params: {
  batchKey: string;
  sourceDate: string;
  articleIds: string[];
  archiveOptions: {
    days: number;
    limitPerDay: number;
    articleLimitPerDay: number;
    imageProbeLimit: number;
    qualityTier: "high" | "general" | "all";
  };
}): Promise<{ content: string; articleCount: number }> {
  const archive = await listArchiveArticles(params.archiveOptions);
  const byArticleId = new Map<string, ArchiveArticleSummary>();
  archive.groups.forEach((group) => {
    group.items.forEach((item) => {
      const articleId = String(item.article_id || "").trim();
      if (!articleId || byArticleId.has(articleId)) {
        return;
      }
      byArticleId.set(articleId, item);
    });
  });

  const selectedArticles: ArchiveArticleSummary[] = [];
  params.articleIds.forEach((articleId) => {
    const article = byArticleId.get(articleId);
    if (article) {
      selectedArticles.push(article);
    }
  });

  if (!selectedArticles.length) {
    return {
      content: "",
      articleCount: 0,
    };
  }

  const payload = buildFlomoArchiveArticlesPayload({
    reportDate: params.sourceDate,
    articles: selectedArticles,
    dedupeKey: params.batchKey,
  });
  return {
    content: payload.content,
    articleCount: selectedArticles.length,
  };
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }

  let lockAcquired = false;
  let batchKeyForFailure = "";

  try {
    const timezoneName = String(queryValue(url, "tz") || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
    const rawDate = queryValue(url, "date");
    const hasExplicitDate = Boolean(rawDate);
    const reportDate = normalizedDate(rawDate, dateShift(0, timezoneName));
    const days = boundedInt(queryValue(url, "days"), Number.parseInt(process.env.FLOMO_ARCHIVE_DAYS || "30", 10) || 30, 1, 30);
    const limitPerDay = boundedInt(
      queryValue(url, "limit_per_day"),
      Number.parseInt(process.env.FLOMO_ARCHIVE_LIMIT_PER_DAY || "30", 10) || 30,
      1,
      200,
    );
    const articleLimitPerDay = boundedIntAllowZero(
      queryValue(url, "article_limit_per_day"),
      Number.parseInt(process.env.FLOMO_ARCHIVE_ARTICLE_LIMIT_PER_DAY || "30", 10) || 30,
      5000,
    );
    const qualityTier = normalizeQualityTier(queryValue(url, "quality_tier") || "high");
    const archiveOptions = {
      days,
      limitPerDay,
      articleLimitPerDay,
      imageProbeLimit: 0,
      qualityTier,
    };

    lockAcquired = await tryAcquireFlomoArchivePushLock();
    if (!lockAcquired) {
      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          article_count: 0,
          sent: false,
          reason: "Another flomo push is in progress",
        },
        true,
      );
    }

    const retryBatch = await getNextRetryableFlomoArchivePushBatch();
    if (retryBatch) {
      const batchKey = String(retryBatch.batchKey || "").trim();
      if (!batchKey) {
        throw new Error("Invalid retry batch: missing batch key");
      }
      batchKeyForFailure = batchKey;

      let content = String(retryBatch.payloadContent || "");
      let articleCount = retryBatch.articleIds.length;
      if (!content.trim()) {
        const rebuilt = await buildRetryPayloadFromArchives({
          batchKey,
          sourceDate: retryBatch.sourceDate || reportDate,
          articleIds: retryBatch.articleIds,
          archiveOptions,
        });
        content = rebuilt.content;
        articleCount = rebuilt.articleCount;
      }

      if (!content.trim()) {
        return jsonResponse(
          200,
          {
            ok: true,
            generated_at: new Date().toISOString(),
            report_date: reportDate,
            source_date: retryBatch.sourceDate || reportDate,
            timezone: timezoneName,
            quality_tier: qualityTier,
            article_count: 0,
            consumed_count: 0,
            retrying_batch: true,
            batch_key: batchKey,
            sent: false,
            reason: "Retry batch payload is empty",
          },
          true,
        );
      }

      const flomo = new FlomoClient();
      await flomo.send({
        content,
        dedupeKey: batchKey,
      });
      const consumedCount = await markFlomoArchivePushBatchSent(batchKey);

      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          source_date: retryBatch.sourceDate || reportDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          article_count: articleCount,
          consumed_count: consumedCount,
          retrying_batch: true,
          batch_key: batchKey,
          sent: true,
        },
        true,
      );
    }

    const result = await listArchiveArticles(archiveOptions);
    const sortedGroups = sortGroupsByDateDesc(result.groups || []);
    const candidateGroups = hasExplicitDate ? sortedGroups.filter((group) => group.date === reportDate) : sortedGroups;
    const candidateArticleIds = flattenArticleIds(candidateGroups);
    const consumedIds = await listConsumedFlomoArchiveArticleIds(candidateArticleIds);

    const unconsumedGroups = candidateGroups
      .map((group) => ({
        ...group,
        items: filterUnconsumedArticles(Array.isArray(group.items) ? group.items : [], consumedIds),
      }))
      .filter((group) => group.items.length > 0);

    const targetGroup = unconsumedGroups[0] || { date: reportDate, items: [] };
    const sourceDate = targetGroup.date || reportDate;
    const articles = Array.isArray(targetGroup.items) ? targetGroup.items : [];

    if (!articles.length) {
      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          source_date: sourceDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          article_count: 0,
          consumed_count: 0,
          retrying_batch: false,
          sent: false,
          reason: "No unconsumed high-quality archive articles found",
        },
        true,
      );
    }

    const batchKey = buildBatchKey(sourceDate);
    const payload = buildFlomoArchiveArticlesPayload({
      reportDate: sourceDate,
      articles,
      dedupeKey: batchKey,
    });
    batchKeyForFailure = batchKey;

    await createFlomoArchivePushBatch({
      batchKey,
      sourceDate,
      articleIds: articles.map((item) => item.article_id),
      payloadContent: payload.content,
    });

    const flomo = new FlomoClient();
    await flomo.send(payload);
    const consumedCount = await markFlomoArchivePushBatchSent(batchKey);

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        report_date: reportDate,
        source_date: sourceDate,
        timezone: timezoneName,
        quality_tier: qualityTier,
        article_count: articles.length,
        consumed_count: consumedCount,
        retrying_batch: false,
        batch_key: batchKey,
        sent: true,
      },
      true,
    );
  } catch (error) {
    if (batchKeyForFailure) {
      try {
        await markFlomoArchivePushBatchFailed({
          batchKey: batchKeyForFailure,
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      } catch {
        // no-op: keep original error
      }
    }
    return jsonResponse(
      500,
      {
        ok: false,
        sent: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  } finally {
    if (lockAcquired) {
      try {
        await releaseFlomoArchivePushLock();
      } catch {
        // no-op
      }
    }
  }
}
