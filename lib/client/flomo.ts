import type {
  FlomoClickStats,
  FlomoConfig,
  FlomoPushLogEntry,
  FlomoPushStats,
} from "./types";

export async function fetchFlomoData(): Promise<{
  config: FlomoConfig | null;
  pushStats: FlomoPushStats;
  clickStats: FlomoClickStats;
}> {
  const [configRes, logRes, clickRes] = await Promise.all([
    fetch("/api/v1/flomo/config", {
      credentials: "include",
      cache: "no-store",
    }),
    fetch("/api/v1/flomo/push-log?limit=20", {
      credentials: "include",
      cache: "no-store",
    }),
    fetch("/api/v1/flomo/click-stats?days=30", {
      credentials: "include",
      cache: "no-store",
    }),
  ]);

  let config: FlomoConfig | null = null;
  let pushStats: FlomoPushStats = { total: 0, recent: [] };
  let clickStats: FlomoClickStats = { total_clicks: 0, days: 30, daily: [] };

  if (configRes.ok) {
    const payload = (await configRes.json()) as {
      ok: boolean;
      config: FlomoConfig | null;
    };
    if (payload.ok) config = payload.config;
  }
  if (logRes.ok) {
    const payload = (await logRes.json()) as {
      ok: boolean;
      total_pushes: number;
      recent: FlomoPushLogEntry[];
    };
    if (payload.ok)
      pushStats = { total: payload.total_pushes, recent: payload.recent || [] };
  }
  if (clickRes.ok) {
    const payload = (await clickRes.json()) as {
      ok: boolean;
      total_clicks: number;
      days: number;
      daily: Array<{ date: string; clicks: number }>;
    };
    if (payload.ok)
      clickStats = {
        total_clicks: payload.total_clicks,
        days: payload.days,
        daily: payload.daily || [],
      };
  }

  return { config, pushStats, clickStats };
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
  const payload = (await res.json()) as {
    ok: boolean;
    config?: FlomoConfig;
    error?: string;
  };
  if (!res.ok || !payload.ok) {
    return { ok: false, error: payload.error || "保存失败" };
  }
  return { ok: true, config: payload.config };
}
