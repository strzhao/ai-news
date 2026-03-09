import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { fetchJson } from "@/lib/infra/http";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

function articleDbBaseUrl(): string {
  return String(process.env.ARTICLE_DB_BASE_URL || "").trim().replace(/\/$/, "");
}

function articleDbAuthHeaders(): HeadersInit {
  const token = String(process.env.ARTICLE_DB_API_TOKEN || "").trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

/** GET: List all extraction tasks for the current user. */
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
    const result = await fetchJson(
      `${base}/api/v1/extract-url?user_id=${encodeURIComponent(auth.user.id)}`,
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
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
