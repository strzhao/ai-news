import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { heartsKey } from "@/lib/integrations/hearts-redis-keys";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const redis = buildUpstashClient();
    const ids = await redis.zrevrange(heartsKey(auth.user.id), 0, -1);
    return jsonResponse(200, { ok: true, ids });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
