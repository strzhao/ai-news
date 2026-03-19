import { listArchiveArticles } from "@/lib/domain/archive-articles";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";
import {
  WEB_PUSH_SUBSCRIBERS_KEY,
  webPushConfigKey,
  webPushSubscriptionKey,
} from "@/lib/integrations/web-push-redis-keys";
import type { PushSubscriptionData } from "@/lib/integrations/web-push-server";
import { sendPushNotification } from "@/lib/integrations/web-push-server";

export const runtime = "nodejs";
export const maxDuration = 120;

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

  try {
    const redis = buildUpstashClient();

    // 1. Get all subscriber user IDs
    const userIds = await redis.smembers(WEB_PUSH_SUBSCRIBERS_KEY);
    if (!userIds.length) {
      return jsonResponse(200, {
        ok: true,
        subscribers: 0,
        sent: 0,
        failed: 0,
        expired: 0,
      });
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
        failed: 0,
        expired: 0,
        reason: "no_articles",
      });
    }

    // 3. Batch-read all subscriptions in one pipeline
    const subResponses = await redis.pipeline(
      userIds.map((id) => ["HGETALL", webPushSubscriptionKey(id)]),
    );

    // 4. Parse subscription data
    const subscriptions = new Map<string, PushSubscriptionData>();
    for (let i = 0; i < userIds.length; i++) {
      const raw = subResponses[i];
      const data =
        raw && typeof raw === "object" && "result" in raw
          ? (raw as { result: unknown }).result
          : raw;
      if (!data || typeof data !== "object") continue;
      const rec = data as Record<string, string>;
      if (rec.endpoint && rec.p256dh && rec.auth) {
        subscriptions.set(userIds[i], {
          endpoint: rec.endpoint,
          keys: { p256dh: rec.p256dh, auth: rec.auth },
        });
      }
    }

    // 5. Send pushes concurrently
    let sent = 0;
    let failed = 0;
    let expired = 0;
    const payload = {
      title: "AI News 每日精选",
      body: `今日 ${allArticles.length} 篇精选 AI 文章已更新`,
      url: "/",
    };

    const results = await Promise.allSettled(
      userIds.map(async (userId) => {
        const subscription = subscriptions.get(userId);
        if (!subscription) {
          return { status: "no_sub" as const };
        }
        await sendPushNotification(subscription, payload);
        return { status: "sent" as const };
      }),
    );

    const cleanupCommands: Array<Array<string | number>> = [];
    for (let i = 0; i < results.length; i++) {
      const r = results[i];
      if (r.status === "fulfilled") {
        if (r.value.status === "sent") {
          sent += 1;
        } else {
          failed += 1;
        }
      } else {
        const error = r.reason;
        if (
          error &&
          typeof error === "object" &&
          "statusCode" in error &&
          (error as { statusCode: number }).statusCode === 410
        ) {
          cleanupCommands.push(
            ["SREM", WEB_PUSH_SUBSCRIBERS_KEY, userIds[i]],
            ["DEL", webPushSubscriptionKey(userIds[i])],
            [
              "HSET",
              webPushConfigKey(userIds[i]),
              "enabled",
              "false",
              "updated_at",
              new Date().toISOString(),
            ],
          );
          expired += 1;
        } else {
          failed += 1;
        }
      }
    }

    if (cleanupCommands.length) {
      await redis.pipeline(cleanupCommands);
    }

    return jsonResponse(200, {
      ok: true,
      subscribers: userIds.length,
      sent,
      failed,
      expired,
      article_count: allArticles.length,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
