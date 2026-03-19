import { normalizeUrl } from "@/lib/domain/tracker-common";

const DEFAULT_TIMEOUT_MS = 8_000;
const DEFAULT_MAX_HTML_BYTES = 1_500_000;
const DEFAULT_MAX_TEXT_CHARS = 120_000;
const DEFAULT_MAX_IMAGES = 24;

export interface ArticleImageResource {
  url: string;
  alt: string;
}

export interface FetchArticleContentOptions {
  timeoutMs?: number;
  maxHtmlBytes?: number;
  maxTextChars?: number;
  maxImages?: number;
  fetchImpl?: typeof fetch;
}

export interface ArticleContentPayload {
  sourceUrl: string;
  resolvedUrl: string;
  html: string;
  text: string;
  images: ArticleImageResource[];
}

function normalizeWhitespace(value: string): string {
  return String(value || "")
    .replace(/\u00a0/g, " ")
    .replace(/\r/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

function decodeHtmlEntities(value: string): string {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, digits: string) => {
      const code = Number.parseInt(digits, 10);
      if (!Number.isFinite(code) || code <= 0) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex: string) => {
      const code = Number.parseInt(hex, 16);
      if (!Number.isFinite(code) || code <= 0) return "";
      try {
        return String.fromCodePoint(code);
      } catch {
        return "";
      }
    });
}

function extractBlockByTag(html: string, tagName: string): string {
  const re = new RegExp(`<${tagName}\\b[^>]*>[\\s\\S]*?<\\/${tagName}>`, "gi");
  let best = "";
  let match: RegExpExecArray | null = null;
  while ((match = re.exec(html)) !== null) {
    const block = String(match[0] || "");
    if (block.length > best.length) {
      best = block;
    }
  }
  return best;
}

function removeNoiseTags(html: string): string {
  return String(html || "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<template\b[^>]*>[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<canvas\b[^>]*>[\s\S]*?<\/canvas>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");
}

function selectContentHtml(rawHtml: string): string {
  const source = removeNoiseTags(rawHtml);
  const article = extractBlockByTag(source, "article");
  if (article) return article;
  const main = extractBlockByTag(source, "main");
  if (main) return main;
  const body = extractBlockByTag(source, "body");
  if (body) return body;
  return source;
}

function htmlToText(html: string, maxChars: number): string {
  const withBreaks = String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(
      /<\/\s*(p|div|article|section|li|h[1-6]|blockquote|pre|tr|td)\s*>/gi,
      "\n",
    );
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = decodeHtmlEntities(stripped);
  const normalized = normalizeWhitespace(decoded);
  if (normalized.length <= maxChars) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxChars - 1)).trimEnd()}…`;
}

function parseTagAttributes(rawTag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const source = String(rawTag || "");
  const quotedRe = /([a-zA-Z_:.-]+)\s*=\s*(["'])(.*?)\2/g;
  const plainRe = /([a-zA-Z_:.-]+)\s*=\s*([^\s"'=<>`]+)/g;
  let match: RegExpExecArray | null = null;

  while ((match = quotedRe.exec(source)) !== null) {
    attrs[String(match[1] || "").toLowerCase()] = String(match[3] || "").trim();
  }
  while ((match = plainRe.exec(source)) !== null) {
    const key = String(match[1] || "").toLowerCase();
    if (!key || key in attrs) continue;
    attrs[key] = String(match[2] || "").trim();
  }
  return attrs;
}

function normalizeImageUrl(raw: string, baseUrl: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("data:")) return "";
  if (value.startsWith("javascript:")) return "";
  if (value.startsWith("about:")) return "";
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

function normalizeImageCandidate(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (!value.includes(",")) return value;
  const firstPart = value.split(",")[0] || "";
  const firstToken = firstPart.trim().split(/\s+/)[0] || "";
  return firstToken.trim();
}

function collectMetaImages(
  html: string,
  baseUrl: string,
  maxImages: number,
): ArticleImageResource[] {
  const result: ArticleImageResource[] = [];
  const metaRe = /<meta\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = metaRe.exec(html)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const property = String(attrs.property || attrs.name || "").toLowerCase();
    if (
      !["og:image", "twitter:image", "twitter:image:src"].includes(property)
    ) {
      continue;
    }
    const imageUrl = normalizeImageUrl(attrs.content || "", baseUrl);
    if (!imageUrl) continue;
    result.push({ url: imageUrl, alt: "" });
    if (result.length >= maxImages) {
      break;
    }
  }
  return result;
}

export function extractRelatedImagesFromHtml(
  html: string,
  contentHtml: string,
  pageUrl: string,
  maxImages = DEFAULT_MAX_IMAGES,
): ArticleImageResource[] {
  const limit = Math.max(1, Math.min(200, Math.trunc(maxImages)));
  const normalizedPageUrl = String(pageUrl || "").trim();
  if (!normalizedPageUrl) return [];

  const merged: ArticleImageResource[] = [];
  const seen = new Set<string>();

  function pushImage(url: string, alt: string): void {
    const normalized = String(url || "").trim();
    if (!normalized || seen.has(normalized)) return;
    seen.add(normalized);
    merged.push({
      url: normalized,
      alt: normalizeWhitespace(decodeHtmlEntities(String(alt || ""))),
    });
  }

  collectMetaImages(html, normalizedPageUrl, limit).forEach((item) => {
    pushImage(item.url, item.alt);
  });

  const imgRe = /<img\b[^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = imgRe.exec(contentHtml)) !== null) {
    const attrs = parseTagAttributes(match[0]);
    const rawSource =
      normalizeImageCandidate(attrs.src || "") ||
      normalizeImageCandidate(attrs["data-src"] || "") ||
      normalizeImageCandidate(attrs["data-original"] || "") ||
      normalizeImageCandidate(attrs.srcset || "") ||
      normalizeImageCandidate(attrs["data-srcset"] || "");
    const imageUrl = normalizeImageUrl(rawSource, normalizedPageUrl);
    if (!imageUrl) continue;
    pushImage(imageUrl, attrs.alt || "");
    if (merged.length >= limit) {
      break;
    }
  }

  return merged.slice(0, limit);
}

export async function fetchArticleContent(
  rawUrl: string,
  options: FetchArticleContentOptions = {},
): Promise<ArticleContentPayload> {
  const sourceUrl = String(rawUrl || "").trim();
  if (!sourceUrl) {
    throw new Error("Missing url");
  }

  const normalizedUrl = normalizeUrl(sourceUrl);
  if (!normalizedUrl) {
    throw new Error("Invalid url");
  }

  const timeoutMs = Math.max(
    300,
    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS),
  );
  const maxHtmlBytes = Math.max(
    2_048,
    Number(options.maxHtmlBytes || DEFAULT_MAX_HTML_BYTES),
  );
  const maxTextChars = Math.max(
    1_000,
    Number(options.maxTextChars || DEFAULT_MAX_TEXT_CHARS),
  );
  const maxImages = Math.max(
    1,
    Math.min(200, Math.trunc(options.maxImages || DEFAULT_MAX_IMAGES)),
  );
  const fetchImpl = options.fetchImpl || fetch;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(normalizedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "text/html,application/xhtml+xml",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status}`);
    }

    const contentType = String(
      response.headers.get("content-type") || "",
    ).toLowerCase();
    if (
      contentType &&
      !contentType.includes("text/html") &&
      !contentType.includes("application/xhtml+xml")
    ) {
      throw new Error(`Unsupported content-type: ${contentType}`);
    }

    const responseUrl =
      String(response.url || normalizedUrl).trim() || normalizedUrl;
    const rawHtml = await response.text();
    const html =
      rawHtml.length > maxHtmlBytes ? rawHtml.slice(0, maxHtmlBytes) : rawHtml;
    const contentHtml = selectContentHtml(html);

    let text = htmlToText(contentHtml, maxTextChars);
    if (text.length < 120) {
      const fallbackText = htmlToText(html, maxTextChars);
      if (fallbackText.length > text.length) {
        text = fallbackText;
      }
    }

    const images = extractRelatedImagesFromHtml(
      html,
      contentHtml,
      responseUrl,
      maxImages,
    );
    return {
      sourceUrl,
      resolvedUrl: responseUrl,
      html: contentHtml,
      text,
      images,
    };
  } finally {
    clearTimeout(timer);
  }
}
