import { fetchJson } from "@/lib/infra/http";

export class ConsumptionClientError extends Error {}

export class ConsumptionClient {
  private readonly baseUrl: string;

  private readonly apiToken: string;

  private readonly timeoutMs: number;

  constructor(baseUrl = process.env.TRACKER_BASE_URL || "", apiToken = process.env.TRACKER_API_TOKEN || "", timeoutMs = 10_000) {
    this.baseUrl = String(baseUrl || "").trim().replace(/\/$/, "");
    this.apiToken = String(apiToken || "").trim();
    this.timeoutMs = timeoutMs;
  }

  enabled(): boolean {
    return Boolean(this.baseUrl && this.apiToken);
  }

  async fetchSourceDailyClicks(days = 90): Promise<Record<string, Record<string, number>>> {
    if (!this.enabled()) return {};
    const queryDays = Math.max(1, Math.min(Math.trunc(days), 120));
    const target = new URL("/api/stats/sources", this.baseUrl);
    target.searchParams.set("days", String(queryDays));

    let payload: unknown;
    try {
      payload = await fetchJson(target.toString(), {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new ConsumptionClientError(`Failed to fetch source stats: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.parseSourceDailyPayload(payload);
  }

  async fetchTypeDailyClicks(days = 90): Promise<Record<string, Record<string, number>>> {
    if (!this.enabled()) return {};
    const queryDays = Math.max(1, Math.min(Math.trunc(days), 120));
    const target = new URL("/api/stats/types", this.baseUrl);
    target.searchParams.set("days", String(queryDays));

    let payload: unknown;
    try {
      payload = await fetchJson(target.toString(), {
        headers: { Authorization: `Bearer ${this.apiToken}` },
        timeoutMs: this.timeoutMs,
      });
    } catch (error) {
      throw new ConsumptionClientError(`Failed to fetch type stats: ${error instanceof Error ? error.message : String(error)}`);
    }
    return this.parseTypeDailyPayload(payload);
  }

  private parseSourceDailyPayload(payload: unknown): Record<string, Record<string, number>> {
    if (!payload || typeof payload !== "object") {
      throw new ConsumptionClientError("Source stats payload must be an object");
    }
    const rows = (payload as Record<string, unknown>).rows;
    if (!Array.isArray(rows)) {
      throw new ConsumptionClientError("Source stats payload.rows must be a list");
    }

    const sourceDaily: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const sourceId = String((row as Record<string, unknown>).source_id || "").trim();
      const date = String((row as Record<string, unknown>).date || "").trim();
      const rawClicks = Number((row as Record<string, unknown>).clicks || 0);
      if (!sourceId || !date || !Number.isFinite(rawClicks)) continue;
      const clicks = Math.max(0, Math.trunc(rawClicks));
      if (clicks <= 0) continue;
      sourceDaily[sourceId] ||= {};
      sourceDaily[sourceId][date] = (sourceDaily[sourceId][date] || 0) + clicks;
    }
    return sourceDaily;
  }

  private parseTypeDailyPayload(payload: unknown): Record<string, Record<string, number>> {
    if (!payload || typeof payload !== "object") {
      throw new ConsumptionClientError("Type stats payload must be an object");
    }
    const rows = (payload as Record<string, unknown>).rows;
    if (!Array.isArray(rows)) {
      throw new ConsumptionClientError("Type stats payload.rows must be a list");
    }

    const typeDaily: Record<string, Record<string, number>> = {};
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const primaryType = String((row as Record<string, unknown>).primary_type || "").trim();
      const date = String((row as Record<string, unknown>).date || "").trim();
      const rawClicks = Number((row as Record<string, unknown>).clicks || 0);
      if (!primaryType || !date || !Number.isFinite(rawClicks)) continue;
      const clicks = Math.max(0, Math.trunc(rawClicks));
      if (clicks <= 0) continue;
      typeDaily[primaryType] ||= {};
      typeDaily[primaryType][date] = (typeDaily[primaryType][date] || 0) + clicks;
    }
    return typeDaily;
  }
}

export async function loadSourceDailyClicks(days = 90): Promise<Record<string, Record<string, number>>> {
  const client = new ConsumptionClient();
  if (!client.enabled()) {
    return {};
  }
  return client.fetchSourceDailyClicks(days);
}

export async function loadTypeDailyClicks(days = 90): Promise<Record<string, Record<string, number>>> {
  const client = new ConsumptionClient();
  if (!client.enabled()) {
    return {};
  }
  return client.fetchTypeDailyClicks(days);
}
