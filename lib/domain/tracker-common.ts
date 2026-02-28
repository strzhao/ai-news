import crypto from "node:crypto";
import { URL } from "node:url";
import { buildUpstashClient, buildUpstashClientOrNone, parseHashResult as parseHashRaw } from "@/lib/infra/upstash";

export const DEFAULT_TTL_SECONDS = 120 * 24 * 3600;

const TRACKING_PREFIXES = ["utm_", "spm", "fbclid", "gclid", "ref"];
const BOT_UA_TOKENS = [
  "bot",
  "spider",
  "crawler",
  "preview",
  "slackbot",
  "discordbot",
  "telegrambot",
  "facebookexternalhit",
  "curl",
];

export function queryValue(rawUrl: string, key: string): string {
  try {
    const parsed = new URL(rawUrl, "https://internal.local");
    return String(parsed.searchParams.get(key) || "").trim();
  } catch {
    return "";
  }
}

export function parseBearerToken(headerValue: string | null): string {
  const raw = String(headerValue || "").trim();
  if (!raw) return "";
  const parts = raw.split(" ", 2);
  if (parts.length !== 2) return "";
  const [scheme, token] = parts;
  if (scheme.trim().toLowerCase() !== "bearer") return "";
  return token.trim();
}

export function shouldSkipTracking(method: string | null, userAgent: string | null): boolean {
  if (String(method || "").toUpperCase() === "HEAD") {
    return true;
  }
  const ua = String(userAgent || "").toLowerCase();
  if (!ua) return false;
  return BOT_UA_TOKENS.some((token) => ua.includes(token));
}

export function utcDateKey(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

export function keyToIsoDate(dateKey: string): string {
  return `${dateKey.slice(0, 4)}-${dateKey.slice(4, 6)}-${dateKey.slice(6, 8)}`;
}

export function lastNDateKeys(days: number): string[] {
  const count = Math.max(1, Math.min(Math.trunc(days), 120));
  const now = new Date();
  const keys: string[] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(now.getTime() - offset * 86_400_000);
    keys.push(utcDateKey(date));
  }
  return keys;
}

export function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(raw);
    const entries: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) return;
      entries.push([key, value]);
    });
    entries.sort(([a], [b]) => a.localeCompare(b));
    const query = new URLSearchParams(entries);
    const pathname = parsed.pathname.replace(/\/$/, "") || "/";
    const normalized = new URL(parsed.toString());
    normalized.protocol = parsed.protocol.toLowerCase();
    normalized.hostname = parsed.hostname.toLowerCase();
    normalized.pathname = pathname;
    normalized.search = query.toString();
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return raw;
  }
}

export function canonicalQuery(params: Record<string, string>): string {
  return Object.entries(params)
    .filter(([, value]) => String(value).trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");
}

export function signParams(params: Record<string, string>, secret: string): string {
  const payload = canonicalQuery(params);
  return crypto.createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifySignature(params: Record<string, string>, providedSig: string, secret: string): boolean {
  const normalized = String(providedSig || "").trim();
  if (normalized.length !== 64) {
    return false;
  }
  const expected = signParams(params, secret);
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(normalized));
  } catch {
    return false;
  }
}

export function hashInfoKey(url: string): string {
  return crypto.createHash("sha256").update(url).digest("hex").slice(0, 24);
}

export { buildUpstashClient, buildUpstashClientOrNone };

export const parseHashResult = parseHashRaw;
