import { fetchArticleSummary } from "@/lib/integrations/article-db-client";
import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(
  _request: Request,
  context: { params: Promise<{ article_id: string }> },
): Promise<Response> {
  const params = await context.params;
  const articleId = String(params.article_id || "").trim();
  if (!articleId) {
    return NextResponse.json({ ok: false, error: "Missing article_id" }, { status: 400 });
  }

  try {
    const result = await fetchArticleSummary(articleId);
    return NextResponse.json(result, {
      status: 200,
      headers: { "Cache-Control": "no-store, max-age=0" },
    });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
