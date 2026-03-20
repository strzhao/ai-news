import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/domain/models";
import { normalizeArticles } from "@/lib/process/normalize";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "a1",
    title: "Test Title",
    url: "https://example.com/article",
    sourceId: "src1",
    sourceName: "Source",
    publishedAt: new Date("2024-01-01T00:00:00Z"),
    summaryRaw: "Summary text",
    leadParagraph: "Lead paragraph",
    contentText: "Content text",
    infoUrl: "https://example.com/article",
    tags: ["ai"],
    primaryType: "news",
    secondaryTypes: ["tech"],
    ...overrides,
  };
}

describe("normalizeArticles", () => {
  it("normalizes basic article fields", () => {
    const articles = [makeArticle({ title: "  Hello   World  " })];
    const [result] = normalizeArticles(articles);
    expect(result.title).toBe("Hello World");
  });

  it("truncates title exceeding 240 chars", () => {
    const longTitle = "A".repeat(300);
    const [result] = normalizeArticles([makeArticle({ title: longTitle })]);
    expect(result.title.length).toBeLessThanOrEqual(243);
    expect(result.title).toMatch(/\.\.\.$/);
  });

  it("truncates contentText exceeding 2400 chars", () => {
    const longContent = "B".repeat(3000);
    const [result] = normalizeArticles([
      makeArticle({ contentText: longContent }),
    ]);
    expect(result.contentText.length).toBeLessThanOrEqual(2403);
    expect(result.contentText).toMatch(/\.\.\.$/);
  });

  it("returns empty array for empty input", () => {
    expect(normalizeArticles([])).toEqual([]);
  });

  it("trims url whitespace", () => {
    const [result] = normalizeArticles([
      makeArticle({ url: "  https://example.com  " }),
    ]);
    expect(result.url).toBe("https://example.com");
  });

  it("preserves valid publishedAt as Date", () => {
    const date = new Date("2024-06-15T12:00:00Z");
    const [result] = normalizeArticles([makeArticle({ publishedAt: date })]);
    expect(result.publishedAt).toBeInstanceOf(Date);
    expect(result.publishedAt!.toISOString()).toBe("2024-06-15T12:00:00.000Z");
  });

  it("copies tags array (no reference sharing)", () => {
    const original = makeArticle({ tags: ["a", "b"] });
    const [result] = normalizeArticles([original]);
    expect(result.tags).toEqual(["a", "b"]);
    expect(result.tags).not.toBe(original.tags);
  });
});
