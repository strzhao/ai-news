function firstNonEmpty(...values: Array<string | undefined>): string {
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized) {
      return normalized;
    }
  }
  return "";
}

export function resolveRedisRestUrl(): string {
  return firstNonEmpty(process.env.UPSTASH_REDIS_REST_URL, process.env.KV_REST_API_URL);
}

export function resolveRedisRestToken(): string {
  return firstNonEmpty(process.env.UPSTASH_REDIS_REST_TOKEN, process.env.KV_REST_API_TOKEN);
}

