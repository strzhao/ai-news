import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { buildAiEvalObservabilitySnapshot } from "@/lib/article-db/ai-observability";
import { listRecentIngestionRuns } from "@/lib/article-db/ingestion-runs";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  try {
    const url = new URL(request.url);
    const limit = boundedInt(String(url.searchParams.get("limit") || "24"), 24, 1, 168);
    const days = boundedInt(String(url.searchParams.get("days") || "3"), 3, 1, 30);
    const rows = await listRecentIngestionRuns({
      limit,
      days,
    });
    const snapshot = buildAiEvalObservabilitySnapshot(rows);

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        limit,
        days,
        summary: snapshot.summary,
        runs: snapshot.runs,
        latest_failed_samples: snapshot.latest_failed_samples,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
