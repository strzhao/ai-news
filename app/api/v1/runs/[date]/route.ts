import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { failStaleIngestionRuns, getLatestIngestionRunByDate } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

export async function GET(
  request: Request,
  context: { params: Promise<{ date: string }> },
): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const params = await context.params;
  const date = String(params.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return jsonResponse(400, { ok: false, error: "Invalid date" }, true);
  }

  try {
    const staleSeconds = Math.max(
      120,
      Math.min(86_400, Number.parseInt(String(process.env.INGESTION_RUN_STALE_SECONDS || "900"), 10) || 900),
    );
    await failStaleIngestionRuns({
      runDate: date,
      staleSeconds,
    });

    const run = await getLatestIngestionRunByDate(date);
    if (!run) {
      return jsonResponse(404, { ok: false, error: "Not found" }, true);
    }

    return jsonResponse(200, { ok: true, generated_at: new Date().toISOString(), run }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
