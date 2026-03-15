import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import { WEB_PUSH_SUBSCRIBERS_KEY, webPushConfigKey } from "@/lib/integrations/web-push-redis-keys";

export const runtime = "nodejs";

const TTL_SECONDS = 120 * 24 * 3600;

/** GET: Fetch web push notification config (default: disabled). */
export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const redis = buildUpstashClientOrNone();
  if (!redis) {
    return jsonResponse(200, { ok: true, config: { enabled: false } }, true);
  }

  try {
    const raw = await redis.hgetall(webPushConfigKey(auth.user.id));
    const enabled = raw.enabled === "true";
    return jsonResponse(200, { ok: true, config: { enabled } }, true);
  } catch {
    return jsonResponse(200, { ok: true, config: { enabled: false } }, true);
  }
}

/** POST: Update web push notification enabled/disabled. */
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
    const body = (await request.json()) as { enabled?: boolean };
    const enabled = body.enabled === true;
    const configKey = webPushConfigKey(auth.user.id);
    const now = new Date().toISOString();

    const commands: Array<Array<string | number>> = [
      ["HSET", configKey, "enabled", String(enabled), "updated_at", now],
      ["EXPIRE", configKey, TTL_SECONDS],
      enabled
        ? ["SADD", WEB_PUSH_SUBSCRIBERS_KEY, auth.user.id]
        : ["SREM", WEB_PUSH_SUBSCRIBERS_KEY, auth.user.id],
    ];
    await redis.pipeline(commands);

    return jsonResponse(200, { ok: true, config: { enabled } }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
