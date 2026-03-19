import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { keyToIsoDate, lastNDateKeys } from "@/lib/domain/tracker-common";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient, parseHashResult } from "@/lib/infra/upstash";

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
    const days = Math.max(
      1,
      Math.min(120, Number(url.searchParams.get("days") || 30) || 30),
    );

    const redis = buildUpstashClient();
    const dateKeys = lastNDateKeys(days);
    const userId = auth.user.id;

    const commands = dateKeys.map((dk) => [
      "HGETALL",
      `clicks:user:${userId}:${dk}`,
    ]);
    const results = await redis.pipeline(commands);

    let totalClicks = 0;
    const daily: Array<{ date: string; clicks: number }> = [];

    for (let i = 0; i < dateKeys.length; i++) {
      const raw = results[i];
      const parsed = parseHashResult(
        raw && typeof raw === "object" && "result" in raw
          ? (raw as { result: unknown }).result
          : raw,
      );
      const clicks = parsed.total || 0;
      totalClicks += clicks;
      daily.push({ date: keyToIsoDate(dateKeys[i]), clicks });
    }

    return jsonResponse(200, {
      ok: true,
      total_clicks: totalClicks,
      days,
      daily,
    });
  } catch (error) {
    return jsonResponse(500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
