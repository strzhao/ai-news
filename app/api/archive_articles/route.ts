import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

function boundedInt(
  raw: string | null,
  fallback: number,
  min: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function boundedIntAllowZero(
  raw: string | null,
  fallback: number,
  max: number,
): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(parsed, max));
}

function normalizeQualityTier(raw: string | null): "high" | "general" | "all" {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (["general", "normal", "common", "non_high"].includes(value))
    return "general";
  if (["all", "any"].includes(value)) return "all";
  return "high";
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const days = boundedInt(
    url.searchParams.get("days"),
    Number.parseInt(process.env.ARCHIVE_DEFAULT_DAYS || "30", 10) || 30,
    1,
    180,
  );
  const limitPerDay = boundedInt(
    url.searchParams.get("limit_per_day"),
    Number.parseInt(process.env.ARCHIVE_DEFAULT_LIMIT_PER_DAY || "10", 10) ||
      10,
    1,
    200,
  );
  const articleLimitPerDay = boundedIntAllowZero(
    url.searchParams.get("article_limit_per_day"),
    Number.parseInt(process.env.ARCHIVE_ARTICLE_LIMIT_PER_DAY || "0", 10) || 0,
    5000,
  );
  const imageProbeLimit = boundedInt(
    url.searchParams.get("image_probe_limit"),
    Number.parseInt(process.env.ARCHIVE_IMAGE_PROBE_LIMIT || "0", 10) || 0,
    0,
    100,
  );
  const qualityTier = normalizeQualityTier(
    url.searchParams.get("quality_tier"),
  );

  try {
    const probeLimitPerDay = Math.min(200, limitPerDay + 1);
    const rawResult = await listArchiveArticles({
      days,
      limitPerDay: probeLimitPerDay,
      articleLimitPerDay,
      imageProbeLimit,
      qualityTier,
    });
    const hasMoreByDate: Record<string, boolean> = {};
    const groups = rawResult.groups.map((group) => {
      const items = Array.isArray(group.items) ? group.items : [];
      hasMoreByDate[group.date] = items.length > limitPerDay;
      return {
        ...group,
        items: items.slice(0, limitPerDay),
      };
    });
    const totalArticles = groups.reduce(
      (sum, group) => sum + group.items.length,
      0,
    );

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        days,
        limit_per_day: limitPerDay,
        article_limit_per_day: articleLimitPerDay,
        image_probe_limit: imageProbeLimit,
        quality_tier: qualityTier,
        total_articles: totalArticles,
        has_more_by_date: hasMoreByDate,
        groups,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
