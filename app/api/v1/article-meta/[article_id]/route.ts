import { NextResponse } from "next/server";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import { heartsMetaKey } from "@/lib/integrations/hearts-redis-keys";
import { userPicksMetaKey } from "@/lib/integrations/user-picks-redis-keys";
import { fetchArticleDetail } from "@/lib/integrations/article-db-client";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ article_id: string }> },
): Promise<Response> {
  const params = await context.params;
  const articleId = String(params.article_id || "").trim();
  if (!articleId) {
    return NextResponse.json({ ok: false, error: "Missing article_id" }, { status: 400 });
  }

  const redis = buildUpstashClientOrNone();

  try {
    // Try hearts:meta first, then user_picks:meta
    let meta: Record<string, unknown> | null = null;
    if (redis) {
      meta = await redis.hgetall(heartsMetaKey(articleId));
      if (!meta || !meta.title) {
        meta = await redis.hgetall(userPicksMetaKey(articleId));
      }
    }

    if (meta && meta.title) {
      return NextResponse.json({
        ok: true,
        article_id: articleId,
        title: meta.title || "",
        url: meta.url || "",
        original_url: meta.original_url || "",
        source_host: meta.source_host || "",
        ai_summary: meta.ai_summary || "",
      }, {
        status: 200,
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }

    // Fallback: fetch from ARTICLE_DB
    const detail = await fetchArticleDetail(articleId);
    if (detail) {
      return NextResponse.json({
        ok: true,
        article_id: articleId,
        title: detail.title,
        url: detail.url,
        original_url: detail.original_url,
        source_host: detail.source_host,
        ai_summary: detail.summary || "",
      }, {
        status: 200,
        headers: { "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" },
      });
    }

    return NextResponse.json({ ok: false, error: "Article not found" }, { status: 404 });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
