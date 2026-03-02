import { runIngestionWithResult } from "@/lib/article-db/ingestion-runner";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];
type TriggerType = "cron" | "manual";

function queryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function boolFlag(raw: string): boolean {
  return ["1", "true", "yes", "on"].includes(String(raw || "").trim().toLowerCase());
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

function detectTriggerType(request: Request): TriggerType {
  const vercelCron = String(request.headers.get("x-vercel-cron") || "").trim();
  if (vercelCron) {
    return "cron";
  }
  const userAgent = String(request.headers.get("user-agent") || "").trim().toLowerCase();
  if (userAgent.includes("vercel-cron")) {
    return "cron";
  }
  return "manual";
}

function jitterDelayMs(request: Request, url: URL): { triggerType: TriggerType; delayMs: number } {
  const triggerType = detectTriggerType(request);
  if (triggerType !== "cron") {
    return { triggerType, delayMs: 0 };
  }
  if (boolFlag(queryValue(url, "skip_jitter"))) {
    return { triggerType, delayMs: 0 };
  }
  const jitterMaxSeconds = boundedInt(String(process.env.INGESTION_CRON_JITTER_MAX_SECONDS || "120"), 120, 0, 180);
  if (jitterMaxSeconds <= 0) {
    return { triggerType, delayMs: 0 };
  }
  const delayMs = Math.floor(Math.random() * (jitterMaxSeconds * 1000 + 1));
  return { triggerType, delayMs };
}

async function sleepMs(delayMs: number): Promise<void> {
  if (delayMs <= 0) return;
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }
  const jitter = jitterDelayMs(request, url);
  await sleepMs(jitter.delayMs);

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
        trigger_type: jitter.triggerType,
        jitter_delay_ms: jitter.delayMs,
        stats: runResult.stats,
        error: runResult.errorMessage,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
