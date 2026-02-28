export class DeepSeekError extends Error {}

function extractJsonPayload(raw: string): string {
  let text = String(raw || "").trim();
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  }
  return text;
}

export class DeepSeekClient {
  readonly apiKey: string;

  readonly model: string;

  readonly baseUrl: string;

  readonly timeoutMs: number;

  constructor(options: { apiKey?: string; model?: string; baseUrl?: string; timeoutSeconds?: number } = {}) {
    this.apiKey = options.apiKey || process.env.DEEPSEEK_API_KEY || "";
    this.model = options.model || process.env.DEEPSEEK_MODEL || "deepseek-chat";
    this.baseUrl = (options.baseUrl || process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/$/, "");
    this.timeoutMs = Math.max(1_000, Math.trunc((options.timeoutSeconds ?? 45) * 1_000));

    if (!this.apiKey) {
      throw new DeepSeekError("Missing DEEPSEEK_API_KEY");
    }
  }

  async chat(messages: Array<{ role: string; content: string }>, temperature = 0.2): Promise<string> {
    const url = `${this.baseUrl}/chat/completions`;
    const payload = {
      model: this.model,
      messages,
      temperature,
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        throw new DeepSeekError(`DeepSeek request failed: ${response.status} ${text}`);
      }

      let data: any;
      try {
        data = JSON.parse(text);
      } catch {
        throw new DeepSeekError(`Unexpected DeepSeek response: ${text}`);
      }

      const content = data?.choices?.[0]?.message?.content;
      if (typeof content !== "string") {
        throw new DeepSeekError(`Unexpected DeepSeek response: ${text}`);
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  async chatJson(messages: Array<{ role: string; content: string }>, temperature = 0.2): Promise<Record<string, any>> {
    const raw = await this.chat(messages, temperature);
    const cleaned = extractJsonPayload(raw);
    try {
      return JSON.parse(cleaned);
    } catch {
      throw new DeepSeekError(`Model output is not valid JSON: ${raw}`);
    }
  }
}
