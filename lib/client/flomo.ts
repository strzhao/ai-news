import type { FlomoConfig, FlomoPushLogEntry, FlomoPushStats } from "./types";

export async function fetchFlomoData(): Promise<{
  config: FlomoConfig | null;
  pushStats: FlomoPushStats;
}> {
  const [configRes, logRes] = await Promise.all([
    fetch("/api/v1/flomo/config", { credentials: "include", cache: "no-store" }),
    fetch("/api/v1/flomo/push-log?limit=20", { credentials: "include", cache: "no-store" }),
  ]);

  let config: FlomoConfig | null = null;
  let pushStats: FlomoPushStats = { total: 0, recent: [] };

  if (configRes.ok) {
    const payload = (await configRes.json()) as { ok: boolean; config: FlomoConfig | null };
    if (payload.ok) config = payload.config;
  }
  if (logRes.ok) {
    const payload = (await logRes.json()) as { ok: boolean; total_pushes: number; recent: FlomoPushLogEntry[] };
    if (payload.ok) pushStats = { total: payload.total_pushes, recent: payload.recent || [] };
  }

  return { config, pushStats };
}

export async function saveFlomoWebhook(
  webhookUrl: string,
): Promise<{ ok: boolean; config?: FlomoConfig; error?: string }> {
  const res = await fetch("/api/v1/flomo/config", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ webhook_url: webhookUrl.trim() }),
  });
  const payload = (await res.json()) as { ok: boolean; config?: FlomoConfig; error?: string };
  if (!res.ok || !payload.ok) {
    return { ok: false, error: payload.error || "保存失败" };
  }
  return { ok: true, config: payload.config };
}

export async function triggerFlomoPush(opts?: {
  days?: number;
  limit?: number;
}): Promise<{
  ok: boolean;
  sent?: boolean;
  article_count?: number;
  daily_remaining?: number;
  error?: string;
}> {
  const res = await fetch("/api/v1/flomo/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ days: opts?.days ?? 1, limit: opts?.limit ?? 10 }),
  });
  return (await res.json()) as {
    ok: boolean;
    sent?: boolean;
    article_count?: number;
    daily_remaining?: number;
    error?: string;
  };
}
