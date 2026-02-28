import { listArchives } from "@/lib/domain/archive-store";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const rawDays = url.searchParams.get("days") || process.env.ARCHIVE_DEFAULT_DAYS || "30";
  const rawLimit = url.searchParams.get("limit_per_day") || process.env.ARCHIVE_DEFAULT_LIMIT_PER_DAY || "10";

  const days = Math.max(1, Math.min(Number.parseInt(rawDays, 10) || 30, 180));
  const limitPerDay = Math.max(1, Math.min(Number.parseInt(rawLimit, 10) || 10, 50));

  try {
    const groups = await listArchives(days, limitPerDay);
    return jsonResponse(
      200,
      {
        ok: true,
        days,
        limit_per_day: limitPerDay,
        generated_at: new Date().toISOString(),
        groups,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
