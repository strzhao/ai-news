import crypto from "node:crypto";
import { getArchiveItem, listArchives } from "@/lib/domain/archive-store";
import { normalizeUrl } from "@/lib/domain/tracker-common";
import { resolveFirstImageUrl } from "@/lib/domain/article-image";

const MULTISPACE_RE = /\s+/g;
const HEADING_RE = /^###\s+\d+\.\s*(.+)$/;
const BULLET_LINK_RE = /^-\s+\[([^\]]+)\]\(([^)]+)\)/;
const LINK_LINE_RE = /^-?\s*(?:原文链接|链接|URL|原文)\s*[:：]\s*(\S+)\s*$/i;
const SUMMARY_LINE_RE = /^-?\s*(?:一句话总结|摘要|导语)\s*[:：]\s*(.+)$/;
const IGNORE_SUMMARY_PREFIX_RE = /^(来源|阅读建议|阅读理由|链接|原文链接|URL|原文)\s*[:：]/;

const DEFAULT_DAYS = 30;
const DEFAULT_LIMIT_PER_DAY = 10;
const DEFAULT_ARTICLE_LIMIT_PER_DAY = 24;
const DEFAULT_IMAGE_PROBE_LIMIT = 24;

export interface ArchiveArticleSummary {
  article_id: string;
  title: string;
  url: string;
  summary: string;
  image_url: string;
  source_host: string;
  date: string;
  digest_id: string;
  generated_at: string;
}

export interface ArchiveArticleGroup {
  date: string;
  items: ArchiveArticleSummary[];
}

export interface ListArchiveArticlesResult {
  groups: ArchiveArticleGroup[];
  totalArticles: number;
}

export interface DigestArchiveSnapshot {
  digest_id: string;
  date: string;
  generated_at: string;
  markdown: string;
}

interface ParsedArticle {
  title: string;
  url: string;
  summary: string;
}

interface AggregatedArticleRow {
  dedupeKey: string;
  sequence: number;
  generatedAtMs: number;
  item: ArchiveArticleSummary;
}

function boundedInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const normalized = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(normalized)) return fallback;
  return Math.max(min, Math.min(max, normalized));
}

function normalizeText(value: string, maxLen = 280): string {
  const normalized = String(value || "").replace(MULTISPACE_RE, " ").trim();
  if (normalized.length <= maxLen) {
    return normalized;
  }
  return `${normalized.slice(0, Math.max(1, maxLen - 1)).trimEnd()}…`;
}

function normalizeTitle(value: string): string {
  return normalizeText(String(value || "").replace(/^⭐\s*/, ""), 240);
}

function normalizeSummary(value: string): string {
  return normalizeText(value, 320);
}

function findFirstMarkdownLink(value: string): { text: string; url: string } | null {
  const match = String(value || "").match(/\[([^\]]+)\]\(([^)]+)\)/);
  if (!match) {
    return null;
  }
  return {
    text: String(match[1] || "").trim(),
    url: String(match[2] || "").trim(),
  };
}

function normalizeDateScore(date: string): number {
  const digits = String(date || "").replace(/\D/g, "");
  if (digits.length !== 8) return 0;
  return Number.parseInt(digits, 10) || 0;
}

function generatedAtMs(value: string): number {
  const date = new Date(String(value || "").trim());
  if (Number.isNaN(date.getTime())) {
    return 0;
  }
  return date.getTime();
}

function sourceHost(value: string): string {
  try {
    return new URL(value).host || "";
  } catch {
    return "";
  }
}

function stableArticleId(key: string, fallback: string): string {
  const payload = key || fallback;
  return crypto.createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

export function unwrapTrackedArticleUrl(rawUrl: string): string {
  const value = String(rawUrl || "").trim();
  if (!value) {
    return "";
  }

  const parseCandidates = [value];
  if (value.startsWith("/")) {
    parseCandidates.push(`https://internal.local${value}`);
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = new URL(candidate);
      const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
      if (!["/api/r", "/r"].includes(pathname)) {
        continue;
      }
      const target = String(parsed.searchParams.get("u") || "").trim();
      if (target) {
        return target;
      }
    } catch {
      continue;
    }
  }

  return value;
}

export function resolveArchiveArticleUrl(rawUrl: string): string {
  const unwrapped = unwrapTrackedArticleUrl(rawUrl);
  if (!unwrapped) {
    return "";
  }
  const normalized = normalizeUrl(unwrapped);
  return String(normalized || unwrapped).trim();
}

export function buildArchiveArticleDedupeKey(params: { title: string; url: string; sourceHost: string }): string {
  const normalizedUrl = resolveArchiveArticleUrl(params.url);
  if (normalizedUrl) {
    return `url:${normalizedUrl}`;
  }

  const normalizedTitle = normalizeText(String(params.title || "").toLowerCase(), 240);
  if (!normalizedTitle) {
    return "";
  }

  const normalizedHost = normalizeText(String(params.sourceHost || "").toLowerCase(), 120);
  return `title:${normalizedTitle}|host:${normalizedHost || "-"}`;
}

export function extractArchiveArticlesFromMarkdown(markdown: string): ParsedArticle[] {
  const lines = String(markdown || "").split(/\r?\n/);
  const parsed: ParsedArticle[] = [];

  let current: ParsedArticle | null = null;

  const flushCurrent = (): void => {
    if (!current) return;
    const title = normalizeTitle(current.title);
    const url = resolveArchiveArticleUrl(current.url);
    if (title && url) {
      parsed.push({
        title,
        url,
        summary: normalizeSummary(current.summary),
      });
    }
    current = null;
  };

  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) {
      continue;
    }

    if (/^##\s+/.test(line)) {
      flushCurrent();
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      flushCurrent();
      const headingText = String(headingMatch[1] || "").trim();
      const headingLink = findFirstMarkdownLink(headingText);
      current = {
        title: headingLink ? headingLink.text : headingText,
        url: headingLink ? headingLink.url : "",
        summary: "",
      };
      continue;
    }

    const bulletLink = line.match(BULLET_LINK_RE);
    if (bulletLink) {
      flushCurrent();
      parsed.push({
        title: normalizeTitle(String(bulletLink[1] || "")),
        url: resolveArchiveArticleUrl(String(bulletLink[2] || "")),
        summary: "",
      });
      continue;
    }

    if (!current) {
      continue;
    }

    if (!current.url) {
      const linkLine = line.match(LINK_LINE_RE);
      if (linkLine) {
        current.url = String(linkLine[1] || "").trim();
        continue;
      }

      const inlineLink = findFirstMarkdownLink(line);
      if (inlineLink) {
        current.url = inlineLink.url;
        if (!current.title) {
          current.title = inlineLink.text;
        }
      }
    }

    if (!current.summary) {
      const summaryLine = line.match(SUMMARY_LINE_RE);
      if (summaryLine) {
        current.summary = String(summaryLine[1] || "").trim();
        continue;
      }

      if (line.startsWith("-")) {
        const plainBullet = line.replace(/^-+\s*/, "").trim();
        if (!IGNORE_SUMMARY_PREFIX_RE.test(plainBullet)) {
          current.summary = plainBullet;
        }
      }
    }
  }

  flushCurrent();
  return parsed.filter((item) => item.title && item.url);
}

export function aggregateArchiveArticlesFromDigests(
  digests: DigestArchiveSnapshot[],
  options: { articleLimitPerDay?: number } = {},
): ListArchiveArticlesResult {
  const articleLimitPerDay = boundedInt(options.articleLimitPerDay, 1, 100, DEFAULT_ARTICLE_LIMIT_PER_DAY);

  const orderedDigests = [...digests].sort((left, right) => {
    const leftTs = generatedAtMs(left.generated_at);
    const rightTs = generatedAtMs(right.generated_at);
    if (rightTs !== leftTs) {
      return rightTs - leftTs;
    }

    const leftDate = normalizeDateScore(left.date);
    const rightDate = normalizeDateScore(right.date);
    if (rightDate !== leftDate) {
      return rightDate - leftDate;
    }

    return String(right.digest_id || "").localeCompare(String(left.digest_id || ""));
  });

  const seen = new Set<string>();
  const grouped = new Map<string, AggregatedArticleRow[]>();

  orderedDigests.forEach((digest) => {
    const articles = extractArchiveArticlesFromMarkdown(digest.markdown);
    articles.forEach((article, index) => {
      const host = sourceHost(article.url);
      const dedupeKey = buildArchiveArticleDedupeKey({
        title: article.title,
        url: article.url,
        sourceHost: host,
      });
      if (!dedupeKey || seen.has(dedupeKey)) {
        return;
      }
      seen.add(dedupeKey);

      const item: ArchiveArticleSummary = {
        article_id: stableArticleId(dedupeKey, `${digest.digest_id}:${index}`),
        title: article.title,
        url: article.url,
        summary: normalizeSummary(article.summary),
        image_url: "",
        source_host: host,
        date: String(digest.date || "").trim(),
        digest_id: String(digest.digest_id || "").trim(),
        generated_at: String(digest.generated_at || "").trim(),
      };

      const bucket = grouped.get(item.date) || [];
      bucket.push({
        dedupeKey,
        sequence: index,
        generatedAtMs: generatedAtMs(item.generated_at),
        item,
      });
      grouped.set(item.date, bucket);
    });
  });

  const dates = Array.from(grouped.keys()).sort((left, right) => String(right).localeCompare(String(left)));
  const groups: ArchiveArticleGroup[] = dates
    .map((date) => {
      const rows = [...(grouped.get(date) || [])].sort((left, right) => {
        if (right.generatedAtMs !== left.generatedAtMs) {
          return right.generatedAtMs - left.generatedAtMs;
        }
        return left.sequence - right.sequence;
      });

      const items = rows.slice(0, articleLimitPerDay).map((row) => row.item);
      return {
        date,
        items,
      };
    })
    .filter((group) => group.items.length > 0);

  const totalArticles = groups.reduce((sum, group) => sum + group.items.length, 0);

  return {
    groups,
    totalArticles,
  };
}

async function enrichFirstImages(
  groups: ArchiveArticleGroup[],
  options: { imageProbeLimit: number; concurrency: number },
): Promise<void> {
  if (options.imageProbeLimit <= 0) {
    return;
  }

  const queue: ArchiveArticleSummary[] = [];
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.image_url && item.url) {
        queue.push(item);
      }
      if (queue.length >= options.imageProbeLimit) {
        break;
      }
    }
    if (queue.length >= options.imageProbeLimit) {
      break;
    }
  }

  if (!queue.length) {
    return;
  }

  let cursor = 0;
  const workerCount = Math.max(1, Math.min(queue.length, options.concurrency));

  async function runWorker(): Promise<void> {
    while (true) {
      const currentIndex = cursor;
      cursor += 1;
      if (currentIndex >= queue.length) {
        return;
      }
      const article = queue[currentIndex];
      article.image_url = await resolveFirstImageUrl(article.url);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}

export async function listArchiveArticles(options: {
  days?: number;
  limitPerDay?: number;
  articleLimitPerDay?: number;
  imageProbeLimit?: number;
} = {}): Promise<ListArchiveArticlesResult> {
  const days = boundedInt(options.days, 1, 180, DEFAULT_DAYS);
  const limitPerDay = boundedInt(options.limitPerDay, 1, 50, DEFAULT_LIMIT_PER_DAY);
  const articleLimitPerDay = boundedInt(options.articleLimitPerDay, 1, 100, DEFAULT_ARTICLE_LIMIT_PER_DAY);
  const imageProbeLimit = boundedInt(options.imageProbeLimit, 0, 100, DEFAULT_IMAGE_PROBE_LIMIT);

  const archiveGroups = await listArchives(days, limitPerDay);
  if (!archiveGroups.length) {
    return {
      groups: [],
      totalArticles: 0,
    };
  }

  const digestRows: Array<Omit<DigestArchiveSnapshot, "markdown">> = [];
  for (const rawGroup of archiveGroups) {
    if (!rawGroup || typeof rawGroup !== "object") continue;
    const group = rawGroup as Record<string, unknown>;
    const date = String(group.date || "").trim();
    const items = Array.isArray(group.items) ? group.items : [];
    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== "object") continue;
      const item = rawItem as Record<string, unknown>;
      const digestId = String(item.digest_id || "").trim();
      if (!digestId) continue;
      digestRows.push({
        digest_id: digestId,
        date: String(item.date || date).trim() || date,
        generated_at: String(item.generated_at || "").trim(),
      });
    }
  }

  if (!digestRows.length) {
    return {
      groups: [],
      totalArticles: 0,
    };
  }

  const withMarkdown = await Promise.all(
    digestRows.map(async (row) => {
      try {
        const detail = await getArchiveItem(row.digest_id);
        const markdown = String((detail || {}).markdown || "").trim();
        if (!markdown) {
          return null;
        }
        return {
          ...row,
          markdown,
        };
      } catch {
        return null;
      }
    }),
  );

  const digests = withMarkdown.filter((item): item is DigestArchiveSnapshot => Boolean(item));
  const aggregated = aggregateArchiveArticlesFromDigests(digests, {
    articleLimitPerDay,
  });

  const imageProbeConcurrency = boundedInt(
    Number.parseInt(String(process.env.ARTICLE_IMAGE_PROBE_CONCURRENCY || "4"), 10),
    1,
    8,
    4,
  );

  await enrichFirstImages(aggregated.groups, {
    imageProbeLimit,
    concurrency: imageProbeConcurrency,
  });

  return aggregated;
}
