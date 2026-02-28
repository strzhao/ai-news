import { describe, expect, it } from "vitest";
import {
  aggregateArchiveArticlesFromDigests,
  extractArchiveArticlesFromMarkdown,
  resolveArchiveArticleUrl,
} from "@/lib/domain/archive-articles";

describe("archive articles", () => {
  it("extractArchiveArticlesFromMarkdown supports markdown-link heading format", () => {
    const markdown = [
      "## 重点文章",
      "### 1. ⭐ [Title A](https://example.com/a?utm_source=x&id=1)",
      "- 导语 A",
      "### 2. [Title B](https://example.com/b)",
      "- 导语 B",
      "",
    ].join("\n");

    const items = extractArchiveArticlesFromMarkdown(markdown);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "Title A",
      url: "https://example.com/a?id=1",
      summary: "导语 A",
    });
    expect(items[1]).toEqual({
      title: "Title B",
      url: "https://example.com/b",
      summary: "导语 B",
    });
  });

  it("extractArchiveArticlesFromMarkdown supports legacy link lines", () => {
    const markdown = [
      "## 重点文章（Top 8）",
      "### 1. Legacy Story",
      "- 来源：Some Blog",
      "- 链接：https://news.example.com/p1",
      "- 一句话总结：这是摘要",
      "",
    ].join("\n");

    const items = extractArchiveArticlesFromMarkdown(markdown);
    expect(items).toHaveLength(1);
    expect(items[0]).toEqual({
      title: "Legacy Story",
      url: "https://news.example.com/p1",
      summary: "这是摘要",
    });
  });

  it("resolveArchiveArticleUrl unwraps tracker links and normalizes target", () => {
    const tracked =
      "https://ai-news.example.com/api/r?u=https%3A%2F%2Forigin.example.com%2Fpost%3Futm_source%3Dfeed%26id%3D7&sid=s1";

    expect(resolveArchiveArticleUrl(tracked)).toBe("https://origin.example.com/post?id=7");
  });

  it("aggregateArchiveArticlesFromDigests applies global dedupe and keeps latest item", () => {
    const latestMarkdown = [
      "## 重点文章",
      "### 1. [Same Story](https://example.com/same?utm_source=x)",
      "- latest summary",
      "### 2. [Only New](https://example.com/new)",
      "- new summary",
      "",
    ].join("\n");

    const olderMarkdown = [
      "## 重点文章",
      "### 1. [Same Story](https://example.com/same)",
      "- old summary",
      "### 2. [Only Old](https://example.com/old)",
      "- old summary",
      "",
    ].join("\n");

    const result = aggregateArchiveArticlesFromDigests(
      [
        {
          digest_id: "d_old",
          date: "2026-02-27",
          generated_at: "2026-02-27T09:00:00.000Z",
          markdown: olderMarkdown,
        },
        {
          digest_id: "d_new",
          date: "2026-02-28",
          generated_at: "2026-02-28T09:00:00.000Z",
          markdown: latestMarkdown,
        },
      ],
      {
        articleLimitPerDay: 50,
      },
    );

    expect(result.totalArticles).toBe(3);
    expect(result.groups).toHaveLength(2);

    const latestGroup = result.groups.find((group) => group.date === "2026-02-28");
    expect(latestGroup?.items).toHaveLength(2);
    expect(latestGroup?.items.map((item) => item.title)).toEqual(["Same Story", "Only New"]);

    const olderGroup = result.groups.find((group) => group.date === "2026-02-27");
    expect(olderGroup?.items).toHaveLength(1);
    expect(olderGroup?.items[0].title).toBe("Only Old");

    expect(latestGroup?.items[0].article_id).toHaveLength(16);
  });

  it("aggregateArchiveArticlesFromDigests supports unlimited per-day articles when limit is 0", () => {
    const markdown = [
      "## 重点文章",
      "### 1. [A](https://example.com/a)",
      "- summary",
      "### 2. [B](https://example.com/b)",
      "- summary",
      "### 3. [C](https://example.com/c)",
      "- summary",
      "",
    ].join("\n");

    const result = aggregateArchiveArticlesFromDigests([
      {
        digest_id: "d_1",
        date: "2026-02-28",
        generated_at: "2026-02-28T09:00:00.000Z",
        markdown,
      },
    ], {
      articleLimitPerDay: 0,
    });

    expect(result.totalArticles).toBe(3);
    expect(result.groups).toHaveLength(1);
    expect(result.groups[0].items).toHaveLength(3);
  });
});
