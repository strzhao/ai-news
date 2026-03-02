import { describe, expect, it } from "vitest";
import { buildFirstSeenUniqueHighQualityGroups } from "@/lib/article-db/repository";

function row(params: {
  articleId: string;
  date: string;
  rankScore: number;
  qualityScoreSnapshot: number;
  title?: string;
  analyzedAt?: string;
}): Record<string, unknown> {
  return {
    article_id: params.articleId,
    date: params.date,
    rank_score: params.rankScore,
    quality_score_snapshot: params.qualityScoreSnapshot,
    title: params.title || params.articleId,
    original_url: `https://example.com/${params.articleId}`,
    info_url: `https://example.com/${params.articleId}`,
    source_host: "example.com",
    source_id: "s1",
    source_name: "Source 1",
    one_line_summary: "summary",
    confidence: 0.8,
    primary_type: "tooling",
    secondary_types: ["agent"],
    tag_groups: { topic: ["llm"] },
    analyzed_at: params.analyzedAt || `${params.date}T09:00:00.000Z`,
  };
}

describe("buildFirstSeenUniqueHighQualityGroups", () => {
  it("keeps only the earliest date when the same article appears across days", () => {
    const rows = [
      row({ articleId: "a_same", date: "2026-03-02", rankScore: 99, qualityScoreSnapshot: 88, title: "Same" }),
      row({ articleId: "a_same", date: "2026-03-01", rankScore: 80, qualityScoreSnapshot: 88, title: "Same" }),
      row({ articleId: "a_new", date: "2026-03-02", rankScore: 90, qualityScoreSnapshot: 86, title: "New" }),
      row({ articleId: "a_old", date: "2026-03-01", rankScore: 70, qualityScoreSnapshot: 75, title: "Old" }),
    ];

    const firstSeenByArticleId = new Map<string, string>([
      ["a_same", "2026-03-01"],
      ["a_new", "2026-03-02"],
      ["a_old", "2026-03-01"],
    ]);

    const result = buildFirstSeenUniqueHighQualityGroups({
      rows,
      firstSeenByArticleId,
      limitPerDay: 10,
      qualityTier: "high",
      qualityThreshold: 62,
    });

    expect(result.totalArticles).toBe(3);
    expect(result.groups).toHaveLength(2);
    expect(result.groups[0].date).toBe("2026-03-02");
    expect(result.groups[0].items.map((item) => item.article_id)).toEqual(["a_new"]);
    expect(result.groups[1].date).toBe("2026-03-01");
    expect(result.groups[1].items.map((item) => item.article_id)).toEqual(["a_same", "a_old"]);
  });

  it("excludes items whose first-seen date is outside the queried window", () => {
    const rows = [row({ articleId: "a1", date: "2026-03-01", rankScore: 88, qualityScoreSnapshot: 88 })];

    const result = buildFirstSeenUniqueHighQualityGroups({
      rows,
      firstSeenByArticleId: new Map([["a1", "2026-02-20"]]),
      limitPerDay: 10,
      qualityTier: "high",
      qualityThreshold: 62,
    });

    expect(result.totalArticles).toBe(0);
    expect(result.groups).toEqual([]);
  });

  it("applies per-day limit after dedupe filtering", () => {
    const rows = [
      row({ articleId: "top_duplicate", date: "2026-03-02", rankScore: 100, qualityScoreSnapshot: 90, title: "Dup" }),
      row({ articleId: "keep_1", date: "2026-03-02", rankScore: 95, qualityScoreSnapshot: 89, title: "Keep1" }),
      row({ articleId: "keep_2", date: "2026-03-02", rankScore: 90, qualityScoreSnapshot: 88, title: "Keep2" }),
    ];

    const firstSeenByArticleId = new Map<string, string>([
      ["top_duplicate", "2026-03-01"],
      ["keep_1", "2026-03-02"],
      ["keep_2", "2026-03-02"],
    ]);

    const result = buildFirstSeenUniqueHighQualityGroups({
      rows,
      firstSeenByArticleId,
      limitPerDay: 2,
      qualityTier: "high",
      qualityThreshold: 62,
    });

    expect(result.totalArticles).toBe(2);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items.map((item) => item.article_id)).toEqual(["keep_1", "keep_2"]);
  });

  it("derives quality tier by score when quality_tier=all", () => {
    const rows = [
      row({ articleId: "high_one", date: "2026-03-02", rankScore: 90, qualityScoreSnapshot: 70 }),
      row({ articleId: "general_one", date: "2026-03-02", rankScore: 80, qualityScoreSnapshot: 50 }),
    ];

    const result = buildFirstSeenUniqueHighQualityGroups({
      rows,
      firstSeenByArticleId: new Map([
        ["high_one", "2026-03-02"],
        ["general_one", "2026-03-02"],
      ]),
      limitPerDay: 10,
      qualityTier: "all",
      qualityThreshold: 62,
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items.map((item) => item.quality_tier)).toEqual(["high", "general"]);
  });

  it("keeps explicit quality tier for non-all responses", () => {
    const rows = [row({ articleId: "g1", date: "2026-03-02", rankScore: 80, qualityScoreSnapshot: 40 })];

    const result = buildFirstSeenUniqueHighQualityGroups({
      rows,
      firstSeenByArticleId: new Map([["g1", "2026-03-02"]]),
      limitPerDay: 10,
      qualityTier: "general",
      qualityThreshold: 62,
    });

    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items[0].quality_tier).toBe("general");
  });
});
