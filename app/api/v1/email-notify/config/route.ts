import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";

export const runtime = "nodejs";

function emailConfigKey(userId: string): string {
  return `user:${userId}:email_notify`;
}

/** GET: Fetch email notification config (default: enabled). */
export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const redis = buildUpstashClientOrNone();
  if (!redis) {
    return jsonResponse(
      200,
      {
        ok: true,
        config: { enabled: true, email: auth.user.email },
      },
      true,
    );
  }

  try {
    const raw = await redis.hgetall(emailConfigKey(auth.user.id));
    const enabled = raw.enabled !== "false";
    return jsonResponse(
      200,
      {
        ok: true,
        config: { enabled, email: auth.user.email },
      },
      true,
    );
  } catch {
    return jsonResponse(
      200,
      {
        ok: true,
        config: { enabled: true, email: auth.user.email },
      },
      true,
    );
  }
}

/** POST: Update email notification enabled/disabled. */
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
    const enabled = body.enabled !== false;

    await redis.hset(emailConfigKey(auth.user.id), {
      enabled: String(enabled),
      updated_at: new Date().toISOString(),
    });
    await redis.expire(emailConfigKey(auth.user.id), 120 * 24 * 3600);

    return jsonResponse(
      200,
      {
        ok: true,
        config: { enabled, email: auth.user.email },
      },
      true,
    );
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
