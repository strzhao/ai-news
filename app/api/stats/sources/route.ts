import { resolveStatsAuth } from "@/lib/auth/unified-auth";
import {
  buildUpstashClient,
  keyToIsoDate,
  lastNDateKeys,
  parseHashResult,
} from "@/lib/domain/tracker-common";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveStatsAuth(request);
  if (!auth.ok) {
    return jsonResponse(401, { ok: false, error: auth.error }, true);
  }

  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days") || "90";
  const days = Math.max(1, Math.min(Number.parseInt(rawDays, 10) || 90, 120));

  try {
    const upstash = buildUpstashClient();
    const dateKeys = lastNDateKeys(days);
    const commands = dateKeys.map(
      (dateKey) =>
        ["HGETALL", `clicks:source:${dateKey}`] as Array<string | number>,
    );
    const responses = await upstash.pipeline(commands);

    const rows: Array<Record<string, unknown>> = [];
    responses.forEach((item, index) => {
      const payload =
        item && typeof item === "object" && "result" in item
          ? (item as { result: unknown }).result
          : item;
      const clicksBySource = parseHashResult(payload);
      const date = keyToIsoDate(dateKeys[index]);
      Object.entries(clicksBySource).forEach(([sourceId, clicks]) => {
        rows.push({ date, source_id: sourceId, clicks });
      });
    });

    rows.sort((a, b) => {
      const dateCmp = String(a.date).localeCompare(String(b.date));
      if (dateCmp !== 0) return dateCmp;
      return String(a.source_id).localeCompare(String(b.source_id));
    });

    return jsonResponse(200, {
      days,
      generated_at: new Date().toISOString(),
      rows,
    });
  } catch (error) {
    return jsonResponse(500, {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
