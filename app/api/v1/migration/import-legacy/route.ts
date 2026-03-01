import { runLegacyImport } from "@/lib/article-db/legacy-import";
import { isTruthy, jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function queryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

function isAuthorized(request: Request, url: URL): boolean {
  const token = String(process.env.CRON_SECRET || "").trim();
  if (!token) {
    return false;
  }

  const authHeader = String(request.headers.get("authorization") || "").trim();
  if (authHeader === `Bearer ${token}`) {
    return true;
  }
  return queryValue(url, "token") === token;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }

  try {
    const result = await runLegacyImport({
      days: Number.parseInt(queryValue(url, "days"), 10) || undefined,
      limitPerDay: Number.parseInt(queryValue(url, "limit_per_day"), 10) || undefined,
      articleLimitPerDay: Number.parseInt(queryValue(url, "article_limit_per_day"), 10) || undefined,
      overwrite: isTruthy(queryValue(url, "overwrite")),
      qualityScore: Number.parseFloat(queryValue(url, "quality_score")) || undefined,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        days: result.days,
        limit_per_day: result.limitPerDay,
        article_limit_per_day: result.articleLimitPerDay,
        overwrite: result.overwrite,
        quality_score: result.qualityScore,
        imported_dates: result.importedDates,
        imported_articles: result.importedArticles,
        imported_sources: result.importedSources,
        message: result.message,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
