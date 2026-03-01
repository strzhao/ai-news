import { afterEach, describe, expect, it } from "vitest";
import {
  buildFlomoArchiveArticlesPayload,
  renderFlomoArchiveArticlesContent,
} from "@/lib/output/flomo-archive-articles-formatter";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("flomo archive articles formatter", () => {
  it("renders overview, article list and home page link", () => {
    process.env.FLOMO_H5_URL = "https://ai-news.example.com";

    const payload = buildFlomoArchiveArticlesPayload({
      reportDate: "2026-03-01",
      articles: [
        {
          article_id: "a1",
          title: "First",
          url: "https://example.com/a1",
          summary: "第一篇摘要",
          image_url: "",
          source_host: "example.com",
          date: "2026-03-01",
          digest_id: "d1",
          generated_at: "2026-03-01T00:10:00.000Z",
        },
        {
          article_id: "a2",
          title: "Second",
          url: "https://example.com/a2",
          summary: "第二篇摘要",
          image_url: "",
          source_host: "example.com",
          date: "2026-03-01",
          digest_id: "d1",
          generated_at: "2026-03-01T00:10:00.000Z",
        },
      ],
    });

    expect(payload.dedupeKey).toBe("archive-articles-2026-03-01");
    expect(payload.content).toContain("【今日速览】");
    expect(payload.content).toContain("- 日期：2026-03-01");
    expect(payload.content).toContain("- 今日共 2 篇重点文章。");
    expect(payload.content).toContain("【重点文章】");
    expect(payload.content).toContain("1. First");
    expect(payload.content).toContain("链接：https://example.com/a1");
    expect(payload.content).toContain("查看更多：https://ai-news.example.com/");
  });

  it("renders fallback text when there is no article", () => {
    const content = renderFlomoArchiveArticlesContent({
      reportDate: "2026-03-01",
      articles: [],
    });

    expect(content).toContain("【重点文章】");
    expect(content).toContain("今日暂无满足阈值的重点文章");
  });
});
