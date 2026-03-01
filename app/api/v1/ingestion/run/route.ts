import { runIngestionWithResult } from "@/lib/article-db/ingestion-runner";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function queryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
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
    const runResult = await runIngestionWithResult({
      date: queryValue(url, "date") || undefined,
      tz: queryValue(url, "tz") || undefined,
    });

    return jsonResponse(
      runResult.ok ? 200 : 500,
      {
        ok: runResult.ok,
        generated_at: new Date().toISOString(),
        run_id: runResult.runId,
        report_date: runResult.reportDate,
        timezone: runResult.timezone,
        fetched_count: runResult.fetchedCount,
        deduped_count: runResult.dedupedCount,
        evaluated_count: runResult.evaluatedCount,
        selected_count: runResult.selectedCount,
        quality_threshold: runResult.qualityThreshold,
        stats: runResult.stats,
        error: runResult.errorMessage,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
