const DEFAULT_TTL_SECONDS = 120 * 24 * 3600;

type Command = Array<string | number>;

export class UpstashClient {
  private readonly restUrl: string;
  private readonly restToken: string;

  constructor(restUrl: string, restToken: string) {
    this.restUrl = restUrl.replace(/\/+$/, "");
    this.restToken = restToken;
  }

  private async call(path: string, body?: unknown): Promise<any> {
    const response = await fetch(`${this.restUrl}${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        Authorization: `Bearer ${this.restToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Upstash error ${response.status}: ${text}`);
    }
    return response.json();
  }

  async hincrby(key: string, field: string, increment = 1): Promise<void> {
    await this.call(`/hincrby/${encodeURIComponent(key)}/${encodeURIComponent(field)}/${increment}`);
  }

  async expire(key: string, ttlSeconds: number = DEFAULT_TTL_SECONDS): Promise<void> {
    await this.call(`/expire/${encodeURIComponent(key)}/${ttlSeconds}`);
  }

  async pipeline(commands: Command[]): Promise<any[]> {
    if (!commands.length) {
      return [];
    }
    const result = await this.call("/pipeline", commands);
    if (!Array.isArray(result)) {
      throw new Error("Upstash pipeline result must be an array");
    }
    return result;
  }
}

