import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { listHighQualityByDate } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function targetDate(timezoneName: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(new Date());
  return `${year}-${month}-${day}`;
}

function normalizedDate(raw: string, tzName: string): string {
  const value = String(raw || "").trim() || targetDate(tzName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Invalid date");
  }
  return value;
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeQualityTier(raw: string): "high" | "general" | "all" {
  const value = String(raw || "").trim().toLowerCase();
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  if (["all", "any"].includes(value)) return "all";
  return "high";
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const tzName = String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const url = new URL(request.url);

  try {
    const date = normalizedDate(String(url.searchParams.get("date") || ""), tzName);
    const limit = boundedInt(String(url.searchParams.get("limit") || "50"), 50, 1, 200);
    const offset = boundedInt(String(url.searchParams.get("offset") || "0"), 0, 0, 10000);
    const tagGroup = String(url.searchParams.get("tag_group") || "").trim();
    const tag = String(url.searchParams.get("tag") || "").trim();
    const qualityTier = normalizeQualityTier(String(url.searchParams.get("quality_tier") || ""));

    const result = await listHighQualityByDate({
      date,
      limit,
      offset,
      tagGroup: tagGroup || undefined,
      tag: tag || undefined,
      qualityTier,
    });
    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        date,
        limit,
        offset,
        tag_group: tagGroup || "",
        tag: tag || "",
        quality_tier: qualityTier,
        total: result.total,
        items: result.items,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
