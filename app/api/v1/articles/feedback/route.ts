import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { recordArticleQualityFeedback } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

interface FeedbackBody {
  article_id?: string;
  feedback?: string;
  source?: string;
  context?: Record<string, unknown>;
}

async function parseBody(request: Request): Promise<FeedbackBody> {
  try {
    const payload = (await request.json()) as FeedbackBody;
    if (!payload || typeof payload !== "object") return {};
    return payload;
  } catch {
    return {};
  }
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(401, { ok: false, error: unauthorized }, true);
  }

  try {
    const body = await parseBody(request);
    const articleId = String(body.article_id || "").trim();
    const feedback = String(body.feedback || "").trim().toLowerCase();

    if (!articleId) {
      return jsonResponse(400, { ok: false, error: "Missing article_id" }, true);
    }
    if (!["good", "bad"].includes(feedback)) {
      return jsonResponse(400, { ok: false, error: "Invalid feedback, expected good|bad" }, true);
    }

    const event = await recordArticleQualityFeedback({
      articleId,
      feedback,
      source: String(body.source || "api").trim() || "api",
      contextJson: body.context && typeof body.context === "object" ? body.context : {},
    });

    if (!event) {
      return jsonResponse(404, { ok: false, error: "Article not found or not analyzed" }, true);
    }

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        event,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
