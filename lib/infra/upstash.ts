const DEFAULT_TTL_SECONDS = 120 * 24 * 3600;

function encodeSegment(value: string): string {
  return encodeURIComponent(value);
}

function toInt(value: unknown, fallback = 0): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function unwrapPipelineResult(item: unknown): unknown {
  if (item && typeof item === "object" && "result" in item) {
    return (item as { result: unknown }).result;
  }
  return item;
}

export class UpstashClient {
  constructor(
    private readonly restUrl: string,
    private readonly restToken: string,
    private readonly timeoutMs = 10_000,
  ) {}

  private async call(path: string, body?: unknown): Promise<unknown> {
    const url = `${this.restUrl}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await fetch(url, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${this.restToken}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`Upstash error ${response.status}: ${text}`);
      }
      if (!text.trim()) {
        return null;
      }
      return JSON.parse(text);
    } finally {
      clearTimeout(timer);
    }
  }

  async hincrby(key: string, field: string, increment = 1): Promise<void> {
    await this.call(`/hincrby/${encodeSegment(key)}/${encodeSegment(field)}/${toInt(increment, 1)}`);
  }

  async expire(key: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    await this.call(`/expire/${encodeSegment(key)}/${toInt(ttlSeconds, DEFAULT_TTL_SECONDS)}`);
  }

  async pipeline(commands: Array<Array<string | number>>): Promise<unknown[]> {
    if (!commands.length) {
      return [];
    }
    const payload = await this.call("/pipeline", commands);
    if (!Array.isArray(payload)) {
      throw new Error("Upstash pipeline result must be an array");
    }
    return payload;
  }

  async command(command: Array<string | number>): Promise<unknown> {
    const responses = await this.pipeline([command]);
    return unwrapPipelineResult(responses[0]);
  }

  async hset(key: string, mapping: Record<string, string | number | boolean>): Promise<number> {
    const entries = Object.entries(mapping);
    if (!entries.length) {
      return 0;
    }
    const command: Array<string | number> = ["HSET", key];
    for (const [field, value] of entries) {
      command.push(field, String(value));
    }
    const responses = await this.pipeline([command]);
    const result = unwrapPipelineResult(responses[0]);
    return toInt(result, 0);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    const responses = await this.pipeline([["HGETALL", key]]);
    const payload = unwrapPipelineResult(responses[0]);
    if (!payload) {
      return {};
    }
    if (Array.isArray(payload)) {
      const result: Record<string, string> = {};
      for (let i = 0; i < payload.length - 1; i += 2) {
        const field = String(payload[i] ?? "").trim();
        if (!field) continue;
        result[field] = String(payload[i + 1] ?? "");
      }
      return result;
    }
    if (typeof payload === "object") {
      const result: Record<string, string> = {};
      for (const [field, value] of Object.entries(payload as Record<string, unknown>)) {
        const normalized = String(field).trim();
        if (!normalized) continue;
        result[normalized] = String(value ?? "");
      }
      return result;
    }
    return {};
  }

  async zadd(key: string, score: number, member: string): Promise<number> {
    const responses = await this.pipeline([["ZADD", key, String(score), member]]);
    return toInt(unwrapPipelineResult(responses[0]), 0);
  }

  async zrevrange(key: string, start: number, stop: number): Promise<string[]> {
    const responses = await this.pipeline([["ZREVRANGE", key, Math.trunc(start), Math.trunc(stop)]]);
    const payload = unwrapPipelineResult(responses[0]);
    if (!Array.isArray(payload)) {
      return [];
    }
    return payload.map((item) => String(item)).filter((item) => item.trim());
  }
}

export function resolveRedisRestUrl(): string {
  return String(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || "").trim();
}

export function resolveRedisRestToken(): string {
  return String(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || "").trim();
}

export function buildUpstashClientOrNone(): UpstashClient | null {
  const url = resolveRedisRestUrl();
  const token = resolveRedisRestToken();
  if (!url || !token) {
    return null;
  }
  return new UpstashClient(url.replace(/\/$/, ""), token);
}

export function buildUpstashClient(): UpstashClient {
  const client = buildUpstashClientOrNone();
  if (!client) {
    throw new Error("Missing Upstash credentials");
  }
  return client;
}

export function parseHashResult(raw: unknown): Record<string, number> {
  if (!raw) {
    return {};
  }
  if (Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (let i = 0; i < raw.length - 1; i += 2) {
      const key = String(raw[i] ?? "").trim();
      const value = Number(raw[i + 1] ?? 0);
      if (!key || !Number.isFinite(value) || value <= 0) continue;
      result[key] = Math.trunc(value);
    }
    return result;
  }
  if (typeof raw === "object") {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const normalizedKey = String(key ?? "").trim();
      const n = Number(value ?? 0);
      if (!normalizedKey || !Number.isFinite(n) || n <= 0) continue;
      result[normalizedKey] = Math.trunc(n);
    }
    return result;
  }
  return {};
}
