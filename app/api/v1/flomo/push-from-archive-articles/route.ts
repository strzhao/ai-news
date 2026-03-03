import {
  fetchFlomoNextPushBatch,
  markFlomoPushBatchFailed,
  markFlomoPushBatchSent,
} from "@/lib/integrations/article-db-client";
import { jsonResponse } from "@/lib/infra/route-utils";
import { FlomoClient } from "@/lib/integrations/flomo-client";

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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }

  let batchKeyForFailure = "";

  try {
    const timezoneName = String(queryValue(url, "tz") || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
    const rawDate = queryValue(url, "date");
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

    const nextBatch = await fetchFlomoNextPushBatch({
      date: rawDate || undefined,
      tz: timezoneName,
      days,
      limitPerDay,
      articleLimitPerDay,
      qualityTier,
    });

    if (!nextBatch.hasBatch || !nextBatch.batchKey || !String(nextBatch.content || "").trim()) {
      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: nextBatch.reportDate || reportDate,
          source_date: nextBatch.sourceDate || reportDate,
          timezone: nextBatch.timezone || timezoneName,
          quality_tier: nextBatch.qualityTier || qualityTier,
          article_count: 0,
          tag_count: 0,
          consumed_count: 0,
          retrying_batch: Boolean(nextBatch.retryingBatch),
          sent: false,
          reason: nextBatch.reason || "No unconsumed high-quality archive articles found",
        },
        true,
      );
    }

    batchKeyForFailure = nextBatch.batchKey;
    const flomo = new FlomoClient();
    await flomo.send({
      content: nextBatch.content,
      dedupeKey: nextBatch.batchKey,
    });
    const sentResult = await markFlomoPushBatchSent(nextBatch.batchKey);

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        report_date: nextBatch.reportDate || reportDate,
        source_date: nextBatch.sourceDate || reportDate,
        timezone: nextBatch.timezone || timezoneName,
        quality_tier: nextBatch.qualityTier || qualityTier,
        article_count: nextBatch.articleCount,
        tag_count: nextBatch.tagCount,
        consumed_count: sentResult.consumedCount,
        retrying_batch: Boolean(nextBatch.retryingBatch),
        batch_key: nextBatch.batchKey,
        sent: true,
      },
      true,
    );
  } catch (error) {
    if (batchKeyForFailure) {
      try {
        await markFlomoPushBatchFailed(
          batchKeyForFailure,
          error instanceof Error ? error.message : String(error),
        );
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
  }
}
