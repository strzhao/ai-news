import crypto from "node:crypto";
import {
  DigestArchiveSnapshot,
  aggregateArchiveArticlesFromDigests,
} from "@/lib/domain/archive-articles";
import { getArchiveMarkdownMap, listArchives } from "@/lib/domain/archive-store";
import {
  replaceDailyAnalyzed,
  replaceDailyHighQuality,
  upsertArticleAnalyses,
  upsertArticles,
  upsertDailyAnalyzed,
  upsertDailyHighQuality,
  upsertSources,
} from "@/lib/article-db/repository";
import { Article, ArticleAssessment, SourceConfig, WORTH_WORTH_READING } from "@/lib/domain/models";

function boundedInt(raw: string | number | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw ?? fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeDate(value: string): string {
  const raw = String(value || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid date: ${raw}`);
  }
  return raw;
}

function sourceHostFromUrl(rawUrl: string): string {
  try {
    return new URL(rawUrl).host || "";
  } catch {
    return "";
  }
}

function legacySourceId(host: string): string {
  const normalized = String(host || "legacy-unknown").trim().toLowerCase();
  return `legacy_${crypto.createHash("sha256").update(normalized).digest("hex").slice(0, 12)}`;
}

function legacySourceName(host: string): string {
  return host ? `Legacy Import (${host})` : "Legacy Import";
}

function feedUrlForHost(host: string): string {
  if (!host) return "https://legacy.local/import";
  return `https://${host}`;
}

function toLead(value: string): string {
  const text = String(value || "").trim();
  if (!text) return "";
  if (text.length <= 280) return text;
  return `${text.slice(0, 279)}…`;
}

function rankScore(index: number, quality: number): number {
  return Number((1000000 - index * 1000 + quality).toFixed(4));
}

async function loadLegacyDigests(days: number, limitPerDay: number): Promise<DigestArchiveSnapshot[]> {
  const archiveGroups = await listArchives(days, limitPerDay);
  if (!archiveGroups.length) return [];

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

  if (!digestRows.length) return [];

  const markdownMap = await getArchiveMarkdownMap(digestRows.map((row) => row.digest_id));
  return digestRows
    .map((row) => {
      const markdown = String(markdownMap[row.digest_id] || "").trim();
      if (!markdown) return null;
      return {
        ...row,
        markdown,
      };
    })
    .filter((item): item is DigestArchiveSnapshot => Boolean(item));
}

export interface LegacyImportOptions {
  days?: number;
  limitPerDay?: number;
  articleLimitPerDay?: number;
  overwrite?: boolean;
  qualityScore?: number;
}

export interface LegacyImportResult {
  ok: boolean;
  days: number;
  limitPerDay: number;
  articleLimitPerDay: number;
  overwrite: boolean;
  qualityScore: number;
  importedDates: number;
  importedArticles: number;
  importedSources: number;
  message: string;
}

export async function runLegacyImport(options: LegacyImportOptions = {}): Promise<LegacyImportResult> {
  const days = boundedInt(options.days, 30, 1, 180);
  const limitPerDay = boundedInt(options.limitPerDay, 10, 1, 50);
  const articleLimitPerDay = boundedInt(options.articleLimitPerDay, 1000, 1, 5000);
  const overwrite = Boolean(options.overwrite);
  const qualityScore = Math.max(0, Math.min(100, Number(options.qualityScore ?? 62) || 62));
  const highQualityThreshold = Math.max(
    0,
    Math.min(100, Number.parseFloat(String(process.env.QUALITY_SCORE_THRESHOLD || "62")) || 62),
  );

  const digests = await loadLegacyDigests(days, limitPerDay);
  if (!digests.length) {
    return {
      ok: true,
      days,
      limitPerDay,
      articleLimitPerDay,
      overwrite,
      qualityScore,
      importedDates: 0,
      importedArticles: 0,
      importedSources: 0,
      message: "No legacy digest data found.",
    };
  }

  const aggregated = aggregateArchiveArticlesFromDigests(digests, { articleLimitPerDay });
  const sources = new Map<string, SourceConfig>();
  const articles: Article[] = [];
  const assessments: Record<string, ArticleAssessment> = {};
  const selectedByDate = new Map<string, Array<{ articleIdInput: string; quality: number }>>();

  aggregated.groups.forEach((group) => {
    const date = normalizeDate(group.date);

    group.items.forEach((item, index) => {
      const url = String(item.url || "").trim();
      if (!url) return;
      const host = String(item.source_host || sourceHostFromUrl(url)).trim();
      const sourceId = legacySourceId(host);

      if (!sources.has(sourceId)) {
        sources.set(sourceId, {
          id: sourceId,
          name: legacySourceName(host),
          url: feedUrlForHost(host),
          sourceWeight: 1,
          sourceType: "legacy_import",
          onlyExternalLinks: false,
        });
      }

      const articleIdInput = `legacy_${date}_${item.article_id || `${sourceId}_${index}`}`;
      const summary = String(item.summary || "").trim();
      const title = String(item.title || "").trim() || "Untitled";
      const generatedAt = String(item.generated_at || "").trim();
      const publishedAt = generatedAt ? new Date(generatedAt) : null;

      articles.push({
        id: articleIdInput,
        title,
        url,
        sourceId,
        sourceName: sources.get(sourceId)?.name || sourceId,
        publishedAt: publishedAt && !Number.isNaN(publishedAt.getTime()) ? publishedAt : null,
        summaryRaw: summary,
        leadParagraph: toLead(summary || title),
        contentText: `${title}\n${summary}`.trim(),
        infoUrl: url,
        tags: [],
        primaryType: "other",
        secondaryTypes: [],
      });

      assessments[articleIdInput] = {
        articleId: articleIdInput,
        worth: WORTH_WORTH_READING,
        qualityScore,
        practicalityScore: qualityScore,
        actionabilityScore: qualityScore,
        noveltyScore: Math.max(0, qualityScore - 8),
        clarityScore: Math.max(0, qualityScore - 5),
        oneLineSummary: toLead(summary || title),
        reasonShort: "legacy_archive_import",
        companyImpact: qualityScore,
        teamImpact: qualityScore,
        personalImpact: qualityScore,
        executionClarity: qualityScore,
        actionHint: "",
        bestForRoles: [],
        evidenceSignals: ["legacy_archive"],
        confidence: 0.55,
        primaryType: "other",
        secondaryTypes: [],
        tagGroups: {
          source: ["legacy_archive"],
          type: ["other"],
        },
        cacheKey: `legacy:${articleIdInput}`,
      };

      const bucket = selectedByDate.get(date) || [];
      bucket.push({
        articleIdInput,
        quality: qualityScore,
      });
      selectedByDate.set(date, bucket);
    });
  });

  if (!articles.length) {
    return {
      ok: true,
      days,
      limitPerDay,
      articleLimitPerDay,
      overwrite,
      qualityScore,
      importedDates: 0,
      importedArticles: 0,
      importedSources: 0,
      message: "No legacy articles extracted.",
    };
  }

  await upsertSources(Array.from(sources.values()));
  const inputToStoredId = await upsertArticles(articles);
  await upsertArticleAnalyses({
    inputToStoredId,
    assessments,
    modelName: "legacy_import",
    promptVersion: "legacy_v1",
  });

  for (const [date, rows] of selectedByDate.entries()) {
    const analyzedRows = rows
      .map((row, index) => {
        const storedId = inputToStoredId[row.articleIdInput];
        if (!storedId) return null;
        return {
          articleId: storedId,
          qualityScoreSnapshot: row.quality,
          rankScore: rankScore(index, row.quality),
        };
      })
      .filter((item): item is { articleId: string; qualityScoreSnapshot: number; rankScore: number } => Boolean(item));
    const highQualityRows = analyzedRows.filter((row) => Number(row.qualityScoreSnapshot || 0) >= highQualityThreshold);

    if (overwrite) {
      await replaceDailyHighQuality(date, highQualityRows);
      await replaceDailyAnalyzed(date, analyzedRows);
    } else {
      await upsertDailyHighQuality(date, highQualityRows);
      await upsertDailyAnalyzed(date, analyzedRows);
    }
  }

  return {
    ok: true,
    days,
    limitPerDay,
    articleLimitPerDay,
    overwrite,
    qualityScore,
    importedDates: selectedByDate.size,
    importedArticles: articles.length,
    importedSources: sources.size,
    message: "Legacy archive import completed.",
  };
}
