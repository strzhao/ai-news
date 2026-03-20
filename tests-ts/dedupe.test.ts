import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/domain/models";
import { dedupeArticles, normalizeUrl } from "@/lib/process/dedupe";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "a1",
    title: "Test Article",
    url: "https://example.com/article",
    sourceId: "src1",
    sourceName: "Source 1",
    publishedAt: null,
    summaryRaw: "",
    leadParagraph: "",
    contentText: "",
    infoUrl: "",
    tags: [],
    primaryType: "news",
    secondaryTypes: [],
    ...overrides,
  };
}

describe("normalizeUrl", () => {
  it("strips tracking params (utm_, fbclid, gclid, spm, ref)", () => {
    const url =
      "https://example.com/page?utm_source=x&utm_medium=y&fbclid=z&keep=1";
    const result = normalizeUrl(url);
    expect(result).toContain("keep=1");
    expect(result).not.toContain("utm_source");
    expect(result).not.toContain("fbclid");
  });

  it("removes trailing slash and hash", () => {
    expect(normalizeUrl("https://example.com/path/#section")).toBe(
      "https://example.com/path",
    );
  });

  it("returns trimmed string for invalid URLs", () => {
    expect(normalizeUrl("not-a-url")).toBe("not-a-url");
    expect(normalizeUrl("  ")).toBe("");
    expect(normalizeUrl("")).toBe("");
  });
});

describe("dedupeArticles", () => {
  it("removes duplicate URLs", () => {
    const articles = [
      makeArticle({ id: "a1", url: "https://example.com/page" }),
      makeArticle({ id: "a2", url: "https://example.com/page" }),
    ];
    const result = dedupeArticles(articles) as Article[];
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a1");
  });

  it("removes articles with very similar titles", () => {
    const articles = [
      makeArticle({
        id: "a1",
        url: "https://a.com/1",
        title: "Breaking News: AI Model Released Today",
      }),
      makeArticle({
        id: "a2",
        url: "https://b.com/2",
        title: "Breaking News: AI Model Released Today!",
      }),
    ];
    const result = dedupeArticles(articles, 0.9) as Article[];
    expect(result).toHaveLength(1);
  });

  it("keeps articles with different titles", () => {
    const articles = [
      makeArticle({ id: "a1", url: "https://a.com/1", title: "Apple" }),
      makeArticle({
        id: "a2",
        url: "https://b.com/2",
        title: "Completely different topic about quantum physics",
      }),
    ];
    const result = dedupeArticles(articles) as Article[];
    expect(result).toHaveLength(2);
  });

  it("returns empty array for empty input", () => {
    const result = dedupeArticles([]) as Article[];
    expect(result).toEqual([]);
  });

  it("returns stats when returnStats is true", () => {
    const articles = [
      makeArticle({ id: "a1", url: "https://a.com/1" }),
      makeArticle({ id: "a2", url: "https://a.com/1" }),
    ];
    const [deduped, stats] = dedupeArticles(articles, 0.93, true) as [
      Article[],
      any,
    ];
    expect(deduped).toHaveLength(1);
    expect(stats.urlDuplicates).toBe(1);
    expect(stats.totalInput).toBe(2);
  });
});
