import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const preferredRegion = ["hkg1", "sin1"];

function boundedInt(raw: string | null, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function boundedIntAllowZero(raw: string | null, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(parsed, max));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  const days = boundedInt(url.searchParams.get("days"), Number.parseInt(process.env.ARCHIVE_DEFAULT_DAYS || "30", 10) || 30, 1, 180);
  const limitPerDay = boundedInt(
    url.searchParams.get("limit_per_day"),
    Number.parseInt(process.env.ARCHIVE_DEFAULT_LIMIT_PER_DAY || "10", 10) || 10,
    1,
    50,
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

  try {
    const result = await listArchiveArticles({
      days,
      limitPerDay,
      articleLimitPerDay,
      imageProbeLimit,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        days,
        limit_per_day: limitPerDay,
        article_limit_per_day: articleLimitPerDay,
        image_probe_limit: imageProbeLimit,
        total_articles: result.totalArticles,
        groups: result.groups,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
