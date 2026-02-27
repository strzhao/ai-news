import type { VercelRequest, VercelResponse } from "@vercel/node";

import { keyToIsoDate, lastNDateKeys } from "../../lib/date.js";
import { resolveRedisRestToken, resolveRedisRestUrl } from "../../lib/redis-env.js";
import { UpstashClient } from "../../lib/upstash.js";

function unauthorized(res: VercelResponse): void {
  res.status(401).json({ error: "Unauthorized" });
}

function parseBearerToken(headerValue: string | string[] | undefined): string {
  const raw = Array.isArray(headerValue) ? String(headerValue[0] || "") : String(headerValue || "");
  if (!raw) {
    return "";
  }
  const [scheme, token] = raw.split(" ");
  if ((scheme || "").toLowerCase() !== "bearer") {
    return "";
  }
  return (token || "").trim();
}

function parseHashResult(raw: unknown): Record<string, number> {
  if (!raw) {
    return {};
  }
  if (Array.isArray(raw)) {
    const result: Record<string, number> = {};
    for (let i = 0; i + 1 < raw.length; i += 2) {
      const key = String(raw[i] || "").trim();
      const value = Number(raw[i + 1] || 0);
      if (key && Number.isFinite(value) && value > 0) {
        result[key] = Math.floor(value);
      }
    }
    return result;
  }
  if (typeof raw === "object") {
    const result: Record<string, number> = {};
    for (const [key, value] of Object.entries(raw)) {
      const numeric = Number(value || 0);
      if (Number.isFinite(numeric) && numeric > 0) {
        result[key] = Math.floor(numeric);
      }
    }
    return result;
  }
  return {};
}

function buildUpstashClient(): UpstashClient {
  const url = resolveRedisRestUrl();
  const token = resolveRedisRestToken();
  if (!url || !token) {
    throw new Error("Missing Upstash credentials");
  }
  return new UpstashClient(url, token);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const expectedToken = (process.env.TRACKER_API_TOKEN || "").trim();
  const providedToken = parseBearerToken(req.headers.authorization);
  if (!expectedToken || providedToken !== expectedToken) {
    unauthorized(res);
    return;
  }

  const rawDays = Number(req.query.days || 90);
  const days = Number.isFinite(rawDays) ? Math.max(1, Math.min(rawDays, 120)) : 90;
  let upstash: UpstashClient;
  try {
    upstash = buildUpstashClient();
  } catch (error) {
    res.status(500).json({ error: String(error) });
    return;
  }

  const dateKeys = lastNDateKeys(days);
  const commands = dateKeys.map((dateKey) => ["HGETALL", `clicks:type:${dateKey}`]);
  try {
    const responses = await upstash.pipeline(commands);
    const rows: Array<{ date: string; primary_type: string; clicks: number }> = [];

    responses.forEach((item, index) => {
      const payload =
        item && typeof item === "object" && "result" in (item as Record<string, unknown>)
          ? (item as Record<string, unknown>).result
          : item;
      const clicksByType = parseHashResult(payload);
      const date = keyToIsoDate(dateKeys[index]);
      for (const [primaryType, clicks] of Object.entries(clicksByType)) {
        rows.push({
          date,
          primary_type: primaryType,
          clicks,
        });
      }
    });

    rows.sort((a, b) => {
      if (a.date === b.date) {
        return a.primary_type.localeCompare(b.primary_type);
      }
      return a.date.localeCompare(b.date);
    });

    res.status(200).json({
      days,
      generated_at: new Date().toISOString(),
      rows,
    });
  } catch (error) {
    res.status(500).json({ error: String(error) });
  }
}
