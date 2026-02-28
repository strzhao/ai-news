import crypto from "node:crypto";
import { Article } from "@/lib/domain/models";

const TRACKING_PARAM_PREFIXES = ["utm_", "spm", "fbclid", "gclid", "ref"];
const NON_ALNUM_RE = /[^a-z0-9]+/g;

function normalizeUrl(raw: string): string {
  try {
    const parsed = new URL(String(raw || "").trim());
    const kept: Array<[string, string]> = [];
    parsed.searchParams.forEach((value, key) => {
      if (TRACKING_PARAM_PREFIXES.some((prefix) => key.toLowerCase().startsWith(prefix))) return;
      kept.push([key, value]);
    });
    const normalized = new URL(parsed.toString());
    normalized.protocol = parsed.protocol.toLowerCase();
    normalized.hostname = parsed.hostname.toLowerCase();
    normalized.pathname = parsed.pathname.replace(/\/$/, "") || "/";
    normalized.hash = "";
    normalized.search = new URLSearchParams(kept).toString();
    return normalized.toString();
  } catch {
    return "";
  }
}

export function buildTitleKey(title: string): string {
  const normalized = String(title || "").toLowerCase().replace(NON_ALNUM_RE, " ").trim();
  if (!normalized) {
    return "title:empty";
  }
  const digest = crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 16);
  return `title:${digest}`;
}

export function buildInfoKey(article: Article): string {
  const candidates = [article.infoUrl, article.url];
  for (const candidate of candidates) {
    const normalized = normalizeUrl(candidate);
    if (normalized) {
      return normalized;
    }
  }
  return buildTitleKey(article.title);
}
