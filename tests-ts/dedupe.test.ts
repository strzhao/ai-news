import { describe, expect, it } from "vitest";
import { dedupeArticles, normalizeUrl } from "@/lib/process/dedupe";

describe("dedupe", () => {
  it("normalizeUrl removes tracking params", () => {
    const normalized = normalizeUrl("https://example.com/a?utm_source=x&id=1");
    expect(normalized).toContain("id=1");
    expect(normalized).not.toContain("utm_source");
  });

  it("dedupeArticles drops url duplicates", () => {
    const baseArticle = {
      id: "1",
      title: "Title A",
      url: "https://example.com/a?id=1",
      infoUrl: "",
      sourceId: "s1",
      sourceName: "Source",
      publishedAt: null,
      summaryRaw: "",
      leadParagraph: "",
      contentText: "",
      tags: [],
      primaryType: "",
      secondaryTypes: [],
    };

    const [deduped, stats] = dedupeArticles(
      [baseArticle, { ...baseArticle, id: "2", url: "https://example.com/a?id=1&utm_campaign=t" }],
      0.93,
      true,
    ) as any;

    expect(deduped).toHaveLength(1);
    expect(stats.urlDuplicates).toBe(1);
  });
});
