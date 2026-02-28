import { buildUpstashClient, keyToIsoDate, lastNDateKeys, parseBearerToken, parseHashResult } from "@/lib/domain/tracker-common";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const expectedToken = String(process.env.TRACKER_API_TOKEN || "").trim();
  const providedToken = parseBearerToken(request.headers.get("authorization"));
  if (!expectedToken || providedToken !== expectedToken) {
    return jsonResponse(401, { error: "Unauthorized" });
  }

  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days") || "90";
  const days = Math.max(1, Math.min(Number.parseInt(rawDays, 10) || 90, 120));

  try {
    const upstash = buildUpstashClient();
    const dateKeys = lastNDateKeys(days);
    const commands = dateKeys.map((dateKey) => ["HGETALL", `clicks:type:${dateKey}`] as Array<string | number>);
    const responses = await upstash.pipeline(commands);

    const rows: Array<Record<string, unknown>> = [];
    responses.forEach((item, index) => {
      const payload = item && typeof item === "object" && "result" in item ? (item as { result: unknown }).result : item;
      const clicksByType = parseHashResult(payload);
      const date = keyToIsoDate(dateKeys[index]);
      Object.entries(clicksByType).forEach(([primaryType, clicks]) => {
        rows.push({ date, primary_type: primaryType, clicks });
      });
    });

    rows.sort((a, b) => {
      const dateCmp = String(a.date).localeCompare(String(b.date));
      if (dateCmp !== 0) return dateCmp;
      return String(a.primary_type).localeCompare(String(b.primary_type));
    });

    return jsonResponse(200, {
      days,
      generated_at: new Date().toISOString(),
      rows,
    });
  } catch (error) {
    return jsonResponse(500, { error: error instanceof Error ? error.message : String(error) });
  }
}
