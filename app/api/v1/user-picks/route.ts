import crypto from "node:crypto";
import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";
import { heartsKey, heartsMetaKey } from "@/lib/integrations/hearts-redis-keys";
import {
  userPicksKey,
  userPicksMetaKey,
} from "@/lib/integrations/user-picks-redis-keys";

export const runtime = "nodejs";

const META_TTL_SECONDS = 365 * 24 * 3600;
const MAX_PICKS = 50;

function errorResponse(error: unknown): Response {
  return jsonResponse(500, {
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
}

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, {
      ok: false,
      error: auth.error || "unauthorized",
    });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    let articleId = String(body.article_id || "").trim();
    const url = String(body.url || "").trim();

    if (!articleId) {
      if (!url) {
        return jsonResponse(400, {
          ok: false,
          error: "url or article_id is required",
        });
      }
      const hex = crypto.createHash("sha256").update(url).digest("hex");
      articleId = `pick-${hex.slice(0, 12)}`;
    }

    const title = String(body.title || url).trim();
    const originalUrl = String(body.original_url || "").trim();
    let sourceHost = String(body.source_host || "").trim();
    if (!sourceHost && url) {
      try {
        sourceHost = new URL(url).hostname;
      } catch {
        // leave empty if URL is invalid
      }
    }
    const imageUrl = String(body.image_url || "").trim();
    const summary = String(body.summary || "").trim();
    const aiSummary = String(body.ai_summary || "").trim();

    const redis = buildUpstashClient();
    const now = Date.now();
    const savedAt = new Date().toISOString();

    const picksKey = userPicksKey(auth.user.id);
    const picksMetaKey = userPicksMetaKey(articleId);
    const hKey = heartsKey(auth.user.id);
    const hMetaKey = heartsMetaKey(articleId);

    const metaFields = {
      title,
      url,
      original_url: originalUrl,
      source_host: sourceHost,
      image_url: imageUrl,
      summary,
      ai_summary: aiSummary,
      saved_at: savedAt,
    };

    // Write user_picks + hearts + TTL in parallel
    await Promise.all([
      redis.zadd(picksKey, now, articleId),
      redis.hset(picksMetaKey, metaFields),
      redis.zadd(hKey, now, articleId),
      redis.hset(hMetaKey, metaFields),
      redis.expire(picksMetaKey, META_TTL_SECONDS),
      redis.expire(hMetaKey, META_TTL_SECONDS),
    ]);

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, {
      ok: false,
      error: auth.error || "unauthorized",
    });
  }

  try {
    const redis = buildUpstashClient();
    const key = userPicksKey(auth.user.id);

    const entries = await redis.zrevrangeWithScores(key, 0, MAX_PICKS - 1);

    const metas = await Promise.all(
      entries.map((entry) => redis.hgetall(userPicksMetaKey(entry.member))),
    );

    const items = entries.map((entry, i) => {
      const meta = metas[i];
      return {
        article_id: entry.member,
        title: meta.title || "",
        url: meta.url || "",
        original_url: meta.original_url || "",
        source_host: meta.source_host || "",
        image_url: meta.image_url || "",
        summary: meta.summary || "",
        ai_summary: meta.ai_summary || "",
        saved_at: meta.saved_at || "",
      };
    });

    return jsonResponse(200, { ok: true, items });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, {
      ok: false,
      error: auth.error || "unauthorized",
    });
  }
  try {
    const body = (await request.json()) as Record<string, unknown>;
    const articleId = String(body.article_id || "").trim();
    if (!articleId) {
      return jsonResponse(400, { ok: false, error: "article_id is required" });
    }

    // Collect all optional updatable fields
    const fields: Record<string, string> = {};
    const fieldNames = [
      "ai_summary",
      "title",
      "summary",
      "image_url",
      "source_host",
      "url",
      "original_url",
    ] as const;
    for (const name of fieldNames) {
      const val = String(body[name] || "").trim();
      if (val) fields[name] = val;
    }

    if (Object.keys(fields).length === 0) {
      return jsonResponse(400, {
        ok: false,
        error: "at least one field is required",
      });
    }

    const redis = buildUpstashClient();

    // Ownership check: ensure article belongs to this user
    const score = await redis.zscore(userPicksKey(auth.user.id), articleId);
    if (score === null) {
      return jsonResponse(403, {
        ok: false,
        error: "article not found in your picks",
      });
    }

    const picksMetaK = userPicksMetaKey(articleId);
    const hMetaK = heartsMetaKey(articleId);

    await Promise.all([
      redis.hset(picksMetaK, fields),
      redis.hset(hMetaK, fields),
    ]);

    return jsonResponse(200, { ok: true });
  } catch (error) {
    return errorResponse(error);
  }
}
