import { describe, expect, it } from "vitest";
import type {
  Article,
  ArticleAssessment,
  SourceConfig,
  SourceQualityScore,
} from "@/lib/domain/models";
import { WORTH_MUST_READ, WORTH_WORTH_READING } from "@/lib/domain/models";
import {
  buildSourceFetchLimits,
  computeSourceQualityScores,
  rankSourcesByPriority,
} from "@/lib/process/source-quality";

function makeSource(id: string, weight = 0.5): SourceConfig {
  return {
    id,
    name: id,
    url: `https://${id}.com`,
    sourceWeight: weight,
    sourceType: null,
    onlyExternalLinks: false,
  };
}

function makeArticle(
  id: string,
  sourceId: string,
  publishedAt: Date | null = new Date(),
): Article {
  return {
    id,
    title: `Article ${id}`,
    url: `https://example.com/${id}`,
    sourceId,
    sourceName: sourceId,
    publishedAt,
    summaryRaw: "",
    leadParagraph: "",
    contentText: "",
    infoUrl: "",
    tags: [],
    primaryType: "news",
    secondaryTypes: [],
  };
}

function makeAssessment(
  articleId: string,
  qualityScore = 70,
  worth = WORTH_WORTH_READING as string,
): ArticleAssessment {
  return {
    articleId,
    worth: worth as any,
    qualityScore,
    practicalityScore: 50,
    actionabilityScore: 50,
    noveltyScore: 50,
    clarityScore: 50,
    oneLineSummary: "",
    reasonShort: "",
    companyImpact: 60,
    teamImpact: 50,
    personalImpact: 40,
    executionClarity: 50,
    actionHint: "",
    bestForRoles: [],
    confidence: 0.8,
    evidenceSignals: [],
    primaryType: "analysis",
    secondaryTypes: [],
    tagGroups: {},
    cacheKey: `cache_${articleId}`,
  };
}

describe("rankSourcesByPriority", () => {
  it("sorts sources by combined priority score", () => {
    const sources = [
      makeSource("first", 0.9),
      makeSource("second", 0.5),
      makeSource("third", 0.2),
    ];
    const result = rankSourcesByPriority(sources, {});
    expect(result[0].id).toBe("first");
    expect(result[2].id).toBe("third");
  });

  it("returns empty array for empty input", () => {
    expect(rankSourcesByPriority([], {})).toEqual([]);
  });

  it("incorporates historical scores", () => {
    const sources = [makeSource("a", 0.5), makeSource("b", 0.5)];
    const historical: Record<string, SourceQualityScore> = {
      b: {
        sourceId: "b",
        qualityScore: 95,
        articleCount: 10,
        mustReadRate: 0.5,
        avgConfidence: 0.9,
        freshness: 1,
      },
    };
    const result = rankSourcesByPriority(sources, historical);
    expect(result.length).toBe(2);
  });
});

describe("buildSourceFetchLimits", () => {
  it("assigns high/medium/low limits based on position", () => {
    const sources = [
      makeSource("a"),
      makeSource("b"),
      makeSource("c"),
      makeSource("d"),
      makeSource("e"),
      makeSource("f"),
    ];
    const limits = buildSourceFetchLimits(sources, 30, 22, 12);
    expect(limits["a"]).toBe(30);
    expect(limits["c"]).toBe(22);
    expect(limits["f"]).toBe(12);
  });

  it("returns empty object for empty sources", () => {
    expect(buildSourceFetchLimits([])).toEqual({});
  });

  it("handles single source", () => {
    const limits = buildSourceFetchLimits([makeSource("only")]);
    expect(limits["only"]).toBeDefined();
  });
});

describe("computeSourceQualityScores", () => {
  it("computes quality scores from articles and assessments", () => {
    const now = new Date();
    const articles = [makeArticle("a1", "src1", now)];
    const assessments: Record<string, ArticleAssessment> = {
      a1: makeAssessment("a1", 80, WORTH_MUST_READ),
    };
    const scores = computeSourceQualityScores(
      articles,
      assessments,
      {},
      30,
      8,
      now,
    );
    expect(scores).toHaveLength(1);
    expect(scores[0].sourceId).toBe("src1");
    expect(scores[0].qualityScore).toBeGreaterThan(0);
  });

  it("returns empty array when no assessments match", () => {
    const articles = [makeArticle("a1", "src1")];
    const scores = computeSourceQualityScores(articles, {});
    expect(scores).toEqual([]);
  });

  it("filters out articles older than lookback period", () => {
    const now = new Date();
    const old = new Date(now.getTime() - 60 * 86_400_000);
    const articles = [makeArticle("a1", "src1", old)];
    const assessments: Record<string, ArticleAssessment> = {
      a1: makeAssessment("a1"),
    };
    const scores = computeSourceQualityScores(
      articles,
      assessments,
      {},
      30,
      8,
      now,
    );
    expect(scores).toEqual([]);
  });
});
