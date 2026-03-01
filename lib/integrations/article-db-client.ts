import { fetchJson } from "@/lib/infra/http";
import { HighQualityArticleGroup } from "@/lib/article-db/types";

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
