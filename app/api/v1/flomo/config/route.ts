import { resolveUserFromRequest } from "@/lib/auth/cookie-auth";
import { flomoConfigKey } from "@/lib/integrations/flomo-redis-keys";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClient } from "@/lib/infra/upstash";

export const runtime = "nodejs";

const CONFIG_TTL_SECONDS = 120 * 24 * 3600;

function isValidWebhookUrl(raw: string): boolean {
  const value = String(raw || "").trim();
  if (!value) return false;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function maskWebhookUrl(url: string): string {
  const value = String(url || "").trim();
  if (value.length <= 20) return value;
  return `${value.slice(0, 20)}***`;
}

export async function GET(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const redis = buildUpstashClient();
    const data = await redis.hgetall(flomoConfigKey(auth.user.id));

    if (!data.webhook_url) {
      return jsonResponse(200, {
        ok: true,
        config: null,
      });
    }

    return jsonResponse(200, {
      ok: true,
      config: {
        webhook_url: data.webhook_url,
        webhook_url_masked: maskWebhookUrl(data.webhook_url),
        updated_at: data.updated_at || "",
        status: data.status || "active",
      },
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}

export async function POST(request: Request): Promise<Response> {
  const auth = await resolveUserFromRequest(request);
  if (!auth.ok || !auth.user) {
    return jsonResponse(401, { ok: false, error: auth.error || "unauthorized" });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const webhookUrl = String(body.webhook_url || "").trim();

    if (!isValidWebhookUrl(webhookUrl)) {
      return jsonResponse(400, { ok: false, error: "webhook_url 必须是有效的 HTTPS URL" });
    }

    const redis = buildUpstashClient();
    const key = flomoConfigKey(auth.user.id);
    await redis.hset(key, {
      webhook_url: webhookUrl,
      updated_at: new Date().toISOString(),
      status: "active",
    });
    await redis.expire(key, CONFIG_TTL_SECONDS);

    return jsonResponse(200, {
      ok: true,
      config: {
        webhook_url: webhookUrl,
        webhook_url_masked: maskWebhookUrl(webhookUrl),
        updated_at: new Date().toISOString(),
        status: "active",
      },
    });
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) });
  }
}
