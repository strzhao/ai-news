import { describe, expect, it } from "vitest";
import type { Article } from "@/lib/domain/models";
import { buildInfoKey, buildTitleKey } from "@/lib/process/info-cluster";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "a1",
    title: "Test Title",
    url: "https://example.com/article",
    sourceId: "src1",
    sourceName: "Source",
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

describe("buildTitleKey", () => {
  it("returns a title: prefixed hash", () => {
    const key = buildTitleKey("Hello World");
    expect(key).toMatch(/^title:[a-f0-9]{16}$/);
  });

  it("returns same key for case-insensitive equivalent titles", () => {
    expect(buildTitleKey("Hello World")).toBe(buildTitleKey("hello world"));
  });

  it("returns same key ignoring non-alnum characters", () => {
    expect(buildTitleKey("Hello, World!")).toBe(buildTitleKey("Hello World"));
  });

  it("returns 'title:empty' for empty/whitespace input", () => {
    expect(buildTitleKey("")).toBe("title:empty");
    expect(buildTitleKey("   ")).toBe("title:empty");
    expect(buildTitleKey(null as unknown as string)).toBe("title:empty");
  });
});

describe("buildInfoKey", () => {
  it("returns normalized URL when infoUrl is valid", () => {
    const key = buildInfoKey(
      makeArticle({ infoUrl: "https://Example.COM/path/" }),
    );
    expect(key).toContain("example.com");
    expect(key).not.toMatch(/\/$/);
  });

  it("falls back to article.url when infoUrl is empty", () => {
    const key = buildInfoKey(
      makeArticle({ infoUrl: "", url: "https://fallback.com/page" }),
    );
    expect(key).toContain("fallback.com");
  });

  it("falls back to buildTitleKey when both URLs are invalid", () => {
    const key = buildInfoKey(
      makeArticle({ infoUrl: "", url: "", title: "My Title" }),
    );
    expect(key).toMatch(/^title:[a-f0-9]{16}$/);
  });

  it("strips tracking params from URL", () => {
    const key = buildInfoKey(
      makeArticle({
        infoUrl: "https://example.com/page?utm_source=twitter&id=123",
      }),
    );
    expect(key).not.toContain("utm_source");
    expect(key).toContain("id=123");
  });

  it("strips hash from URL", () => {
    const key = buildInfoKey(
      makeArticle({
        infoUrl: "https://example.com/page#section",
      }),
    );
    expect(key).not.toContain("#section");
  });
});
