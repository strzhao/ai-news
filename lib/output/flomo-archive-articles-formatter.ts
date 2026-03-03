import { ArchiveArticleSummary } from "@/lib/domain/archive-articles";
import { resolveFlomoHomePageUrl } from "@/lib/output/flomo-formatter";
import { buildSignedTrackingUrl } from "@/lib/tracking/signed-url";

export interface FlomoArchiveArticlesPayload {
  content: string;
  dedupeKey: string;
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

function trackerBaseUrl(): string {
  return String(process.env.TRACKER_BASE_URL || "").trim().replace(/\/$/, "");
}

function trackerSigningSecret(): string {
  return String(process.env.TRACKER_SIGNING_SECRET || "").trim();
}

function buildArchiveArticleLink(article: ArchiveArticleSummary, reportDate: string): string {
  const targetUrl = normalizeUrl(article.url);
  if (!targetUrl) {
    return "";
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
  articles: ArchiveArticleSummary[];
  homePageUrl?: string;
  overviewLimit?: number;
}): string {
  const reportDate = normalizeDate(params.reportDate);
  const articles = Array.isArray(params.articles) ? params.articles : [];
  const overviewLimit = Math.max(1, Math.min(Number(params.overviewLimit || 3), 8));
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
      const url = buildArchiveArticleLink(article, reportDate);
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

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildFlomoArchiveArticlesPayload(params: {
  reportDate: string;
  articles: ArchiveArticleSummary[];
  dedupeKey?: string;
}): FlomoArchiveArticlesPayload {
  const reportDate = normalizeDate(params.reportDate);
  const homePageUrl = resolveFlomoHomePageUrl();
  const dedupeKey = String(params.dedupeKey || "").trim() || `archive-articles-${reportDate}`;
  return {
    content: renderFlomoArchiveArticlesContent({
      reportDate,
      articles: params.articles,
      homePageUrl,
    }),
    dedupeKey,
  };
}
