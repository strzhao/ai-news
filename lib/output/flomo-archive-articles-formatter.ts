import { buildSignedTrackingUrl } from "@/lib/tracking/signed-url";

export interface FlomoArchiveArticlesPayload {
  content: string;
  dedupeKey: string;
}

export interface FlomoArchiveArticleSummary {
  article_id: string;
  title: string;
  url: string;
  original_url: string;
  summary: string;
  image_url: string;
  source_host: string;
  tag_groups: Record<string, string[]>;
  date: string;
  digest_id: string;
  generated_at: string;
}

export interface FlomoTagDefinition {
  group_key: string;
  tag_key: string;
  display_name: string;
  description: string;
  aliases: string[];
  is_active: boolean;
  managed_by: string;
  updated_at: string;
}

function normalizeText(value: string, maxLen: number): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "";
  }
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function normalizeDate(value: string): string {
  const date = String(value || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date;
  }
  return "unknown";
}

function normalizeTagKey(value: string): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_\-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function normalizeUrl(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function normalizeHomePageUrl(raw: string): string {
  const value = String(raw || "").trim();
  if (!value) return "";

  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const parsed = new URL(candidate);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return "";
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function resolveFlomoHomePageUrl(env: NodeJS.ProcessEnv = process.env): string {
  const candidates = [
    String(env.FLOMO_H5_URL || ""),
    String(env.DIGEST_H5_URL || ""),
    String(env.TRACKER_BASE_URL || ""),
    String(env.AI_NEWS_BASE_URL || ""),
    String(env.NEXT_PUBLIC_APP_URL || ""),
    String(env.VERCEL_URL || ""),
  ];

  for (const raw of candidates) {
    const normalized = normalizeHomePageUrl(raw);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function buildCanonicalTagMap(
  activeTagDefinitions: FlomoTagDefinition[],
): Record<string, Record<string, string>> {
  const byGroup: Record<string, Record<string, string>> = {};

  (activeTagDefinitions || []).forEach((definition) => {
    const groupKey = normalizeTagKey(definition.group_key);
    const canonicalTag = normalizeTagKey(definition.tag_key);
    if (!groupKey || !canonicalTag || !definition.is_active) {
      return;
    }

    const bucket = byGroup[groupKey] || {};
    bucket[canonicalTag] = canonicalTag;
    (definition.aliases || []).forEach((alias) => {
      const normalizedAlias = normalizeTagKey(alias);
      if (normalizedAlias) {
        bucket[normalizedAlias] = canonicalTag;
      }
    });
    byGroup[groupKey] = bucket;
  });

  return byGroup;
}

function collectFlomoTags(params: {
  articles: FlomoArchiveArticleSummary[];
  activeTagDefinitions?: FlomoTagDefinition[];
  tagLimit?: number;
}): string[] {
  const articles = Array.isArray(params.articles) ? params.articles : [];
  const tagLimit = Math.max(1, Math.min(Number(params.tagLimit || 20), 200));
  const canonicalByGroup = buildCanonicalTagMap(params.activeTagDefinitions || []);
  const countByTag = new Map<string, number>();

  articles.forEach((article) => {
    const tagGroups = article.tag_groups && typeof article.tag_groups === "object" ? article.tag_groups : {};
    Object.entries(tagGroups)
      .sort(([left], [right]) => String(left).localeCompare(String(right)))
      .forEach(([groupKey, tags]) => {
        const normalizedGroupKey = normalizeTagKey(groupKey);
        if (!normalizedGroupKey || !Array.isArray(tags)) return;
        const canonicalMap = canonicalByGroup[normalizedGroupKey] || {};

        tags.forEach((rawTag) => {
          const normalizedTag = normalizeTagKey(String(rawTag || ""));
          if (!normalizedTag) return;
          const canonicalTag = normalizeTagKey(canonicalMap[normalizedTag] || normalizedTag);
          if (!canonicalTag) return;
          countByTag.set(canonicalTag, (countByTag.get(canonicalTag) || 0) + 1);
        });
      });
  });

  return Array.from(countByTag.entries())
    .sort((left, right) => {
      if (right[1] !== left[1]) return right[1] - left[1];
      return left[0].localeCompare(right[0]);
    })
    .slice(0, tagLimit)
    .map(([tag]) => `#${tag}`);
}

function trackerBaseUrl(): string {
  return String(process.env.TRACKER_BASE_URL || "").trim().replace(/\/$/, "");
}

function trackerSigningSecret(): string {
  return String(process.env.TRACKER_SIGNING_SECRET || "").trim();
}

function resolveArticleUrl(article: FlomoArchiveArticleSummary): string {
  const original = normalizeUrl(article.original_url);
  if (original) return original;
  return normalizeUrl(article.url);
}

function buildArchiveArticleLink(article: FlomoArchiveArticleSummary, reportDate: string, skipTracking = false): string {
  const targetUrl = resolveArticleUrl(article);
  if (!targetUrl) {
    return "";
  }

  if (skipTracking) {
    return targetUrl;
  }

  const baseUrl = trackerBaseUrl();
  const signingSecret = trackerSigningSecret();
  if (!baseUrl || !signingSecret) {
    return targetUrl;
  }

  const params: Record<string, string> = {
    u: targetUrl,
    sid: normalizeText(article.source_host, 120) || "archive_articles",
    aid: normalizeText(article.article_id, 120) || "archive_article",
    d: normalizeDate(reportDate),
    ch: "flomo",
  };

  return buildSignedTrackingUrl(baseUrl, params, signingSecret);
}

export function renderFlomoArchiveArticlesContent(params: {
  reportDate: string;
  articles: FlomoArchiveArticleSummary[];
  homePageUrl?: string;
  overviewLimit?: number;
  activeTagDefinitions?: FlomoTagDefinition[];
  tagLimit?: number;
  skipTracking?: boolean;
}): string {
  const reportDate = normalizeDate(params.reportDate);
  const articles = Array.isArray(params.articles) ? params.articles : [];
  const overviewLimit = Math.max(1, Math.min(Number(params.overviewLimit || 3), 8));
  const skipTracking = Boolean(params.skipTracking);
  const lines: string[] = [];

  lines.push("【今日速览】");
  if (!articles.length) {
    lines.push("- 今日暂无满足阈值的重点文章。");
  } else {
    const previews = articles
      .slice(0, overviewLimit)
      .map((item) => normalizeText(item.summary || item.title, 120))
      .filter(Boolean);
    if (!previews.length) {
      lines.push("- 今日暂无可用摘要。");
    } else {
      previews.forEach((preview) => lines.push(`- ${preview}`));
    }
  }

  lines.push("");
  lines.push("【重点文章】");
  if (!articles.length) {
    lines.push("- 今日暂无满足阈值的重点文章。");
  } else {
    articles.forEach((article, index) => {
      const title = normalizeText(article.title, 200) || `未命名文章 ${index + 1}`;
      const summary = normalizeText(article.summary, 320);
      const url = buildArchiveArticleLink(article, reportDate, skipTracking);
      lines.push(`${index + 1}. ${title}`);
      if (summary) {
        lines.push(summary);
      }
      if (url) {
        lines.push(`链接：${url}`);
      }
    });
  }

  const homePageUrl = normalizeUrl(String(params.homePageUrl || ""));
  if (homePageUrl) {
    lines.push("");
    lines.push(`查看更多：${homePageUrl}`);
    lines.push("");
  }

  const tags = collectFlomoTags({
    articles,
    activeTagDefinitions: params.activeTagDefinitions || [],
    tagLimit: params.tagLimit || 20,
  });
  if (tags.length) {
    if (!homePageUrl) {
      lines.push("");
    }
    lines.push(tags.join(" "));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildFlomoArchiveArticlesPayload(params: {
  reportDate: string;
  articles: FlomoArchiveArticleSummary[];
  dedupeKey?: string;
  activeTagDefinitions?: FlomoTagDefinition[];
  tagLimit?: number;
}): FlomoArchiveArticlesPayload {
  const reportDate = normalizeDate(params.reportDate);
  const homePageUrl = resolveFlomoHomePageUrl();
  const dedupeKey = String(params.dedupeKey || "").trim() || `archive-articles-${reportDate}`;
  return {
    content: renderFlomoArchiveArticlesContent({
      reportDate,
      articles: params.articles,
      homePageUrl,
      activeTagDefinitions: params.activeTagDefinitions || [],
      tagLimit: params.tagLimit || 20,
    }),
    dedupeKey,
  };
}
