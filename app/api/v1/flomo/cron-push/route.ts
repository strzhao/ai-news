import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { FlomoClient } from "@/lib/integrations/flomo-client";
import { FLOMO_SUBSCRIBERS_KEY, flomoConfigKey, flomoPushLogKey } from "@/lib/integrations/flomo-redis-keys";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";
import { renderFlomoArchiveArticlesContent } from "@/lib/output/flomo-archive-articles-formatter";

export const runtime = "nodejs";
export const maxDuration = 120;

const LOG_TTL_SECONDS = 120 * 24 * 3600;

function currentDateInTz(tz: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(new Date());
  return `${year}-${month}-${day}`;
}

function isAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return true;
  const authHeader = String(request.headers.get("authorization") || "").trim();
  if (authHeader === `Bearer ${cronSecret}`) return true;
  const url = new URL(request.url);
  return url.searchParams.get("token") === cronSecret;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" });
  }

  const tz = "Asia/Shanghai";
  const todayDate = currentDateInTz(tz);
  const now = Date.now();

  try {
    const redis = buildUpstashClient();

    // 1. Get all subscriber user IDs
    const userIds = await redis.smembers(FLOMO_SUBSCRIBERS_KEY);
    if (!userIds.length) {
      return jsonResponse(200, { ok: true, subscribers: 0, sent: 0, skipped: 0, failed: 0 });
    }

    // 2. Fetch articles once for all users
    const result = await listArchiveArticles({
      days: 1,
      limitPerDay: 10,
      qualityTier: "high",
    });
    const allArticles = result.groups.flatMap((group) => group.items);
    if (!allArticles.length) {
      return jsonResponse(200, {
        ok: true,
        subscribers: userIds.length,
        sent: 0,
        skipped: userIds.length,
        failed: 0,
        reason: "no_articles",
      });
    }

    // 3. Push to each subscriber (content generated per-user for tracking URLs)
    let sent = 0;
    let skipped = 0;
    let failed = 0;

    for (const userId of userIds) {
      try {
        const config = await redis.hgetall(flomoConfigKey(userId));
        if (!config.webhook_url) {
          skipped += 1;
          continue;
        }

        const content = renderFlomoArchiveArticlesContent({
          reportDate: todayDate,
          articles: allArticles,
          userId,
        });

        const flomo = new FlomoClient(config.webhook_url);
        await flomo.send({
          content,
          dedupeKey: `cron-${userId}-${todayDate}-${now}`,
        });

        // Log the push
        const lk = flomoPushLogKey(userId);
        await redis.pipeline([
          ["ZADD", lk, String(now), `${todayDate}:${allArticles.length}:${now}`],
          ["EXPIRE", lk, LOG_TTL_SECONDS],
        ]);

        sent += 1;
      } catch {
        failed += 1;
      }
    }

    return jsonResponse(200, {
      ok: true,
      subscribers: userIds.length,
      sent,
      skipped,
      failed,
      article_count: allArticles.length,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
