import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(): Promise<Response> {
  return jsonResponse(200, {
    ok: true,
    now: new Date().toISOString(),
  });
}
