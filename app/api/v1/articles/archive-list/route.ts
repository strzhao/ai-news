import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { listArchivedArticles } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
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
  if (["high", "hq", "default"].includes(value)) return "high";
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  return "all";
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const timezoneName = String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const defaultTo = dateShift(0, timezoneName);
  const defaultFrom = dateShift(29, timezoneName);

  try {
    const url = new URL(request.url);
    const fromDate = normalizedDate(String(url.searchParams.get("from") || ""), defaultFrom);
    const toDate = normalizedDate(String(url.searchParams.get("to") || ""), defaultTo);
    const qualityTier = normalizeQualityTier(String(url.searchParams.get("quality_tier") || ""));
    const limit = boundedInt(String(url.searchParams.get("limit") || "80"), 80, 1, 200);
    const offset = boundedInt(String(url.searchParams.get("offset") || "0"), 0, 0, 20_000);
    const sourceId = String(url.searchParams.get("source_id") || "").trim();
    const primaryType = String(url.searchParams.get("primary_type") || "").trim();
    const search = String(url.searchParams.get("q") || "").trim();
    const normalizedFrom = fromDate <= toDate ? fromDate : toDate;
    const normalizedTo = fromDate <= toDate ? toDate : fromDate;

    const result = await listArchivedArticles({
      fromDate: normalizedFrom,
      toDate: normalizedTo,
      qualityTier,
      limit,
      offset,
      sourceId: sourceId || undefined,
      primaryType: primaryType || undefined,
      search: search || undefined,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        from: normalizedFrom,
        to: normalizedTo,
        quality_tier: qualityTier,
        limit,
        offset,
        source_id: sourceId,
        primary_type: primaryType,
        q: search,
        total: result.total,
        items: result.items,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
