import { Article } from "@/lib/domain/models";

const MULTISPACE_RE = /\s+/g;

function normalizeText(value: string, maxLen = 1200): string {
  const normalized = String(value || "").replace(MULTISPACE_RE, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, maxLen).trimEnd()}...`;
}

export function normalizeArticles(articles: Article[]): Article[] {
  return articles.map((article) => {
    let publishedAt: Date | null = article.publishedAt;
    if (publishedAt && Number.isFinite(publishedAt.getTime())) {
      publishedAt = new Date(publishedAt.toISOString());
    }

    return {
      ...article,
      title: normalizeText(article.title, 240),
      url: String(article.url || "").trim(),
      publishedAt,
      summaryRaw: normalizeText(article.summaryRaw, 1600),
      leadParagraph: normalizeText(article.leadParagraph, 320),
      contentText: normalizeText(article.contentText, 2400),
      tags: [...(article.tags || [])],
      secondaryTypes: [...(article.secondaryTypes || [])],
    };
  });
}
