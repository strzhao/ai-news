import { FlomoPayload } from "@/lib/output/flomo-formatter";

export class FlomoSyncError extends Error {}

export class FlomoClient {
  private readonly apiUrl: string;

  private readonly timeoutMs: number;

  private readonly maxRetries: number;

  constructor(apiUrl = process.env.FLOMO_API_URL || "", timeoutSeconds = 20, maxRetries = 3) {
    this.apiUrl = String(apiUrl || "").trim();
    this.timeoutMs = Math.max(1_000, Math.trunc(timeoutSeconds * 1_000));
    this.maxRetries = Math.max(1, Math.trunc(maxRetries));
    if (!this.apiUrl) {
      throw new FlomoSyncError("Missing FLOMO_API_URL");
    }
  }

  async send(payload: FlomoPayload): Promise<void> {
    let backoffMs = 1_000;
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const response = await fetch(this.apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ content: payload.content }),
          signal: controller.signal,
        });

        if ([408, 429, 500, 502, 503, 504].includes(response.status)) {
          const text = await response.text();
          throw new FlomoSyncError(`temporary error (${response.status}): ${text}`);
        }
        if (!response.ok) {
          const text = await response.text();
          throw new FlomoSyncError(`Flomo request failed (${response.status}): ${text}`);
        }
        return;
      } catch (error) {
        lastError = error;
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          backoffMs *= 2;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    throw new FlomoSyncError(`Flomo sync failed after retries: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }
}
