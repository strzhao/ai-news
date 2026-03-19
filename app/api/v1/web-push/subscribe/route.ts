import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import {
  WEB_PUSH_SUBSCRIBERS_KEY,
  webPushConfigKey,
  webPushSubscriptionKey,
} from "@/lib/integrations/web-push-redis-keys";

export const runtime = "nodejs";

const TTL_SECONDS = 120 * 24 * 3600;

/** POST: Save a push subscription. */
export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const redis = buildUpstashClientOrNone();
  if (!redis) {
    return jsonResponse(503, { ok: false, error: "redis_unavailable" }, true);
  }

  try {
    const body = (await request.json()) as {
      subscription?: {
        endpoint?: string;
        keys?: { p256dh?: string; auth?: string };
      };
    };
    const sub = body.subscription;
    if (!sub?.endpoint || !sub.keys?.p256dh || !sub.keys?.auth) {
      return jsonResponse(
        400,
        { ok: false, error: "invalid_subscription" },
        true,
      );
    }

    const subKey = webPushSubscriptionKey(auth.user.id);
    const configKey = webPushConfigKey(auth.user.id);
    const now = new Date().toISOString();

    await redis.pipeline([
      [
        "HSET",
        subKey,
        "endpoint",
        sub.endpoint,
        "p256dh",
        sub.keys.p256dh,
        "auth",
        sub.keys.auth,
        "updated_at",
        now,
      ],
      ["EXPIRE", subKey, TTL_SECONDS],
      ["HSET", configKey, "enabled", "true", "updated_at", now],
      ["EXPIRE", configKey, TTL_SECONDS],
      ["SADD", WEB_PUSH_SUBSCRIBERS_KEY, auth.user.id],
    ]);

    return jsonResponse(200, { ok: true }, true);
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}

/** DELETE: Remove a push subscription. */
export async function DELETE(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const redis = buildUpstashClientOrNone();
  if (!redis) {
    return jsonResponse(503, { ok: false, error: "redis_unavailable" }, true);
  }

  try {
    const configKey = webPushConfigKey(auth.user.id);
    const now = new Date().toISOString();

    await redis.pipeline([
      ["SREM", WEB_PUSH_SUBSCRIBERS_KEY, auth.user.id],
      ["DEL", webPushSubscriptionKey(auth.user.id)],
      ["HSET", configKey, "enabled", "false", "updated_at", now],
      ["EXPIRE", configKey, TTL_SECONDS],
    ]);

    return jsonResponse(200, { ok: true }, true);
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
