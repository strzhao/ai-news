import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { DeepSeekClient } from "@/lib/llm/deepseek-client";
import { EditorialGenerator } from "@/lib/llm/editorial";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const preferredRegion = ["sin1"];

const ARCHIVE_TZ = "Asia/Shanghai";

function currentDateInTz(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ARCHIVE_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  // Only support today's editorial; ignore arbitrary date params to avoid stale misses
  const date = currentDateInTz();
  // Allow cache busting via ?force=1
  const forceRefresh = url.searchParams.get("force") === "1";

  try {
    const redis = buildUpstashClientOrNone();

    let deepseekClient: DeepSeekClient;
    try {
      deepseekClient = new DeepSeekClient({ timeoutSeconds: 60 });
    } catch {
      return jsonResponse(200, { ok: true, editorial: null, reason: "llm_not_configured" }, true);
    }

    const generator = new EditorialGenerator(deepseekClient, redis, { forceRefresh });

    // Fetch today's articles
    let articles: Awaited<ReturnType<typeof listArchiveArticles>>["groups"][number]["items"] = [];
    try {
      const archiveResult = await listArchiveArticles({ days: 1, limitPerDay: 30, qualityTier: "high" });
      const todayGroup = archiveResult.groups.find((g) => g.date === date);
      articles = todayGroup?.items || [];
    } catch (err) {
      console.error("[daily_editorial] Archive fetch error:", err instanceof Error ? err.message : String(err));
      return jsonResponse(200, { ok: false, editorial: null, reason: "archive_fetch_failed" }, true);
    }

    if (!articles.length) {
      return jsonResponse(200, { ok: true, editorial: null, reason: "no_articles" }, true);
    }

    const briefs = articles.map((a) => ({
      title: a.title,
      summary: a.summary,
      source_host: a.source_host,
      tag_groups: a.tag_groups || {},
    }));

    const editorial = await generator.getDailyEditorial(date, briefs);

    return jsonResponse(200, { ok: true, editorial }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[daily_editorial] Generation error:", message);
    return jsonResponse(200, { ok: false, editorial: null, reason: "generation_failed" }, true);
  }
}
