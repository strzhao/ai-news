import { LRUCache } from "lru-cache";
import { normalizeUrl } from "@/lib/domain/tracker-common";

const DEFAULT_TIMEOUT_MS = 3_000;
const DEFAULT_MAX_HTML_BYTES = 512_000;
const POSITIVE_TTL_MS = 24 * 3600 * 1000;
const NEGATIVE_TTL_MS = 3600 * 1000;
const NO_IMAGE_SENTINEL = "__NO_IMAGE__";

const imageCache = new LRUCache<string, string>({
  max: 2_000,
  ttl: POSITIVE_TTL_MS,
});

export interface ResolveFirstImageOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
  fetchImpl?: typeof fetch;
}

function normalizedCacheKey(rawUrl: string): string {
  const candidate = String(rawUrl || "").trim();
  if (!candidate) return "";
  const normalized = normalizeUrl(candidate);
  return String(normalized || candidate).trim();
}

function parseTagAttributes(rawTag: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const attrRe = /([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g;
  let match: RegExpExecArray | null = null;
  while ((match = attrRe.exec(rawTag)) !== null) {
    attributes[match[1].toLowerCase()] = String(match[3] || "").trim();
  }
  return attributes;
}

function absolutizeUrl(raw: string, baseUrl: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  try {
    const resolved = new URL(value, baseUrl);
    if (!["http:", "https:"].includes(resolved.protocol)) {
      return "";
    }
    return resolved.toString();
  } catch {
    return "";
  }
}

export function extractFirstImageUrlFromHtml(html: string, pageUrl: string): string {
  const source = String(html || "");
  const base = String(pageUrl || "").trim();
  if (!source || !base) {
    return "";
  }

  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  const metaTags: Array<Record<string, string>> = [];
  while ((match = metaRe.exec(source)) !== null) {
    metaTags.push(parseTagAttributes(match[0]));
  }

  const ogImage = metaTags.find((tag) => tag.property?.toLowerCase() === "og:image")?.content || "";
  const ogResolved = absolutizeUrl(ogImage, base);
  if (ogResolved) {
    return ogResolved;
  }

  const twitterImage = metaTags.find((tag) => tag.name?.toLowerCase() === "twitter:image")?.content || "";
  const twitterResolved = absolutizeUrl(twitterImage, base);
  if (twitterResolved) {
    return twitterResolved;
  }

  const imgRe = /<img\b[^>]*>/gi;
  while ((match = imgRe.exec(source)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const resolved = absolutizeUrl(attrs.src || "", base);
    if (resolved) {
      return resolved;
    }
  }

  return "";
}

export function clearArticleImageCache(): void {
  imageCache.clear();
}

export async function resolveFirstImageUrl(rawUrl: string, options: ResolveFirstImageOptions = {}): Promise<string> {
  const pageUrl = normalizedCacheKey(rawUrl);
  if (!pageUrl) {
    return "";
  }

  if (imageCache.has(pageUrl)) {
    const cached = String(imageCache.get(pageUrl) || "");
    return cached === NO_IMAGE_SENTINEL ? "" : cached;
  }

  const timeoutMs = Math.max(300, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));
  const maxHtmlBytes = Math.max(1_024, Number(options.maxHtmlBytes || DEFAULT_MAX_HTML_BYTES));
  const fetchImpl = options.fetchImpl || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(pageUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      imageCache.set(pageUrl, NO_IMAGE_SENTINEL, { ttl: NEGATIVE_TTL_MS });
      return "";
    }

    const contentType = String(response.headers.get("content-type") || "").toLowerCase();
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      imageCache.set(pageUrl, NO_IMAGE_SENTINEL, { ttl: NEGATIVE_TTL_MS });
      return "";
    }

    const rawHtml = await response.text();
    const html = rawHtml.length > maxHtmlBytes ? rawHtml.slice(0, maxHtmlBytes) : rawHtml;
    const resolvedBase = String(response.url || pageUrl).trim() || pageUrl;
    const firstImage = extractFirstImageUrlFromHtml(html, resolvedBase);

    if (firstImage) {
      imageCache.set(pageUrl, firstImage, { ttl: POSITIVE_TTL_MS });
      return firstImage;
    }

    imageCache.set(pageUrl, NO_IMAGE_SENTINEL, { ttl: NEGATIVE_TTL_MS });
    return "";
  } catch {
    imageCache.set(pageUrl, NO_IMAGE_SENTINEL, { ttl: NEGATIVE_TTL_MS });
    return "";
  } finally {
    clearTimeout(timer);
  }
}
