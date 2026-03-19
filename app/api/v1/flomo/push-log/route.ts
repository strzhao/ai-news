import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";
import { flomoPushLogKey } from "@/lib/integrations/flomo-redis-keys";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, {
      ok: false,
      error: auth.error || "unauthorized",
    });
  }

  try {
    const url = new URL(request.url);
    const limit = Math.max(
      1,
      Math.min(50, Number(url.searchParams.get("limit") || 20) || 20),
    );

    const redis = buildUpstashClient();
    const lk = flomoPushLogKey(auth.user.id);

    const [total, entries] = await Promise.all([
      redis.zcard(lk),
      redis.zrevrangeWithScores(lk, 0, limit - 1),
    ]);

    const recent = entries.map((entry) => {
      const parts = entry.member.split(":");
      return {
        date: parts[0] || "",
        article_count: Number(parts[1] || 0),
        pushed_at: new Date(entry.score).toISOString(),
      };
    });

    return jsonResponse(200, {
      ok: true,
      total_pushes: total,
      recent,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
