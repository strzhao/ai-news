import { DailyDigest, ScoredArticle, WORTH_MUST_READ } from "@/lib/domain/models";

export interface FlomoPayload {
  content: string;
  dedupeKey: string;
}

export function renderFlomoContent(
  digest: DailyDigest,
  globalTagLimit = 20,
  linkResolver?: (article: ScoredArticle) => string,
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

  if (digest.dailyTags.length) {
    lines.push(digest.dailyTags.slice(0, globalTagLimit).join(" "));
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

export function buildFlomoPayload(
  digest: DailyDigest,
  linkResolver?: (article: ScoredArticle) => string,
): FlomoPayload {
  return {
    content: renderFlomoContent(digest, 20, linkResolver),
    dedupeKey: `digest-${digest.date}`,
  };
}
