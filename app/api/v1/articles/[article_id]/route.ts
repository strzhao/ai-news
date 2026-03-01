import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { getHighQualityArticleDetail } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

export async function GET(
  request: Request,
  context: { params: Promise<{ article_id: string }> },
): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  const params = await context.params;
  const articleId = String(params.article_id || "").trim();
  if (!articleId) {
    return jsonResponse(400, { ok: false, error: "Missing article_id" }, true);
  }

  try {
    const detail = await getHighQualityArticleDetail(articleId);
    if (!detail) {
      return jsonResponse(404, { ok: false, error: "Not found" }, true);
    }
    return jsonResponse(200, { ok: true, generated_at: new Date().toISOString(), item: detail }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
