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
  it("renders summary-first overview, tracker links, and tail tags", () => {
    process.env.FLOMO_H5_URL = "https://ai-news.example.com";
    process.env.TRACKER_BASE_URL = "https://tracker.example.com";
    process.env.TRACKER_SIGNING_SECRET = "tracker-secret";

    const payload = buildFlomoArchiveArticlesPayload({
      reportDate: "2026-03-01",
      dedupeKey: "batch-123",
      activeTagDefinitions: [
        {
          group_key: "topic",
          tag_key: "multi_agent",
          display_name: "multi_agent",
          description: "",
          aliases: ["multi agent"],
          is_active: true,
          managed_by: "ai",
          updated_at: "2026-03-01T00:00:00.000Z",
        },
      ],
      articles: [
        {
          article_id: "a1",
          title: "First",
          url: "https://example.com/a1",
          original_url: "https://example.com/a1",
          summary: "第一篇摘要",
          image_url: "",
          source_host: "example.com",
          tag_groups: {
            topic: ["multi agent", "rag"],
            role: ["ai engineer"],
          },
          date: "2026-03-01",
          digest_id: "d1",
          generated_at: "2026-03-01T00:10:00.000Z",
        },
        {
          article_id: "a2",
          title: "Second",
          url: "https://example.com/a2",
          original_url: "https://example.com/a2",
          summary: "第二篇摘要",
          image_url: "",
          source_host: "example.com",
          tag_groups: {
            topic: ["multi_agent"],
          },
          date: "2026-03-01",
          digest_id: "d1",
          generated_at: "2026-03-01T00:10:00.000Z",
        },
      ],
    });

    expect(payload.dedupeKey).toBe("batch-123");
    expect(payload.content).toContain("【今日速览】");
    expect(payload.content).not.toContain("日期：");
    expect(payload.content).not.toContain("今日共");
    expect(payload.content).toContain("- 第一篇摘要");
    expect(payload.content).toContain("【重点文章】");
    expect(payload.content).toContain("1. First");
    expect(payload.content).toContain("链接：https://tracker.example.com/api/r?");
    expect(payload.content).toContain("sid=example.com");
    expect(payload.content).toContain("aid=a1");
    expect(payload.content).toContain("d=2026-03-01");
    expect(payload.content).toContain("ch=flomo");
    expect(payload.content).toContain("sig=");
    expect(payload.content).toContain("查看更多：https://ai-news.example.com/");
    expect(payload.content).toContain("#AI新闻");
    expect(payload.content).toContain("#multi_agent");
    expect(payload.content).toContain("#rag");
    expect(payload.content).toContain("#ai_engineer");

    const nonEmptyLines = payload.content
      .trim()
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const lastLine = nonEmptyLines[nonEmptyLines.length - 1] || "";
    expect(lastLine.startsWith("#")).toBe(true);
    const tagTokens = lastLine.split(/\s+/);
    expect(tagTokens.every((token) => token.startsWith("#") && !token.includes(" "))).toBe(true);
    expect(tagTokens.length).toBeLessThanOrEqual(4);
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
