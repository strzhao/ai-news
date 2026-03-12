import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { DeepSeekClient } from "@/lib/llm/deepseek-client";
import { EditorialGenerator, type EditorialEdition } from "@/lib/llm/editorial";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 60;
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

const VALID_EDITIONS = new Set<EditorialEdition>(["morning", "noon", "evening"]);

function getYesterdayDate(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() - 1);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isCronAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return true;
  const authHeader = String(request.headers.get("authorization") || "").trim();
  if (authHeader === `Bearer ${cronSecret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === cronSecret;
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const date = currentDateInTz();
  // force=1 triggers a fresh generation (requires CRON_SECRET auth)
  const wantsForce = url.searchParams.get("force") === "1";
  const forceRefresh = wantsForce && isCronAuthorized(request);
  const editionParam = url.searchParams.get("edition") as EditorialEdition | null;
  const edition: EditorialEdition | undefined =
    editionParam && VALID_EDITIONS.has(editionParam) ? editionParam : undefined;

  try {
    const redis = buildUpstashClientOrNone();

    let deepseekClient: DeepSeekClient;
    try {
      deepseekClient = new DeepSeekClient({ timeoutSeconds: 60 });
    } catch {
      return jsonResponse(200, { ok: true, editorial: null, reason: "llm_not_configured" }, true);
    }

    const generator = new EditorialGenerator(deepseekClient, redis, { forceRefresh });

    // Morning edition: fetch today + yesterday (late-night articles)
    // Noon/Evening: today only
    type ArchiveItem = Awaited<ReturnType<typeof listArchiveArticles>>["groups"][number]["items"][number];
    let articles: ArchiveItem[] = [];
    try {
      const fetchDays = edition === "morning" ? 2 : 1;
      const archiveResult = await listArchiveArticles({ days: fetchDays, limitPerDay: 30, qualityTier: "high" });

      if (edition === "morning") {
        const todayGroup = archiveResult.groups.find((g) => g.date === date);
        const yesterdayDate = getYesterdayDate(date);
        const yesterdayGroup = archiveResult.groups.find((g) => g.date === yesterdayDate);
        // Today's articles first, then yesterday's as supplement
        articles = [...(todayGroup?.items || []), ...(yesterdayGroup?.items || [])];
      } else {
        const todayGroup = archiveResult.groups.find((g) => g.date === date);
        articles = todayGroup?.items || [];
      }
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

    const editorial = await generator.getDailyEditorial(date, briefs, edition);

    return jsonResponse(200, { ok: true, editorial }, true);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[daily_editorial] Generation error:", message);
    return jsonResponse(200, { ok: false, editorial: null, reason: "generation_failed" }, true);
  }
}
