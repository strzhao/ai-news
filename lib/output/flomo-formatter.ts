import { DailyDigest, ScoredArticle, WORTH_MUST_READ } from "@/lib/domain/models";

export interface FlomoPayload {
  content: string;
  dedupeKey: string;
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

export function resolveFlomoHomePageUrl(env: NodeJS.ProcessEnv = process.env): string {
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

export function renderFlomoContent(
  digest: DailyDigest,
  globalTagLimit = 20,
  linkResolver?: (article: ScoredArticle) => string,
  homePageUrl = "",
): string {
  const resolver = linkResolver || ((article: ScoredArticle) => article.url);
  const lines: string[] = [];

  lines.push("【今日速览】");
  if (digest.topSummary.trim()) {
    lines.push(...digest.topSummary.split(/\r?\n/).filter((line) => line.trim()));
  } else {
    lines.push("- 今日暂无高质量 AI 更新。");
  }

  lines.push("");
  lines.push("【重点文章】");

  if (!digest.highlights.length) {
    lines.push("- 今日暂无满足阈值的重点文章。");
  }

  digest.highlights.forEach((taggedArticle, index) => {
    const article = taggedArticle.article;
    const marker = article.worth === WORTH_MUST_READ ? "⭐ " : "";
    lines.push(`${index + 1}. ${marker}${article.title}`);
    lines.push(article.leadParagraph);
    lines.push(`链接：${resolver(article)}`);
  });

  const normalizedHomePageUrl = normalizeHomePageUrl(homePageUrl);
  if (normalizedHomePageUrl) {
    lines.push(`H5 页面：${normalizedHomePageUrl}`);
  }

  if (digest.dailyTags.length) {
    lines.push(digest.dailyTags.slice(0, globalTagLimit).join(" "));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildFlomoPayload(
  digest: DailyDigest,
  linkResolver?: (article: ScoredArticle) => string,
): FlomoPayload {
  const homePageUrl = resolveFlomoHomePageUrl();
  return {
    content: renderFlomoContent(digest, 20, linkResolver, homePageUrl),
    dedupeKey: `digest-${digest.date}`,
  };
}
