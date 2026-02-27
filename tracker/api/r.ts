import type { VercelRequest, VercelResponse } from "@vercel/node";

import { shouldSkipTracking } from "../lib/bot.js";
import { utcDateKey } from "../lib/date.js";
import { resolveRedisRestToken, resolveRedisRestUrl } from "../lib/redis-env.js";
import { hashInfoKey, type SignedParams, verifySignature } from "../lib/signature.js";
import { UpstashClient } from "../lib/upstash.js";
import { normalizeUrl } from "../lib/url.js";

function queryValue(req: VercelRequest, key: string): string {
  const value = req.query[key];
  if (Array.isArray(value)) {
    return String(value[0] || "").trim();
  }
  return String(value || "").trim();
}

function parseSignedParams(req: VercelRequest): SignedParams {
  return {
    u: queryValue(req, "u"),
    sid: queryValue(req, "sid"),
    aid: queryValue(req, "aid"),
    d: queryValue(req, "d"),
    ch: queryValue(req, "ch"),
  };
}

function userAgentFromHeader(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return String(value[0] || "");
  }
  return String(value || "");
}

function resolveUpstashClient(): UpstashClient | null {
  const url = resolveRedisRestUrl();
  const token = resolveRedisRestToken();
  if (!url || !token) {
    return null;
  }
  return new UpstashClient(url, token);
}

async function trackClick(params: SignedParams, userAgent: string | undefined): Promise<void> {
  if (shouldSkipTracking("GET", userAgent)) {
    return;
  }
  const upstash = resolveUpstashClient();
  if (!upstash) {
    return;
  }

  const dateKey = utcDateKey();
  const sourceKey = `clicks:source:${dateKey}`;
  const articleKey = `clicks:article:${dateKey}`;
  const metaKey = `clicks:meta:${dateKey}`;
  const articleInfoKey = hashInfoKey(normalizeUrl(params.u));

  await Promise.all([
    upstash.hincrby(sourceKey, params.sid, 1),
    upstash.expire(sourceKey),
    upstash.hincrby(articleKey, articleInfoKey, 1),
    upstash.expire(articleKey),
    upstash.hincrby(metaKey, "total", 1),
    upstash.expire(metaKey),
  ]);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = (process.env.TRACKER_SIGNING_SECRET || "").trim();
  if (!secret) {
    res.status(500).json({ error: "Missing TRACKER_SIGNING_SECRET" });
    return;
  }

  const params = parseSignedParams(req);
  const signature = queryValue(req, "sig");
  if (!params.u || !params.sid || !params.aid || !params.d || !params.ch) {
    res.status(400).json({ error: "Missing required query params" });
    return;
  }

  try {
    // Validate URL early to avoid open redirect abuse.
    new URL(params.u);
  } catch {
    res.status(400).json({ error: "Invalid target URL" });
    return;
  }

  const userAgent = userAgentFromHeader(req.headers["user-agent"]);
  if (!verifySignature(params, signature, secret)) {
    const upstash = resolveUpstashClient();
    if (upstash) {
      try {
        const metaKey = `clicks:meta:${utcDateKey()}`;
        await upstash.hincrby(metaKey, "invalid_sig", 1);
        await upstash.expire(metaKey);
      } catch {
        // Ignore tracking-side errors on invalid signatures.
      }
    }
    res.status(400).json({ error: "Invalid signature" });
    return;
  }

  if (shouldSkipTracking(req.method, userAgent)) {
    res.redirect(302, params.u);
    return;
  }

  try {
    await trackClick(params, userAgent);
  } catch {
    // Tracking failures should never block redirect.
  }

  res.redirect(302, params.u);
}
