import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { fetchJson } from "@/lib/infra/http";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";

export const runtime = "nodejs";
export const maxDuration = 120;

const RATE_LIMIT_WINDOW_SECONDS = 60;
const RATE_LIMIT_MAX_REQUESTS = 3;

function articleDbBaseUrl(): string {
  return String(process.env.ARTICLE_DB_BASE_URL || "")
    .trim()
    .replace(/\/$/, "");
}

function articleDbAuthHeaders(): HeadersInit {
  const token = String(process.env.ARTICLE_DB_API_TOKEN || "").trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function checkRateLimit(userId: string): Promise<boolean> {
  const redis = buildUpstashClientOrNone();
  if (!redis) return true;

  const key = `ratelimit:analyze:${userId}`;
  try {
    await redis.hincrby(key, "count", 1);
    await redis.expire(key, RATE_LIMIT_WINDOW_SECONDS);
    const data = await redis.hgetall(key);
    const count = Number(data.count || 0);
    return count <= RATE_LIMIT_MAX_REQUESTS;
  } catch {
    return true;
  }
}

/** POST: Submit a new URL extraction request. */
export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(
      401,
      { ok: false, error: "unauthorized", message: "请先登录" },
      true,
    );
  }

  const base = articleDbBaseUrl();
  if (!base) {
    return jsonResponse(
      503,
      { ok: false, error: "service_unavailable", message: "article-db 未配置" },
      true,
    );
  }

  const allowed = await checkRateLimit(auth.user.id);
  if (!allowed) {
    return jsonResponse(
      429,
      { ok: false, error: "rate_limited", message: "请求过于频繁，请稍后再试" },
      true,
    );
  }

  try {
    const body = (await request.json()) as {
      url?: string;
      ai_summary?: boolean;
    };
    const url = String(body?.url || "").trim();
    if (!url) {
      return jsonResponse(
        400,
        { ok: false, error: "missing_url", message: "请提供 URL" },
        true,
      );
    }

    const result = await fetchJson(`${base}/api/v1/extract-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...articleDbAuthHeaders(),
      },
      body: JSON.stringify({
        url,
        user_id: auth.user.id,
        ai_summary: !!body.ai_summary,
      }),
      timeoutMs: 90_000,
    });

    return jsonResponse(200, result as Record<string, unknown>, true);
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}

/** GET: Poll task status by task_id. */
export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const base = articleDbBaseUrl();
  if (!base) {
    return jsonResponse(503, { ok: false, error: "service_unavailable" }, true);
  }

  try {
    const url = new URL(request.url);
    const taskId = String(url.searchParams.get("task_id") || "").trim();
    if (!taskId) {
      return jsonResponse(400, { ok: false, error: "missing_task_id" }, true);
    }

    const result = await fetchJson(
      `${base}/api/v1/extract-url/${encodeURIComponent(taskId)}`,
      {
        method: "GET",
        headers: {
          Accept: "application/json",
          ...articleDbAuthHeaders(),
        },
        timeoutMs: 15_000,
      },
    );

    return jsonResponse(200, result as Record<string, unknown>, true);
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
