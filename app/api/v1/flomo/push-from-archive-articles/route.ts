import { listArchiveArticles } from "@/lib/domain/archive-articles";
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

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }

  try {
    const timezoneName = String(queryValue(url, "tz") || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
    const reportDate = normalizedDate(queryValue(url, "date"), dateShift(0, timezoneName));
    const days = boundedInt(queryValue(url, "days"), Number.parseInt(process.env.FLOMO_ARCHIVE_DAYS || "1", 10) || 1, 1, 30);
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

    const result = await listArchiveArticles({
      days,
      limitPerDay,
      articleLimitPerDay,
      imageProbeLimit: 0,
      qualityTier,
    });

    const targetGroup = result.groups.find((group) => group.date === reportDate) || result.groups[0] || { date: reportDate, items: [] };
    const articles = Array.isArray(targetGroup.items) ? targetGroup.items : [];

    if (!articles.length) {
      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          source_date: targetGroup.date || reportDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          article_count: 0,
          sent: false,
          reason: "No high-quality archive articles found",
        },
        true,
      );
    }

    const payload = buildFlomoArchiveArticlesPayload({
      reportDate: targetGroup.date || reportDate,
      articles,
    });

    const flomo = new FlomoClient();
    await flomo.send(payload);

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        report_date: reportDate,
        source_date: targetGroup.date || reportDate,
        timezone: timezoneName,
        quality_tier: qualityTier,
        article_count: articles.length,
        sent: true,
      },
      true,
    );
  } catch (error) {
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
