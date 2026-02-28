import { getArchiveItem } from "@/lib/domain/archive-store";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const digestId = String(url.searchParams.get("id") || "").trim();
  if (!digestId) {
    return jsonResponse(400, { ok: false, error: "Missing id" }, true);
  }

  try {
    const item = await getArchiveItem(digestId);
    if (!item) {
      return jsonResponse(404, { ok: false, error: "Not found" }, true);
    }
    return jsonResponse(200, { ok: true, generated_at: new Date().toISOString(), item }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
