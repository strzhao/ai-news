import crypto from "node:crypto";
import Parser from "rss-parser";
import { Article, SourceConfig } from "@/lib/domain/models";

const TAG_RE = /<[^>]+>/g;
const MULTISPACE_RE = /\s+/g;
const HREF_RE = /href=["']([^"']+)["']/gi;
const URL_RE = /https?:\/\/[^\s<>"']+/gi;
const X_INTERNAL_HOSTS = new Set([
  "twitter.com",
  "www.twitter.com",
  "x.com",
  "www.x.com",
  "mobile.twitter.com",
  "mobile.x.com",
]);

const parser = new Parser({
  customFields: {
    item: ["summary", "content", "content:encoded", "description"],
  },
});

async function fetchFeedWithTimeout(feedUrl: string, timeoutMs: number): Promise<Parser.Output<Parser.Item>> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(feedUrl, {
      method: "GET",
      redirect: "follow",
      headers: {
        Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
      },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`RSS fetch failed: ${response.status}`);
    }

    const xml = await response.text();
    return await parser.parseString(xml);
  } finally {
    clearTimeout(timer);
  }
}

function cleanHtmlText(value: string): string {
  return String(value || "")
    .replace(TAG_RE, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(MULTISPACE_RE, " ")
    .trim();
}

function extractLeadParagraph(item: Parser.Item): string {
  const content = cleanHtmlText(String(item.content || (item as any)["content:encoded"] || ""));
  if (content) {
    return content.split(".")[0].slice(0, 280).trim();
  }

  const summary = cleanHtmlText(String(item.summary || item.contentSnippet || item.content || ""));
  if (summary) {
    for (const token of ["。", ".", "!", "?", "\n"]) {
      if (summary.includes(token)) {
        return summary.split(token)[0].slice(0, 280).trim();
      }
    }
    return summary.slice(0, 280).trim();
  }

  return cleanHtmlText(String(item.title || "")).slice(0, 280).trim();
}

function parsePublishedAt(item: Parser.Item): Date | null {
  const candidates = [item.isoDate, item.pubDate, (item as any).published, (item as any).updated];
  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = new Date(String(candidate));
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return null;
}

function makeArticleId(sourceId: string, url: string, title: string): string {
  const digest = crypto.createHash("sha256").update(`${sourceId}|${url}|${title}`).digest("hex").slice(0, 12);
  return `${sourceId}-${digest}`;
}

function collectEntryCandidateLinks(item: Parser.Item): string[] {
  const blocks: string[] = [];
  [item.summary, item.contentSnippet, item.content, (item as any).description, (item as any)["content:encoded"]].forEach((value) => {
    if (typeof value === "string" && value.trim()) {
      blocks.push(value);
    }
  });

  const links: string[] = [];
  for (const block of blocks) {
    const hrefMatches = block.matchAll(HREF_RE);
    for (const match of hrefMatches) {
      if (match[1]) links.push(match[1]);
    }
    const urlMatches = block.match(URL_RE) || [];
    links.push(...urlMatches);
  }

  return links;
}

function isExternalLink(value: string): boolean {
  try {
    const parsed = new URL(value.trim());
    const host = parsed.hostname.toLowerCase();
    if (!host) return false;
    if (host === "t.co") return true;
    if (X_INTERNAL_HOSTS.has(host)) return false;
    if (host.endsWith(".twitter.com") || host.endsWith(".x.com") || host.endsWith(".twimg.com")) return false;
    return true;
  } catch {
    return false;
  }
}

function entryHasExternalLink(item: Parser.Item): boolean {
  return collectEntryCandidateLinks(item).some((link) => isExternalLink(link));
}

function selectInfoUrl(item: Parser.Item, fallbackUrl: string): string {
  for (const link of collectEntryCandidateLinks(item)) {
    if (isExternalLink(link)) {
      return link;
    }
  }
  return fallbackUrl;
}

export async function fetchArticles(
  sources: SourceConfig[],
  options: {
    timeoutSeconds?: number;
    maxPerSource?: number;
    perSourceLimits?: Record<string, number>;
    totalBudget?: number;
  } = {},
): Promise<Article[]> {
  const timeoutSeconds = options.timeoutSeconds ?? 20;
  const timeoutMs = Math.max(1_000, Math.trunc(timeoutSeconds * 1_000));
  const maxPerSource = options.maxPerSource ?? 25;
  const perSourceLimits = options.perSourceLimits || {};
  const totalBudget = options.totalBudget ?? 0;

  const articles: Article[] = [];

  for (const source of sources) {
    if (totalBudget > 0 && articles.length >= totalBudget) {
      break;
    }

    try {
      const feed = await fetchFeedWithTimeout(source.url, timeoutMs);
      const perSourceCap = Math.trunc(perSourceLimits[source.id] ?? maxPerSource);
      const entries = (feed.items || []).slice(0, Math.max(0, perSourceCap));

      for (const entry of entries) {
        if (totalBudget > 0 && articles.length >= totalBudget) {
          break;
        }
        if (source.onlyExternalLinks && !entryHasExternalLink(entry)) {
          continue;
        }

        const title = cleanHtmlText(String(entry.title || ""));
        const url = String(entry.link || "").trim();
        if (!title || !url) {
          continue;
        }

        const summary = cleanHtmlText(String(entry.summary || entry.contentSnippet || ""));
        const lead = extractLeadParagraph(entry);
        const contentText = [title, summary, lead].filter(Boolean).join(" ");

        articles.push({
          id: makeArticleId(source.id, url, title),
          title,
          url,
          sourceId: source.id,
          sourceName: source.name,
          publishedAt: parsePublishedAt(entry),
          summaryRaw: summary,
          leadParagraph: lead,
          contentText,
          infoUrl: selectInfoUrl(entry, url),
          tags: [],
          primaryType: "",
          secondaryTypes: [],
        });
      }
    } catch {
      // keep running if one source fails
      continue;
    }

    if (timeoutSeconds > 0) {
      // avoid burst to upstream feeds
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  return articles;
}
