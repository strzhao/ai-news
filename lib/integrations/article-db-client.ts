import { fetchJson } from "@/lib/infra/http";

export interface HighQualityArticleItem {
  article_id: string;
  title: string;
  url: string;
  summary: string;
  image_url: string;
  source_host: string;
  source_id: string;
  source_name: string;
  date: string;
  digest_id: string;
  generated_at: string;
  quality_score: number;
  quality_tier: "high" | "general" | "all";
  confidence: number;
  primary_type: string;
  secondary_types: string[];
  original_url: string;
  tag_groups: Record<string, string[]>;
}

export interface HighQualityArticleGroup {
  date: string;
  items: HighQualityArticleItem[];
}

function baseUrl(): string {
  return String(process.env.ARTICLE_DB_BASE_URL || "").trim().replace(/\/$/, "");
}

function authHeaders(): HeadersInit {
  const token = String(process.env.ARTICLE_DB_API_TOKEN || "").trim();
  if (!token) return {};
  return {
    Authorization: `Bearer ${token}`,
  };
}

export function articleDbClientEnabled(): boolean {
  return Boolean(baseUrl());
}

export interface FetchHighQualityRangeParams {
  fromDate: string;
  toDate: string;
  limitPerDay: number;
  qualityTier?: string;
}

export interface FetchFlomoNextBatchParams {
  date?: string;
  tz?: string;
  days?: number;
  limitPerDay?: number;
  articleLimitPerDay?: number;
  qualityTier?: string;
}

export interface FetchFlomoNextBatchResult {
  ok: boolean;
  generatedAt: string;
  reportDate: string;
  sourceDate: string;
  timezone: string;
  qualityTier: "high" | "general" | "all";
  hasBatch: boolean;
  retryingBatch: boolean;
  batchKey: string;
  articleCount: number;
  tagCount: number;
  content: string;
  reason: string;
}

export async function fetchHighQualityRange(
  params: FetchHighQualityRangeParams,
): Promise<{ groups: HighQualityArticleGroup[]; totalArticles: number }> {
  const root = baseUrl();
  if (!root) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }

  const query = new URLSearchParams({
    from: params.fromDate,
    to: params.toDate,
    limit_per_day: String(params.limitPerDay),
    quality_tier: String(params.qualityTier || "high"),
  });

  const raw = (await fetchJson(`${root}/api/v1/articles/high-quality/range?${query.toString()}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
    timeoutMs: 20_000,
  })) as Record<string, unknown>;

  const groupsRaw = Array.isArray(raw.groups) ? raw.groups : [];
  const groups: HighQualityArticleGroup[] = groupsRaw
    .map((group) => {
      if (!group || typeof group !== "object") return null;
      const row = group as Record<string, unknown>;
      const date = String(row.date || "").trim();
      if (!date) return null;
      const itemsRaw = Array.isArray(row.items) ? row.items : [];
      const items = itemsRaw
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const entry = item as Record<string, unknown>;
          return {
            article_id: String(entry.article_id || ""),
            title: String(entry.title || ""),
            url: String(entry.url || ""),
            original_url: String(entry.original_url || ""),
            summary: String(entry.summary || ""),
            image_url: String(entry.image_url || ""),
            source_host: String(entry.source_host || ""),
            source_id: String(entry.source_id || ""),
            source_name: String(entry.source_name || ""),
            date: String(entry.date || date),
            digest_id: String(entry.digest_id || ""),
            generated_at: String(entry.generated_at || ""),
            quality_score: Number(entry.quality_score || 0),
            quality_tier: String(entry.quality_tier || "high") as "high" | "general" | "all",
            confidence: Number(entry.confidence || 0),
            primary_type: String(entry.primary_type || "other"),
            secondary_types: Array.isArray(entry.secondary_types)
              ? entry.secondary_types.map((value) => String(value || "")).filter(Boolean)
              : [],
            tag_groups:
              entry.tag_groups && typeof entry.tag_groups === "object" && !Array.isArray(entry.tag_groups)
                ? Object.fromEntries(
                    Object.entries(entry.tag_groups as Record<string, unknown>).map(([groupKey, tags]) => [
                      String(groupKey || "").trim(),
                      Array.isArray(tags) ? tags.map((value) => String(value || "").trim()).filter(Boolean) : [],
                    ]),
                  )
                : {},
          };
        })
        .filter((item): item is HighQualityArticleGroup["items"][number] => Boolean(item));

      return {
        date,
        items,
      };
    })
    .filter((group): group is HighQualityArticleGroup => Boolean(group));

  return {
    groups,
    totalArticles: Number(raw.total_articles || 0),
  };
}

export async function fetchFlomoNextPushBatch(params: FetchFlomoNextBatchParams): Promise<FetchFlomoNextBatchResult> {
  const root = baseUrl();
  if (!root) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }

  const raw = (await fetchJson(`${root}/api/v1/flomo/push-batches/next`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      date: params.date,
      tz: params.tz,
      days: params.days,
      limit_per_day: params.limitPerDay,
      article_limit_per_day: params.articleLimitPerDay,
      quality_tier: params.qualityTier,
    }),
    timeoutMs: 20_000,
  })) as Record<string, unknown>;

  return {
    ok: Boolean(raw.ok),
    generatedAt: String(raw.generated_at || ""),
    reportDate: String(raw.report_date || ""),
    sourceDate: String(raw.source_date || ""),
    timezone: String(raw.timezone || ""),
    qualityTier: String(raw.quality_tier || "high") as "high" | "general" | "all",
    hasBatch: Boolean(raw.has_batch),
    retryingBatch: Boolean(raw.retrying_batch),
    batchKey: String(raw.batch_key || ""),
    articleCount: Number(raw.article_count || 0),
    tagCount: Number(raw.tag_count || 0),
    content: String(raw.content || ""),
    reason: String(raw.reason || ""),
  };
}

export async function markFlomoPushBatchSent(batchKey: string): Promise<{ consumedCount: number }> {
  const root = baseUrl();
  if (!root) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }
  const normalizedBatchKey = String(batchKey || "").trim();
  if (!normalizedBatchKey) {
    throw new Error("Missing batchKey");
  }

  const raw = (await fetchJson(`${root}/api/v1/flomo/push-batches/${encodeURIComponent(normalizedBatchKey)}/sent`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
    timeoutMs: 20_000,
  })) as Record<string, unknown>;

  return {
    consumedCount: Number(raw.consumed_count || 0),
  };
}

export interface ArticleSummaryResult {
  ok: boolean;
  status?: "completed" | "generating" | "failed" | "no_content";
  summary_markdown?: string;
  model_name?: string;
  updated_at?: string;
  error?: string;
}

export async function fetchArticleSummary(articleId: string): Promise<ArticleSummaryResult> {
  const root = baseUrl();
  if (!root) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }

  const raw = (await fetchJson(
    `${root}/api/v1/articles/${encodeURIComponent(articleId)}/summary`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        ...authHeaders(),
      },
      timeoutMs: 120_000,
    },
  )) as Record<string, unknown>;

  return {
    ok: Boolean(raw.ok),
    status: String(raw.status || "") as ArticleSummaryResult["status"],
    summary_markdown: raw.summary_markdown ? String(raw.summary_markdown) : undefined,
    model_name: raw.model_name ? String(raw.model_name) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
    error: raw.error ? String(raw.error) : undefined,
  };
}

export async function markFlomoPushBatchFailed(batchKey: string, errorMessage: string): Promise<void> {
  const root = baseUrl();
  if (!root) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }
  const normalizedBatchKey = String(batchKey || "").trim();
  if (!normalizedBatchKey) {
    throw new Error("Missing batchKey");
  }

  await fetchJson(`${root}/api/v1/flomo/push-batches/${encodeURIComponent(normalizedBatchKey)}/failed`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify({
      error_message: String(errorMessage || "").slice(0, 2000),
    }),
    timeoutMs: 20_000,
  });
}
