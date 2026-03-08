import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { FlomoClient } from "@/lib/integrations/flomo-client";
import { flomoConfigKey, flomoPushLogKey, flomoRateKey } from "@/lib/integrations/flomo-redis-keys";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";
import { renderFlomoArchiveArticlesContent } from "@/lib/output/flomo-archive-articles-formatter";

export const runtime = "nodejs";
export const maxDuration = 60;

const DAILY_PUSH_LIMIT = 5;
const RATE_TTL_SECONDS = 2 * 24 * 3600;
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

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const tz = String(body.tz || "Asia/Shanghai").trim() || "Asia/Shanghai";
    const todayDate = currentDateInTz(tz);
    const days = Math.max(1, Math.min(7, Number(body.days || 1) || 1));
    const limit = Math.max(1, Math.min(30, Number(body.limit || 10) || 10));

    const redis = buildUpstashClient();
    const rk = flomoRateKey(auth.user.id, todayDate);

    // 1. Check config and rate limit in parallel
    const [config, currentRate] = await Promise.all([
      redis.hgetall(flomoConfigKey(auth.user.id)),
      redis.get(rk),
    ]);

    if (!config.webhook_url) {
      return jsonResponse(400, { ok: false, error: "请先配置 Flomo Webhook URL" });
    }

    const currentCount = Number(currentRate || 0);
    if (currentCount >= DAILY_PUSH_LIMIT) {
      return jsonResponse(429, {
        ok: false,
        error: `今日推送次数已达上限（${DAILY_PUSH_LIMIT} 次）`,
        daily_remaining: 0,
      });
    }

    // 2. Fetch articles
    const result = await listArchiveArticles({
      days,
      limitPerDay: limit,
      qualityTier: "high",
    });

    const allArticles = result.groups.flatMap((group) => group.items);
    if (!allArticles.length) {
      return jsonResponse(200, {
        ok: true,
        sent: false,
        article_count: 0,
        reason: "暂无可推送的文章",
        daily_remaining: DAILY_PUSH_LIMIT - currentCount,
      });
    }

    // 3. Format content (skipTracking, use original_url)
    const content = renderFlomoArchiveArticlesContent({
      reportDate: todayDate,
      articles: allArticles,
      skipTracking: true,
    });

    // 4. Send to flomo
    const newCount = currentCount + 1;
    const flomo = new FlomoClient(config.webhook_url);
    await flomo.send({
      content,
      dedupeKey: `user-push-${auth.user.id}-${todayDate}-${newCount}`,
    });

    // 5. Increment rate + log push (pipeline)
    const lk = flomoPushLogKey(auth.user.id);
    const now = Date.now();
    await redis.pipeline([
      ["INCR", rk],
      ["EXPIRE", rk, RATE_TTL_SECONDS],
      ["ZADD", lk, String(now), `${todayDate}:${allArticles.length}:${now}`],
      ["EXPIRE", lk, LOG_TTL_SECONDS],
    ]);

    return jsonResponse(200, {
      ok: true,
      sent: true,
      article_count: allArticles.length,
      daily_remaining: DAILY_PUSH_LIMIT - newCount,
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
