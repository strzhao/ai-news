import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { heartsKey, heartsMetaKey } from "@/lib/integrations/hearts-redis-keys";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";

export const runtime = "nodejs";

const META_TTL_SECONDS = 365 * 24 * 3600;
const PAGE_SIZE_DEFAULT = 20;
const PAGE_SIZE_MAX = 100;

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const articleId = String(body.article_id || "").trim();
    if (!articleId) {
      return jsonResponse(400, { ok: false, error: "article_id is required" });
    }

    const redis = buildUpstashClient();
    const key = heartsKey(auth.user.id);
    const existing = await redis.zscore(key, articleId);

    if (existing !== null) {
      await redis.zrem(key, articleId);
      return jsonResponse(200, { ok: true, hearted: false });
    }

    await redis.zadd(key, Date.now(), articleId);

    const title = String(body.title || "").trim();
    const url = String(body.url || "").trim();
    const originalUrl = String(body.original_url || "").trim();
    const sourceHost = String(body.source_host || "").trim();
    const imageUrl = String(body.image_url || "").trim();
    const summary = String(body.summary || "").trim();

    if (title || url) {
      const metaKey = heartsMetaKey(articleId);
      await redis.hset(metaKey, {
        title,
        url,
        original_url: originalUrl,
        source_host: sourceHost,
        image_url: imageUrl,
        summary,
        saved_at: new Date().toISOString(),
      });
      await redis.expire(metaKey, META_TTL_SECONDS);
    }

    return jsonResponse(200, { ok: true, hearted: true });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const url = new URL(request.url);
    const page = Math.max(0, Number.parseInt(url.searchParams.get("page") || "0", 10) || 0);
    const size = Math.max(1, Math.min(PAGE_SIZE_MAX, Number.parseInt(url.searchParams.get("size") || String(PAGE_SIZE_DEFAULT), 10) || PAGE_SIZE_DEFAULT));

    const redis = buildUpstashClient();
    const key = heartsKey(auth.user.id);
    const total = await redis.zcard(key);
    const start = page * size;
    const stop = start + size - 1;

    if (start >= total) {
      return jsonResponse(200, { ok: true, items: [], total, page, size });
    }

    const entries = await redis.zrevrangeWithScores(key, start, stop);

    const metas = await Promise.all(
      entries.map((entry) => redis.hgetall(heartsMetaKey(entry.member))),
    );

    const items = entries.map((entry, i) => {
      const meta = metas[i];
      return {
        article_id: entry.member,
        hearted_at: entry.score,
        title: meta.title || "",
        url: meta.url || "",
        original_url: meta.original_url || "",
        source_host: meta.source_host || "",
        image_url: meta.image_url || "",
        summary: meta.summary || "",
      };
    });

    return jsonResponse(200, { ok: true, items, total, page, size });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
