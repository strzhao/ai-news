import { DailyDigest, ScoredArticle, WORTH_MUST_READ } from "@/lib/domain/models";

export function renderDigestMarkdown(
  digest: DailyDigest,
  linkResolver?: (article: ScoredArticle) => string,
): string {
  const resolver = linkResolver || ((article: ScoredArticle) => article.url);
  const lines: string[] = [];

  lines.push("## 今日速览");
  lines.push(digest.topSummary.trim() || "- 今日暂无高质量 AI 更新。");
  lines.push("");
  lines.push("## 重点文章");

  if (!digest.highlights.length) {
    lines.push("- 今日暂无满足阈值的重点文章。");
  }

  digest.highlights.forEach((taggedArticle, index) => {
    const article = taggedArticle.article;
    const marker = article.worth === WORTH_MUST_READ ? "⭐ " : "";
    lines.push(`### ${index + 1}. ${marker}[${article.title}](${resolver(article)})`);
    lines.push(`- ${article.leadParagraph}`);
  });

  if (digest.extras.length) {
    lines.push("## 其他可关注");
    digest.extras.forEach((taggedArticle) => {
      const article = taggedArticle.article;
      lines.push(`- [${article.title}](${resolver(article)})（${article.worth}）`);
    });
    lines.push("");
  }

  if (digest.dailyTags.length) {
    lines.push(digest.dailyTags.join(" "));
    lines.push("");
  }

  return `${lines.join("\n").replace(/\s+$/g, "")}\n`;
}
