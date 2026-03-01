import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(): Promise<Response> {
  return jsonResponse(
    410,
    {
      ok: false,
      error: "Deprecated endpoint: /api/cron_digest has been retired.",
      replacement: "/api/v1/ingestion/run",
      deprecated_since: "2026-03-01",
    },
    true,
  );
}
